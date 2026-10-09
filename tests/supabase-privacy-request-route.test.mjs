import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const jwt = "synthetic-privacy-route-jwt";

function harness() {
  const state = {
    actor: { id: actorId, roles: ["tutor"], supabaseAuth: { userId: actorId, accessToken: jwt } },
    env: { SCHOOL_DATA_PROVIDER: "supabase", SUPABASE_URL: "https://school.example.test", SUPABASE_PUBLISHABLE_KEY: "synthetic-public-key" },
    status: 200, payload: { items: [], students: [] }, calls: [], d1Calls: 0,
  };
  const dependencies = {
    "@/lib/runtime/env": { env: state.env }, "@/db/schema": {}, "drizzle-orm": {}, "zod": require("zod"),
    "@/db": { getDb() { state.d1Calls++; throw Error("D1 must not be consulted"); } },
    "@/lib/access": {
      actorFromRequest: async () => state.actor,
      hasRole: (actor, ...roles) => roles.some(role => actor.roles.includes(role)),
      errorResponse: (status, error) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } }),
    },
  };
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const sandboxModule = { exports: {} }; modules.set(file, sandboxModule);
    const source = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const mockRequire = name => {
      if (dependencies[name]) return dependencies[name];
      const files = {
        "@/lib/supabase/auth-route-utils": "lib/supabase/auth-route-utils.ts",
        "@/lib/supabase/database": "lib/supabase/database.ts",
        "@/lib/supabase/privacy-administration": "lib/supabase/privacy-administration.ts",
        "./local-http-test-policy.ts": "lib/supabase/local-http-test-policy.ts",
      };
      if (!files[name]) throw Error(`Unexpected import ${name}`);
      return load(files[name]);
    };
    const fetcher = async (input, options) => {
      const url = new URL(input); state.calls.push({ url, options });
      assert.equal(options.headers.Authorization, `Bearer ${jwt}`);
      assert.equal(url.pathname, "/rest/v1/rpc/school_privacy_request_directory");
      assert.deepEqual(JSON.parse(options.body), {});
      return Response.json(state.status === 200 ? state.payload : { code: "42501", message: "private-upstream-detail" }, { status: state.status });
    };
    vm.runInContext(source, vm.createContext({ module: sandboxModule, exports: sandboxModule.exports, require: mockRequire,
      fetch: fetcher, URL, Request, Response, Headers, TextEncoder, TextDecoder, AbortSignal }), { filename: file });
    return sandboxModule.exports;
  }
  return { state, GET: load("app/api/privacy-requests/route.ts").GET };
}

const request = () => new Request("https://portal.example.test/api/privacy-requests");

test("privacy directory rejects anonymous and unauthorized roles before any provider request", async () => {
  for (const provider of ["supabase", "d1"]) {
    for (const roles of [null, [], ["docente"], ["alumno"]]) {
      const runtime = harness(); runtime.state.env.SCHOOL_DATA_PROVIDER = provider;
      if (roles === null) runtime.state.actor = null; else runtime.state.actor.roles = roles;
      const response = await runtime.GET(request());
      assert.equal(response.status, roles === null ? 401 : 403);
      assert.equal(runtime.state.calls.length, 0); assert.equal(runtime.state.d1Calls, 0);
    }
  }
});

test("authorized privacy directory uses verified actor JWT and returns private no-store data without D1", async () => {
  for (const role of ["tutor", "direccion", "superadmin"]) {
    const runtime = harness(); runtime.state.actor.roles = [role];
    const response = await runtime.GET(request());
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), runtime.state.payload);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(runtime.state.calls.length, 1); assert.equal(runtime.state.d1Calls, 0);
  }
});

test("missing or mismatched privacy identity remains unavailable without requesting data", async () => {
  for (const auth of [null, { userId: "different-user", accessToken: jwt }]) {
    const runtime = harness(); runtime.state.actor.supabaseAuth = auth;
    const response = await runtime.GET(request());
    assert.equal(response.status, 503); assert.equal(runtime.state.calls.length, 0); assert.equal(runtime.state.d1Calls, 0);
    assert.doesNotMatch(await response.text(), /synthetic-privacy|different-user/);
  }
});

test("privacy RPC forbidden is 403 while upstream outages stay sanitized 503", async () => {
  for (const [status, expected] of [[403, 403], [502, 503]]) {
    const runtime = harness(); runtime.state.status = status;
    const response = await runtime.GET(request());
    assert.equal(response.status, expected); assert.equal(runtime.state.calls.length, 1); assert.equal(runtime.state.d1Calls, 0);
    assert.doesNotMatch(await response.text(), /private-upstream-detail|42501|synthetic-public-key|synthetic-privacy/);
  }
});
