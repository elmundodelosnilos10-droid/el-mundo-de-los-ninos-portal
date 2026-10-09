import { env } from "@/lib/runtime/env";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { auditLog, calendarEvents, classSessions, groups, teachers, teacherGroups, user } from "@/db/schema";
import { accessibleGroupIds, actorFromRequest, errorResponse, hasRole } from "@/lib/access";
import { notifyGroupFamilies } from "@/lib/family-notifications";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";

const input = z.object({ groupId: z.uuid(), teacherId: z.uuid().optional(), title: z.string().trim().min(2).max(120), startsAt: z.iso.datetime({ offset: true }), endsAt: z.iso.datetime({ offset: true }), meetUrl: z.url() });

export async function GET(request: Request) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const result = await createSchoolDatabaseClient(env).rpc<{ items: unknown[]; timeZone: string }>(actor.supabaseAuth.accessToken, "school_list_class_sessions", { p_limit: 100 });
      const payload = result.data[0];
      if (!payload || !Array.isArray(payload.items) || payload.timeZone !== "America/Mexico_City") return errorResponse(503, "No se pudieron cargar las clases.");
      return Response.json({ items: payload.items, timeZone: payload.timeZone }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return errorResponse(503, "No se pudieron cargar las clases.");
    }
  }
  const ids = await accessibleGroupIds(actor);
  if (!ids.length) return Response.json({ items: [] }, { headers: { "Cache-Control": "no-store" } });
  const rows = await getDb().select({ id: classSessions.id, groupId: classSessions.groupId, groupName: groups.name, teacherName: user.name, title: calendarEvents.title, startsAt: calendarEvents.startsAt, endsAt: calendarEvents.endsAt, meetUrl: classSessions.meetUrl })
    .from(classSessions).innerJoin(calendarEvents, eq(calendarEvents.id, classSessions.eventId)).innerJoin(groups, eq(groups.id, classSessions.groupId)).innerJoin(teachers, eq(teachers.id, classSessions.teacherId)).innerJoin(user, eq(user.id, teachers.userId))
    .where(inArray(classSessions.groupId, ids)).orderBy(asc(calendarEvents.startsAt)).limit(100);
  return Response.json({ items: rows, timeZone: "America/Mexico_City" }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion", "docente")) return errorResponse(403, "No tienes permiso para programar clases.");
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "Revisa el grupo, docente, fecha y enlace de Meet.");
  const starts = new Date(parsed.data.startsAt); const ends = new Date(parsed.data.endsAt);
  if (ends <= starts) return errorResponse(400, "La hora final debe ser posterior al inicio.");
  const url = new URL(parsed.data.meetUrl);
  if (url.protocol !== "https:" || url.hostname !== "meet.google.com" || url.username || url.password) return errorResponse(400, "Usa un enlace seguro de Google Meet.");
  const id = crypto.randomUUID(); const eventId = crypto.randomUUID(); const now = new Date();
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const result = await createSchoolDatabaseClient(env).rpc<{ id: string; eventId: string }>(actor.supabaseAuth.accessToken, "school_create_class_session", {
        p_id: id, p_event_id: eventId, p_group_id: parsed.data.groupId,
        p_teacher_id: hasRole(actor, "docente") ? null : parsed.data.teacherId ?? null,
        p_title: parsed.data.title, p_starts_at: starts.toISOString(), p_ends_at: ends.toISOString(), p_meet_url: url.toString(),
      });
      if (result.data[0]?.id !== id || result.data[0]?.eventId !== eventId) return errorResponse(503, "No se pudo programar la clase.");
      return Response.json({ id }, { status: 201, headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "No tienes permiso para programar en ese grupo.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "El grupo o la maestra no están disponibles.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 400) return errorResponse(400, "Revisa el grupo, la maestra y los datos de la clase.");
      return errorResponse(503, "No se pudo programar la clase.");
    }
  }
  const db = getDb();
  const group = await db.select({ id: groups.id }).from(groups).where(and(eq(groups.id, parsed.data.groupId), eq(groups.active, true))).limit(1);
  if (!group.length) return errorResponse(404, "Grupo no disponible.");
  let teacherId = parsed.data.teacherId;
  if (hasRole(actor, "docente")) {
    const teacher = await db.select({ id: teachers.id }).from(teachers).where(and(eq(teachers.userId, actor.id), eq(teachers.active, true))).limit(1);
    if (!teacher.length) return errorResponse(403, "Tu cuenta no tiene un perfil docente activo.");
    teacherId = teacher[0].id;
  }
  if (!teacherId && hasRole(actor, "superadmin", "direccion")) {
    const assignedTeachers = await db.select({ id: teacherGroups.teacherId }).from(teacherGroups)
      .innerJoin(teachers, eq(teachers.id, teacherGroups.teacherId))
      .where(and(eq(teacherGroups.groupId, parsed.data.groupId), eq(teachers.active, true))).limit(2);
    if (assignedTeachers.length === 1) teacherId = assignedTeachers[0].id;
  }
  if (!teacherId) return errorResponse(400, "Selecciona a la maestra de la clase.");
  const assigned = await db.select({ id: teacherGroups.teacherId }).from(teacherGroups).where(and(eq(teacherGroups.teacherId, teacherId), eq(teacherGroups.groupId, parsed.data.groupId))).limit(1);
  if (!assigned.length) return errorResponse(400, "La maestra debe estar asignada a ese grupo.");
  if (hasRole(actor, "docente") && !(await accessibleGroupIds(actor)).includes(parsed.data.groupId)) return errorResponse(403, "No tienes permiso para ese grupo.");
  await db.batch([
    db.insert(calendarEvents).values({ id: eventId, groupId: parsed.data.groupId, kind: "clase", title: parsed.data.title, startsAt: starts, endsAt: ends, createdBy: actor.id }),
    db.insert(classSessions).values({ id, eventId, groupId: parsed.data.groupId, teacherId, meetUrl: url.toString(), recordingAllowed: false }),
    db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "schedule_meet", entityType: "class_session", entityId: id, createdAt: now }),
  ]);
  await notifyGroupFamilies(parsed.data.groupId, { kind: "clase", title: "Nueva clase virtual programada", href: "/clases", sourceId: id, createdAt: now });
  return Response.json({ id }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
