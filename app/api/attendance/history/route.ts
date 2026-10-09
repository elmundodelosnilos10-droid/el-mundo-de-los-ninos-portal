import { and, asc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { attendance, guardians, groups, students, studentGuardians } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole, mayTeachGroup } from "@/lib/access";
import { env } from "@/lib/runtime/env";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";

export async function GET(request: Request) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  const params = new URL(request.url).searchParams;
  const studentId = params.get("studentId");
  const groupId = params.get("groupId");
  const from = params.get("from");
  const to = params.get("to");
  if (!z.uuid().safeParse(studentId).success || !z.iso.date().safeParse(from).success || !z.iso.date().safeParse(to).success || from! > to!) {
    return errorResponse(400, "Indica al alumno y un periodo válido.");
  }
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > 366) return errorResponse(400, "El periodo máximo es de 366 días.");

  const isStaff = hasRole(actor, "superadmin", "direccion", "docente");
  let rows;
  if (isStaff) {
    if (!z.uuid().safeParse(groupId).success) return errorResponse(404, "Alumno no disponible.");
    if (env.SCHOOL_DATA_PROVIDER === "supabase") {
      if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
      try {
        const result = await createSchoolDatabaseClient(env).rpc<Record<string, unknown>>(actor.supabaseAuth.accessToken, "school_attendance_history", {
          p_student_id: studentId, p_group_id: groupId, p_from: from, p_to: to,
        });
        const payload = result.data[0];
        if (!payload || !payload.student || !payload.period || !payload.counts || !Array.isArray(payload.records)) return errorResponse(503, "No se pudo consultar el historial de asistencia.");
        return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
      } catch (cause) {
        if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "No tienes permiso para consultar este historial.");
        if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "Alumno no disponible.");
        if (cause instanceof SupabaseDatabaseError && cause.status === 400) return errorResponse(400, "Indica al alumno y un periodo válido.");
        return errorResponse(503, "No se pudo consultar el historial de asistencia.");
      }
    }
    if (!(await mayTeachGroup(actor, groupId!))) return errorResponse(404, "Alumno no disponible.");
    const db = getDb();
    rows = await db.select({ date: attendance.onDate, studentId: students.id, givenName: students.givenName, familyName: students.familyName, groupName: groups.name, status: attendance.status, note: attendance.note })
      .from(attendance).innerJoin(students, eq(students.id, attendance.studentId)).innerJoin(groups, eq(groups.id, attendance.groupId))
      .where(and(eq(attendance.studentId, studentId!), eq(attendance.groupId, groupId!), gte(attendance.onDate, from!), lte(attendance.onDate, to!)))
      .orderBy(asc(attendance.onDate)).limit(366);
  } else if (hasRole(actor, "tutor") && !groupId) {
    if (env.SCHOOL_DATA_PROVIDER === "supabase") {
      if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
      try {
        const result = await createSchoolDatabaseClient(env).rpc<Record<string, unknown>>(actor.supabaseAuth.accessToken, "school_attendance_history", {
          p_student_id: studentId, p_group_id: null, p_from: from, p_to: to,
        });
        const payload = result.data[0];
        if (!payload || !payload.student || !payload.period || !payload.counts || !Array.isArray(payload.records)) return errorResponse(503, "No se pudo consultar el historial de asistencia.");
        return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
      } catch (cause) {
        if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "No tienes permiso para consultar este historial.");
        if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "Alumno no disponible.");
        if (cause instanceof SupabaseDatabaseError && cause.status === 400) return errorResponse(400, "Indica al alumno y un periodo válido.");
        return errorResponse(503, "No se pudo consultar el historial de asistencia.");
      }
    }
    const db = getDb();
    const linked = await db.select({ id: students.id }).from(studentGuardians).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).innerJoin(students, eq(students.id, studentGuardians.studentId))
      .where(and(eq(students.id, studentId!), eq(students.active, true), eq(studentGuardians.active, true), eq(guardians.active, true), eq(guardians.userId, actor.id))).limit(1);
    if (!linked.length) return errorResponse(404, "Alumno no disponible.");
    rows = await db.select({ date: attendance.onDate, studentId: students.id, givenName: students.givenName, familyName: students.familyName, groupName: groups.name, status: attendance.status, note: attendance.note })
      .from(attendance).innerJoin(students, eq(students.id, attendance.studentId)).innerJoin(groups, eq(groups.id, attendance.groupId))
      .where(and(eq(attendance.studentId, studentId!), gte(attendance.onDate, from!), lte(attendance.onDate, to!)))
      .orderBy(asc(attendance.onDate)).limit(366);
  } else return errorResponse(403, "No tienes permiso para consultar este historial.");

  const counts = { presente: 0, retardo: 0, ausente: 0, justificada: 0 };
  for (const row of rows) counts[row.status] += 1;
  const total = rows.length;
  const attendancePercent = total ? Math.round(((counts.presente + counts.retardo) / total) * 100) : null;
  return Response.json({
    student: rows[0] ? { id: rows[0].studentId, name: `${rows[0].givenName} ${rows[0].familyName}` } : { id: studentId },
    period: { from, to }, counts, total, attendancePercent,
    percentageRule: "Presentes y retardos ÷ todos los registros del periodo; las faltas justificadas cuentan como ausencia.",
    records: rows,
  }, { headers: { "Cache-Control": "no-store" } });
}
