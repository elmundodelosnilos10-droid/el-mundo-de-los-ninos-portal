/** PostgreSQL database entrypoint for the Next.js / Vercel build only. */
import { createSchoolPostgresConnection, type SchoolPostgresTransaction } from "../lib/supabase/pg-connection";

let connection: ReturnType<typeof createSchoolPostgresConnection> | undefined;

/**
 * Reuses only the connection pool. User identities never live in module state.
 * Next maps @/db to this entrypoint; Sites keeps its existing D1 entrypoint.
 */
function schoolPostgresConnection() {
  if (typeof window !== "undefined") throw new Error("School PostgreSQL is server-only");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Vercel requires the school Supabase DATABASE_URL server secret. Cloudflare D1 is not available in this runtime.");
  }
  if (!connection) connection = createSchoolPostgresConnection({ databaseUrl });
  return connection;
}

/**
 * Owner-level database handle for audited server operations. Existing callers
 * must still validate actor/role/resource membership. Do not use this handle
 * to bypass a user-scoped RPC or expose database queries to a Client Component.
 */
export function getDb() {
  return schoolPostgresConnection().database;
}

/** Uses transaction-local claims and role; concurrent requests stay isolated. */
export function runAsVerifiedSchoolActor<T>(
  /** UUID from server-side Supabase get-user verification, never request JSON. */
  verifiedAuthUserId: string,
  operation: (transaction: SchoolPostgresTransaction) => Promise<T>,
): Promise<T> {
  return schoolPostgresConnection().runAsVerifiedUser(verifiedAuthUserId, operation);
}
