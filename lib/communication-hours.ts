import { eq } from "drizzle-orm";
import { env } from "@/lib/runtime/env";
import type { Actor } from "@/lib/access";
import { createSchoolDatabaseClient } from "@/lib/supabase/database";
import { readSupabaseCommunicationSettings } from "@/lib/supabase/communication-settings";
import { getDb } from "@/db";
import { communicationSettings } from "@/db/schema";
import { DEFAULT_COMMUNICATION_HOURS, type CommunicationHours } from "./communication-hours-policy";

export { COMMUNICATION_TIME_ZONE, DEFAULT_COMMUNICATION_HOURS, isWithinCommunicationHours } from "./communication-hours-policy";
export type { CommunicationHours } from "./communication-hours-policy";

export async function getCommunicationHours(actor?: Actor): Promise<CommunicationHours> {
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    const result = await readSupabaseCommunicationSettings(createSchoolDatabaseClient(env), actor);
    return result.settings;
  }
  const rows = await getDb().select({ enabled: communicationSettings.enabled, weekdays: communicationSettings.weekdays, startTime: communicationSettings.startTime, endTime: communicationSettings.endTime })
    .from(communicationSettings).where(eq(communicationSettings.id, "school")).limit(1);
  const row = rows[0];
  if (!row) return DEFAULT_COMMUNICATION_HOURS;
  const weekdays = row.weekdays.split(",").map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6);
  return { enabled: row.enabled, weekdays, startTime: row.startTime, endTime: row.endTime };
}
