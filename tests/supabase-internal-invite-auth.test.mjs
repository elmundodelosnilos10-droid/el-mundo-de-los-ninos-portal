import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseAuthClient, SupabaseAuthError } from "../lib/supabase/auth.ts";

const config = { url: "https://school-project.supabase.co", publishableKey: "sb_publishable_synthetic", serviceRoleKey: "sb_secret_synthetic" };
const user = { id: "a1000000-0000-4000-8000-000000000002", email: "teacher@example.invalid", invited_at: "2026-10-12T12:00:00Z", app_metadata: { provider: "email" } };
const hash = "a".repeat(56);
const receipt = { ...user, hashed_token: hash, email_otp: "123456", verification_type: "invite", action_link: "https://school-project.supabase.co/auth/v1/verify?token=synthetic", redirect_to: "https://school.example.invalid" };
const session = { access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600, token_type: "bearer", user };
const matchesError = (code, operation, status) => error => error instanceof SupabaseAuthError && error.code === code && error.operation === operation && (status === undefined || error.status === status);

test("private invitation uses only admin generate_link, no SMTP, password, redirect or recovery request", async () => {
  const calls = [];
  const auth = createSupabaseAuthClient(config, async (url, init) => { calls.push({ url: String(url), init }); return Response.json(receipt); });
  const result = await auth.admin.generateInviteLink({ email: " Teacher@Example.invalid ", user_metadata: { name: "Maestra ficticia" } });
  assert.deepEqual(result, { user, tokenHash: hash });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${config.url}/auth/v1/admin/generate_link`);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.apikey, config.serviceRoleKey);
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(calls[0].init.redirect, "error");
  assert.deepEqual(JSON.parse(calls[0].init.body), { type: "invite", email: user.email, data: { name: "Maestra ficticia" } });
  for (const key of ["action_link", "email_otp", "hashed_token", "verification_type", "redirect_to"]) assert.equal(result.user[key], undefined);
});

test("legacy service key uses bearer for private invitation generation", async () => {
  const auth = createSupabaseAuthClient({ ...config, serviceRoleKey: "synthetic-legacy-service" }, async (_url, init) => {
    assert.equal(init.headers.apikey, "synthetic-legacy-service");
    assert.equal(init.headers.Authorization, "Bearer synthetic-legacy-service");
    return Response.json(receipt);
  });
  assert.equal((await auth.admin.generateInviteLink({ email: user.email })).tokenHash, hash);
});

test("generation accepts the current SHA224 and bounded SHA256 receipt forms", async () => {
  for (const tokenHash of ["a".repeat(56), "b".repeat(64)]) {
    const auth = createSupabaseAuthClient(config, async () => Response.json({ ...receipt, hashed_token: tokenHash }));
    assert.equal((await auth.admin.generateInviteLink({ email: user.email })).tokenHash, tokenHash);
  }
});

test("invalid invite parameters and absent server key fail before any network call", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json(receipt); };
  const auth = createSupabaseAuthClient(config, fetcher);
  for (const input of [null, [], {}, { email: "bad" }, { email: user.email, type: "recovery" }, { email: user.email, password: "synthetic" }, { email: user.email, redirectTo: "https://evil.invalid" }, { email: user.email, user_metadata: [] }, { email: user.email, user_metadata: null }]) {
    await assert.rejects(auth.admin.generateInviteLink(input), matchesError("invalid_input", "admin_generate_invite_link"));
  }
  const noKey = createSupabaseAuthClient({ ...config, serviceRoleKey: undefined }, fetcher);
  await assert.rejects(noKey.admin.generateInviteLink({ email: user.email }), matchesError("not_configured", "admin_generate_invite_link"));
  assert.equal(calls, 0);
});

test("malformed or mismatched provider invite receipts are rejected without leaking their fields", async () => {
  for (const malformed of [null, [], {}, { ...receipt, id: "not-a-uuid" }, { ...receipt, email: "other@example.invalid" }, { ...receipt, email: 1 }, { ...receipt, invited_at: null }, { ...receipt, invited_at: "invalid" }, { ...receipt, verification_type: "recovery" }, { ...receipt, verification_type: "magiclink" }, { ...receipt, hashed_token: "a".repeat(55) }, { ...receipt, hashed_token: "pkce_" + hash }, { ...receipt, hashed_token: "z".repeat(56) }, { ...receipt, app_metadata: [] }]) {
    const auth = createSupabaseAuthClient(config, async () => Response.json(malformed));
    await assert.rejects(auth.admin.generateInviteLink({ email: user.email }), matchesError("rejected", "admin_generate_invite_link", 502));
  }
});

test("provider status errors and connection failures are sanitized for invite generation", async () => {
  for (const status of [401, 422, 429, 503]) {
    const auth = createSupabaseAuthClient(config, async () => Response.json({ error: "synthetic-private-provider-detail" }, { status }));
    await assert.rejects(auth.admin.generateInviteLink({ email: user.email }), error => matchesError("rejected", "admin_generate_invite_link", status)(error) && !error.message.includes("synthetic-private"));
  }
  const auth = createSupabaseAuthClient(config, async () => { throw Error("synthetic-private-provider-detail"); });
  await assert.rejects(auth.admin.generateInviteLink({ email: user.email }), matchesError("unavailable", "admin_generate_invite_link"));
});

test("invite verification exchanges only token_hash and invite type using publishable credentials", async () => {
  const calls = [];
  const auth = createSupabaseAuthClient(config, async (url, init) => { calls.push({ url: String(url), init }); return Response.json(session); });
  assert.deepEqual(await auth.verifyInviteTokenHash(hash), session);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${config.url}/auth/v1/verify`);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.apikey, config.publishableKey);
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(calls[0].init.body), { token_hash: hash, type: "invite" });
});

test("invalid verification credentials and missing public configuration never reach Auth", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json(session); };
  const auth = createSupabaseAuthClient(config, fetcher);
  for (const invalid of [null, 5, "", "a".repeat(55), "a".repeat(65), "pkce_" + hash, hash + "\n", "z".repeat(56), { token_hash: hash, type: "recovery" }]) {
    await assert.rejects(auth.verifyInviteTokenHash(invalid), matchesError("invalid_input", "verify_invite_token"));
  }
  const noPublicKey = createSupabaseAuthClient({ ...config, publishableKey: undefined }, fetcher);
  await assert.rejects(noPublicKey.verifyInviteTokenHash(hash), matchesError("not_configured", "verify_invite_token"));
  assert.equal(calls, 0);
});

test("verification rejects an expired, reused, rate limited or malformed session receipt", async () => {
  for (const status of [401, 403, 429, 503]) {
    const auth = createSupabaseAuthClient(config, async () => Response.json({ error: "private-detail" }, { status }));
    await assert.rejects(auth.verifyInviteTokenHash(hash), matchesError("rejected", "verify_invite_token", status));
  }
  for (const malformed of [{ ...session, refresh_token: undefined }, { ...session, user: { id: "bad" } }, { ...session, expires_in: 0 }]) {
    const auth = createSupabaseAuthClient(config, async () => Response.json(malformed));
    await assert.rejects(auth.verifyInviteTokenHash(hash), matchesError("rejected", "verify_invite_token", 502));
  }
});
