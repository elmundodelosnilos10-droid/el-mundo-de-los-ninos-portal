import type { createSchoolDatabaseClient } from "./database";

type SchoolClient = ReturnType<typeof createSchoolDatabaseClient>;
export type SchoolAuditRecord = {
  id: string; actorName: string | null; action: string; entityType: string; entityId: string; createdAt: string;
};
export type SchoolDatabaseStatus = {
  checkedAt: string; activeAccounts: number; activeGroups: number; auditRecords: number; latestAuditAt: string | null;
};

function isDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/** Every read uses the current verified user's JWT; RPCs recheck roles and RLS.
 * Whitelist DTOs so future SQL fields never expose credentials or record bodies.
 */
export async function readSchoolAudit(client: SchoolClient, jwt: string): Promise<SchoolAuditRecord[]> {
  const result = await client.rpc(jwt, "school_audit_feed", { p_version: 1 });
  const items = result.data[0]?.items;
  if (!Array.isArray(items) || items.length > 100) throw new Error("School audit unavailable");
  return items.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("School audit unavailable");
    const row = item as Record<string, unknown>;
    if (["id", "action", "entityType", "entityId"].some(key => typeof row[key] !== "string") ||
        (row.actorName !== null && typeof row.actorName !== "string") || !isDate(row.createdAt)) {
      throw new Error("School audit unavailable");
    }
    return { id: row.id as string, actorName: row.actorName as string | null, action: row.action as string,
      entityType: row.entityType as string, entityId: row.entityId as string, createdAt: row.createdAt };
  });
}

export async function readSchoolDatabaseStatus(client: SchoolClient, jwt: string): Promise<SchoolDatabaseStatus> {
  const result = await client.rpc(jwt, "school_system_status", { p_version: 1 });
  const row = result.data[0];
  if (!row || !isDate(row.checkedAt) || (row.latestAuditAt !== null && !isDate(row.latestAuditAt)) ||
      ["activeAccounts", "activeGroups", "auditRecords"].some(key => !Number.isSafeInteger(row[key]) || Number(row[key]) < 0)) {
    throw new Error("School database status unavailable");
  }
  return { checkedAt: row.checkedAt, activeAccounts: Number(row.activeAccounts), activeGroups: Number(row.activeGroups),
    auditRecords: Number(row.auditRecords), latestAuditAt: row.latestAuditAt as string | null };
}

type OperatingEnvironment = {
  SCHOOL_AUTH_PROVIDER?: string; SCHOOL_DATA_PROVIDER?: string; SCHOOL_FILE_STORAGE_PROVIDER?: string;
  SUPABASE_URL?: string; SUPABASE_PUBLISHABLE_KEY?: string; SUPABASE_SECRET_KEY?: string; SUPABASE_STORAGE_BUCKET?: string;
  BETTER_AUTH_SECRET?: string; BETTER_AUTH_URL?: string; BUCKET?: unknown;
};
function present(value: string | undefined) { return Boolean(value?.trim() && !/[\r\n]/.test(value)); }
function projectUrlPresent(value: string | undefined) {
  try { const url = new URL(value ?? ""); return url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash; }
  catch { return false; }
}

/** Configuration presence is not a delivery, storage or restoration test. Never
 * include environment values in this public-to-superadmin DTO. */
export function describeSchoolServiceConfiguration(environment: OperatingEnvironment, checks: {
  recoveryConfigured: boolean; scannerConfigured: boolean;
}) {
  const authProvider = environment.SCHOOL_AUTH_PROVIDER === "supabase" ? "supabase" : "better-auth";
  const storageProvider = environment.SCHOOL_FILE_STORAGE_PROVIDER === "supabase" ? "supabase" : "r2";
  return {
    authProvider,
    dataProvider: environment.SCHOOL_DATA_PROVIDER === "supabase" ? "supabase" : "d1",
    storageProvider,
    authenticationConfigured: authProvider === "supabase"
      ? projectUrlPresent(environment.SUPABASE_URL) && present(environment.SUPABASE_PUBLISHABLE_KEY)
      : present(environment.BETTER_AUTH_SECRET) && present(environment.BETTER_AUTH_URL),
    recoveryConfigured: checks.recoveryConfigured,
    scannerConfigured: checks.scannerConfigured,
    storageConfigured: storageProvider === "supabase"
      ? projectUrlPresent(environment.SUPABASE_URL) && present(environment.SUPABASE_SECRET_KEY) && /^[a-z0-9][a-z0-9_-]{0,99}$/.test(environment.SUPABASE_STORAGE_BUCKET ?? "school-files")
      : Boolean(environment.BUCKET),
    serviceChecksPerformed: false,
    backupsVerified: false,
    recordingsEnabled: false,
    timeZone: "America/Mexico_City",
  };
}
