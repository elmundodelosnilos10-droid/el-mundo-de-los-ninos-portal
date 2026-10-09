import { env } from "@/lib/runtime/env";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { auditLog, guardians, notifications, studentGuardians, submissions, tasks, user, groups } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole, mayTeachGroup } from "@/lib/access";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";

const input = z.object({ status: z.enum(["revisada", "completada"]), reviewNote: z.string().trim().max(1000).optional(), evaluation: z.enum(["logrado", "en_proceso", "con_acompanamiento"]).nullable().optional() });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion", "docente")) return errorResponse(403, "No tienes permiso para revisar entregas.");
  const { id } = await context.params;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "Revisa el estado y el comentario.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const result = await createSchoolDatabaseClient(env).rpc<{ reviewed: boolean; reviewedAt: string }>(actor.supabaseAuth.accessToken, "school_review_submission", {
        p_submission_id: id,
        p_status: parsed.data.status,
        p_review_note: parsed.data.reviewNote ?? null,
        p_evaluation: parsed.data.evaluation ?? null,
      });
      if (result.data[0]?.reviewed !== true) return errorResponse(503, "No se pudo guardar la retroalimentación.");
      return Response.json({ reviewed: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 400) return errorResponse(400, "Revisa el estado, la etapa y la evaluación.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "No tienes permiso para revisar esta entrega.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "Entrega no disponible.");
      return errorResponse(503, "No se pudo guardar la retroalimentación.");
    }
  }
  const db = getDb();
  const row = await db.select({ id: submissions.id, taskId: submissions.taskId, studentId: submissions.studentId, groupId: tasks.groupId, stage: groups.stage }).from(submissions).innerJoin(tasks, eq(tasks.id, submissions.taskId)).innerJoin(groups, eq(groups.id, tasks.groupId)).where(eq(submissions.id, id)).limit(1);
  if (!row.length || !(await mayTeachGroup(actor, row[0].groupId))) return errorResponse(404, "Entrega no disponible.");
  if (parsed.data.evaluation && (row[0].stage === "lactantes" || row[0].stage === "maternal")) return errorResponse(400, "Para lactantes y maternal usa observaciones cualitativas, sin evaluación académica.");
  const now = new Date();
  const updates: { status: "revisada" | "completada"; reviewNote?: string; evaluation?: "logrado" | "en_proceso" | "con_acompanamiento" | null; reviewedBy: string; reviewedAt: Date } = { status: parsed.data.status, reviewNote: parsed.data.reviewNote, reviewedBy: actor.id, reviewedAt: now };
  if (Object.hasOwn(parsed.data, "evaluation")) updates.evaluation = parsed.data.evaluation ?? null;
  const recipients = await db.selectDistinct({ id: user.id }).from(studentGuardians).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).innerJoin(user, eq(user.id, guardians.userId)).where(and(eq(studentGuardians.studentId, row[0].studentId), eq(studentGuardians.active, true), eq(guardians.active, true)));
  await db.batch([
    db.update(submissions).set(updates).where(eq(submissions.id, id)),
    db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "review", entityType: "submission", entityId: id, createdAt: now }),
    ...recipients.map(recipient => db.insert(notifications).values({ id: crypto.randomUUID(), userId: recipient.id, kind: "entrega_revisada", title: "Revisaron una actividad", href: "/tareas", dedupeKey: `review:${id}:${now.getTime()}:${recipient.id}`, createdAt: now }).onConflictDoNothing()),
  ]);
  return Response.json({ reviewed: true }, { headers: { "Cache-Control": "no-store" } });
}
