import type { createSchoolDatabaseClient } from "./database";
import type { LibraryFeed, LibraryMaterial, LibraryQuery } from "../library-query";

/** Pagination and filters run in PostgreSQL under the current JWT and RLS.
 * Reject malformed results rather than presenting invented counts or rows. */
export async function readSchoolLibrary(client: ReturnType<typeof createSchoolDatabaseClient>, jwt: string, query: LibraryQuery): Promise<LibraryFeed> {
  const result = await client.rpc(jwt, "school_search_materials", {
    p_query: query.query, p_group_id: query.groupId, p_category: query.category,
    p_limit: query.pageSize, p_offset: (query.page - 1) * query.pageSize,
  });
  const payload = result.data[0];
  if (!payload || !Array.isArray(payload.items) || payload.items.length > query.pageSize || !Number.isSafeInteger(payload.total) || Number(payload.total) < 0 ||
      !Array.isArray(payload.categories) || payload.categories.some(value => typeof value !== "string" || !value || value.length > 60)) throw new Error("School library unavailable");
  const items = payload.items.map((value: unknown): LibraryMaterial => {
    if (!value || typeof value !== "object") throw new Error("School library unavailable");
    const row = value as Record<string, unknown>;
    if (["id", "fileId", "groupId", "groupName", "title", "category", "publishedAt", "fileName", "mimeType"].some(key => typeof row[key] !== "string") ||
        !Number.isFinite(Date.parse(row.publishedAt as string)) || !Number.isSafeInteger(row.sizeBytes) || Number(row.sizeBytes) < 1) throw new Error("School library unavailable");
    return { id: row.id as string, fileId: row.fileId as string, groupId: row.groupId as string, groupName: row.groupName as string,
      title: row.title as string, category: row.category as string, publishedAt: row.publishedAt as string,
      fileName: row.fileName as string, mimeType: row.mimeType as string, sizeBytes: Number(row.sizeBytes) };
  });
  return { items, total: Number(payload.total), categories: payload.categories as string[], page: query.page, pageSize: query.pageSize };
}
