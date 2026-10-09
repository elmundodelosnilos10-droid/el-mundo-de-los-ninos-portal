import { env } from "@/lib/runtime/env";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { auditLog, enrollments, files, groups, guardians, studentGuardians, students, submissions, taskFiles, tasks } from "@/db/schema";
import { accessibleGroupIds, actorFromRequest, errorResponse, hasRole, mayTeachGroup } from "@/lib/access";
import { notifyGroupFamilies } from "@/lib/family-notifications";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";

const input = z.object({ groupId: z.uuid(), title: z.string().trim().min(2).max(120), instructions: z.string().trim().min(2).max(3000), dueAt: z.iso.datetime({ offset: true }).optional() });

export async function GET(request: Request) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const result = await createSchoolDatabaseClient(env).rpc<{ items: unknown[]; total: number }>(actor.supabaseAuth.accessToken, "school_list_tasks", {
        p_limit: 200, p_offset: 0,
      });
      const payload = result.data[0];
      if (!payload || !Array.isArray(payload.items) || !Number.isSafeInteger(payload.total)) return errorResponse(503, "No se pudieron consultar las tareas.");
      return Response.json({ items: payload.items }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return errorResponse(503, "No se pudieron consultar las tareas.");
    }
  }
  const ids = await accessibleGroupIds(actor);
  if (!ids.length) return Response.json({ items: [] }, { headers: { "Cache-Control": "no-store" } });
  const db = getDb();
  const rows = await db.select({ id: tasks.id, groupId: tasks.groupId, groupName: groups.name, stage: groups.stage, title: tasks.title, instructions: tasks.instructions, dueAt: tasks.dueAt, createdAt: tasks.createdAt, createdBy: tasks.createdBy })
    .from(tasks).innerJoin(groups, eq(groups.id, tasks.groupId)).where(and(inArray(tasks.groupId, ids), isNull(tasks.archivedAt))).orderBy(asc(tasks.dueAt)).limit(200);
  const attachments = rows.length ? await db.select({ taskId: taskFiles.taskId, id: files.id, name: files.originalName }).from(taskFiles).innerJoin(files, eq(files.id, taskFiles.fileId)).where(and(inArray(taskFiles.taskId, rows.map(row => row.id)), isNull(files.deletedAt))) : [];
  let familyChildren: { id: string; groupId: string }[] = [];
  let familyStatuses: { taskId: string; studentId: string; status: string }[] = [];
  if (hasRole(actor, "tutor") && rows.length) {
    familyChildren = await db.select({ id: students.id, groupId: enrollments.groupId }).from(studentGuardians)
      .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
      .innerJoin(students, eq(students.id, studentGuardians.studentId))
      .innerJoin(enrollments, eq(enrollments.studentId, students.id))
      .where(and(eq(guardians.userId, actor.id), eq(guardians.active, true), eq(studentGuardians.active, true), eq(students.active, true), inArray(enrollments.groupId, ids), isNull(enrollments.endedAt)));
    const childIds = [...new Set(familyChildren.map(child => child.id))];
    if (childIds.length) familyStatuses = await db.select({ taskId: submissions.taskId, studentId: submissions.studentId, status: submissions.status })
      .from(submissions).where(and(inArray(submissions.taskId, rows.map(row => row.id)), inArray(submissions.studentId, childIds)));
  }
  const now = Date.now();
  return Response.json({ items: rows.map(row => ({
    ...row,
    files: attachments.filter(file => file.taskId === row.id).map(file => ({ id: file.id, name: file.name, url: `/api/files/${file.id}` })),
    studentStatuses: hasRole(actor, "tutor") ? familyChildren.filter(child => child.groupId === row.groupId).map(child => {
      const submission = familyStatuses.find(item => item.taskId === row.id && item.studentId === child.id);
      return { studentId: child.id, status: submission?.status ?? (row.dueAt && row.dueAt.getTime() < now ? "vencida" : "pendiente") };
    }) : undefined,
  })) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion", "docente")) return errorResponse(403, "No tienes permiso para publicar tareas.");
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "Revisa el título, las instrucciones y el grupo.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const result = await createSchoolDatabaseClient(env).rpc<{ id: string; createdAt: string }>(actor.supabaseAuth.accessToken, "school_create_task", {
        p_id: crypto.randomUUID(),
        p_group_id: parsed.data.groupId,
        p_title: parsed.data.title,
        p_instructions: parsed.data.instructions,
        p_due_at: parsed.data.dueAt ?? null,
      });
      const payload = result.data[0];
      if (!payload || !z.uuid().safeParse(payload.id).success) return errorResponse(503, "No se pudo publicar la tarea.");
      return Response.json({ id: payload.id }, { status: 201, headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 400) return errorResponse(400, "Revisa el título, las instrucciones y la fecha límite.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "No tienes permiso para publicar en ese grupo.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "Grupo no disponible.");
      return errorResponse(503, "No se pudo publicar la tarea.");
    }
  }
  if (!(await mayTeachGroup(actor, parsed.data.groupId))) return errorResponse(403, "No tienes permiso para publicar en ese grupo.");
  const id = crypto.randomUUID(); const now = new Date(); const db = getDb();
  await db.batch([
    db.insert(tasks).values({ id, groupId: parsed.data.groupId, title: parsed.data.title, instructions: parsed.data.instructions, dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null, createdBy: actor.id, createdAt: now }),
    db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "create", entityType: "task", entityId: id, createdAt: now }),
  ]);
  await notifyGroupFamilies(parsed.data.groupId, { kind: "tarea", title: "Nueva tarea publicada", href: "/tareas", sourceId: id, createdAt: now });
  return Response.json({ id }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
