import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { prepareSchoolAuthLink } from "../lib/supabase/auth-link.ts";

// Run the actual route/session code with the actual REST clients. Replace only
// runtime bindings and HTTP, so no real account, JWT, database, or SMTP is used.
const authId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const cookie = "__Host-school-access=synthetic-access; __Host-school-refresh=synthetic-refresh";

function harness() {
  const environment = {
    SCHOOL_AUTH_PROVIDER: "supabase", SCHOOL_DATA_PROVIDER: "supabase",
    SUPABASE_URL: "https://school.example.test", SUPABASE_PUBLISHABLE_KEY: "test-publishable",
    APP_ORIGIN: "https://portal.example.test",
  };
  const authUser = { id: authId, email: "school@example.test", user_metadata: { role: "superadmin" } };
  const authSession = { access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600, token_type: "bearer", user: authUser };
  const state = { mode: "ok", calls: [], d1Calls: 0, adminCalls: 0 };
  const fetcher = async (input, options = {}) => {
    const url = new URL(input);
    state.calls.push({ url, options });
    if (url.pathname.startsWith("/rest/v1/")) {
      assert.equal(options.headers.Authorization, "Bearer synthetic-access");
      assert.equal(options.headers.apikey, "test-publishable");
      if (state.mode === "database-down") return Response.json({}, { status: 503 });
      if (url.pathname.endsWith("/profiles")) {
        assert.equal(url.searchParams.get("id"), `eq.${authId}`);
        return Response.json(state.mode === "missing-profile" ? [] : [{
          id: state.mode === "foreign-profile" ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" : authId,
          email: state.mode === "foreign-email" ? "other@example.test" : authUser.email,
          name: "Escuela", active: state.mode !== "inactive",
        }]);
      }
      if (url.pathname.endsWith("/user_roles")) {
        assert.equal(url.searchParams.get("user_id"), `eq.${authId}`);
        return Response.json(state.mode === "no-roles" ? [] : [{ role: state.mode === "bad-role" ? "hacker" : "docente" }]);
      }
      throw new Error(`Unexpected database request ${url.pathname}`);
    }
    if (url.pathname === "/auth/v1/token") {
      return state.mode === "invalid-password" ? Response.json({}, { status: 400 }) : Response.json(authSession);
    }
    if (url.pathname === "/auth/v1/user") {
      return state.mode === "expired" ? Response.json({}, { status: 401 }) : Response.json(authUser);
    }
    if (url.pathname === "/auth/v1/logout") return new Response(null, { status: 204 });
    if (url.pathname === "/auth/v1/recover") return new Response(null, { status: state.mode === "recovery-rate-limit" ? 429 : 200 });
    throw new Error(`Unexpected request ${url.pathname}`);
  };
  const modules = new Map();
  const dependencies = {
    "@/lib/runtime/env": { env: environment },
    "@/db": { getDb() { state.d1Calls++; throw new Error("D1 must not be accessed"); } },
    "@/db/schema": {}, "drizzle-orm": {},
    "@/lib/auth": { getAuth() { throw new Error("Better Auth must not be accessed"); } },
    "./admin-database": {
      createSchoolAdminDatabaseClient() { state.adminCalls++; throw new Error("D1 role mirror must not be called"); },
      SupabaseAdminDatabaseError: class extends Error {},
    },
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const sandboxModule = { exports: {} };
    modules.set(file, sandboxModule);
    const source = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const requireMock = name => {
      if (dependencies[name]) return dependencies[name];
      const routes = { "./local-http-test-policy.ts": "lib/supabase/local-http-test-policy.ts",
        "./auth": "lib/supabase/auth.ts", "./database": "lib/supabase/database.ts",
        "./auth-route-utils": "lib/supabase/auth-route-utils.ts", "./session": "lib/supabase/session.ts",
        "@/lib/supabase/session": "lib/supabase/session.ts",
        "@/lib/supabase/database": "lib/supabase/database.ts",
        "@/lib/supabase/access": "lib/supabase/access.ts",
      };
      if (!routes[name]) throw new Error(`Unexpected import ${name}`);
      return load(routes[name]);
    };
    vm.runInContext(source, vm.createContext({
      module: sandboxModule, exports: sandboxModule.exports, require: requireMock, fetch: fetcher,
      URL, Request, Response, Headers, TextEncoder, Set, Map,
    }), { filename: file });
    return sandboxModule.exports;
  }
  return {
    environment, state, authUser,
    ...load("lib/supabase/auth-route.ts"), ...load("lib/supabase/session.ts"), ...load("lib/access.ts"),
  };
}

function post(path, body, withCookie = false) {
  return new Request(`https://portal.example.test/api/auth/${path}`, {
    method: "POST",
    headers: { origin: "https://portal.example.test", "content-type": "application/json", ...(withCookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function login(runtime) {
  return runtime.handleSupabaseAuthRequest(post("sign-in/email", { email: runtime.authUser.email, password: "old-password" }));
}

function noLegacyAccess(runtime) {
  assert.equal(runtime.state.d1Calls, 0);
  assert.equal(runtime.state.adminCalls, 0);
}

test("Supabase login verifies Auth first, uses JWT-scoped profile/roles and keeps tokens out of JSON", async () => {
  const runtime = harness();
  const response = await login(runtime);
  assert.equal(response.status, 200);
  const cookies = response.headers.get("set-cookie");
  assert.match(cookies, /HttpOnly/i);
  assert.match(cookies, /Secure/i);
  const payload = await response.text();
  assert.equal(JSON.parse(payload).user.id, authId);
  assert.doesNotMatch(payload, /synthetic-access|synthetic-refresh|access_token|refresh_token/);
  assert.equal(runtime.state.calls[0].url.pathname, "/auth/v1/token");
  assert.equal(runtime.state.calls[1].url.pathname, "/rest/v1/profiles");
  noLegacyAccess(runtime);
});

test("recovery request uses the current Vercel origin and rejects malformed, foreign or noncanonical redirect URLs", async () => {
  const runtime = harness();
  let response = await runtime.handleSupabaseAuthRequest(post("request-password-reset", { email: runtime.authUser.email, redirectTo: "https://portal.example.test/restablecer" }));
  assert.equal(response.status, 200);
  assert.equal(runtime.state.calls[0].url.pathname, "/auth/v1/recover");
  assert.equal(runtime.state.calls[0].url.searchParams.get("redirect_to"), "https://portal.example.test/restablecer");
  for (const redirectTo of ["not-a-url", "https://foreign.example.test/restablecer", "https://portal.example.test/ingresar", "https://portal.example.test/restablecer?token=inject", "https://portal.example.test/restablecer#token", "https://user:secret@portal.example.test/restablecer"]) {
    runtime.state.calls.length = 0;
    response = await runtime.handleSupabaseAuthRequest(post("request-password-reset", { email: runtime.authUser.email, redirectTo }));
    assert.equal(response.status, 400);
    assert.equal(runtime.state.calls.length, 0);
  }
  runtime.state.mode = "recovery-rate-limit";
  response = await runtime.handleSupabaseAuthRequest(post("request-password-reset", { email: runtime.authUser.email, redirectTo: "https://portal.example.test/restablecer" }));
  assert.equal(response.status, 429);
  noLegacyAccess(runtime);
});

test("recovery and invitation callback tokens authenticate password update without D1, admin API or tokens in JSON", async () => {
  for (const kind of ["recovery", "invite"]) {
    const runtime = harness();
    const callback = prepareSchoolAuthLink(`https://portal.example.test/restablecer#access_token=synthetic-${kind}-access&refresh_token=private-refresh&type=${kind}`);
    const response = await runtime.handleSupabaseAuthRequest(post("reset-password", { token: callback.link.token, newPassword: "new-private-password" }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("set-cookie"), null);
    const payload = await response.text();
    assert.equal(JSON.parse(payload).success, true);
    assert.doesNotMatch(payload, /synthetic|new-private-password|private-refresh/);
    assert.equal(runtime.state.calls.length, 1);
    const call = runtime.state.calls[0];
    assert.equal(call.url.pathname, "/auth/v1/user");
    assert.equal(call.options.method, "PUT");
    assert.equal(call.options.headers.Authorization, `Bearer synthetic-${kind}-access`);
    assert.deepEqual(JSON.parse(call.options.body), { password: "new-private-password" });
    noLegacyAccess(runtime);
  }
});

test("expired recovery token is rejected and a too-short or oversized new password never reaches Auth", async () => {
  const runtime = harness();
  runtime.state.mode = "expired";
  let response = await runtime.handleSupabaseAuthRequest(post("reset-password", { token: "expired-recovery-token", newPassword: "new-private-password" }));
  assert.equal(response.status, 401);
  runtime.state.calls.length = 0;
  for (const newPassword of ["eleven-pass", "x".repeat(129)]) {
    response = await runtime.handleSupabaseAuthRequest(post("reset-password", { token: "recovery-token", newPassword }));
    assert.equal(response.status, 400);
    assert.equal(runtime.state.calls.length, 0);
  }
  noLegacyAccess(runtime);
});

for (const mode of ["inactive", "missing-profile", "foreign-profile", "foreign-email", "no-roles", "bad-role", "invalid-password"]) {
  test(`Supabase login denies ${mode} without issuing session cookies`, async () => {
    const runtime = harness();
    runtime.state.mode = mode;
    const response = await login(runtime);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("set-cookie"), null);
    if (mode === "invalid-password") assert.equal(runtime.state.calls.length, 1);
    noLegacyAccess(runtime);
  });
}

test("database outage and missing credentials return 503, never an authenticated session", async () => {
  const runtime = harness();
  runtime.state.mode = "database-down";
  let response = await login(runtime);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("set-cookie"), null);
  delete runtime.environment.SUPABASE_PUBLISHABLE_KEY;
  response = await login(runtime);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("set-cookie"), null);
  noLegacyAccess(runtime);
});

test("session and actor retain the verified UUID and current database roles, ignoring Auth metadata", async () => {
  const runtime = harness();
  const session = await runtime.getSchoolSession(new Headers({ cookie }));
  assert.equal(session.user.id, authId);
  assert.equal(session.session.userId, authId);
  const actor = await runtime.actorFromRequest(new Request("https://portal.example.test/api/tasks", { headers: { cookie } }));
  assert.equal(actor.id, authId);
  assert.equal(actor.roles.join(","), "docente");
  assert.equal(actor.supabaseAuth.userId, authId);
  const response = await runtime.handleSupabaseAuthRequest(new Request("https://portal.example.test/api/auth/get-session", { headers: { cookie } }));
  const payload = await response.text();
  assert.equal(JSON.parse(payload).user.id, authId);
  assert.doesNotMatch(payload, /synthetic-access|synthetic-refresh/);
  runtime.state.mode = "inactive";
  assert.equal(await runtime.actorFromRequest(new Request("https://portal.example.test/api/tasks", { headers: { cookie } })), null);
  noLegacyAccess(runtime);
});

test("expired Auth session denies access before database reads and invalid provider fails closed", async () => {
  const runtime = harness();
  runtime.state.mode = "expired";
  assert.equal(await runtime.getSchoolSession(new Headers({ cookie })), null);
  assert.equal(runtime.state.calls.length, 1);
  runtime.environment.SCHOOL_AUTH_PROVIDER = "d1";
  assert.equal(await runtime.getSchoolSession(new Headers({ cookie })), null);
  noLegacyAccess(runtime);
});

test("change-password verifies an existing 11-character password while requiring a new password of at least 12", async () => {
  const runtime = harness();
  let response = await runtime.handleSupabaseAuthRequest(post("change-password", { currentPassword: "old-pass123", newPassword: "new-pass12345" }, true));
  assert.equal(response.status, 200);
  assert.ok(runtime.state.calls.find(call => call.url.pathname === "/auth/v1/token" && JSON.parse(call.options.body).password === "old-pass123"));
  assert.ok(runtime.state.calls.find(call => call.url.pathname === "/auth/v1/user" && call.options.method === "PUT" && JSON.parse(call.options.body).password === "new-pass12345"));
  runtime.state.calls.length = 0;
  response = await runtime.handleSupabaseAuthRequest(post("change-password", { currentPassword: "old-pass123", newPassword: "short-pass1" }, true));
  assert.equal(response.status, 400);
  assert.equal(runtime.state.calls.length, 0);
  noLegacyAccess(runtime);
});
