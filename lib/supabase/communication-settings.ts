/** User-JWT reads and auditable RPC writes for school communication hours. */
import type { Actor } from "../access";
import { DEFAULT_COMMUNICATION_HOURS, type CommunicationHours } from "../communication-hours-policy.ts";
import type { createSchoolDatabaseClient } from "./database";

type SchoolDatabaseClient = ReturnType<typeof createSchoolDatabaseClient>;
export type SchoolCommunicationSettings = {
  settings: CommunicationHours;
  updatedAt: string | null;
  configured: boolean;
};

export class SchoolCommunicationSettingsError extends Error {
  constructor() {
    super("School communication settings are unavailable");
    this.name = "SchoolCommunicationSettingsError";
  }
}

function verifiedActorToken(actor?: Actor) {
  if (!actor?.supabaseAuth || actor.supabaseAuth.userId !== actor.id || !actor.supabaseAuth.accessToken) {
    throw new SchoolCommunicationSettingsError();
  }
  return actor.supabaseAuth.accessToken;
}

/** An empty successful read means the pre-existing policy has no restriction. */
export async function readSupabaseCommunicationSettings(client: SchoolDatabaseClient, actor?: Actor): Promise<SchoolCommunicationSettings> {
  const jwt = verifiedActorToken(actor);
  const result = await client.select(jwt, "communication_settings", {
    columns: ["id", "enabled", "weekdays", "start_time", "end_time", "updated_at"],
    filters: [{ column: "id", operator: "eq", value: "school" }], limit: 1,
  });
  if (!result.data.length) {
    return { settings: { ...DEFAULT_COMMUNICATION_HOURS, weekdays: [...DEFAULT_COMMUNICATION_HOURS.weekdays] }, updatedAt: null, configured: false };
  }
  return parseSettings(result.data[0]);
}

export async function writeSupabaseCommunicationSettings(client: SchoolDatabaseClient, actor: Actor, settings: CommunicationHours): Promise<SchoolCommunicationSettings> {
  const jwt = verifiedActorToken(actor);
  const result = await client.rpc(jwt, "school_update_communication_settings", {
    p_enabled: settings.enabled, p_weekdays: settings.weekdays,
    p_start_time: settings.startTime, p_end_time: settings.endTime,
  });
  const parsed = parseSettings(result.data[0]);
  if (!parsed.updatedAt) throw new SchoolCommunicationSettingsError();
  return parsed;
}

function parseSettings(row: Record<string, unknown> | undefined): SchoolCommunicationSettings {
  if (!row || row.id !== "school" || typeof row.enabled !== "boolean" || typeof row.weekdays !== "string"
    || !/^(?:[0-6](?:,[0-6])*)?$/.test(row.weekdays) || !isClockTime(row.start_time) || !isClockTime(row.end_time)) {
    throw new SchoolCommunicationSettingsError();
  }
  const weekdays = row.weekdays === "" ? [] : row.weekdays.split(",").map(Number);
  if (new Set(weekdays).size !== weekdays.length || weekdays.length > 7
    || row.enabled && (!weekdays.length || row.start_time >= row.end_time)
    || row.updated_at !== null && (typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.updated_at)))) {
    throw new SchoolCommunicationSettingsError();
  }
  return { settings: { enabled: row.enabled, weekdays, startTime: row.start_time, endTime: row.end_time }, updatedAt: row.updated_at, configured: true };
}

function isClockTime(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}
