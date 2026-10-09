import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const groupId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const jwt = "synthetic-library-jwt";
const row = { id: groupId, fileId: groupId, groupId, groupName: "Grupo sintético", title: "Colores", category: "Audio", publishedAt: "2026-10-08T10:00:00Z", fileName: "colores.mp3", mimeType: "audio/mpeg", sizeBytes: 20, objectKey: "private-not-for-clients" };
function harness() {
  const state = { actor: { id: "user-synthetic", roles: ["tutor"], supabaseAuth: { userId: "user-synthetic", accessToken: jwt } }, calls: [], d1: 0, status: 200, payload: { items: [row], total: 31, categories: ["Audio", "Guía"] } };
  const failD1 = () => { state.d1++; throw new Error("Supabase must not initialize D1"); };
  const dependencies = {
    "@/lib/runtime/env": { env: { SCHOOL_DATA_PROVIDER: "supabase", SUPABASE_URL: "https://library.example.test", SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable" } },
    "@/db": { getDb: failD1 }, "@/db/schema": {}, "drizzle-orm": {},
    "@/lib/access": { actorFromRequest: async () => state.actor, accessibleGroupIds: failD1,
      hasRole: (actor, ...roles) => roles.some(role => actor.roles.includes(role)), errorResponse: (status, error) => Response.json({ error }, { status }) },
  };
  const modules = new Map();
  const files = { "./local-http-test-policy.ts": "lib/supabase/local-http-test-policy.ts", "@/lib/supabase/database": "lib/supabase/database.ts", "@/lib/supabase/library": "lib/supabase/library.ts", "@/lib/library-query": "lib/library-query.ts" };
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const sandboxModule = { exports: {} }; modules.set(file, sandboxModule);
    const source = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const fetcher = async (url, options) => {
      state.calls.push({ url: new URL(url), options });
      assert.equal(options.headers.Authorization, `Bearer ${jwt}`);
      assert.equal(options.headers.apikey, "synthetic-publishable");
      assert.equal(new URL(url).pathname, "/rest/v1/rpc/school_search_materials");
      return Response.json(state.status === 200 ? state.payload : { message: "private upstream details" }, { status: state.status });
    };
    vm.runInContext(source, vm.createContext({ module: sandboxModule, exports: sandboxModule.exports, URL, URLSearchParams, Request, Response, Headers, TextEncoder, fetch: fetcher,
      require: name => { if (dependencies[name]) return dependencies[name]; if (files[name]) return load(files[name]); throw new Error(`Unexpected dependency ${name}`); } }), { filename: file });
    return sandboxModule.exports;
  }
  return { state, ...load("app/api/materials/route.ts") };
}
function request(query = "") { return new Request(`https://portal.example.test/api/materials${query}`); }

test("actual materials GET forwards search/filter/page to JWT RPC, returns exact count/facets and never reaches D1", async () => {
  const runtime = harness();
  const response = await runtime.GET(request(`?q=Colores%25&groupId=${groupId}&category=Audio&page=3&pageSize=12`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.total, 31); assert.equal(body.page, 3); assert.equal(body.pageSize, 12);
  assert.deepEqual(body.categories, ["Audio", "Guía"]); assert.equal(body.items.length, 1);
  assert.equal("objectKey" in body.items[0], false);
  assert.deepEqual(JSON.parse(runtime.state.calls[0].options.body), { p_query: "Colores%", p_group_id: groupId, p_category: "Audio", p_limit: 12, p_offset: 24 });
  assert.equal(runtime.state.d1, 0);
});

test("actual materials GET rejects missing session, disallowed role and malformed filters before database access", async () => {
  for (const [change, suffix, status] of [
    [state => { state.actor = null; }, "", 401],
    [state => { state.actor.roles = ["alumno"]; }, "", 403],
    [() => {}, "?q=one&q=two", 400], [() => {}, "?pageSize=500", 400], [() => {}, "?groupId=not-a-uuid", 400], [() => {}, "?unknown=value", 400],
  ]) {
    const runtime = harness(); change(runtime.state);
    const response = await runtime.GET(request(suffix));
    assert.equal(response.status, status); assert.equal(runtime.state.calls.length, 0); assert.equal(runtime.state.d1, 0);
  }
});

test("actual materials GET rejects absent or mismatched verified Supabase identity without D1 fallback", async () => {
  for (const auth of [null, { userId: "foreign-user", accessToken: jwt }]) {
    const runtime = harness(); runtime.state.actor.supabaseAuth = auth;
    const response = await runtime.GET(request());
    assert.equal(response.status, 503); assert.equal(runtime.state.calls.length, 0); assert.equal(runtime.state.d1, 0);
  }
});

test("actual materials GET preserves authorization status and sanitizes upstream or malformed result errors", async () => {
  for (const [upstream, expected] of [[403, 403], [404, 404], [500, 503]]) {
    const runtime = harness(); runtime.state.status = upstream;
    const response = await runtime.GET(request());
    assert.equal(response.status, expected); assert.equal(runtime.state.d1, 0);
    assert.doesNotMatch(await response.text(), /private upstream details|synthetic-library-jwt|synthetic-publishable/);
  }
  const runtime = harness(); runtime.state.payload = { items: [], total: -1, categories: [] };
  assert.equal((await runtime.GET(request())).status, 503); assert.equal(runtime.state.d1, 0);
});

test("actual materials GET distinguishes authorized empty results from errors without inventing rows or counts", async () => {
  const runtime = harness(); runtime.state.payload = { items: [], total: 0, categories: ["Audio"] };
  const response = await runtime.GET(request("?q=absent"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: [], total: 0, categories: ["Audio"], page: 1, pageSize: 12 });
  assert.equal(runtime.state.d1, 0);
});
