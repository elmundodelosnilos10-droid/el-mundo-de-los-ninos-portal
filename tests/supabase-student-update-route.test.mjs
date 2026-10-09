import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const studentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const groupId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function harness() {
  const state = { actor: { id: "actor-school", roles: ["direccion"], supabaseAuth: { userId: "actor-school", accessToken: "student-user-jwt" } }, visible: true, httpStatus: 200, rows: [{ id: studentId, given_name: "Ana", family_name: "Escolar", birth_date: null }], calls: [], d1Calls: 0 };
  const dependencies = {
    "@/lib/runtime/env": { env: { SCHOOL_DATA_PROVIDER: "supabase", SUPABASE_URL: "https://school.example.test", SUPABASE_PUBLISHABLE_KEY: "test-public" } },
    "@/db": { getDb() { state.d1Calls++; throw new Error("D1 must not be read in Supabase mode"); } },
    "@/db/schema": {}, "drizzle-orm": {}, "zod": require("zod"),
    "@/lib/access": {
      actorFromRequest: async () => state.actor,
      hasRole: (actor, ...roles) => roles.some(role => actor.roles.includes(role)),
      maySeeStudent: async () => state.visible,
      errorResponse: (status, message) => Response.json({ error: message }, { status }),
    },
  };
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const sandboxModule = { exports: {} }; modules.set(file, sandboxModule);
    const source = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const fetcher = async (input, options) => {
      const url = new URL(input); state.calls.push({ url, options });
      assert.equal(options.headers.Authorization, "Bearer student-user-jwt");
      assert.equal(options.headers.apikey, "test-public");
      if (state.httpStatus !== 200) return Response.json({ error: "upstream-private-details" }, { status: state.httpStatus });
      return Response.json(url.pathname === "/rest/v1/students" ? state.rows : { updated: true });
    };
    const requireMock = name => {
      if (dependencies[name]) return dependencies[name];
      const files = { "./local-http-test-policy.ts": "lib/supabase/local-http-test-policy.ts", "@/lib/supabase/auth-route-utils": "lib/supabase/auth-route-utils.ts", "@/lib/supabase/database": "lib/supabase/database.ts" };
      if (!files[name]) throw new Error(`Unexpected import ${name}`);
      return load(files[name]);
    };
    vm.runInContext(source, vm.createContext({ module: sandboxModule, exports: sandboxModule.exports, require: requireMock, fetch: fetcher, URL, Response, Request, Headers, TextEncoder, crypto: webcrypto }), { filename: file });
    return sandboxModule.exports;
  }
  return { state, ...load("app/api/students/[id]/route.ts") };
}

function context(id = studentId) { return { params: Promise.resolve({ id }) }; }
function patch(body, origin = "https://portal.example.test") {
  return new Request(`https://portal.example.test/api/students/${studentId}`, { method: "PATCH", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
}

test("student GET uses private RLS-scoped select and returns the existing camelCase DTO", async () => {
  const runtime = harness();
  const response = await runtime.GET(new Request(`https://portal.example.test/api/students/${studentId}`), context());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: studentId, givenName: "Ana", familyName: "Escolar", birthDate: null });
  assert.equal(runtime.state.calls[0].url.searchParams.get("id"), `eq.${studentId}`);
  assert.equal(runtime.state.d1Calls, 0);
});

test("student GET denies missing or foreign RLS rows and rejects unauthorized visibility before fetching", async () => {
  for (const rows of [[], [{ id: groupId, given_name: "Ajeno", family_name: "Oculto", birth_date: null }]]) {
    const runtime = harness(); runtime.state.rows = rows;
    assert.equal((await runtime.GET(new Request("https://portal.example.test/"), context())).status, 404);
  }
  const runtime = harness(); runtime.state.visible = false;
  assert.equal((await runtime.GET(new Request("https://portal.example.test/"), context())).status, 404);
  assert.equal(runtime.state.calls.length, 0);
});

test("student PATCH preserves omitted birth date and explicitly clears null through the atomic RPC", async () => {
  for (const clear of [false, true]) {
    const runtime = harness();
    const response = await runtime.PATCH(patch({ givenName: " Ana ", familyName: "Escolar", ...(clear ? { birthDate: null } : {}) }), context());
    assert.equal(response.status, 200);
    const call = runtime.state.calls[0];
    assert.equal(call.url.pathname, "/rest/v1/rpc/school_update_student");
    assert.deepEqual(JSON.parse(call.options.body), { p_student_id: studentId, p_given_name: "Ana", p_family_name: "Escolar", p_birth_date: null, p_replace_birth_date: clear });
    assert.equal(runtime.state.d1Calls, 0);
  }
});

test("logical withdrawal and reactivation use transaction RPCs rather than direct deletes", async () => {
  const runtime = harness();
  let response = await runtime.PATCH(patch({ active: false }), context());
  assert.deepEqual(await response.json(), { updated: true, active: false });
  assert.equal(runtime.state.calls[0].url.pathname, "/rest/v1/rpc/school_set_student_active");
  assert.deepEqual(JSON.parse(runtime.state.calls[0].options.body), { p_student_id: studentId, p_active: false, p_group_id: null, p_enrollment_id: null });
  runtime.state.calls.length = 0;
  response = await runtime.PATCH(patch({ active: true, groupId }), context());
  assert.equal(response.status, 200);
  const input = JSON.parse(runtime.state.calls[0].options.body);
  assert.equal(input.p_group_id, groupId);
  assert.equal(input.p_active, true);
  assert.match(input.p_enrollment_id, /^[a-f0-9-]{36}$/);
  assert.equal(runtime.state.d1Calls, 0);
});

test("PATCH denies cross-site, unauthenticated, family role, invalid UUID, bad name/date and missing reactivation group before HTTP", async () => {
  const crossSite = harness();
  assert.equal((await crossSite.PATCH(patch({ active: false }, "https://other.example.test"), context())).status, 403);
  assert.equal(crossSite.state.calls.length, 0);
  const loggedOut = harness(); loggedOut.state.actor = null;
  assert.equal((await loggedOut.PATCH(patch({ active: false }), context())).status, 401);
  const family = harness(); family.state.actor.roles = ["tutor"];
  assert.equal((await family.PATCH(patch({ active: false }), context())).status, 403);
  for (const body of [{ active: true }, { givenName: "", familyName: "Escolar" }, { givenName: "Ana", familyName: "Escolar", birthDate: "2026-99-99" }]) {
    const runtime = harness();
    assert.equal((await runtime.PATCH(patch(body), context())).status, 400);
    assert.equal(runtime.state.calls.length, 0);
  }
  const invalidId = harness();
  assert.equal((await invalidId.PATCH(patch({ active: false }), context("not-a-uuid"))).status, 400);
  assert.equal(invalidId.state.calls.length, 0);
});

test("database errors map to sanitized 400/403/404/409/503 without leaking upstream details", async () => {
  for (const [upstream, expected] of [[400, 400], [403, 403], [404, 404], [409, 409], [502, 503]]) {
    const runtime = harness(); runtime.state.httpStatus = upstream;
    const response = await runtime.PATCH(patch({ active: false }), context());
    assert.equal(response.status, expected);
    assert.doesNotMatch(await response.text(), /upstream-private-details|student-user-jwt|test-public/);
  }
});

test("student edit SQL uses authenticated leadership, locks, auditable transactions and no destructive history removal", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/20261023000000_school_student_update_rpc.sql", import.meta.url), "utf8");
  assert.equal((sql.match(/language plpgsql security definer set search_path = ''/g) ?? []).length, 2);
  assert.equal((sql.match(/auth.uid\(\) is null or not public.school_is_leader\(\)/g) ?? []).length, 2);
  assert.equal((sql.match(/for update/g) ?? []).length, 2);
  assert.match(sql, /from public.groups g where g.id = p_group_id and g.active for share/);
  assert.match(sql, /birth_date = case when p_replace_birth_date then p_birth_date else birth_date end/);
  assert.match(sql, /update public.enrollments set ended_at = v_now where student_id = p_student_id and ended_at is null/);
  assert.match(sql, /student_has_open_enrollment/);
  assert.equal((sql.match(/insert into public.audit_log/g) ?? []).length, 2);
  assert.match(sql, /revoke insert, update, delete on table public.students, public.enrollments from authenticated/);
  assert.doesNotMatch(sql, /delete from public\./);
  assert.doesNotMatch(sql, /p_actor/);
});

test("password form admits existing 8-character passwords and retains the new-password minimum", () => {
  const source = fs.readFileSync(new URL("../app/mi-cuenta/password-change-form.tsx", import.meta.url), "utf8");
  assert.match(source, /id="current-password"[^\n]+minLength=\{8\}/);
  assert.match(source, /id="new-password"[^\n]+minLength=\{12\}/);
});
