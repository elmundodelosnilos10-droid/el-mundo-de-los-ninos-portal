import { env } from "@/lib/runtime/env";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { activityProgress, enrollments, groups, students } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole, maySeeStudent } from "@/lib/access";
import { interactiveActivities } from "@/app/actividades/catalog";
import { correctAnswers } from "@/app/actividades/answers";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";

const point = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
const drawing = z.object({ color: z.enum(["#237345", "#ffb629", "#ed6b68", "#4285d4", "#8659ad", "#293c30"]), points: z.array(point).min(1).max(160) });
const input = z.object({ studentId: z.uuid(), activityId: z.string().min(1).max(80), answer: z.string().max(100).optional(), artwork: z.array(drawing).max(30).optional() });

async function enrolledStage(studentId: string) {
  const rows = await getDb().select({ stage: groups.stage }).from(enrollments)
    .innerJoin(groups, eq(groups.id, enrollments.groupId))
    .where(and(eq(enrollments.studentId, studentId), isNull(enrollments.endedAt), eq(groups.active, true)));
  return rows.map(row => row.stage);
}

export async function GET(request: Request) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "tutor", "docente", "direccion", "superadmin")) return errorResponse(403, "No tienes permiso para consultar estos logros.");
  const studentId = new URL(request.url).searchParams.get("studentId");
  if (!studentId || !(await maySeeStudent(actor, studentId))) return errorResponse(404, "Alumno no disponible.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const client = createSchoolDatabaseClient(env);
      const student = await client.select<{ id: string }>(actor.supabaseAuth.accessToken, "students", { columns: ["id"], filters: [{ column: "id", operator: "eq", value: studentId }, { column: "active", operator: "eq", value: true }], limit: 1 });
      if (!student.data.length) return errorResponse(404, "Alumno no disponible.");
      const result = await client.select<{ activity_id: string; completed_at: string; artwork_json: string | null }>(actor.supabaseAuth.accessToken, "activity_progress", {
        columns: ["activity_id", "completed_at", "artwork_json"], filters: [{ column: "student_id", operator: "eq", value: studentId }],
        orderBy: [{ column: "completed_at", ascending: false }, { column: "id" }], limit: 500,
      });
      return Response.json({ items: result.data.map(row => ({ activityId: row.activity_id, completedAt: row.completed_at, artwork: row.artwork_json ? JSON.parse(row.artwork_json) : null })) }, { headers: { "Cache-Control": "no-store" } });
    } catch { return errorResponse(503, "No se pudieron cargar los logros escolares."); }
  }
  const items = await getDb().select({ activityId: activityProgress.activityId, completedAt: activityProgress.completedAt, artworkJson: activityProgress.artworkJson })
    .from(activityProgress).innerJoin(students, eq(students.id, activityProgress.studentId))
    .where(and(eq(activityProgress.studentId, studentId), eq(students.active, true)));
  return Response.json({ items: items.map(item => ({ activityId: item.activityId, completedAt: item.completedAt, artwork: item.artworkJson ? JSON.parse(item.artworkJson) : null })) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "tutor")) return errorResponse(403, "Las actividades se guardan desde la cuenta de la familia.");
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "Revisa la actividad y vuelve a intentarlo.");
  const { studentId, activityId, answer, artwork } = parsed.data;
  if (!(await maySeeStudent(actor, studentId))) return errorResponse(404, "Alumno no disponible.");
  const activity = interactiveActivities.find(item => item.id === activityId);
  const stages = env.SCHOOL_DATA_PROVIDER === "supabase" ? null : await enrolledStage(studentId);
  if (!activity || (stages && !stages.some(stage => activity.stages.includes(stage)))) return errorResponse(400, "Esta actividad no está disponible para la etapa del alumno.");
  let savedArtwork: string | null = null;
  if (activity.kind === "drawing") {
    if (!artwork?.length || answer !== undefined) return errorResponse(400, "Completa el dibujo antes de guardarlo.");
    savedArtwork = JSON.stringify(artwork);
  } else if (answer !== correctAnswers[activityId] || artwork !== undefined) {
    return errorResponse(400, "Aún no. Inténtenlo juntos una vez más.");
  }
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const result = await createSchoolDatabaseClient(env).rpc<{ saved: boolean; activityId: string; completedAt: string }>(actor.supabaseAuth.accessToken, "school_save_activity_progress", {
        p_student_id: studentId, p_activity_id: activityId, p_answer: answer ?? null,
        p_artwork: savedArtwork ? JSON.parse(savedArtwork) : null,
      });
      const saved = result.data[0];
      if (!saved?.saved || saved.activityId !== activityId || !saved.completedAt) return errorResponse(503, "No se pudo confirmar el logro escolar.");
      return Response.json(saved, { headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "Alumno no disponible.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 400) return errorResponse(400, "Revisa la respuesta, el dibujo y la etapa del alumno.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "Las actividades se guardan desde la cuenta de la familia.");
      return errorResponse(503, "No se pudo guardar el logro escolar.");
    }
  }
  const db = getDb();
  const now = new Date();
  await db.insert(activityProgress).values({ id: crypto.randomUUID(), studentId, activityId, completedAt: now, artworkJson: savedArtwork, updatedAt: now })
    .onConflictDoUpdate({ target: [activityProgress.studentId, activityProgress.activityId], set: { completedAt: now, artworkJson: savedArtwork, updatedAt: now } });
  return Response.json({ saved: true, activityId, completedAt: now }, { headers: { "Cache-Control": "no-store" } });
}
