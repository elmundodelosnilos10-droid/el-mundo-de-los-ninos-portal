import { env } from "@/lib/runtime/env";
import { z } from "zod";
import { getDb } from "@/db";
import { auditLog, calendarEvents } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole, mayTeachGroup } from "@/lib/access";
import { calendarFeed } from "@/lib/calendar-feed";
import { schoolDateKey, schoolLocalInputToISO } from "@/lib/datetime";
import { notifyAllFamilies, notifyGroupFamilies } from "@/lib/family-notifications";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";
import { CALENDAR_KIND_VALUES } from "@/lib/calendar-filters";

const input = z.object({ groupId: z.uuid().optional(), kind: z.enum(["entrega", "reunion", "festival", "suspension", "evento", "otro"]), title: z.string().trim().min(2).max(120), description: z.string().trim().max(1000).optional(), startsAt: z.iso.datetime({ offset: true }), endsAt: z.iso.datetime({ offset: true }).optional() });
const rangeInput = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional(), groupId: z.union([z.uuid(), z.literal("general")]).optional(), kind: z.enum(CALENDAR_KIND_VALUES).optional() }).refine(value => Boolean(value.from) === Boolean(value.to));

function calendarWindow(from: string, to: string) {
  const start = new Date(schoolLocalInputToISO(`${from}T00:00`));
  const dayAfter = new Date(`${to}T12:00:00Z`);
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
  const end = new Date(schoolLocalInputToISO(`${dayAfter.toISOString().slice(0, 10)}T00:00`));
  return { start, end };
}

export async function GET(request: Request) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  const params = new URL(request.url).searchParams;
  const parsed = rangeInput.safeParse({ from: params.get("from") ?? undefined, to: params.get("to") ?? undefined, groupId: params.get("groupId") ?? undefined, kind: params.get("kind") ?? undefined });
  if (!parsed.success) return errorResponse(400, "Indica un periodo válido para consultar el calendario.");
  let from = parsed.data.from; let to = parsed.data.to;
  if (!from || !to) {
    const today = schoolDateKey(new Date());
    from = `${today.slice(0, 7)}-01`;
    const lastDay = new Date(`${from}T12:00:00Z`); lastDay.setUTCDate(lastDay.getUTCDate() + 41);
    to = lastDay.toISOString().slice(0, 10);
  }
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (from > to || days > 93) return errorResponse(400, "El periodo del calendario debe ser de hasta 93 días.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const { start, end } = calendarWindow(from, to);
      const result = await createSchoolDatabaseClient(env).rpc<{ items: unknown[]; total: number; limited: boolean }>(actor.supabaseAuth.accessToken, "school_calendar_feed_filtered", {
        p_from: start.toISOString(), p_to_exclusive: end.toISOString(), p_limit: 500,
        p_group_id: parsed.data.groupId && parsed.data.groupId !== "general" ? parsed.data.groupId : null,
        p_general_only: parsed.data.groupId === "general", p_kind: parsed.data.kind ?? null,
      });
      const payload = result.data[0];
      if (!payload || !Array.isArray(payload.items) || !Number.isSafeInteger(payload.total) || payload.total < 0 || payload.items.length > 500 || payload.total < payload.items.length || typeof payload.limited !== "boolean" || payload.limited !== (payload.total > payload.items.length)) {
        return errorResponse(503, "No se pudo consultar el calendario.");
      }
      return Response.json({ items: payload.items, total: payload.total, timeZone: "America/Mexico_City", limited: payload.limited }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return errorResponse(503, "No se pudo consultar el calendario.");
    }
  }
  const result = await calendarFeed(actor, { from, to }, { groupId: parsed.data.groupId, kind: parsed.data.kind });
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion", "docente")) return errorResponse(403, "No tienes permiso para publicar eventos.");
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "Revisa los datos del evento.");
  if (parsed.data.endsAt && parsed.data.endsAt < parsed.data.startsAt) return errorResponse(400, "La hora de término debe ser posterior al inicio.");
  if (parsed.data.groupId && env.SCHOOL_DATA_PROVIDER !== "supabase" && !(await mayTeachGroup(actor, parsed.data.groupId))) return errorResponse(403, "No tienes permiso para ese grupo.");
  if (!parsed.data.groupId && !hasRole(actor, "superadmin", "direccion")) return errorResponse(403, "Solo dirección puede publicar eventos generales.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const id = crypto.randomUUID();
      const result = await createSchoolDatabaseClient(env).rpc<{ id: string }>(actor.supabaseAuth.accessToken, "school_create_calendar_event", {
        p_id: id, p_group_id: parsed.data.groupId ?? null, p_kind: parsed.data.kind, p_title: parsed.data.title,
        p_description: parsed.data.description ?? null, p_starts_at: parsed.data.startsAt,
        p_ends_at: parsed.data.endsAt ?? null,
      });
      if (result.data[0]?.id !== id) return errorResponse(503, "No se pudo guardar el evento.");
      return Response.json({ id }, { status: 201, headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "No tienes permiso para publicar en ese grupo.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "El grupo no está disponible.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 400) return errorResponse(400, "Revisa los datos del evento.");
      return errorResponse(503, "No se pudo guardar el evento.");
    }
  }
  const id = crypto.randomUUID(); const now = new Date();
  const db = getDb();
  await db.batch([
    db.insert(calendarEvents).values({ id, groupId: parsed.data.groupId, kind: parsed.data.kind, title: parsed.data.title, description: parsed.data.description, startsAt: new Date(parsed.data.startsAt), endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : null, createdBy: actor.id }),
    db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "create", entityType: "calendar_event", entityId: id, createdAt: now }),
  ]);
  const notice = { kind: "calendario", title: "Nueva actividad en el calendario", href: "/calendario", sourceId: id, createdAt: now };
  if (parsed.data.groupId) await notifyGroupFamilies(parsed.data.groupId, notice);
  else await notifyAllFamilies(notice);
  return Response.json({ id }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
