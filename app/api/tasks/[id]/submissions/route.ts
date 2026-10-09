import { env } from "@/lib/runtime/env";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { auditLog, enrollments, files, guardians, groups, notifications, studentGuardians, students, submissionFiles, submissions, tasks, teacherGroups, teachers, user } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole, mayTeachGroup } from "@/lib/access";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";

const input = z.object({ studentId: z.uuid(), note: z.string().trim().max(1000).optional() });

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  const { id: taskId } = await context.params;
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const result = await createSchoolDatabaseClient(env).rpc<{ items: unknown[]; total: number }>(actor.supabaseAuth.accessToken, "school_list_task_submissions", {
        p_task_id: taskId, p_limit: 200, p_offset: 0,
      });
      const payload = result.data[0];
      if (!payload || !Array.isArray(payload.items) || !Number.isSafeInteger(payload.total)) return errorResponse(503, "No se pudieron consultar las entregas.");
      return Response.json({ items: payload.items }, { headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "No tienes permiso para consultar entregas.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "Actividad no disponible.");
      return errorResponse(503, "No se pudieron consultar las entregas.");
    }
  }
  const db = getDb();
  const task = await db.select({ groupId: tasks.groupId }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task.length) return errorResponse(404, "Actividad no disponible.");
  let rows;
  if (hasRole(actor, "superadmin", "direccion", "docente")) {
    if (!(await mayTeachGroup(actor, task[0].groupId))) return errorResponse(404, "Actividad no disponible.");
    rows = await db.select({ id: submissions.id, studentId: submissions.studentId, studentName: students.givenName, studentFamilyName: students.familyName, status: submissions.status, note: submissions.note, reviewNote: submissions.reviewNote, evaluation: submissions.evaluation, submittedAt: submissions.submittedAt, reviewedAt: submissions.reviewedAt }).from(submissions).innerJoin(students, eq(students.id, submissions.studentId)).where(eq(submissions.taskId, taskId)).orderBy(asc(submissions.submittedAt));
  } else if (hasRole(actor, "tutor")) {
    const children = await db.select({ id: students.id }).from(studentGuardians).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).innerJoin(students, eq(students.id, studentGuardians.studentId)).innerJoin(enrollments, eq(enrollments.studentId, students.id)).where(and(eq(guardians.userId, actor.id), eq(guardians.active, true), eq(studentGuardians.active, true), eq(students.active, true), eq(enrollments.groupId, task[0].groupId), isNull(enrollments.endedAt)));
    if (!children.length) return errorResponse(404, "Actividad no disponible.");
    rows = await db.select({ id: submissions.id, studentId: submissions.studentId, studentName: students.givenName, studentFamilyName: students.familyName, status: submissions.status, note: submissions.note, reviewNote: submissions.reviewNote, evaluation: submissions.evaluation, submittedAt: submissions.submittedAt, reviewedAt: submissions.reviewedAt }).from(submissions).innerJoin(students, eq(students.id, submissions.studentId)).where(and(eq(submissions.taskId, taskId), inArray(submissions.studentId, children.map(child => child.id)))).orderBy(asc(submissions.submittedAt));
  } else return errorResponse(403, "No tienes permiso para consultar entregas.");
  const attachments = rows.length ? await db.select({ submissionId: submissionFiles.submissionId, id: files.id, name: files.originalName }).from(submissionFiles).innerJoin(files, eq(files.id, submissionFiles.fileId)).where(inArray(submissionFiles.submissionId, rows.map(row => row.id))) : [];
  return Response.json({ items: rows.map(row => ({ ...row, files: attachments.filter(file => file.submissionId === row.id).map(file => ({ id: file.id, name: file.name, url: `/api/files/${file.id}` })) })) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "tutor")) return errorResponse(403, "La entrega debe enviarla un tutor autorizado.");
  const { id: taskId } = await context.params;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "Revisa la actividad y el alumno.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const result = await createSchoolDatabaseClient(env).rpc<{ id: string; submittedAt: string; status: string; created: boolean }>(actor.supabaseAuth.accessToken, "school_submit_task", {
        p_id: crypto.randomUUID(),
        p_task_id: taskId,
        p_student_id: parsed.data.studentId,
        p_note: parsed.data.note ?? null,
      });
      const payload = result.data[0];
      if (!payload || !z.uuid().safeParse(payload.id).success || payload.status !== "entregada" || typeof payload.created !== "boolean") {
        return errorResponse(503, "No se pudo guardar la entrega.");
      }
      return Response.json({ submitted: true }, { status: payload.created ? 201 : 200, headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 400) return errorResponse(400, "Revisa la actividad y el alumno.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "La entrega debe enviarla un tutor autorizado.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "Actividad no disponible.");
      return errorResponse(503, "No se pudo guardar la entrega.");
    }
  }
  const db = getDb();
  const task = await db.select({ id: tasks.id, groupId: tasks.groupId }).from(tasks).where(and(eq(tasks.id, taskId), isNull(tasks.archivedAt))).limit(1);
  if (!task.length) return errorResponse(404, "Actividad no disponible.");
  const owned = await db.select({ id: students.id }).from(studentGuardians).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).innerJoin(students, eq(students.id, studentGuardians.studentId)).innerJoin(enrollments, eq(enrollments.studentId, students.id))
    .where(and(eq(guardians.userId, actor.id), eq(guardians.active, true), eq(studentGuardians.active, true), eq(students.id, parsed.data.studentId), eq(students.active, true), eq(enrollments.groupId, task[0].groupId), isNull(enrollments.endedAt))).limit(1);
  if (!owned.length) return errorResponse(404, "Actividad no disponible.");
  const id = crypto.randomUUID(); const now = new Date();
  try {
    await db.insert(submissions).values({ id, taskId, studentId: parsed.data.studentId, submittedBy: actor.id, status: "entregada", note: parsed.data.note, submittedAt: now }).onConflictDoUpdate({ target: [submissions.taskId, submissions.studentId], set: { submittedBy: actor.id, status: "entregada", note: parsed.data.note, reviewNote: null, evaluation: null, reviewedBy: null, reviewedAt: null, submittedAt: now } });
    await db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "submit", entityType: "task", entityId: taskId, createdAt: now });
    const recipients = await db.select({ id: user.id }).from(groups).innerJoin(enrollments, eq(enrollments.groupId, groups.id)).innerJoin(students, eq(students.id, enrollments.studentId)).innerJoin(teacherGroups, eq(teacherGroups.groupId, groups.id)).innerJoin(teachers, eq(teachers.id, teacherGroups.teacherId)).innerJoin(user, eq(user.id, teachers.userId)).where(and(eq(groups.id, task[0].groupId), eq(students.id, parsed.data.studentId), isNull(enrollments.endedAt)));
    await Promise.all(recipients.map(recipient => db.insert(notifications).values({ id: crypto.randomUUID(), userId: recipient.id, kind: "entrega", title: "Nueva entrega para revisar", href: "/tareas", dedupeKey: `submission:${taskId}:${parsed.data.studentId}:${recipient.id}`, createdAt: now }).onConflictDoNothing()));
    return Response.json({ submitted: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch { return errorResponse(500, "No se pudo guardar la entrega."); }
}
