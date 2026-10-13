import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as zod from "zod";
import { webcrypto } from "node:crypto";
import * as authModule from "../lib/supabase/auth.ts";
import * as accountAdministration from "../lib/supabase/account-administration.ts";
import * as activation from "../lib/supabase/internal-activation.ts";
import * as authRouteUtils from "../lib/supabase/auth-route-utils.ts";

const origin = "https://school.example.invalid";
const secret = "synthetic-private-activation-key-20261012-abcdefghijklmnopqrstuvwxyz";
const actorId = "a1000000-0000-4000-8000-000000000001";
const targetId = "a1000000-0000-4000-8000-000000000002";
const tokenHash = "b".repeat(56);
const input = { name: "Maestra ficticia", email: "Teacher@Example.invalid", role: "docente" };
const source = ts.transpileModule(readFileSync(new URL("../app/api/users/route.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

function harness(overrides = {}) {
  const state = { ready: true, events: [], environment: { SCHOOL_AUTH_PROVIDER: "supabase", SCHOOL_DATA_PROVIDER: "supabase", SCHOOL_ACCOUNT_ACTIVATION_MODE: "internal", SCHOOL_ACCOUNT_ACTIVATION_SECRET: secret, APP_ORIGIN: origin }, actor: { id: actorId, roles: ["direccion"], supabaseAuth: { userId: actorId, accessToken: "synthetic-school-direction-jwt" } }, ...overrides };
  const auth = { admin: {
    listUsers: async () => { state.events.push({ operation: "listAuthUsers" }); return state.existingUsers ?? []; },
    generateInviteLink: async body => {
      state.events.push({ operation: "generatePrivateInvite", body });
      if (state.generationError) throw state.generationError;
      return { user: { id: targetId, email: body.email, invited_at: "2026-10-12T12:00:00Z", app_metadata: { provider: "email" } }, tokenHash };
    },
    inviteUserByEmail: async body => { state.events.push({ operation: "sendEmailInvite", body }); return { id: targetId, email: body.email, invited_at: "2026-10-12T12:00:00Z" }; },
    updateUser: async (id, body) => { state.events.push({ operation: "stampReceipt", id, body }); return { id, email: input.email.toLowerCase(), app_metadata: body.app_metadata }; },
  } };
  const database = { rpc: async (jwt, name, fields) => {
    state.events.push({ operation: "rpc", jwt, name, fields });
    return { data: [name === "school_provision_invited_account" ? { id: targetId, active: true, role: fields.p_role } : { quarantined: true }] };
  } };
  const imports = {
    "drizzle-orm": {}, zod,
    "@/db": { getDb: () => assert.fail("An internal Supabase invitation cannot touch legacy D1") },
    "@/db/schema": {},
    "@/lib/runtime/env": { env: state.environment },
    "@/lib/access": { actorFromRequest: async () => { state.events.push({ operation: "actor" }); return state.actor; }, hasRole: (actor, ...roles) => roles.some(role => actor.roles.includes(role)), errorResponse: (status, error) => Response.json({ error }, { status }) },
    "@/lib/auth": { getAuth: () => assert.fail("Legacy Better Auth must not participate") },
    "@/lib/supabase/auth": { ...authModule, createSchoolAuthClient: () => { state.events.push({ operation: "authFactory" }); return auth; } },
    "@/lib/supabase/auth-route-utils": authRouteUtils,
    "@/lib/supabase/invitation-recovery": { checkInvitationIdentity: async () => assert.fail("Do not reconcile uncertain internal accounts by email") },
    "@/lib/pagination": {},
    "@/lib/supabase/database": { createSchoolDatabaseClient: () => { state.events.push({ operation: "databaseFactory" }); return database; } },
    "@/lib/supabase/account-feed": {},
    "@/lib/supabase/account-administration": accountAdministration,
    "@/lib/supabase/internal-activation": activation,
    "@/lib/supabase/internal-activation-database": { isInternalActivationDatabaseReady: async (_environment, jwt) => {
      state.events.push({ operation: "readiness", jwt });
      if (state.readyError) throw state.readyError;
      return state.readyGate ? await state.readyGate : state.ready;
    } },
  };
  const sandboxModule = { exports: {} };
  vm.runInNewContext(source, { module: sandboxModule, exports: sandboxModule.exports, require: name => imports[name] ?? assert.fail(`Unexpected import ${name}`), Request, Response, Headers, URL, Date, crypto: webcrypto });
  return { state, POST: sandboxModule.exports.POST };
}
function request(body = input, selectedOrigin = origin) {
  return new Request(origin + "/api/users", { method: "POST", headers: { origin: selectedOrigin, "content-type": "application/json" }, body: JSON.stringify(body) });
}
function assertNoIdentityWrites(state) {
  assert.equal(state.events.some(event => ["authFactory", "databaseFactory", "listAuthUsers", "generatePrivateInvite", "sendEmailInvite", "stampReceipt", "rpc"].includes(event.operation)), false);
}

test("unapplied internal activation migration denies the real POST handler before creating any Auth identity", async () => {
  const h = harness({ ready: false });
  const response = await h.POST(request());
  assert.equal(response.status, 503);
  assert.deepEqual(h.state.events.map(event => event.operation), ["actor", "readiness"]);
  assert.equal(h.state.events[1].jwt, "synthetic-school-direction-jwt");
  assertNoIdentityWrites(h.state);
  assert.equal((await response.text()).includes(secret), false);
});

test("an unavailable or uncertain readiness RPC never creates an invitation or assigns a school role", async () => {
  const h = harness({ readyError: Error("synthetic-private-readiness-provider-detail") });
  const response = await h.POST(request());
  assert.equal(response.status, 503);
  assertNoIdentityWrites(h.state);
  assert.deepEqual(h.state.events.map(event => event.operation), ["actor", "readiness"]);
  assert.equal((await response.text()).includes("synthetic-private"), false);
});

test("Auth identity creation waits for the completed database readiness check", async () => {
  let resolve;
  const gate = new Promise(done => { resolve = done; });
  const h = harness({ readyGate: gate });
  const pending = h.POST(request());
  await new Promise(done => setImmediate(done));
  assert.deepEqual(h.state.events.map(event => event.operation), ["actor", "readiness"]);
  assertNoIdentityWrites(h.state);
  resolve(false);
  assert.equal((await pending).status, 503);
  assertNoIdentityWrites(h.state);
});

test("confirmed readiness precedes the real private invitation, protected provision and encrypted activation code response", async () => {
  const h = harness();
  const response = await h.POST(request());
  assert.equal(response.status, 201);
  assert.deepEqual(h.state.events.map(event => event.operation), ["actor", "readiness", "authFactory", "databaseFactory", "listAuthUsers", "generatePrivateInvite", "stampReceipt", "rpc"]);
  assert.equal(h.state.events.at(-1).jwt, "synthetic-school-direction-jwt");
  assert.equal(h.state.events.at(-1).name, "school_provision_invited_account");
  const result = await response.json();
  assert.deepEqual(Object.keys(result).sort(), ["activation", "id", "invited"]);
  assert.equal(result.id, targetId);
  assert.equal(result.invited, false);
  assert.equal(result.activation.activationPath, "/activar-cuenta");
  assert.equal(Number.isFinite(Date.parse(result.activation.expiresAt)), true);
  assert.match(result.activation.code, /^EMDN1\.[A-Za-z0-9_-]+$/);
  assert.equal(JSON.stringify(result).includes(tokenHash), false);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes("synthetic-school-direction-jwt"), false);
  assert.equal(result.activationIdentity, undefined);
  const decoded = await activation.readInternalActivationCode(result.activation.code, input.email, secret);
  assert.equal(decoded.tokenHash, tokenHash);
  assert.equal(decoded.id, targetId);
  assert.equal(decoded.role, input.role);
  assert.equal(decoded.nonce, h.state.events.find(event => event.operation === "stampReceipt").body.app_metadata.school_invitation_receipt.nonce);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});

test("a missing, short or provider-secret activation key fails before checking migrations or creating Auth identities", async () => {
  for (const key of [undefined, "short", "sb_secret_synthetic-this-is-not-an-activation-key"]) {
    const h = harness(); h.state.environment.SCHOOL_ACCOUNT_ACTIVATION_SECRET = key;
    assert.equal((await h.POST(request())).status, 503);
    assert.deepEqual(h.state.events.map(event => event.operation), ["actor"]);
    assertNoIdentityWrites(h.state);
  }
});

test("internal activation cannot create a user without the administrator's verified Supabase JWT", async () => {
  const h = harness(); h.state.actor.supabaseAuth = undefined;
  assert.equal((await h.POST(request())).status, 503);
  assert.deepEqual(h.state.events.map(event => event.operation), ["actor"]);
  assertNoIdentityWrites(h.state);
});

test("cross-site, logged-out and family requests are denied before readiness and invitation work", async () => {
  const crossSite = harness();
  assert.equal((await crossSite.POST(request(input, "https://evil.example.invalid"))).status, 403);
  assert.equal(crossSite.state.events.length, 0);
  const loggedOut = harness({ actor: null });
  assert.equal((await loggedOut.POST(request())).status, 401);
  assertNoIdentityWrites(loggedOut.state);
  const family = harness(); family.state.actor.roles = ["tutor"];
  assert.equal((await family.POST(request())).status, 403);
  assertNoIdentityWrites(family.state);
});

test("Direction cannot create Direction and no route permits creating a superadmin account", async () => {
  const direction = harness();
  assert.equal((await direction.POST(request({ ...input, role: "direccion" }))).status, 403);
  assertNoIdentityWrites(direction.state);
  const admin = harness(); admin.state.actor.roles = ["superadmin"];
  assert.equal((await admin.POST(request({ ...input, role: "superadmin" }))).status, 400);
  assertNoIdentityWrites(admin.state);
});

test("an existing identity is not regenerated or given an activation code even when migrations are ready", async () => {
  const h = harness({ existingUsers: [{ id: targetId, email: input.email.toLowerCase() }] });
  const response = await h.POST(request());
  assert.equal(response.status, 409);
  assert.equal(h.state.events.some(event => ["generatePrivateInvite", "stampReceipt", "rpc"].includes(event.operation)), false);
  const result = await response.json();
  assert.equal(result.activation, undefined);
  assert.equal(JSON.stringify(result).includes(tokenHash), false);
});

test("a failed private invitation cannot return a success code or invoke the school permission RPC", async () => {
  const h = harness({ generationError: Error("synthetic-private-generation-provider-detail") });
  const response = await h.POST(request());
  assert.equal(response.status, 503);
  assert.equal(h.state.events.some(event => ["stampReceipt", "rpc"].includes(event.operation)), false);
  const result = await response.json();
  assert.equal(result.activation, undefined);
  assert.equal(JSON.stringify(result).includes("synthetic-private"), false);
});

test("email invitation mode preserves the existing response and does not call the new internal readiness gate", async () => {
  const h = harness(); h.state.environment.SCHOOL_ACCOUNT_ACTIVATION_MODE = "email";
  h.state.environment.SCHOOL_ACCOUNT_ACTIVATION_SECRET = undefined;
  const response = await h.POST(request());
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: targetId, invited: true });
  assert.equal(h.state.events.some(event => event.operation === "readiness"), false);
  assert.equal(h.state.events.some(event => event.operation === "generatePrivateInvite"), false);
  assert.equal(h.state.events.filter(event => event.operation === "sendEmailInvite").length, 1);
  assert.equal(h.state.events.find(event => event.operation === "sendEmailInvite").body.redirectTo, origin + "/restablecer");
});
