import type { BatchItem } from "drizzle-orm/batch";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { attendance, attendanceJustifications, auditLog, guardians, notifications, studentGuardians, user } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole, mayTeachGroup } from "@/lib/access";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { env } from "@/lib/runtime/env";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";

const input = z.object({ status: z.enum(["aceptada", "rechazada"]) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion", "docente")) return errorResponse(403, "Solo personal autorizado puede resolver justificaciones.");
  const { id } = await context.params;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "Indica si la justificación se acepta o se rechaza.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const result = await createSchoolDatabaseClient(env).rpc<{ status: "aceptada" | "rechazada" }>(actor.supabaseAuth.accessToken, "school_review_attendance_justification", {
        p_id: id, p_status: parsed.data.status,
      });
      const payload = result.data[0];
      if (!payload || payload.status !== parsed.data.status) return errorResponse(503, "No se pudo resolver la justificación.");
      return Response.json({ status: payload.status }, { headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 400) return errorResponse(400, "Indica si la justificación se acepta o se rechaza.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "No tienes permiso para resolver esta justificación.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "Justificación no disponible.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 409) return errorResponse(409, "Esta justificación ya fue resuelta.");
      return errorResponse(503, "No se pudo resolver la justificación.");
    }
  }
  const db = getDb();
  const [requestRow] = await db.select({ id: attendanceJustifications.id, studentId: attendanceJustifications.studentId, groupId: attendanceJustifications.groupId, onDate: attendanceJustifications.onDate, reason: attendanceJustifications.reason, status: attendanceJustifications.status })
    .from(attendanceJustifications).where(eq(attendanceJustifications.id, id)).limit(1);
  if (!requestRow || !(await mayTeachGroup(actor, requestRow.groupId))) return errorResponse(404, "Justificación no disponible.");
  if (requestRow.status !== "pendiente") return errorResponse(409, "Esta justificación ya fue resuelta.");

  const now = new Date();
  const guardiansForStudent = await db.selectDistinct({ id: user.id }).from(studentGuardians).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).innerJoin(user, eq(user.id, guardians.userId))
    .where(and(eq(studentGuardians.studentId, requestRow.studentId), eq(studentGuardians.active, true), eq(guardians.active, true), eq(user.active, true)));
  const operations: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
    db.update(attendanceJustifications).set({ status: parsed.data.status, reviewedBy: actor.id, reviewedAt: now }).where(and(eq(attendanceJustifications.id, id), eq(attendanceJustifications.status, "pendiente"))),
    ...(parsed.data.status === "aceptada" ? [db.insert(attendance).values({ id: crypto.randomUUID(), studentId: requestRow.studentId, groupId: requestRow.groupId, onDate: requestRow.onDate, status: "justificada", note: requestRow.reason, recordedBy: actor.id, modifiedBy: actor.id, modifiedAt: now }).onConflictDoUpdate({ target: [attendance.studentId, attendance.onDate], set: { groupId: requestRow.groupId, status: "justificada", note: requestRow.reason, modifiedBy: actor.id, modifiedAt: now } })] : []),
    db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: parsed.data.status === "aceptada" ? "approve_attendance_justification" : "reject_attendance_justification", entityType: "attendance_justification", entityId: id, createdAt: now }),
    ...guardiansForStudent.map(recipient => db.insert(notifications).values({ id: crypto.randomUUID(), userId: recipient.id, kind: `asistencia_justificacion_${parsed.data.status}`, title: parsed.data.status === "aceptada" ? "Aceptaron tu justificación de asistencia" : "Respondieron a tu justificación de asistencia", href: "/asistencia", dedupeKey: `attendance-justification:${id}:${parsed.data.status}:${now.getTime()}:${recipient.id}`, createdAt: now }).onConflictDoNothing()),
  ];
  await db.batch(operations);
  return Response.json({ status: parsed.data.status }, { headers: { "Cache-Control": "no-store" } });
}
