import { env } from "@/lib/runtime/env";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { auditLog, observations, students, teacherGroups, teachers } from "@/db/schema";
import { actorFromRequest, errorResponse as accessErrorResponse, hasRole, maySeeStudent, mayTeachGroup } from "@/lib/access";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { enrollments } from "@/db/schema";
import { notifyStudentFamilies } from "@/lib/family-notifications";
import { isObservationUuid, makeObservationPage, OBSERVATION_PAGE_SIZE, parseObservationCursor, readSupabaseObservationPage } from "@/lib/supabase/observation-page";

const categories = ["lenguaje", "motricidad", "socioemocional", "participacion", "autonomia", "convivencia", "creatividad", "objetivo_aprendizaje"] as const;
const input = z.object({ category: z.enum(categories), body: z.string().trim().min(2).max(2000), visibleToFamily: z.boolean().default(false) });
function errorResponse(status: Parameters<typeof accessErrorResponse>[0], message: string) {
  const response = accessErrorResponse(status, message);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  const { id } = await context.params;
  if (!isObservationUuid(id)) return errorResponse(404, "Alumno no disponible.");
  try {
    if (!(await maySeeStudent(actor, id))) return errorResponse(404, "Alumno no disponible.");
  } catch { return errorResponse(503, "No se pudo comprobar el acceso al seguimiento escolar."); }
  const params = new URL(request.url).searchParams;
  let cursor;
  try {
    if (params.getAll("cursor").length > 1) throw new Error("invalid_cursor");
    cursor = parseObservationCursor(params.get("cursor"), id);
  } catch { return errorResponse(400, "El cursor del seguimiento no es válido."); }
  const staff = hasRole(actor, "superadmin", "direccion", "docente");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const page = await readSupabaseObservationPage(createSchoolDatabaseClient(env), actor.supabaseAuth.accessToken, id, cursor, staff);
      return Response.json(page, { headers: { "Cache-Control": "no-store" } });
    } catch { return errorResponse(503, "No se pudo cargar el seguimiento escolar."); }
  }
  const before = cursor ? new Date(cursor.recordedAt) : null;
  // The legacy SQLite column stores integer seconds, never PostgreSQL fractions.
  if (cursor && !cursor.recordedAt.endsWith(".000000Z")) return errorResponse(400, "El cursor del seguimiento no es válido.");
  try {
    const db = getDb();
    let internal = hasRole(actor, "superadmin", "direccion");
    if (!internal && hasRole(actor, "docente")) {
      const assignment = await db.select({ teacherId: teacherGroups.teacherId }).from(teacherGroups)
        .innerJoin(teachers, eq(teachers.id, teacherGroups.teacherId))
        .innerJoin(enrollments, eq(enrollments.groupId, teacherGroups.groupId))
        .where(and(eq(teachers.userId, actor.id), eq(teachers.active, true), eq(enrollments.studentId, id), isNull(enrollments.endedAt))).limit(1);
      internal = assignment.length > 0;
    }
    const rows = await db.select({ id: observations.id, category: observations.category, body: observations.body, visibleToFamily: observations.visibleToFamily, recordedAt: observations.recordedAt })
      .from(observations).where(and(eq(observations.studentId, id), internal ? undefined : eq(observations.visibleToFamily, true),
        cursor && before ? or(lt(observations.recordedAt, before), and(eq(observations.recordedAt, before), lt(observations.id, cursor.id))) : undefined))
      .orderBy(desc(observations.recordedAt), desc(observations.id)).limit(OBSERVATION_PAGE_SIZE + 1);
    return Response.json(makeObservationPage(id, rows.map(row => ({ ...row, recordedAt: row.recordedAt.toISOString() }))), { headers: { "Cache-Control": "no-store" } });
  } catch { return errorResponse(503, "No se pudo cargar el seguimiento escolar."); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion", "docente")) return errorResponse(403, "No tienes permiso para registrar observaciones.");
  const { id } = await context.params;
  if (!isObservationUuid(id)) return errorResponse(404, "Alumno no disponible.");
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "Revisa la categoría y la observación.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const result = await createSchoolDatabaseClient(env).rpc<{ id: string }>(actor.supabaseAuth.accessToken, "school_record_observation", {
        p_id: crypto.randomUUID(), p_student_id: id, p_category: parsed.data.category,
        p_body: parsed.data.body, p_visible_to_family: parsed.data.visibleToFamily,
      });
      if (!result.data[0]?.id) return errorResponse(503, "No se pudo confirmar la observación.");
      return Response.json({ id: result.data[0].id }, { status: 201, headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "Alumno no disponible.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 400) return errorResponse(400, "Revisa la categoría y la observación.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "No tienes permiso para registrar observaciones.");
      return errorResponse(503, "No se pudo guardar la observación.");
    }
  }
  const db = getDb();
  const student = await db.select({ id: students.id, groupId: enrollments.groupId }).from(students).innerJoin(enrollments, eq(enrollments.studentId, students.id)).where(and(eq(students.id, id), eq(students.active, true))).limit(1);
  if (!student.length) return errorResponse(404, "Alumno no disponible.");
  if (!(await mayTeachGroup(actor, student[0].groupId))) return errorResponse(404, "Alumno no disponible.");
  const observationId = crypto.randomUUID(); const now = new Date();
  await db.batch([
    db.insert(observations).values({ id: observationId, studentId: id, category: parsed.data.category, body: parsed.data.body, visibleToFamily: parsed.data.visibleToFamily, recordedBy: actor.id, recordedAt: now }),
    db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "record_observation", entityType: "student", entityId: id, createdAt: now }),
  ]);
  if (parsed.data.visibleToFamily) await notifyStudentFamilies(id, { kind: "seguimiento", title: "Nueva observación de seguimiento", href: `/alumnos/${id}`, sourceId: observationId, createdAt: now });
  return Response.json({ id: observationId }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
