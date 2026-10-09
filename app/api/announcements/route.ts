import { env } from "@/lib/runtime/env";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { announcements, announcementReads, auditLog, enrollments, guardians, notifications, studentGuardians, students, user, userRoles } from "@/db/schema";
import { accessibleGroupIds, actorFromRequest, errorResponse, hasRole, mayTeachGroup } from "@/lib/access";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";

const input = z.object({ groupId: z.uuid().optional(), title: z.string().trim().min(2).max(120), body: z.string().trim().min(2).max(3000), important: z.boolean().default(false) });

export async function GET(request: Request) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const result = await createSchoolDatabaseClient(env).rpc<{ items: unknown[] }>(actor.supabaseAuth.accessToken, "school_announcement_feed", { p_limit: 200 });
      const payload = result.data[0];
      if (!payload || !Array.isArray(payload.items)) return errorResponse(503, "No se pudieron cargar los comunicados.");
      return Response.json({ items: payload.items }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return errorResponse(503, "No se pudieron cargar los comunicados.");
    }
  }
  const ids = hasRole(actor, "superadmin", "direccion") ? undefined : await accessibleGroupIds(actor);
  const rows = await getDb().select({ id: announcements.id, groupId: announcements.groupId, title: announcements.title, body: announcements.body, important: announcements.important, publishedBy: announcements.publishedBy, publishedAt: announcements.publishedAt, readAt: announcementReads.readAt }).from(announcements).leftJoin(announcementReads, and(eq(announcementReads.announcementId, announcements.id), eq(announcementReads.userId, actor.id)))
    .where(ids ? (ids.length ? or(isNull(announcements.groupId), inArray(announcements.groupId, ids)) : isNull(announcements.groupId)) : undefined)
    .orderBy(asc(announcements.publishedAt)).limit(200);
  return Response.json({ items: rows }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion", "docente")) return errorResponse(403, "No tienes permiso para publicar comunicados.");
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "Revisa el título y el comunicado.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const id = crypto.randomUUID();
      const result = await createSchoolDatabaseClient(env).rpc<{ id: string; notified: number }>(actor.supabaseAuth.accessToken, "school_create_announcement", {
        p_id: id, p_group_id: parsed.data.groupId ?? null, p_title: parsed.data.title, p_body: parsed.data.body, p_important: parsed.data.important,
      });
      const payload = result.data[0];
      if (payload?.id !== id || !Number.isSafeInteger(payload.notified) || payload.notified < 0) return errorResponse(503, "No se pudo publicar el comunicado.");
      return Response.json({ id, notified: payload.notified }, { status: 201, headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "No tienes permiso para publicar en ese grupo.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "El grupo no está disponible.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 400) return errorResponse(400, "Revisa el título y el comunicado.");
      return errorResponse(503, "No se pudo publicar el comunicado.");
    }
  }
  if (parsed.data.groupId && !(await mayTeachGroup(actor, parsed.data.groupId))) return errorResponse(403, "No tienes permiso para ese grupo.");
  if (!parsed.data.groupId && !hasRole(actor, "superadmin", "direccion")) return errorResponse(403, "Solo dirección puede publicar comunicados generales.");
  const db = getDb(); const id = crypto.randomUUID(); const now = new Date();
  await db.batch([
    db.insert(announcements).values({ id, groupId: parsed.data.groupId ?? null, title: parsed.data.title, body: parsed.data.body, important: parsed.data.important, publishedBy: actor.id, publishedAt: now }),
    db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "publish", entityType: "announcement", entityId: id, createdAt: now }),
  ]);
  let recipients;
  if (parsed.data.groupId) recipients = await db.selectDistinct({ id: user.id }).from(enrollments).innerJoin(students, eq(students.id, enrollments.studentId)).innerJoin(studentGuardians, eq(studentGuardians.studentId, students.id)).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).innerJoin(user, eq(user.id, guardians.userId)).where(and(eq(enrollments.groupId, parsed.data.groupId), isNull(enrollments.endedAt), eq(students.active, true), eq(guardians.active, true), eq(studentGuardians.active, true)));
  else recipients = await db.selectDistinct({ id: user.id }).from(user).innerJoin(userRoles, eq(userRoles.userId, user.id)).where(eq(userRoles.role, "tutor"));
  await Promise.all(recipients.map(recipient => db.insert(notifications).values({ id: crypto.randomUUID(), userId: recipient.id, kind: "comunicado", title: parsed.data.important ? "Comunicado importante" : "Nuevo comunicado escolar", href: "/comunicados", dedupeKey: `announcement:${id}:${recipient.id}`, createdAt: now }).onConflictDoNothing()));
  return Response.json({ id, notified: recipients.length }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
