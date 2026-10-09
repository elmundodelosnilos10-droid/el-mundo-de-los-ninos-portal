import { env } from "@/lib/runtime/env";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { user, userRoles } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { createSchoolAuthClient, readSupabaseAuthCookies, type AuthUser } from "./auth";
import { createSchoolDatabaseClient } from "./database";
import type { SchoolRole } from "./admin-database";

const schoolRoles = new Set<SchoolRole>(["superadmin", "direccion", "docente", "tutor", "alumno"]);

/** Read authorization with the verified identity's JWT; never infer roles from Auth metadata. */
export async function getActiveSupabaseSchoolAccount(authUser: Pick<AuthUser, "id" | "email">, accessToken: string, fetcher: typeof fetch = fetch) {
  const email = typeof authUser.email === "string" ? authUser.email.trim().toLowerCase() : "";
  if (!email) return null;
  const database = createSchoolDatabaseClient(env, fetcher);
  const profiles = await database.select(accessToken, "profiles", {
    columns: ["id", "name", "email", "active"],
    filters: [{ column: "id", operator: "eq", value: authUser.id }],
    limit: 1,
  });
  const profile = profiles.data[0];
  if (!profile || profile.id !== authUser.id || profile.active !== true || typeof profile.name !== "string" ||
      typeof profile.email !== "string" || profile.email.trim().toLowerCase() !== email) return null;
  const roleRows = await database.select(accessToken, "user_roles", {
    columns: ["role"], filters: [{ column: "user_id", operator: "eq", value: authUser.id }], limit: 6,
  });
  if (!roleRows.data.length || roleRows.data.some(row => typeof row.role !== "string" || !schoolRoles.has(row.role as SchoolRole))) return null;
  return { id: authUser.id, name: profile.name, email, roles: [...new Set(roleRows.data.map(row => row.role as SchoolRole))] };
}

/** Keep page/API identity stable while Supabase Auth replaces Better Auth. */
export async function getSchoolSession(headers: Headers) {
  if (env.SCHOOL_AUTH_PROVIDER !== "supabase") {
    if (env.SCHOOL_DATA_PROVIDER === "supabase") return null;
    return getAuth().api.getSession({ headers });
  }

  const stored = readSupabaseAuthCookies(headers.get("cookie"));
  if (!stored) return null;

  let authUser;
  try {
    authUser = await createSchoolAuthClient(env).verifyCurrentUser(stored.accessToken);
  } catch {
    return null;
  }
  const email = typeof authUser.email === "string" ? authUser.email.trim().toLowerCase() : "";
  if (!email) return null;

  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    try {
      const account = await getActiveSupabaseSchoolAccount(authUser, stored.accessToken);
      if (!account) return null;
      return {
        user: { id: account.id, name: account.name, email: account.email },
        session: { userId: account.id, supabaseAuthUserId: authUser.id, supabaseAccessToken: stored.accessToken },
      };
    } catch {
      return null;
    }
  }

  const db = getDb();
  const accounts = await db.select({ id: user.id, name: user.name, email: user.email, active: user.active })
    .from(user).where(eq(user.email, email)).limit(1);
  const account = accounts[0];
  if (!account?.active) return null;
  const roles = await db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, account.id));
  if (!roles.length) return null;

  return {
    user: { id: account.id, name: account.name, email: account.email },
    // The verified identity and JWT stay server-side for user-scoped PostgREST.
    // Do not pass this session object to a Client Component.
    session: { userId: account.id, supabaseAuthUserId: authUser.id, supabaseAccessToken: stored.accessToken },
  };
}
