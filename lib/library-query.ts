export type LibraryQuery = { query: string; groupId: string | null; category: string | null; page: number; pageSize: number };
export type LibraryMaterial = {
  id: string; fileId: string; groupId: string; groupName: string; title: string; category: string;
  publishedAt: string; fileName: string; mimeType: string; sizeBytes: number;
};
export type LibraryFeed = { items: LibraryMaterial[]; total: number; categories: string[]; page: number; pageSize: number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseLibraryQuery(params: URLSearchParams): LibraryQuery | null {
  const allowed = new Set(["q", "groupId", "category", "page", "pageSize"]);
  if ([...params.keys()].some(key => !allowed.has(key) || params.getAll(key).length !== 1)) return null;
  const query = (params.get("q") ?? "").trim();
  const groupId = params.get("groupId")?.trim() || null;
  const category = params.get("category")?.trim() || null;
  if (query.length > 100 || /[\u0000-\u001f\u007f]/.test(query) || (groupId && !UUID.test(groupId)) ||
      (category && (category.length > 60 || /[\u0000-\u001f\u007f]/.test(category)))) return null;
  const pageText = params.get("page") ?? "1";
  const sizeText = params.get("pageSize") ?? "12";
  if (!/^\d+$/.test(pageText) || !/^\d+$/.test(sizeText)) return null;
  const page = Number(pageText); const pageSize = Number(sizeText);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50 || (page - 1) * pageSize > 100_000) return null;
  return { query, groupId, category, page, pageSize };
}

export function libraryListUrl(options: LibraryQuery) {
  const params = new URLSearchParams({ page: String(options.page), pageSize: String(options.pageSize) });
  if (options.query) params.set("q", options.query);
  if (options.groupId) params.set("groupId", options.groupId);
  if (options.category) params.set("category", options.category);
  return `/api/materials?${params}`;
}

export function libraryPreviewKind(mimeType: string): "pdf" | "image" | "audio" | null {
  if (mimeType === "application/pdf") return "pdf";
  if (["image/jpeg", "image/png", "image/webp"].includes(mimeType)) return "image";
  if (["audio/mpeg", "audio/ogg", "audio/wav"].includes(mimeType)) return "audio";
  return null;
}
