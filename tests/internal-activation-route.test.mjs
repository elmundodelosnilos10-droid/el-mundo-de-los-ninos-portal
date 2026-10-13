import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { webcrypto } from "node:crypto";
import * as authModule from "../lib/supabase/auth.ts";
import * as activation from "../lib/supabase/internal-activation.ts";
import * as authRouteUtils from "../lib/supabase/auth-route-utils.ts";

const origin = "https://school.example.invalid";
const baseNow = Date.parse("2026-10-12T12:00:00Z");
const secret = "synthetic-private-activation-key-20261012-abcdefghijklmnopqrstuvwxyz";
const identity = { id: "a1000000-0000-4000-8000-000000000002", email: "teacher@example.invalid", role: "docente", nonce: "a9000000-0000-4000-8000-000000000002", tokenHash: "a".repeat(56) };
const accessToken = "synthetic-provisional-access-token";
const cookieName = "__Host-school-activation";
const normalCookies = "__Host-school-access=synthetic-master-access; __Host-school-refresh=synthetic-master-refresh";
const environment = { SCHOOL_AUTH_PROVIDER: "supabase", SCHOOL_DATA_PROVIDER: "supabase", SCHOOL_ACCOUNT_ACTIVATION_MODE: "internal", SCHOOL_ACCOUNT_ACTIVATION_SECRET: secret };
const source = ts.transpileModule(readFileSync(new URL("../lib/supabase/internal-activation-route.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const sandboxModule = { exports: {} };
const imports = { "@/lib/runtime/env": { env: {} }, "./auth": authModule, "./auth-route-utils": authRouteUtils, "./internal-activation": activation, "./internal-activation-database": { claimInternalActivation: async () => assert.fail("Use the injected atomic claim callback") }, "./session": { getActiveSupabaseSchoolAccount: async () => assert.fail("Use the injected user-scoped account dependency") } };
vm.runInNewContext(source, { module: sandboxModule, exports: sandboxModule.exports, require: name => imports[name] ?? assert.fail(`Unexpected dependency ${name}`), Request, Response, Headers, URL, TextEncoder, TextDecoder, Uint8Array, Date, crypto: webcrypto });
const { createInternalActivationHandlers } = sandboxModule.exports;

function harness(overrides = {}) {
  const state = { now: baseNow, consumed: false, claimed: false, events: [], ...overrides };
  state.user ??= { id: identity.id, email: identity.email, invited_at: "2026-10-12T11:59:00Z", app_metadata: { provider: "email", unrelated: "preserved", school_invitation_receipt: { email: identity.email, nonce: identity.nonce, role: identity.role, delivery: "internal" } } };
  state.account ??= { id: identity.id, name: "Maestra ficticia", email: identity.email, roles: [identity.role] };
  const auth = {
    verifyInviteTokenHash: async hash => {
      state.events.push({ operation: "verifyInvite", hash });
      if (state.verifyError) throw state.verifyError;
      if (state.consumed) throw new authModule.SupabaseAuthError("rejected", "verify_invite_token", 403);
      state.consumed = true;
      return { access_token: accessToken, refresh_token: "synthetic-provisional-refresh", expires_in: 3600, token_type: "bearer", user: state.verifiedUser ?? state.user };
    },
    verifyCurrentUser: async token => { state.events.push({ operation: "verifyUser", token }); if (state.currentError) throw state.currentError; return state.user; },
    signOut: async token => { state.events.push({ operation: "signOut", token }); if (state.logoutError) throw state.logoutError; },
    admin: { updateUser: async (id, fields) => {
      state.events.push({ operation: "update", id, fields });
      if (state.updateError) throw state.updateError;
      if (state.updatedReceipt) return state.updatedReceipt;
      state.user = { ...state.user, app_metadata: fields.app_metadata };
      return state.user;
    } },
  };
  const handlers = createInternalActivationHandlers({ environment: state.environment ?? environment, auth: () => { state.events.push({ operation: "authFactory" }); return auth; }, account: async (user, token) => { state.events.push({ operation: "account", id: user.id, token }); if (state.accountError) throw state.accountError; if (state.accountGate) await state.accountGate(); return state.accountDenied ? null : state.account; }, claim: async session => {
    state.events.push({ operation: "claim", id: session.id, nonce: session.nonce, token: session.accessToken });
    if (state.claimError) throw state.claimError;
    if (state.claimDenied || state.claimed) return false;
    state.claimed = true;
    if (state.afterClaim) state.afterClaim();
    return true;
  }, now: () => state.now });
  return { state, handle: handlers.handle };
}
function request(path, body, options = {}) {
  return new Request(origin + path, { method: options.method ?? "POST", headers: { origin, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(options.cookie ? { cookie: options.cookie } : {}), ...options.headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function activationCode(now = baseNow) { return (await activation.createInternalActivationCode(identity, secret, now)).code; }
async function provisionalCookie(expiresAt = baseNow + 600_000) {
  const value = await activation.sealInternalActivationSession({ id: identity.id, email: identity.email, role: identity.role, nonce: identity.nonce, accessToken, expiresAt }, secret, baseNow);
  return `${cookieName}=${encodeURIComponent(value)}`;
}
function cookieFrom(response) { return response.headers.get("set-cookie")?.split(";", 1)[0]; }
function assertNoSchoolSession(response) {
  const header = response.headers.get("set-cookie") ?? "";
  assert.doesNotMatch(header, /__Host-school-(?:access|refresh)=/);
}
function assertPrivate(response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assertNoSchoolSession(response);
}
const validPasswords = { password: "synthetic-chosen-password-2026", confirmPassword: "synthetic-chosen-password-2026" };

test("a provisional session expiring while its database claim waits cannot update a password", async () => {
  const h = harness(); h.state.afterClaim = () => { h.state.now = baseNow + 600_000; };
  const response = await h.handle(request("/api/account-activation/complete", validPasswords, { cookie: await provisionalCookie() }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "activation_consumed");
  assert.equal(h.state.events.filter(event => event.operation === "update").length, 0);
  assert.equal(h.state.claimed, true);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  assertPrivate(response);
});

test("activation rejects cross-origin POST requests before configuration or any provider access", async () => {
  for (const path of ["/api/account-activation/verify", "/api/account-activation/complete", "/api/account-activation/cancel"]) {
    const h = harness({ environment: {} });
    for (const originHeader of ["https://evil.example.invalid", "null", "https://school.example.invalid/path"]) {
      const response = await h.handle(request(path, {}, { headers: { origin: originHeader } }));
      assert.equal(response.status, 403);
      assert.equal(h.state.events.length, 0);
      assertPrivate(response);
    }
    const response = await h.handle(new Request(origin + path, { method: "POST", body: "{}" }));
    assert.equal(response.status, 403);
    assert.equal(h.state.events.length, 0);
  }
});

test("cross-site status reads and mismatched GET origins are rejected without provider calls", async () => {
  for (const headers of [{ "sec-fetch-site": "cross-site" }, { origin: "https://evil.example.invalid" }]) {
    const h = harness();
    assert.equal((await h.handle(new Request(origin + "/api/account-activation", { headers }))).status, 403);
    assert.equal(h.state.events.length, 0);
  }
});

test("disabled or incomplete internal configuration fails closed before Auth", async () => {
  for (const values of [{}, { ...environment, SCHOOL_ACCOUNT_ACTIVATION_MODE: "email" }, { ...environment, SCHOOL_AUTH_PROVIDER: "better-auth" }, { ...environment, SCHOOL_DATA_PROVIDER: "d1" }, { ...environment, SCHOOL_ACCOUNT_ACTIVATION_SECRET: undefined }, { ...environment, SCHOOL_ACCOUNT_ACTIVATION_SECRET: "short" }, { ...environment, SCHOOL_ACCOUNT_ACTIVATION_SECRET: "sb_secret_synthetic-this-is-not-an-activation-key" }]) {
    const h = harness({ environment: values });
    const response = await h.handle(request("/api/account-activation/verify", { email: identity.email, code: "synthetic-invalid" }));
    assert.equal(response.status, 503);
    assert.equal(h.state.events.length, 0);
    assertPrivate(response);
  }
});

test("a same-origin status read without provisional credentials is pending false and clears only the provisional cookie", async () => {
  const h = harness();
  const response = await h.handle(request("/api/account-activation", undefined, { method: "GET", cookie: normalCookies }));
  assert.deepEqual(await response.json(), { pending: false });
  assert.match(response.headers.get("set-cookie"), /^__Host-school-activation=;.*Max-Age=0/);
  assert.equal(h.state.events.length, 0);
  assertPrivate(response);
});

test("bounded JSON reader cancels oversized bodies with and without Content-Length before reading credentials", async () => {
  for (const length of [undefined, "8193", "invalid"]) {
    let cancelled = 0;
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(8193))); }, cancel() { cancelled++; } });
    const h = harness();
    const req = new Request(origin + "/api/account-activation/verify", { method: "POST", headers: { origin, ...(length ? { "content-length": length } : {}) }, body: stream, duplex: "half" });
    const response = await h.handle(req);
    assert.equal(response.status, 400);
    assert.equal(cancelled, 1);
    assert.equal(h.state.events.length, 0);
  }
});

test("invalid JSON, arrays, extra fields and missing verify fields never call Auth", async () => {
  const cases = [[], {}, { email: identity.email }, { email: identity.email, code: "x", password: "synthetic" }, { email: 1, code: "x" }, { email: identity.email, code: {} }];
  for (const body of cases) {
    const h = harness();
    assert.equal((await h.handle(request("/api/account-activation/verify", body))).status, 400);
    assert.equal(h.state.events.length, 0);
  }
  const h = harness();
  const response = await h.handle(new Request(origin + "/api/account-activation/verify", { method: "POST", headers: { origin }, body: "not JSON" }));
  assert.equal(response.status, 400);
  assert.equal(h.state.events.length, 0);
});

test("forged, wrong-email or expired codes are rejected before provider token consumption", async () => {
  const code = await activationCode();
  for (const selected of [{ code: code.slice(0, -1) + (code.endsWith("A") ? "B" : "A"), email: identity.email }, { code, email: "other@example.invalid" }, { code: "EMDN1.not-real", email: identity.email }]) {
    const h = harness();
    assert.equal((await h.handle(request("/api/account-activation/verify", selected))).status, 401);
    assert.equal(h.state.events.length, 0);
  }
  const h = harness({ now: baseNow + 30 * 60_000 });
  assert.equal((await h.handle(request("/api/account-activation/verify", { code, email: identity.email }))).status, 401);
  assert.equal(h.state.events.length, 0);
});

test("verified code grants only encrypted, HttpOnly, Secure provisional credentials after user-JWT and school access checks", async () => {
  const h = harness();
  const response = await h.handle(request("/api/account-activation/verify", { code: await activationCode(), email: " Teacher@Example.invalid " }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { verified: true, email: identity.email });
  assert.deepEqual(h.state.events.map(event => event.operation), ["authFactory", "verifyInvite", "verifyUser", "account"]);
  assert.equal(h.state.events[2].token, accessToken);
  assert.equal(h.state.events[3].token, accessToken);
  const header = response.headers.get("set-cookie");
  assert.match(header, /^__Host-school-activation=EMDNS1\.[A-Za-z0-9_-]+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Expires=/);
  assert.equal(header.includes(accessToken), false);
  assert.equal(header.includes(identity.tokenHash), false);
  const value = decodeURIComponent(cookieFrom(response).split("=")[1]);
  const decrypted = await activation.readInternalActivationSession(value, secret, baseNow);
  assert.equal(decrypted.accessToken, accessToken);
  assert.equal(decrypted.expiresAt, baseNow + 600_000);
  assertPrivate(response);
});

test("Auth rejecting a reused code cannot grant a second provisional session", async () => {
  const h = harness();
  const body = { code: await activationCode(), email: identity.email };
  assert.equal((await h.handle(request("/api/account-activation/verify", body))).status, 200);
  const response = await h.handle(request("/api/account-activation/verify", body));
  assert.equal(response.status, 401);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(h.state.events.filter(event => event.operation === "account").length, 1);
});

test("verification identity mismatch revokes only the newly issued provisional session", async () => {
  for (const user of [{ id: "a1000000-0000-4000-8000-000000000003", email: identity.email }, { id: identity.id, email: "other@example.invalid" }]) {
    const h = harness({ verifiedUser: user });
    const response = await h.handle(request("/api/account-activation/verify", { code: await activationCode(), email: identity.email }, { cookie: normalCookies }));
    assert.equal(response.status, 401);
    assert.deepEqual(h.state.events.filter(event => event.operation === "signOut"), [{ operation: "signOut", token: accessToken }]);
    assert.equal(h.state.events.filter(event => event.operation === "account").length, 0);
    assertNoSchoolSession(response);
  }
});

test("mismatched nonce, delivery, role or completed nonce fails before creating cookies or changing password", async () => {
  for (const change of [{ nonce: "wrong" }, { delivery: "email" }, { role: "tutor" }, { email: "other@example.invalid" }]) {
    const h = harness();
    Object.assign(h.state.user.app_metadata.school_invitation_receipt, change);
    const response = await h.handle(request("/api/account-activation/verify", { code: await activationCode(), email: identity.email }));
    assert.equal(response.status, 401);
    assert.equal(h.state.events.some(event => event.operation === "update"), false);
    assert.equal(h.state.events.some(event => event.operation === "account"), false);
    assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  }
  const h = harness();
  h.state.user.app_metadata.school_activation_completed_nonce = identity.nonce;
  assert.equal((await h.handle(request("/api/account-activation/verify", { code: await activationCode(), email: identity.email }))).status, 401);
});

test("superadmin, mixed roles, wrong school identities, inactive and quarantined school access cannot activate", async () => {
  for (const changes of [{ roles: ["superadmin"] }, { roles: ["docente", "superadmin"] }, { roles: ["tutor"] }, { id: "a1000000-0000-4000-8000-000000000003" }, { email: "other@example.invalid" }, { roles: [] }]) {
    const h = harness(); Object.assign(h.state.account, changes);
    const response = await h.handle(request("/api/account-activation/verify", { code: await activationCode(), email: identity.email }));
    assert.equal(response.status, 401);
    assert.equal(h.state.events.some(event => event.operation === "update"), false);
  }
  for (const deniedState of ["inactive", "quarantined"]) {
    const h = harness({ accountDenied: true, deniedState });
    assert.equal((await h.handle(request("/api/account-activation/verify", { code: await activationCode(), email: identity.email }))).status, 401);
    assert.equal(h.state.events.some(event => event.operation === "update"), false);
  }
});

test("rate limits and provider outages are sanitized and never falsely verify an activation", async () => {
  for (const [error, status] of [[new authModule.SupabaseAuthError("rejected", "verify_invite_token", 429), 429], [new authModule.SupabaseAuthError("unavailable", "verify_invite_token"), 503], [new authModule.SupabaseAuthError("not_configured", "verify_invite_token"), 503]]) {
    const h = harness({ verifyError: error });
    const response = await h.handle(request("/api/account-activation/verify", { code: await activationCode(), email: identity.email }));
    assert.equal(response.status, status);
    assert.equal((await response.json()).verified, undefined);
    assertNoSchoolSession(response);
  }
});

test("a valid provisional status read revalidates Auth and RLS and returns only pending and email", async () => {
  const h = harness();
  const response = await h.handle(request("/api/account-activation", undefined, { method: "GET", cookie: await provisionalCookie() }));
  assert.deepEqual(await response.json(), { pending: true, email: identity.email });
  assert.deepEqual(h.state.events.map(event => event.operation), ["authFactory", "verifyUser", "account"]);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("expired provisional cookies fail before any Auth request and cannot set passwords", async () => {
  const cookie = await provisionalCookie(baseNow + 2);
  const h = harness({ now: baseNow + 2 });
  const response = await h.handle(request("/api/account-activation/complete", validPasswords, { cookie }));
  assert.equal(response.status, 401);
  assert.equal(h.state.events.length, 0);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
});

test("duplicate, corrupt or absent provisional cookies never borrow an existing school session", async () => {
  const valid = await provisionalCookie();
  for (const cookie of [normalCookies, valid + "; " + valid, `${cookieName}=%E0%A4%A`, `${cookieName}=EMDNS1.invalid`, `${cookieName}=${"x".repeat(3801)}`]) {
    const h = harness();
    const response = await h.handle(request("/api/account-activation/complete", validPasswords, { cookie }));
    assert.equal(response.status, 401);
    assert.equal(h.state.events.length, 0);
    assertNoSchoolSession(response);
  }
});

test("password validation and extra fields fail before reading provisional credentials", async () => {
  for (const body of [{ ...validPasswords, password: "short" }, { ...validPasswords, confirmPassword: "different" }, { ...validPasswords, password: "a".repeat(129), confirmPassword: "a".repeat(129) }, { ...validPasswords, token: accessToken }, { password: "a\n".repeat(10), confirmPassword: "a\n".repeat(10) }, { password: validPasswords.password }]) {
    const h = harness();
    assert.equal((await h.handle(request("/api/account-activation/complete", body, { cookie: await provisionalCookie() }))).status, 400);
    assert.equal(h.state.events.length, 0);
  }
});

test("completion revalidates user-JWT school access then performs one atomic Auth password-plus-marker update", async () => {
  const h = harness();
  const response = await h.handle(request("/api/account-activation/complete", validPasswords, { cookie: (await provisionalCookie()) + "; " + normalCookies }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { activated: true });
  assert.deepEqual(h.state.events.map(event => event.operation), ["authFactory", "verifyUser", "account", "claim", "update", "signOut"]);
  assert.deepEqual(h.state.events.find(event => event.operation === "claim"), { operation: "claim", id: identity.id, nonce: identity.nonce, token: accessToken });
  const update = h.state.events.find(event => event.operation === "update");
  assert.equal(update.id, identity.id);
  assert.deepEqual(Object.keys(update.fields).sort(), ["app_metadata", "password"]);
  assert.equal(update.fields.password, validPasswords.password);
  assert.equal(update.fields.app_metadata.provider, "email");
  assert.equal(update.fields.app_metadata.unrelated, "preserved");
  assert.equal(update.fields.app_metadata.school_activation_completed_nonce, identity.nonce);
  assert.equal(h.state.events.at(-1).token, accessToken);
  assert.match(response.headers.get("set-cookie"), /^__Host-school-activation=;.*Max-Age=0/);
  assertPrivate(response);
});

test("the confirmed completion marker denies a sequential replay of the provisional cookie", async () => {
  const h = harness();
  const cookie = await provisionalCookie();
  assert.equal((await h.handle(request("/api/account-activation/complete", validPasswords, { cookie }))).status, 200);
  const replay = await h.handle(request("/api/account-activation/complete", validPasswords, { cookie }));
  assert.equal(replay.status, 401);
  assert.equal(h.state.events.filter(event => event.operation === "update").length, 1);
  assert.equal(h.state.events.filter(event => event.operation === "claim").length, 1);
  assert.match(replay.headers.get("set-cookie"), /Max-Age=0/);
});

test("concurrent completion requests sharing one provisional cookie must authorize only one password mutation", async () => {
  let arrivals = 0;
  let release;
  const bothAuthorized = new Promise(resolve => { release = resolve; });
  const h = harness({ accountGate: async () => { arrivals++; if (arrivals === 2) release(); await bothAuthorized; } });
  const cookie = await provisionalCookie();
  const otherPasswords = { password: "synthetic-second-chosen-password", confirmPassword: "synthetic-second-chosen-password" };
  const results = await Promise.all([
    h.handle(request("/api/account-activation/complete", validPasswords, { cookie })),
    h.handle(request("/api/account-activation/complete", otherPasswords, { cookie })),
  ]);
  assert.equal(arrivals, 2, "Both requests passed real Auth/RLS callbacks before the mutation barrier opened");
  assert.equal(h.state.events.filter(event => event.operation === "update").length, 1, "One-use activation must reject the competing password write");
  assert.equal(h.state.events.filter(event => event.operation === "claim").length, 2, "Both competing requests reached the atomic claim gate");
  assert.equal(results.filter(response => response.status === 200).length, 1);
  assert.equal(results.filter(response => response.status === 409).length, 1);
});

test("malformed password update receipts consume the claim and clear credentials without reporting success", async () => {
  for (const updatedReceipt of [{ id: "a1000000-0000-4000-8000-000000000003", email: identity.email, app_metadata: { school_activation_completed_nonce: identity.nonce } }, { id: identity.id, email: "other@example.invalid", app_metadata: { school_activation_completed_nonce: identity.nonce } }, { id: identity.id, email: identity.email, app_metadata: {} }]) {
    const h = harness({ updatedReceipt });
    const response = await h.handle(request("/api/account-activation/complete", validPasswords, { cookie: await provisionalCookie() }));
    assert.equal(response.status, 503);
    const result = await response.json();
    assert.equal(result.activated, undefined);
    assert.equal(result.code, "activation_consumed");
    assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
    assert.equal(h.state.claimed, true);
    assert.equal(h.state.events.filter(event => event.operation === "update").length, 1);
    assert.deepEqual(h.state.events.filter(event => event.operation === "signOut"), [{ operation: "signOut", token: accessToken }]);
  }
});

test("known password PUT failures consume the claim, clear credentials and never expose provider causes or submitted password", async () => {
  const h = harness({ updateError: Error("synthetic-private-provider-detail") });
  const response = await h.handle(request("/api/account-activation/complete", validPasswords, { cookie: await provisionalCookie() }));
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.equal(text.includes("synthetic-private-provider-detail"), false);
  assert.equal(text.includes(validPasswords.password), false);
  assert.equal(text.includes(accessToken), false);
  assert.equal(JSON.parse(text).code, "activation_consumed");
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(h.state.claimed, true);
  assert.equal(h.state.events.filter(event => event.operation === "update").length, 1);
  const repeat = await h.handle(request("/api/account-activation/complete", validPasswords, { cookie: await provisionalCookie() }));
  assert.equal(repeat.status, 409);
  assert.equal(h.state.events.filter(event => event.operation === "update").length, 1, "A consumed activation is never automatically reopened after an Auth error");
});

test("a denied atomic claim cannot mutate Auth and clears only provisional credentials", async () => {
  const h = harness({ claimDenied: true });
  const response = await h.handle(request("/api/account-activation/complete", validPasswords, { cookie: await provisionalCookie() }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "activation_consumed");
  assert.equal(h.state.events.filter(event => event.operation === "claim").length, 1);
  assert.equal(h.state.events.some(event => event.operation === "update"), false);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  assertPrivate(response);
});

test("an uncertain atomic claim aborts before any password update and does not suggest retrying completion", async () => {
  const h = harness({ claimError: Error("synthetic-private-claim-provider-detail") });
  const response = await h.handle(request("/api/account-activation/complete", validPasswords, { cookie: await provisionalCookie() }));
  assert.equal(response.status, 503);
  const result = await response.json();
  assert.equal(result.code, "activation_consumed");
  assert.equal(result.activated, undefined);
  assert.equal(JSON.stringify(result).includes("synthetic-private"), false);
  assert.equal(h.state.events.some(event => event.operation === "update"), false);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  assertNoSchoolSession(response);
});

test("cancel signs out only verified provisional credentials and preserves the main school account session", async () => {
  const h = harness();
  const response = await h.handle(request("/api/account-activation/cancel", undefined, { cookie: (await provisionalCookie()) + "; " + normalCookies }));
  assert.deepEqual(await response.json(), { cancelled: true });
  assert.deepEqual(h.state.events.filter(event => event.operation === "signOut"), [{ operation: "signOut", token: accessToken }]);
  assert.equal(h.state.events.some(event => event.operation === "update"), false);
  assert.match(response.headers.get("set-cookie"), /^__Host-school-activation=;.*Max-Age=0/);
  assertPrivate(response);
});

test("cancel without valid provisional access or while disabled clears only the provisional cookie without touching Auth", async () => {
  for (const values of [{ environment: {} }, { accountDenied: true }, {}]) {
    const h = harness(values);
    const response = await h.handle(request("/api/account-activation/cancel", undefined, { cookie: normalCookies }));
    assert.equal(response.status, 200);
    assert.equal(h.state.events.length, 0);
    assert.equal(response.headers.get("set-cookie").includes("__Host-school-access"), false);
  }
});

test("unavailable current identity or RLS lookup denies completion without a password mutation", async () => {
  for (const changes of [{ currentError: Error("synthetic-private-identity-detail") }, { accountError: Error("synthetic-private-RLS-detail") }, { accountDenied: true }]) {
    const h = harness(changes);
    const response = await h.handle(request("/api/account-activation/complete", validPasswords, { cookie: await provisionalCookie() }));
    assert.equal(response.status, 401);
    assert.equal(h.state.events.some(event => event.operation === "update"), false);
    assert.equal((await response.text()).includes("synthetic-private"), false);
  }
});

test("unexpected route or method cannot reach activation credentials", async () => {
  const h = harness();
  assert.equal((await h.handle(request("/api/account-activation/unknown", {}))).status, 404);
  assert.equal((await h.handle(request("/api/account-activation/verify", undefined, { method: "GET" }))).status, 404);
  assert.equal(h.state.events.length, 0);
});
