import type { Actor } from "../access";
import type { createSchoolDatabaseClient } from "./database";
import { validatePushDestination } from "../school-notification-delivery.ts";
type Client = ReturnType<typeof createSchoolDatabaseClient>;
export function externalNoticeActorToken(actor: Actor) {
  if (!actor.supabaseAuth || actor.supabaseAuth.userId !== actor.id || !actor.roles.some(role => ["superadmin", "direccion", "docente", "tutor"].includes(role))) throw Error("External notice identity unavailable");
  return actor.supabaseAuth.accessToken;
}
export async function readExternalNoticePreferences(client: Client, actor: Actor) {
  const result = await client.rpc<{ preferences: unknown[]; subscriptions: unknown[] }>(externalNoticeActorToken(actor), "school_notification_preferences", {});
  const row = result.data[0];
  if (!row || !Array.isArray(row.preferences) || !Array.isArray(row.subscriptions)) throw Error("External notice preferences unavailable");
  const preferences = row.preferences.map(value => {
    if (!value || typeof value !== "object") throw Error("External notice preferences unavailable");
    const item = value as Record<string, unknown>;
    if (!["email", "webpush"].includes(String(item.channel)) || typeof item.enabled !== "boolean" ||
      !(item.consentedAt === null || typeof item.consentedAt === "string") || typeof item.updatedAt !== "string") throw Error("External notice preferences unavailable");
    return { channel: item.channel, enabled: item.enabled, consentedAt: item.consentedAt, updatedAt: item.updatedAt };
  });
  const subscriptions = row.subscriptions.map(value => {
    if (!value || typeof value !== "object") throw Error("External notice preferences unavailable");
    const item = value as Record<string, unknown>;
    if (typeof item.id !== "string" || !/^[0-9a-f-]{36}$/i.test(item.id) || typeof item.active !== "boolean" || typeof item.createdAt !== "string") throw Error("External notice preferences unavailable");
    return { id: item.id, active: item.active, createdAt: item.createdAt };
  });
  if (preferences.length > 2 || subscriptions.length > 5) throw Error("External notice preferences unavailable");
  return { preferences, subscriptions };
}
export async function setExternalNoticePreference(client: Client, actor: Actor, channel: "email" | "webpush", enabled: boolean, consentConfirmed: boolean) {
  const result = await client.rpc<{ channel: string; enabled: boolean }>(externalNoticeActorToken(actor), "school_set_notification_preference", { p_channel: channel, p_enabled: enabled, p_consent_confirmed: consentConfirmed });
  const row = result.data[0]; if (!row || row.channel !== channel || row.enabled !== enabled) throw Error("External notice preference unconfirmed");
  return row;
}
export async function storeExternalPushSubscription(client: Client, actor: Actor, value: unknown) {
  const destination = validatePushDestination(value);
  const result = await client.rpc<{ id: string; registered: boolean }>(externalNoticeActorToken(actor), "school_store_push_subscription", { p_endpoint: destination.endpoint, p_p256dh: destination.keys.p256dh, p_auth: destination.keys.auth });
  const row = result.data[0]; if (!row || typeof row.id !== "string" || row.registered !== true) throw Error("External notice subscription unconfirmed");
  return row;
}
export async function removeExternalPushSubscription(client: Client, actor: Actor, id: string) {
  const result = await client.rpc<{ removed: boolean }>(externalNoticeActorToken(actor), "school_remove_push_subscription", { p_id: id });
  if (result.data[0]?.removed !== true) throw Error("External notice subscription removal unconfirmed");
  return { removed: true };
}
