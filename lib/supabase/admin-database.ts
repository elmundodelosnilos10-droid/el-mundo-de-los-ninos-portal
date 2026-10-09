/**
 * Server-only PostgREST operations that require the Supabase secret key.
 * Keep this surface intentionally narrow: the current D1 account and role
 * records are the authority, and this client only mirrors access into the
 * matching Supabase Auth profile after a successful school sign-in.
 */

export type SchoolRole = "superadmin" | "direccion" | "docente" | "tutor" | "alumno";

export type SupabaseAdminDatabaseEnvironment = {
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
};

export class SupabaseAdminDatabaseError extends Error {
  readonly code: "not_configured" | "invalid_input" | "unavailable" | "rejected";

  constructor(code: SupabaseAdminDatabaseError["code"]) {
    super(`Supabase access synchronization failed (${code})`);
    this.name = "SupabaseAdminDatabaseError";
    this.code = code;
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const roleSet = new Set<SchoolRole>(["superadmin", "direccion", "docente", "tutor", "alumno"]);

export function createSchoolAdminDatabaseClient(
  environment: SupabaseAdminDatabaseEnvironment,
  fetcher: typeof fetch = fetch,
) {
  const rawUrl = environment.SUPABASE_URL;
  const secretKey = environment.SUPABASE_SECRET_KEY?.trim();
  let base: URL | null = null;
  try {
    const url = new URL(rawUrl ?? "");
    if (url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash) base = url;
  } catch {
    // Report one sanitized configuration error from the public method.
  }

  async function request(path: string, init: RequestInit) {
    if (!base || !secretKey || /[\r\n]/.test(secretKey)) throw new SupabaseAdminDatabaseError("not_configured");
    const headers = new Headers(init.headers);
    headers.set("apikey", secretKey);
    // Current sb_secret_* values are opaque API keys, not bearer JWTs.
    if (!secretKey.startsWith("sb_secret_")) headers.set("Authorization", `Bearer ${secretKey}`);
    headers.set("Accept", "application/json");
    let response: Response;
    try {
      response = await fetcher(new URL(path, base), { ...init, headers, redirect: "error" });
    } catch {
      throw new SupabaseAdminDatabaseError("unavailable");
    }
    if (!response.ok) throw new SupabaseAdminDatabaseError("rejected");
    return response;
  }

  async function setProfileActive(authUserId: string, active: boolean, profileName?: string) {
    if (!uuidPattern.test(authUserId) || typeof active !== "boolean" ||
        (profileName !== undefined && (typeof profileName !== "string" || profileName.trim().length < 2 || profileName.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(profileName)))) {
      throw new SupabaseAdminDatabaseError("invalid_input");
    }
    const profileUrl = new URL("/rest/v1/profiles", base ?? "https://invalid.example");
    profileUrl.searchParams.set("id", `eq.${authUserId}`);
    profileUrl.searchParams.set("select", profileName === undefined ? "id,active" : "id,active,name");
    const response = await request(`${profileUrl.pathname}${profileUrl.search}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ active, ...(profileName === undefined ? {} : { name: profileName.trim() }) }),
    });
    const rows = await response.json().catch(() => null) as unknown;
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== "object" ||
        (rows[0] as Record<string, unknown>).id !== authUserId || (rows[0] as Record<string, unknown>).active !== active ||
        (profileName !== undefined && (rows[0] as Record<string, unknown>).name !== profileName.trim())) {
      throw new SupabaseAdminDatabaseError("rejected");
    }
  }

  async function syncAccountAccess(
    authUserId: string,
    roles: readonly SchoolRole[],
    profileName?: string,
    activeAfterSync = true,
  ) {
    if (!uuidPattern.test(authUserId) || !Array.isArray(roles) || roles.length < 1 || roles.length > roleSet.size ||
        roles.some(role => !roleSet.has(role)) || new Set(roles).size !== roles.length || typeof activeAfterSync !== "boolean") {
      throw new SupabaseAdminDatabaseError("invalid_input");
    }

    // Keep all RLS reads blocked while replacing the authoritative D1 roles.
    await setProfileActive(authUserId, false);
    const roleUrl = new URL("/rest/v1/user_roles", base ?? "https://invalid.example");
    roleUrl.searchParams.set("user_id", `eq.${authUserId}`);
    await request(`${roleUrl.pathname}${roleUrl.search}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    const insertUrl = new URL("/rest/v1/user_roles", base ?? "https://invalid.example");
    insertUrl.searchParams.set("on_conflict", "user_id,role");
    await request(`${insertUrl.pathname}${insertUrl.search}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(roles.map(role => ({ user_id: authUserId, role }))),
    });
    await setProfileActive(authUserId, activeAfterSync, profileName);
  }

    return { syncAccountAccess, setProfileActive };
}
