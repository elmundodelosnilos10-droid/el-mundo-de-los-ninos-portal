import type { BatchItem } from "drizzle-orm/batch";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { attendanceJustifications, auditLog, enrollments, guardians, groups, notifications, studentGuardians, students, teacherGroups, teachers, user, userRoles } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole, mayTeachGroup } from "@/lib/access";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { env } from "@/lib/runtime/env";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";

const input = z.object({ studentId: z.uuid(), onDate: z.iso.date(), reason: z.string().trim().min(2).max(400) });

export async function GET(request: Request) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  const params = new URL(request.url).searchParams;
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    const client = createSchoolDatabaseClient(env);
    try {
      if (hasRole(actor, "superadmin", "direccion", "docente")) {
        const groupId = params.get("groupId"); const onDate = params.get("date");
        if (!groupId || !z.uuid().safeParse(groupId).success || !onDate || !z.iso.date().safeParse(onDate).success) return errorResponse(400, "Indica el grupo y la fecha.");
        const result = await client.rpc<{ items: Record<string, unknown>[] }>(actor.supabaseAuth.accessToken, "school_list_attendance_justifications", {
          p_group_id: groupId, p_on_date: onDate, p_student_id: null,
        });
        const payload = result.data[0];
        if (!payload || !Array.isArray(payload.items)) return errorResponse(503, "No se pudieron consultar las justificaciones.");
        return Response.json({ items: payload.items }, { headers: { "Cache-Control": "no-store" } });
      }
      if (hasRole(actor, "tutor")) {
        const studentId = params.get("studentId");
        if (!z.uuid().safeParse(studentId).success) return errorResponse(400, "Indica al alumno.");
        const result = await client.rpc<{ items: Record<string, unknown>[] }>(actor.supabaseAuth.accessToken, "school_list_attendance_justifications", {
          p_group_id: null, p_on_date: null, p_student_id: studentId,
        });
        const payload = result.data[0];
        if (!payload || !Array.isArray(payload.items)) return errorResponse(503, "No se pudieron consultar las justificaciones.");
        return Response.json({ items: payload.items }, { headers: { "Cache-Control": "no-store" } });
      }
      return errorResponse(403, "No tienes permiso para consultar justificaciones.");
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "No tienes permiso para consultar estas justificaciones.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "Grupo o alumno no disponible.");
      return errorResponse(503, "No se pudieron consultar las justificaciones.");
    }
  }
  const db = getDb();
  if (hasRole(actor, "superadmin", "direccion", "docente")) {
    const groupId = params.get("groupId"); const onDate = params.get("date");
    if (!groupId || !z.uuid().safeParse(groupId).success || !onDate || !z.iso.date().safeParse(onDate).success) return errorResponse(400, "Indica el grupo y la fecha.");
    if (!(await mayTeachGroup(actor, groupId))) return errorResponse(404, "Grupo no disponible.");
    const items = await db.select({ id: attendanceJustifications.id, studentId: students.id, studentName: students.givenName, studentFamilyName: students.familyName, groupId: groups.id, groupName: groups.name, onDate: attendanceJustifications.onDate, reason: attendanceJustifications.reason, status: attendanceJustifications.status, createdAt: attendanceJustifications.createdAt, reviewedAt: attendanceJustifications.reviewedAt })
      .from(attendanceJustifications).innerJoin(students, eq(students.id, attendanceJustifications.studentId)).innerJoin(groups, eq(groups.id, attendanceJustifications.groupId))
      .where(and(eq(attendanceJustifications.groupId, groupId), eq(attendanceJustifications.onDate, onDate))).orderBy(desc(attendanceJustifications.createdAt)).limit(100);
    return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
  }
  if (hasRole(actor, "tutor")) {
    const studentId = params.get("studentId");
    if (!z.uuid().safeParse(studentId).success) return errorResponse(400, "Indica al alumno.");
    const linked = await db.select({ id: students.id }).from(studentGuardians).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).innerJoin(students, eq(students.id, studentGuardians.studentId))
      .where(and(eq(students.id, studentId!), eq(students.active, true), eq(studentGuardians.active, true), eq(guardians.active, true), eq(guardians.userId, actor.id))).limit(1);
    if (!linked.length) return errorResponse(404, "Alumno no disponible.");
    const items = await db.select({ id: attendanceJustifications.id, studentId: students.id, studentName: students.givenName, studentFamilyName: students.familyName, groupId: groups.id, groupName: groups.name, onDate: attendanceJustifications.onDate, reason: attendanceJustifications.reason, status: attendanceJustifications.status, createdAt: attendanceJustifications.createdAt, reviewedAt: attendanceJustifications.reviewedAt })
      .from(attendanceJustifications).innerJoin(students, eq(students.id, attendanceJustifications.studentId)).innerJoin(groups, eq(groups.id, attendanceJustifications.groupId))
      .where(eq(attendanceJustifications.studentId, studentId!)).orderBy(desc(attendanceJustifications.onDate)).limit(100);
    return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
  }
  return errorResponse(403, "No tienes permiso para consultar justificaciones.");
}

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "tutor")) return errorResponse(403, "La justificación debe enviarla un tutor autorizado.");
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "Indica el alumno, la fecha y el motivo.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const result = await createSchoolDatabaseClient(env).rpc<{ id: string; status: "pendiente" }>(actor.supabaseAuth.accessToken, "school_submit_attendance_justification", {
        p_id: crypto.randomUUID(), p_student_id: parsed.data.studentId, p_on_date: parsed.data.onDate, p_reason: parsed.data.reason,
      });
      const payload = result.data[0];
      if (!payload || typeof payload.id !== "string" || payload.status !== "pendiente") return errorResponse(503, "No se pudo enviar la justificación.");
      return Response.json({ id: payload.id, status: payload.status }, { status: 201, headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 400) return errorResponse(400, "Indica un motivo válido para la falta.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "Solo un tutor vinculado puede justificar esta falta.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "Alumno no disponible o sin grupo activo.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 409) return errorResponse(409, "Ya existe una justificación pendiente o aceptada para esa fecha.");
      return errorResponse(503, "No se pudo enviar la justificación.");
    }
  }
  const db = getDb();
  const owned = await db.select({ studentId: students.id, groupId: enrollments.groupId }).from(studentGuardians)
    .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).innerJoin(students, eq(students.id, studentGuardians.studentId)).innerJoin(enrollments, eq(enrollments.studentId, students.id))
    .where(and(eq(guardians.userId, actor.id), eq(guardians.active, true), eq(studentGuardians.active, true), eq(students.id, parsed.data.studentId), eq(students.active, true), isNull(enrollments.endedAt))).limit(1);
  if (!owned.length) return errorResponse(404, "Alumno no disponible.");

  const existing = await db.select({ id: attendanceJustifications.id, status: attendanceJustifications.status }).from(attendanceJustifications)
    .where(and(eq(attendanceJustifications.studentId, parsed.data.studentId), eq(attendanceJustifications.onDate, parsed.data.onDate))).limit(1);
  if (existing[0] && existing[0].status !== "rechazada") return errorResponse(409, "Ya existe una solicitud de justificación para esa fecha.");

  const now = new Date(); const id = existing[0]?.id ?? crypto.randomUUID();
  const [teachersForGroup, schoolLeaders] = await Promise.all([
    db.selectDistinct({ id: user.id }).from(teacherGroups).innerJoin(teachers, eq(teachers.id, teacherGroups.teacherId)).innerJoin(user, eq(user.id, teachers.userId))
      .where(and(eq(teacherGroups.groupId, owned[0].groupId), eq(teachers.active, true), eq(user.active, true))),
    db.selectDistinct({ id: user.id }).from(userRoles).innerJoin(user, eq(user.id, userRoles.userId)).where(and(inArray(userRoles.role, ["superadmin", "direccion"]), eq(user.active, true))),
  ]);
  const recipients = [...new Map([...teachersForGroup, ...schoolLeaders].map(recipient => [recipient.id, recipient])).values()];
  const operations: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
    existing[0]
      ? db.update(attendanceJustifications).set({ groupId: owned[0].groupId, submittedBy: actor.id, reason: parsed.data.reason, status: "pendiente", reviewedBy: null, reviewedAt: null, createdAt: now }).where(eq(attendanceJustifications.id, id))
      : db.insert(attendanceJustifications).values({ id, studentId: parsed.data.studentId, groupId: owned[0].groupId, onDate: parsed.data.onDate, submittedBy: actor.id, reason: parsed.data.reason, status: "pendiente", createdAt: now }),
    db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "submit_attendance_justification", entityType: "attendance_justification", entityId: id, createdAt: now }),
    ...recipients.map(recipient => db.insert(notifications).values({ id: crypto.randomUUID(), userId: recipient.id, kind: "asistencia_justificacion", title: "Nueva justificación de asistencia", href: "/asistencia", dedupeKey: `attendance-justification:${id}:pending:${now.getTime()}:${recipient.id}`, createdAt: now }).onConflictDoNothing()),
  ];
  await db.batch(operations);
  return Response.json({ id, status: "pendiente" }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
