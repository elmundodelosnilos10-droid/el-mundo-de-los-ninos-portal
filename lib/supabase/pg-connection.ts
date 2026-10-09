/** Server-only PostgreSQL connection for a Vercel Node.js runtime. */
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../db/schema-postgres";

export type SchoolPostgresDatabase = PostgresJsDatabase<typeof schema>;
export type SchoolPostgresTransaction = Parameters<Parameters<SchoolPostgresDatabase["transaction"]>[0]>[0];

export type SchoolPostgresConnectionOptions = {
  /** A server secret from the school project's Supabase Connect dialog. */
  databaseUrl: string;
  /** Keep per-instance connections bounded on Vercel; defaults to three. */
  maxConnections?: number;
};

/**
 * Creates a lazy PostgreSQL client. No network request occurs until a query.
 * Credentials are injected by the server; this module does not discover,
 * persist, print, or forward them to Sites or the browser.
 *
 * The returned database deliberately has no D1-style batch method. Create
 * each mutation using the transaction object inside database.transaction().
 * Raw owner-level access must be confined to authorized server operations.
 * Use runAsVerifiedUser for user-scoped queries that should obey Supabase RLS.
 */
export function createSchoolPostgresConnection(options: SchoolPostgresConnectionOptions) {
  if (typeof window !== "undefined") throw new Error("School PostgreSQL is server-only");
  validateSchoolConnectionUrl(options.databaseUrl);
  const max = options.maxConnections ?? 3;
  if (!Number.isSafeInteger(max) || max < 1 || max > 10) {
    throw new Error("School PostgreSQL connection limit is invalid");
  }

  const client = postgres(options.databaseUrl, {
    // Supabase's transaction pooler does not support prepared statements.
    prepare: false,
    max,
    idle_timeout: 20,
    connect_timeout: 10,
    // `ssl: 'require'` in postgres-js disables certificate verification.
    // Verify the public CA certificate instead; never silently downgrade TLS.
    ssl: { rejectUnauthorized: true },
    connection: { application_name: "el-mundo-de-los-ninos" },
  });
  const database = drizzle(client, { schema });

  async function runAsVerifiedUser<T>(
    /** Use only the id returned by the server's Supabase get-user verification. */
    verifiedAuthUserId: string,
    operation: (transaction: SchoolPostgresTransaction) => Promise<T>,
  ): Promise<T> {
    if (!UUID.test(verifiedAuthUserId)) throw new Error("Verified school identity is invalid");
    return database.transaction(async transaction => {
      // Both settings are LOCAL to this transaction; pooled requests cannot
      // inherit another user's identity after COMMIT or ROLLBACK.
      await transaction.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: verifiedAuthUserId, role: "authenticated" })}, true), set_config('request.jwt.claim.sub', ${verifiedAuthUserId}, true), set_config('request.jwt.claim.role', 'authenticated', true)`);
      await transaction.execute(sql`set local role authenticated`);
      return operation(transaction);
    });
  }

  return {
    database,
    runAsVerifiedUser,
    close: () => client.end({ timeout: 5 }),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateSchoolConnectionUrl(value: string) {
  let url: URL;
  try {
    if (typeof value !== "string" || /[\r\n\u0000]/.test(value)) throw new Error();
    url = new URL(value);
  } catch {
    throw new Error("School PostgreSQL connection is not configured");
  }
  const schoolHost = /^db\.[a-z0-9]+\.supabase\.co$/.test(url.hostname)
    || /^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(url.hostname);
  if (!schoolHost || !["postgres:", "postgresql:"].includes(url.protocol)
    || !url.username || !url.password || url.pathname === "/" || url.hash) {
    throw new Error("School PostgreSQL connection configuration is invalid");
  }
}
