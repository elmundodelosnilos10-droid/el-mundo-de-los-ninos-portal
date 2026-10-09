import { env } from "@/lib/runtime/env";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { auditLog, observations, students } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole, maySeeStudent, mayTeachGroup } from "@/lib/access";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { enrollments } from "@/db/schema";
import { notifyStudentFamilies } from "@/lib/family-notifications";

const categories = ["lenguaje", "motricidad", "socioemocional", "participacion", "autonomia", "convivencia", "creatividad", "objetivo_aprendizaje"] as const;
const input = z.object({ category: z.enum(categories), body: z.string().trim().min(2).max(2000), visibleToFamily: z.boolean().default(false) });

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  const { id } = await context.params;
  if (!(await maySeeStudent(actor, id))) return errorResponse(404, "Alumno no disponible.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const result = await createSchoolDatabaseClient(env).select<{ id: string; category: string; body: string; visible_to_family: boolean; recorded_at: string }>(actor.supabaseAuth.accessToken, "observations", {
        columns: ["id", "category", "body", "visible_to_family", "recorded_at"],
        filters: [{ column: "student_id", operator: "eq", value: id }],
        orderBy: [{ column: "recorded_at" }, { column: "id" }], limit: 500,
      });
      return Response.json({ items: result.data.map(row => ({ id: row.id, category: row.category, body: row.body, visibleToFamily: row.visible_to_family, recordedAt: row.recorded_at })) }, { headers: { "Cache-Control": "no-store" } });
    } catch { return errorResponse(503, "No se pudo cargar el seguimiento escolar."); }
  }
  const rows = hasRole(actor, "superadmin", "direccion", "docente")
    ? await getDb().select().from(observations).where(eq(observations.studentId, id)).orderBy(asc(observations.recordedAt))
    : await getDb().select({ id: observations.id, studentId: observations.studentId, category: observations.category, body: observations.body, visibleToFamily: observations.visibleToFamily, recordedAt: observations.recordedAt }).from(observations).where(and(eq(observations.studentId, id), eq(observations.visibleToFamily, true))).orderBy(asc(observations.recordedAt));
  return Response.json({ items: rows }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion", "docente")) return errorResponse(403, "No tienes permiso para registrar observaciones.");
  const { id } = await context.params;
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
