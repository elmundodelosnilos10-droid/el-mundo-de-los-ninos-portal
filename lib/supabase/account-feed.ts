import type { createSchoolDatabaseClient } from "./database";

type SchoolClient = ReturnType<typeof createSchoolDatabaseClient>;
export type SchoolAccountRow = { id: string; name: string; email: string; role: string; active: boolean };

/** Shared server-side first page and API pagination; identity is derived by the RPC from the JWT. */
export async function readSchoolAccounts(client: SchoolClient, jwt: string, options: {
  query?: string; role?: string | null; status?: string | null; page?: number; pageSize?: number;
} = {}) {
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 10;
  if (!Number.isSafeInteger(page) || page < 1 || page > 100_000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    throw new Error("Invalid school account pagination");
  }
  const result = await client.rpc(jwt, "school_account_feed", {
    p_query: (options.query ?? "").trim().slice(0, 100),
    p_role: options.role ?? null, p_status: options.status ?? null,
    p_limit: pageSize, p_offset: (page - 1) * pageSize,
  });
  const feed = result.data[0];
  if (!feed || !Array.isArray(feed.items) || !Number.isSafeInteger(feed.total) || Number(feed.total) < 0 || feed.items.length > pageSize) {
    throw new Error("Invalid school account feed");
  }
  const items = feed.items as unknown[];
  if (items.some(item => !item || typeof item !== "object" ||
    typeof (item as SchoolAccountRow).id !== "string" || typeof (item as SchoolAccountRow).name !== "string" ||
    typeof (item as SchoolAccountRow).email !== "string" || typeof (item as SchoolAccountRow).role !== "string" ||
    typeof (item as SchoolAccountRow).active !== "boolean")) throw new Error("Invalid school account rows");
  return { items: items as SchoolAccountRow[], total: Number(feed.total), page, pageSize };
}
