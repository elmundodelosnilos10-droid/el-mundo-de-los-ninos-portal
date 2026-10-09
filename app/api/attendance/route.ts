import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { attendance, auditLog, enrollments, guardians, students, studentGuardians } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole, mayTeachGroup } from "@/lib/access";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { env } from "@/lib/runtime/env";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";

const entry = z.object({ studentId: z.uuid(), status: z.enum(["presente", "ausente", "retardo", "justificada"]), note: z.string().trim().max(400).optional() }).superRefine((record, context) => {
  if (record.status === "justificada" && (record.note?.length ?? 0) < 2) context.addIssue({ code: "custom", path: ["note"], message: "Agrega el motivo de la falta justificada." });
});
const input = z.object({ groupId: z.uuid(), onDate: z.iso.date(), records: z.array(entry).min(1).max(80) });

export async function GET(request: Request) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  const url = new URL(request.url); const groupId = url.searchParams.get("groupId"); const onDate = url.searchParams.get("date");
  if (!groupId || !onDate || !z.iso.date().safeParse(onDate).success) return errorResponse(400, "Indica el grupo y la fecha.");
  const isStaff = hasRole(actor, "superadmin", "direccion", "docente");
  if (!isStaff && !hasRole(actor, "tutor")) return errorResponse(403, "No tienes permiso para consultar asistencia.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const result = await createSchoolDatabaseClient(env).rpc<{ items: { id: string | null; studentId: string; givenName: string; familyName: string; status: string | null; note: string | null; modifiedAt: string | null }[] }>(actor.supabaseAuth.accessToken, "school_attendance_roster", {
        p_group_id: groupId, p_on_date: onDate,
      });
      const payload = result.data[0];
      if (!payload || !Array.isArray(payload.items)) return errorResponse(503, "No se pudo consultar la lista de asistencia.");
      return Response.json({ items: payload.items }, { headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "No tienes permiso para consultar este grupo.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "Grupo no disponible.");
      return errorResponse(503, "No se pudo consultar la lista de asistencia.");
    }
  }
  if (isStaff && !(await mayTeachGroup(actor, groupId))) return errorResponse(404, "Grupo no disponible.");
  const db = getDb();
  let rows;
  if (isStaff) rows = await db.select({ id: attendance.id, studentId: students.id, givenName: students.givenName, familyName: students.familyName, status: attendance.status, note: attendance.note, modifiedAt: attendance.modifiedAt }).from(enrollments).innerJoin(students, eq(students.id, enrollments.studentId)).leftJoin(attendance, and(eq(attendance.studentId, students.id), eq(attendance.onDate, onDate))).where(and(eq(enrollments.groupId, groupId), isNull(enrollments.endedAt), eq(students.active, true))).orderBy(asc(students.familyName));
  else rows = await db.select({ id: attendance.id, studentId: students.id, givenName: students.givenName, familyName: students.familyName, status: attendance.status, note: attendance.note, modifiedAt: attendance.modifiedAt }).from(attendance).innerJoin(students, eq(students.id, attendance.studentId)).innerJoin(studentGuardians, eq(studentGuardians.studentId, students.id)).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).where(and(eq(attendance.groupId, groupId), eq(attendance.onDate, onDate), eq(guardians.userId, actor.id), eq(guardians.active, true), eq(studentGuardians.active, true))).orderBy(asc(students.familyName));
  return Response.json({ items: rows }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion", "docente")) return errorResponse(403, "Solo el personal autorizado puede registrar asistencia.");
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "Revisa el grupo, la fecha y la lista de asistencia.");
  if (env.SCHOOL_DATA_PROVIDER !== "supabase" && !(await mayTeachGroup(actor, parsed.data.groupId))) return errorResponse(404, "Grupo no disponible.");
  const studentIds = [...new Set(parsed.data.records.map(row => row.studentId))];
  if (studentIds.length !== parsed.data.records.length) return errorResponse(400, "No repitas alumnos en una misma lista.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const result = await createSchoolDatabaseClient(env).rpc<{ saved: number }>(actor.supabaseAuth.accessToken, "school_record_attendance", {
        p_group_id: parsed.data.groupId, p_on_date: parsed.data.onDate, p_records: parsed.data.records,
      });
      const payload = result.data[0];
      if (!payload || !Number.isSafeInteger(payload.saved) || payload.saved < 0) return errorResponse(503, "No se pudo guardar la asistencia.");
      return Response.json({ saved: payload.saved }, { headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 400) return errorResponse(400, "La lista incluye datos no válidos o alumnos fuera del grupo.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "No tienes permiso para registrar asistencia en este grupo.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "Grupo no disponible.");
      return errorResponse(503, "No se pudo guardar la asistencia.");
    }
  }
  const db = getDb();
  const enrolled = await db.select({ id: enrollments.studentId }).from(enrollments).innerJoin(students, eq(students.id, enrollments.studentId)).where(and(eq(enrollments.groupId, parsed.data.groupId), inArray(enrollments.studentId, studentIds), isNull(enrollments.endedAt), eq(students.active, true)));
  if (enrolled.length !== studentIds.length) return errorResponse(400, "La lista incluye un alumno que no pertenece al grupo.");
  const now = new Date();
  await Promise.all(parsed.data.records.map(record => db.insert(attendance).values({ id: crypto.randomUUID(), studentId: record.studentId, groupId: parsed.data.groupId, onDate: parsed.data.onDate, status: record.status, note: record.note, recordedBy: actor.id }).onConflictDoUpdate({ target: [attendance.studentId, attendance.onDate], set: { groupId: parsed.data.groupId, status: record.status, note: record.note, modifiedBy: actor.id, modifiedAt: now } })));
  await db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "record_attendance", entityType: "group", entityId: parsed.data.groupId, createdAt: now });
  return Response.json({ saved: studentIds.length }, { headers: { "Cache-Control": "no-store" } });
}
