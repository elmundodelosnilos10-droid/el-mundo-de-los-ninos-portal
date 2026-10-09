import { env } from "@/lib/runtime/env";
import { and, asc, count, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { conversations, enrollments, guardians, messages, students, studentGuardians, teacherGroups, teachers, user } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole } from "@/lib/access";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";

const input = z.object({ studentId: z.uuid(), teacherId: z.uuid(), guardianId: z.uuid().optional() });

export async function GET(request: Request) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    if (!hasRole(actor, "docente", "tutor")) return errorResponse(403, "El chat está disponible para familias y docentes vinculados.");
    try {
      const { data } = await createSchoolDatabaseClient(env).rpc<{ items?: unknown[] }>(actor.supabaseAuth.accessToken, "school_conversation_feed", {});
      return Response.json({ items: data[0]?.items ?? [] }, { headers: { "Cache-Control": "no-store" } });
    } catch { return errorResponse(503, "No se pudieron consultar las conversaciones."); }
  }
  const db = getDb();
  if (hasRole(actor, "tutor")) {
    const rows = await db.select({ id: conversations.id, studentId: students.id, studentName: students.givenName, studentFamilyName: students.familyName, teacherName: user.name, createdAt: conversations.createdAt }).from(conversations).innerJoin(guardians, eq(guardians.id, conversations.guardianId)).innerJoin(studentGuardians, and(eq(studentGuardians.studentId, conversations.studentId), eq(studentGuardians.guardianId, conversations.guardianId), eq(studentGuardians.active, true))).innerJoin(students, eq(students.id, conversations.studentId)).innerJoin(teachers, eq(teachers.id, conversations.teacherId)).innerJoin(user, eq(user.id, teachers.userId)).where(and(eq(guardians.userId, actor.id), eq(guardians.active, true), eq(teachers.active, true), eq(students.active, true))).orderBy(asc(conversations.createdAt));
    const unread = rows.length ? await db.select({ conversationId: messages.conversationId, total: count(messages.id) }).from(messages).where(and(inArray(messages.conversationId, rows.map(row => row.id)), ne(messages.authorId, actor.id), isNull(messages.readAt))).groupBy(messages.conversationId) : [];
    const unreadByConversation = new Map(unread.map(row => [row.conversationId, row.total]));
    return Response.json({ items: rows.map(row => ({ ...row, unreadCount: unreadByConversation.get(row.id) ?? 0 })) }, { headers: { "Cache-Control": "no-store" } });
  }
  if (hasRole(actor, "docente")) {
    const rows = await db.select({ id: conversations.id, studentId: students.id, studentName: students.givenName, studentFamilyName: students.familyName, guardianName: user.name, createdAt: conversations.createdAt }).from(conversations).innerJoin(teachers, eq(teachers.id, conversations.teacherId)).innerJoin(students, eq(students.id, conversations.studentId)).innerJoin(guardians, eq(guardians.id, conversations.guardianId)).innerJoin(user, eq(user.id, guardians.userId)).where(and(eq(teachers.userId, actor.id), eq(teachers.active, true), eq(guardians.active, true), eq(students.active, true))).orderBy(asc(conversations.createdAt));
    const unread = rows.length ? await db.select({ conversationId: messages.conversationId, total: count(messages.id) }).from(messages).where(and(inArray(messages.conversationId, rows.map(row => row.id)), ne(messages.authorId, actor.id), isNull(messages.readAt))).groupBy(messages.conversationId) : [];
    const unreadByConversation = new Map(unread.map(row => [row.conversationId, row.total]));
    return Response.json({ items: rows.map(row => ({ ...row, unreadCount: unreadByConversation.get(row.id) ?? 0 })) }, { headers: { "Cache-Control": "no-store" } });
  }
  return errorResponse(403, "El chat está disponible para familias y docentes vinculados.");
}

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "docente", "tutor")) return errorResponse(403, "El chat está disponible para familias y docentes.");
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "Indica el alumno y la maestra.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const { data } = await createSchoolDatabaseClient(env).rpc<{ id?: string; created?: boolean }>(actor.supabaseAuth.accessToken, "school_open_conversation", {
        p_id: crypto.randomUUID(), p_student_id: parsed.data.studentId, p_teacher_id: parsed.data.teacherId,
        p_guardian_id: parsed.data.guardianId ?? null,
      });
      const result = data[0];
      if (!result?.id) return errorResponse(503, "No se pudo iniciar la conversación.");
      return Response.json({ id: result.id }, { status: result.created ? 201 : 200, headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "No tienes permiso para iniciar esta conversación.");
      if (cause instanceof SupabaseDatabaseError && (cause.status === 404 || cause.status === 400)) return errorResponse(404, "No hay una relación activa entre ese alumno, su familia y la maestra.");
      return errorResponse(503, "No se pudo iniciar la conversación.");
    }
  }
  const db = getDb();
  const currentEnrollments = await db.select({ groupId: enrollments.groupId }).from(enrollments).innerJoin(students, eq(students.id, enrollments.studentId)).where(and(eq(enrollments.studentId, parsed.data.studentId), eq(students.active, true), isNull(enrollments.endedAt)));
  if (!currentEnrollments.length) return errorResponse(404, "No hay una inscripción activa para ese alumno.");
  const teacherFilters = [eq(teachers.id, parsed.data.teacherId), eq(teachers.active, true), inArray(teacherGroups.groupId, currentEnrollments.map(item => item.groupId))];
  if (hasRole(actor, "docente")) teacherFilters.push(eq(teachers.userId, actor.id));
  const validTeacher = await db.select({ id: teachers.id }).from(teacherGroups).innerJoin(teachers, eq(teachers.id, teacherGroups.teacherId)).where(and(...teacherFilters)).limit(1);
  if (!validTeacher.length) return errorResponse(404, "No hay una relación activa entre ese alumno y la maestra.");
  let guardianId = parsed.data.guardianId;
  if (hasRole(actor, "tutor")) {
    const owned = await db.select({ id: guardians.id }).from(studentGuardians).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).where(and(eq(studentGuardians.studentId, parsed.data.studentId), eq(guardians.userId, actor.id), eq(guardians.active, true), eq(studentGuardians.active, true))).limit(1);
    if (!owned.length || (guardianId && guardianId !== owned[0].id)) return errorResponse(404, "No hay una relación activa entre ese alumno y tu cuenta.");
    guardianId = owned[0].id;
  } else {
    const teacher = await db.select({ id: teachers.id }).from(teachers).where(and(eq(teachers.id, parsed.data.teacherId), eq(teachers.userId, actor.id), eq(teachers.active, true))).limit(1);
    if (!teacher.length || !guardianId) return errorResponse(403, "Una maestra solo puede contactar a familias de sus grupos.");
    const link = await db.select({ id: guardians.id }).from(studentGuardians).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).where(and(eq(studentGuardians.studentId, parsed.data.studentId), eq(studentGuardians.guardianId, guardianId), eq(guardians.active, true), eq(studentGuardians.active, true))).limit(1);
    if (!link.length) return errorResponse(404, "Tutor no disponible.");
  }
  const existing = await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.studentId, parsed.data.studentId), eq(conversations.teacherId, parsed.data.teacherId), eq(conversations.guardianId, guardianId!))).limit(1);
  if (existing.length) return Response.json({ id: existing[0].id }, { headers: { "Cache-Control": "no-store" } });
  const id = crypto.randomUUID();
  await db.insert(conversations).values({ id, studentId: parsed.data.studentId, teacherId: parsed.data.teacherId, guardianId: guardianId!, createdAt: new Date() });
  return Response.json({ id }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
