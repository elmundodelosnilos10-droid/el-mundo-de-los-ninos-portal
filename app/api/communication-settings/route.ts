import { z } from "zod";
import { env } from "@/lib/runtime/env";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";
import { readSupabaseCommunicationSettings, writeSupabaseCommunicationSettings } from "@/lib/supabase/communication-settings";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLog, communicationSettings } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole } from "@/lib/access";
import { DEFAULT_COMMUNICATION_HOURS } from "@/lib/communication-hours";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";

const clockTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const input = z.object({
  enabled: z.boolean(),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7),
  startTime: clockTime,
  endTime: clockTime,
}).superRefine((value, context) => {
  if (new Set(value.weekdays).size !== value.weekdays.length) context.addIssue({ code: "custom", path: ["weekdays"], message: "No repitas días." });
  if (value.enabled && value.weekdays.length === 0) context.addIssue({ code: "custom", path: ["weekdays"], message: "Selecciona al menos un día." });
  if (value.enabled && value.startTime >= value.endTime) context.addIssue({ code: "custom", path: ["endTime"], message: "La hora final debe ser posterior a la hora inicial." });
});

export async function GET(request: Request) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion", "docente", "tutor")) return errorResponse(403, "Este ajuste no está disponible para tu cuenta.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    try {
      const result = await readSupabaseCommunicationSettings(createSchoolDatabaseClient(env), actor);
      return Response.json({ settings: { ...result.settings, updatedAt: result.updatedAt }, configured: result.configured }, { headers: { "Cache-Control": "no-store" } });
    } catch { return errorResponse(503, "No se pudo consultar el horario de comunicación. Inténtalo más tarde."); }
  }
  const rows = await getDb().select({ enabled: communicationSettings.enabled, weekdays: communicationSettings.weekdays, startTime: communicationSettings.startTime, endTime: communicationSettings.endTime, updatedAt: communicationSettings.updatedAt })
    .from(communicationSettings).where(eq(communicationSettings.id, "school")).limit(1);
  const row = rows[0];
  return Response.json({ settings: row ? { enabled: row.enabled, weekdays: row.weekdays.split(",").map(Number), startTime: row.startTime, endTime: row.endTime, updatedAt: row.updatedAt } : { ...DEFAULT_COMMUNICATION_HOURS, updatedAt: null } }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion")) return errorResponse(403, "Solo Dirección puede cambiar el horario de comunicación.");
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "Revisa los días y el horario. La hora final debe ser posterior a la inicial.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    try {
      const result = await writeSupabaseCommunicationSettings(createSchoolDatabaseClient(env), actor, parsed.data);
      return Response.json({ settings: { ...result.settings, updatedAt: result.updatedAt }, configured: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "Solo Dirección puede cambiar el horario de comunicación.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 400) return errorResponse(400, "Revisa los días y el horario.");
      return errorResponse(503, "No se pudo guardar el horario de comunicación.");
    }
  }
  const now = new Date();
  const values = parsed.data;
  const db = getDb();
  const settingsWrite = db.insert(communicationSettings).values({ id: "school", enabled: values.enabled, weekdays: values.weekdays.join(","), startTime: values.startTime, endTime: values.endTime, updatedBy: actor.id, updatedAt: now })
    .onConflictDoUpdate({ target: communicationSettings.id, set: { enabled: values.enabled, weekdays: values.weekdays.join(","), startTime: values.startTime, endTime: values.endTime, updatedBy: actor.id, updatedAt: now } });
  const auditWrite = db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "update_communication_hours", entityType: "school_settings", entityId: "school", createdAt: now });
  await db.batch([settingsWrite, auditWrite]);
  return Response.json({ settings: { ...values, updatedAt: now } }, { status: 200, headers: { "Cache-Control": "no-store" } });
}
