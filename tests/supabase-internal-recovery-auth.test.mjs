import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseAuthClient, SupabaseAuthError } from "../lib/supabase/auth.ts";

const config = { url: "https://school-project.supabase.co", publishableKey: "sb_publishable_synthetic", serviceRoleKey: "sb_secret_synthetic" };
const id = "a1000000-0000-4000-8000-000000000003";
const email = "family@example.invalid";
const hash = "b".repeat(56);
const user = { id, email, email_confirmed_at: "2026-10-12T12:00:00Z" };
const receipt = { ...user, verification_type: "recovery", hashed_token: hash, action_link: "https://school-project.supabase.co/auth/v1/verify?token=synthetic-private", email_otp: "654321", redirect_to: "https://school.example.invalid", user_metadata: { private: true } };
const session = { access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600, token_type: "bearer", user };
const match = (code, operation, status) => error => error instanceof SupabaseAuthError && error.code === code && error.operation === operation && (status === undefined || error.status === status) && !error.message.includes("synthetic-private");

test("private recovery generates one link for an exact existing identity without email, password, redirect or metadata mutation", async () => {
  const calls = [];
  const auth = createSupabaseAuthClient(config, async (url, init) => { calls.push({ url: String(url), init }); return Response.json(receipt); });
  const result = await auth.admin.generateRecoveryLink({ expectedUserId: id, email: " Family@Example.invalid " });
  assert.deepEqual(result, { id, email, emailConfirmedAt: user.email_confirmed_at, tokenHash: hash });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, config.url + "/auth/v1/admin/generate_link");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.apikey, config.serviceRoleKey);
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(calls[0].init.redirect, "error");
  assert.deepEqual(JSON.parse(calls[0].init.body), { type: "recovery", email });
  for (const field of ["action_link", "email_otp", "redirect_to", "user_metadata", "hashed_token"]) assert.equal(result[field], undefined);
});

test("legacy service credentials remain server bearer; generated recovery supports bounded SHA224/SHA256", async () => {
  for (const tokenHash of ["a".repeat(56), "b".repeat(64)]) {
    const auth = createSupabaseAuthClient({ ...config, serviceRoleKey: "synthetic-legacy-service" }, async (_url, init) => {
      assert.equal(init.headers.Authorization, "Bearer synthetic-legacy-service");
      return Response.json({ ...receipt, hashed_token: tokenHash });
    });
    assert.equal((await auth.admin.generateRecoveryLink({ expectedUserId: id, email })).tokenHash, tokenHash);
  }
});

test("invalid recovery generation or absent private key makes zero provider requests", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json(receipt); };
  const auth = createSupabaseAuthClient(config, fetcher);
  for (const input of [null, [], {}, { email }, { email, expectedUserId: "bad" }, { expectedUserId: id, email: "bad" }, { expectedUserId: id, email, password: "bad" }, { expectedUserId: id, email, user_metadata: {} }, { expectedUserId: id, email, redirectTo: "https://evil.invalid" }]) {
    await assert.rejects(auth.admin.generateRecoveryLink(input), match("invalid_input", "admin_generate_recovery_link"));
  }
  const noKey = createSupabaseAuthClient({ ...config, serviceRoleKey: undefined }, fetcher);
  await assert.rejects(noKey.admin.generateRecoveryLink({ expectedUserId: id, email }), match("not_configured", "admin_generate_recovery_link"));
  assert.equal(calls, 0);
});

test("recovery rejects wrong identity, email, type, unconfirmed user and malformed credential; no repair attempt", async () => {
  for (const malformed of [null, [], {}, { ...receipt, id: "a1000000-0000-4000-8000-000000000004" }, { ...receipt, email: "other@example.invalid" }, { ...receipt, email: 1 }, { ...receipt, verification_type: "invite" }, { ...receipt, email_confirmed_at: null }, { ...receipt, email_confirmed_at: "invalid" }, { ...receipt, hashed_token: "pkce_" + hash }, { ...receipt, hashed_token: "z".repeat(56) }, { ...receipt, hashed_token: "a".repeat(55) }]) {
    let calls = 0;
    const auth = createSupabaseAuthClient(config, async () => { calls++; return Response.json(malformed); });
    await assert.rejects(auth.admin.generateRecoveryLink({ expectedUserId: id, email }), match("rejected", "admin_generate_recovery_link", 502));
    assert.equal(calls, 1);
  }
});

test("provider recovery errors and uncertain network outcomes remain sanitized without retries", async () => {
  for (const status of [401, 422, 429, 503]) {
    let calls = 0;
    const auth = createSupabaseAuthClient(config, async () => { calls++; return Response.json({ error: "synthetic-private" }, { status }); });
    await assert.rejects(auth.admin.generateRecoveryLink({ expectedUserId: id, email }), match("rejected", "admin_generate_recovery_link", status));
    assert.equal(calls, 1);
  }
  const auth = createSupabaseAuthClient(config, async () => { throw Error("synthetic-private"); });
  await assert.rejects(auth.admin.generateRecoveryLink({ expectedUserId: id, email }), match("unavailable", "admin_generate_recovery_link"));
});

test("recovery exchange uses publishable key, recovery type and token_hash only", async () => {
  let calls = 0;
  const auth = createSupabaseAuthClient(config, async (url, init) => {
    calls++; assert.equal(String(url), config.url + "/auth/v1/verify"); assert.equal(init.method, "POST");
    assert.equal(init.headers.apikey, config.publishableKey); assert.equal(init.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(init.body), { token_hash: hash, type: "recovery" });
    return Response.json(session);
  });
  assert.deepEqual(await auth.verifyRecoveryTokenHash(hash), session);
  assert.equal(calls, 1);
});

test("invalid recovery credentials or absent public key are rejected before exchange", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json(session); };
  const auth = createSupabaseAuthClient(config, fetcher);
  for (const bad of [null, 7, "", "a".repeat(55), "a".repeat(65), hash + "\n", "pkce_" + hash, { token_hash: hash }]) await assert.rejects(auth.verifyRecoveryTokenHash(bad), match("invalid_input", "verify_recovery_token"));
  const noKey = createSupabaseAuthClient({ ...config, publishableKey: undefined }, fetcher);
  await assert.rejects(noKey.verifyRecoveryTokenHash(hash), match("not_configured", "verify_recovery_token"));
  assert.equal(calls, 0);
});

test("expired/reused recovery credentials and malformed sessions never become accepted receipts", async () => {
  for (const status of [401, 403, 429, 503]) {
    const auth = createSupabaseAuthClient(config, async () => Response.json({ error: "synthetic-private" }, { status }));
    await assert.rejects(auth.verifyRecoveryTokenHash(hash), match("rejected", "verify_recovery_token", status));
  }
  for (const bad of [{ ...session, expires_in: 0 }, { ...session, refresh_token: undefined }, { ...session, user: { id: "bad" } }]) {
    const auth = createSupabaseAuthClient(config, async () => Response.json(bad));
    await assert.rejects(auth.verifyRecoveryTokenHash(hash), match("rejected", "verify_recovery_token", 502));
  }
});
