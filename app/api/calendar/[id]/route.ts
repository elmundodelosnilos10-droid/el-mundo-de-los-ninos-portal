import { env } from "@/lib/runtime/env";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { auditLog, calendarEvents } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole, mayTeachGroup } from "@/lib/access";
import { notifyAllFamilies, notifyGroupFamilies } from "@/lib/family-notifications";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";

const input = z.object({
  kind: z.enum(["entrega", "reunion", "festival", "suspension", "evento", "otro"]),
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }).optional(),
});

async function getEditableEvent(actor: NonNullable<Awaited<ReturnType<typeof actorFromRequest>>>, id: string) {
  const [event] = await getDb().select({ id: calendarEvents.id, groupId: calendarEvents.groupId, kind: calendarEvents.kind })
    .from(calendarEvents).where(eq(calendarEvents.id, id)).limit(1);
  if (!event) return { error: errorResponse(404, "Evento no disponible.") };
  if (event.kind === "clase") return { error: errorResponse(409, "Administra las clases desde la sección Clases.") };
  if (event.groupId ? !(await mayTeachGroup(actor, event.groupId)) : !hasRole(actor, "superadmin", "direccion")) {
    return { error: errorResponse(404, "Evento no disponible.") };
  }
  return { event };
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion", "docente")) return errorResponse(403, "No tienes permiso para editar eventos.");
  const { id } = await context.params;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "Revisa los datos del evento.");
  const startsAt = new Date(parsed.data.startsAt);
  const endsAt = parsed.data.endsAt ? new Date(parsed.data.endsAt) : null;
  if (endsAt && endsAt < startsAt) return errorResponse(400, "La hora de término debe ser posterior al inicio.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    if (!z.uuid().safeParse(id).success) return errorResponse(404, "Evento no disponible.");
    try {
      const client = createSchoolDatabaseClient(env);
      const current = await client.select<{ id: string; kind: string }>(actor.supabaseAuth.accessToken, "calendar_events", {
        columns: ["id", "kind"], filters: [{ column: "id", operator: "eq", value: id }], limit: 1,
      });
      if (!current.data.length) return errorResponse(404, "Evento no disponible.");
      if (current.data[0].kind === "clase") return errorResponse(409, "Administra las clases desde la sección Clases.");
      const result = await client.rpc<{ updated: boolean }>(actor.supabaseAuth.accessToken, "school_update_calendar_event", {
        p_id: id, p_kind: parsed.data.kind, p_title: parsed.data.title,
        p_description: parsed.data.description ?? null, p_starts_at: parsed.data.startsAt,
        p_ends_at: parsed.data.endsAt ?? null,
      });
      if (result.data[0]?.updated !== true) return errorResponse(503, "No se pudo actualizar el evento.");
      return Response.json({ updated: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && (cause.status === 403 || cause.status === 404)) return errorResponse(404, "Evento no disponible.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 400) return errorResponse(400, "Revisa los datos del evento.");
      return errorResponse(503, "No se pudo actualizar el evento.");
    }
  }
  const editable = await getEditableEvent(actor, id);
  if (editable.error) return editable.error;
  const now = new Date();
  await getDb().batch([
    getDb().update(calendarEvents).set({ kind: parsed.data.kind, title: parsed.data.title, description: parsed.data.description ?? null, startsAt, endsAt }).where(and(eq(calendarEvents.id, id), eq(calendarEvents.kind, editable.event.kind))),
    getDb().insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "update", entityType: "calendar_event", entityId: id, createdAt: now }),
  ]);
  const notice = { kind: "calendario", title: "Se actualizó una actividad del calendario", href: "/calendario", sourceId: id, createdAt: now };
  if (editable.event.groupId) await notifyGroupFamilies(editable.event.groupId, notice);
  else await notifyAllFamilies(notice);
  return Response.json({ updated: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion", "docente")) return errorResponse(403, "No tienes permiso para eliminar eventos.");
  const { id } = await context.params;
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    if (!z.uuid().safeParse(id).success) return errorResponse(404, "Evento no disponible.");
    try {
      const client = createSchoolDatabaseClient(env);
      const current = await client.select<{ id: string; kind: string }>(actor.supabaseAuth.accessToken, "calendar_events", {
        columns: ["id", "kind"], filters: [{ column: "id", operator: "eq", value: id }], limit: 1,
      });
      if (!current.data.length) return errorResponse(404, "Evento no disponible.");
      if (current.data[0].kind === "clase") return errorResponse(409, "Administra las clases desde la sección Clases.");
      const result = await client.rpc<{ deleted: boolean }>(actor.supabaseAuth.accessToken, "school_delete_calendar_event", { p_id: id });
      if (result.data[0]?.deleted !== true) return errorResponse(503, "No se pudo cancelar el evento.");
      return Response.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && (cause.status === 403 || cause.status === 404)) return errorResponse(404, "Evento no disponible.");
      return errorResponse(503, "No se pudo cancelar el evento.");
    }
  }
  const editable = await getEditableEvent(actor, id);
  if (editable.error) return editable.error;
  const now = new Date();
  await getDb().batch([
    getDb().delete(calendarEvents).where(and(eq(calendarEvents.id, id), eq(calendarEvents.kind, editable.event.kind))),
    getDb().insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "delete", entityType: "calendar_event", entityId: id, createdAt: now }),
  ]);
  const notice = { kind: "calendario", title: "Se canceló una actividad del calendario", href: "/calendario", sourceId: id, createdAt: now };
  if (editable.event.groupId) await notifyGroupFamilies(editable.event.groupId, notice);
  else await notifyAllFamilies(notice);
  return Response.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } });
}
