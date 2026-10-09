import assert from "node:assert/strict";
import test from "node:test";
import { parseLibraryQuery, libraryListUrl, libraryPreviewKind } from "../lib/library-query.ts";
import { loadPrivateLibraryPreview } from "../lib/library-preview.ts";
import { createSupabaseDatabaseClient } from "../lib/supabase/database.ts";
import { readSchoolLibrary } from "../lib/supabase/library.ts";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const config = { url: "https://library.example.test", publishableKey: "synthetic-public-key" };
const query = { query: "cat_%", groupId: id, category: "Audio", page: 2, pageSize: 12 };
const material = { id, fileId: id, groupId: id, groupName: "Grupo sintético", title: "Cat", category: "Audio", publishedAt: "2026-10-08T10:00:00Z", fileName: "cat.mp3", mimeType: "audio/mpeg", sizeBytes: 20 };

test("library query uses bounded, validated server pagination and preserves literal search text", () => {
  assert.deepEqual(parseLibraryQuery(new URLSearchParams()), { query: "", groupId: null, category: null, page: 1, pageSize: 12 });
  assert.deepEqual(parseLibraryQuery(new URL(libraryListUrl(query), "https://portal.example.test").searchParams), query);
  assert.equal(parseLibraryQuery(new URLSearchParams({ q: "  cat_%  " })).query, "cat_%");
  for (const params of [{ page: "0" }, { page: "1.5" }, { pageSize: "51" }, { pageSize: "0" }, { page: "100002", pageSize: "1" },
    { groupId: "unknown" }, { q: "x".repeat(101) }, { q: "a\nb" }, { category: "x".repeat(61) }, { unknown: "1" }]) {
    assert.equal(parseLibraryQuery(new URLSearchParams(params)), null);
  }
  assert.equal(parseLibraryQuery(new URLSearchParams("page=1&page=2")), null);
});

test("library feed filters and paginates on JWT/RLS RPC and exposes only needed DTO fields", async () => {
  let request;
  const client = createSupabaseDatabaseClient(config, async (url, init) => {
    request = { url: String(url), init };
    return Response.json({ items: [{ ...material, object_key: "private/file", email: "private@example.test" }], total: 21, categories: ["Actividad", "Audio"] });
  });
  assert.deepEqual(await readSchoolLibrary(client, "synthetic-user-jwt", query), { items: [material], total: 21, categories: ["Actividad", "Audio"], page: 2, pageSize: 12 });
  assert.match(request.url, /\/rpc\/school_search_materials$/);
  assert.equal(request.init.headers.Authorization, "Bearer synthetic-user-jwt");
  assert.equal(request.init.headers.apikey, config.publishableKey);
  assert.deepEqual(JSON.parse(request.init.body), { p_query: "cat_%", p_group_id: id, p_category: "Audio", p_limit: 12, p_offset: 12 });
});

test("library successful empty result stays distinct from upstream failure or invalid counts", async () => {
  const client = createSupabaseDatabaseClient(config, async () => Response.json({ items: [], total: 0, categories: [] }));
  assert.deepEqual((await readSchoolLibrary(client, "jwt", query)).items, []);
  for (const payload of [{ items: [], total: null, categories: [] }, { items: [material], total: -1, categories: [] },
    { items: [material], total: 1, categories: [null] }, { items: [{ ...material, publishedAt: "bad" }], total: 1, categories: [] }]) {
    const invalid = createSupabaseDatabaseClient(config, async () => Response.json(payload));
    await assert.rejects(readSchoolLibrary(invalid, "jwt", query), /School library unavailable/);
  }
  const failed = createSupabaseDatabaseClient(config, async () => Response.json({ message: "private error" }, { status: 503 }));
  await assert.rejects(readSchoolLibrary(failed, "jwt", query));
});

test("preview formats exclude HTML, SVG and unsupported active content", () => {
  for (const [type, kind] of [["application/pdf", "pdf"], ["image/jpeg", "image"], ["image/png", "image"], ["image/webp", "image"], ["audio/mpeg", "audio"], ["audio/ogg", "audio"], ["audio/wav", "audio"]]) {
    assert.equal(libraryPreviewKind(type), kind);
  }
  for (const type of ["text/html", "image/svg+xml", "video/mp4", "application/octet-stream"]) assert.equal(libraryPreviewKind(type), null);
});

test("preview downloads private bytes with same-origin cookies, no-store and cancellation; no public URLs", async () => {
  const controller = new AbortController(); let request;
  const blob = await loadPrivateLibraryPreview(id, "application/pdf", controller.signal, async (url, init) => {
    request = { url, init }; return new Response("%PDF-1.7 synthetic", { headers: { "content-type": "application/pdf" } });
  });
  assert.equal(request.url, `/api/files/${id}`);
  assert.equal(request.init.credentials, "same-origin");
  assert.equal(request.init.cache, "no-store");
  assert.equal(request.init.signal, controller.signal);
  assert.equal(request.init.headers, undefined);
  assert.equal(blob.type, "application/pdf");
  assert.ok(blob.size > 0);
});

test("preview safely handles unavailable permission, expired session, changed MIME and aborted load", async () => {
  for (const [status, message] of [[401, /sesión expiró/], [403, /no está disponible/], [404, /no está disponible/], [503, /No se pudo abrir/]]) {
    await assert.rejects(loadPrivateLibraryPreview(id, "application/pdf", new AbortController().signal, async () => new Response("private upstream credentials", { status })), message);
  }
  await assert.rejects(loadPrivateLibraryPreview(id, "application/pdf", new AbortController().signal, async () => new Response("html", { headers: { "content-type": "text/html" } })), /formato del archivo cambió/);
  const aborted = new AbortController();
  await assert.rejects(loadPrivateLibraryPreview(id, "application/pdf", aborted.signal, async () => { aborted.abort(); return new Response("pdf", { headers: { "content-type": "application/pdf" } }); }), { name: "AbortError" });
  let called = false;
  await assert.rejects(loadPrivateLibraryPreview("../other", "text/html", new AbortController().signal, async () => { called = true; return new Response(); }));
  assert.equal(called, false);
});
