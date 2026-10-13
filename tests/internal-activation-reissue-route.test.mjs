import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as authRouteUtils from "../lib/supabase/auth-route-utils.ts";
import * as activation from "../lib/supabase/internal-activation.ts";
import * as reissue from "../lib/supabase/internal-activation-reissue.ts";

const origin = "https://school.example.invalid", target = "a1000000-0000-4000-8000-000000000002", leader = "a1000000-0000-4000-8000-000000000001", oldNonce = "a9000000-0000-4000-8000-000000000002";
const secret = "synthetic-private-reissue-key-20261012-abcdefghijklmnopqrstuvwxyz";
const email = "pending@example.invalid";
const source = ts.transpileModule(readFileSync(new URL("../app/api/users/[id]/activation/reissue/route.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function harness(overrides = {}) {
  const state = { events: [], reserved: true, environment: { SCHOOL_AUTH_PROVIDER: "supabase", SCHOOL_DATA_PROVIDER: "supabase", SCHOOL_ACCOUNT_ACTIVATION_MODE: "internal", SCHOOL_ACCOUNT_ACTIVATION_SECRET: secret }, actor: { id: leader, roles: ["direccion"], supabaseAuth: { userId: leader, accessToken: "synthetic-leader-jwt" } }, ...overrides };
  const identity = { id: target, email, invited_at: "2026-10-12T12:00:00Z", app_metadata: { school_invitation_receipt: { email, role: "docente", nonce: oldNonce, inviter_id: leader, delivery: "internal" } } };
  const providerFetch = async (_url, init) => { state.events.push({ operation: "boundedFetch", signal: init.signal }); assert.ok(init.signal instanceof AbortSignal); assert.equal(init.signal.aborted, false); return Response.json({}); };
  const imports = {
    "@/lib/runtime/env": { env: state.environment }, "@/lib/supabase/auth-route-utils": authRouteUtils, "@/lib/supabase/internal-activation": activation, "@/lib/supabase/internal-activation-reissue": reissue,
    "@/lib/access": { actorFromRequest: async () => state.actor, hasRole: (actor, ...roles) => roles.some(role => actor.roles.includes(role)), errorResponse: (status, error) => Response.json({ error }, { status }) },
    "@/lib/supabase/database": { createSchoolDatabaseClient: (_env, fetcher) => ({ rpc: async (_jwt, name, fields) => {
      state.events.push({ operation: name }); await fetcher("https://school-project.supabase.co/rest/v1/rpc/synthetic", {});
      if (state.dbError) throw state.dbError;
      state.nonce = fields.p_replacement_nonce;
      return { data: [name.includes("begin") ? state.reserved ? { reserved: true, id: target, name: "Cuenta pendiente", email, role: "docente", nonce: state.nonce, previousNonce: oldNonce, inviterId: leader } : { reserved: false } : { finished: true, id: target, email, role: "docente", nonce: state.nonce }] };
    } }) },
    "@/lib/supabase/auth": { createSchoolAuthClient: (_env, fetcher) => { state.events.push({ operation: "authFactory" }); return { admin: {
      generateInviteLink: async () => { state.events.push({ operation: "generate" }); await fetcher("https://school-project.supabase.co/auth/v1/admin/generate_link", {}); return { user: identity, tokenHash: "a".repeat(56) }; },
      updateUser: async (_id, fields) => { state.events.push({ operation: "stamp" }); await fetcher("https://school-project.supabase.co/auth/v1/admin/users/synthetic", {}); return { ...identity, app_metadata: fields.app_metadata }; },
    } }; } },
  };
  const sandboxModule = { exports: {} };
  vm.runInNewContext(source, { module: sandboxModule, exports: sandboxModule.exports, require: name => imports[name] ?? assert.fail(name), Request, Response, Headers, AbortSignal, fetch: providerFetch });
  return { state, run: (requestOrigin = origin, id = target) => sandboxModule.exports.POST(new Request(origin + `/api/users/${id}/activation/reissue`, { method: "POST", headers: { origin: requestOrigin }, body: "{}" }), { params: Promise.resolve({ id }) }) };
}

test("reissue route rejects cross-site, logged out, family and malformed identifiers before provider access", async () => {
  const foreign = harness(); assert.equal((await foreign.run("https://evil.example.invalid")).status, 403); assert.equal(foreign.state.events.length, 0);
  const out = harness({ actor: null }); assert.equal((await out.run()).status, 401); assert.equal(out.state.events.length, 0);
  const family = harness(); family.state.actor.roles = ["tutor"]; assert.equal((await family.run()).status, 403); assert.equal(family.state.events.length, 0);
  const bad = harness(); assert.equal((await bad.run(origin, "invalid")).status, 400); assert.equal(bad.state.events.length, 0);
});

test("unconfigured server cannot reserve invitations or build an Auth client", async () => {
  for (const changed of [{ SCHOOL_ACCOUNT_ACTIVATION_MODE: "email" }, { SCHOOL_AUTH_PROVIDER: "better-auth" }, { SCHOOL_DATA_PROVIDER: "d1" }, { SCHOOL_ACCOUNT_ACTIVATION_SECRET: "short" }]) {
    const f = harness(); Object.assign(f.state.environment, changed); assert.equal((await f.run()).status, 503); assert.equal(f.state.events.length, 0);
  }
});

test("ineligible account response is a safe conflict and no Auth factory runs", async () => {
  const f = harness({ reserved: false }); const response = await f.run(); assert.equal(response.status, 409);
  assert.equal(f.state.events.some(event => event.operation === "authFactory"), false);
  assert.equal((await response.json()).activation, undefined);
});

test("lost reservation response is uncertain, sanitized and never creates credentials", async () => {
  const f = harness({ dbError: Error("synthetic-private-provider-detail") }); const response = await f.run();
  assert.equal(response.status, 503); assert.equal(f.state.events.some(event => event.operation === "authFactory"), false);
  const result = await response.json(); assert.equal(result.code, "reissue_uncertain"); assert.equal(JSON.stringify(result).includes("synthetic-private"), false);
});

test("successful route uses bounded provider requests and returns only a private encrypted activation code", async () => {
  const f = harness(); const response = await f.run(); assert.equal(response.status, 201);
  assert.equal(f.state.events.filter(event => event.operation === "boundedFetch").length, 4);
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  const result = await response.json(); assert.equal(result.id, target); assert.equal(result.invited, false);
  assert.equal(JSON.stringify(result).includes("a".repeat(56)), false); assert.equal(JSON.stringify(result).includes(secret), false);
  const decoded = await activation.readInternalActivationCode(result.activation.code, email, secret); assert.equal(decoded.nonce, f.state.nonce);
});
