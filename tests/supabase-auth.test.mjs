import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearSessionCookies,
  createSchoolAuthClient,
  createSupabaseAuthClient,
  readSupabaseAuthCookies,
  serializeAuthCookie,
  serializeSessionCookies,
  SupabaseAuthError,
} from "../lib/supabase/auth.ts";

const config = {
  url: "https://school-project.supabase.co",
  publishableKey: "sb_publishable_synthetic-public-key",
  serviceRoleKey: "server-only-synthetic-service-role-key",
  appOrigin: "https://school.example",
};
const user = { id: "65e4785a-94f4-4f67-98a7-8d8aee1e42f1", email: "family@example.com" };
const session = {
  access_token: "synthetic-access.token",
  refresh_token: "synthetic-refresh-token",
  expires_in: 3600,
  token_type: "bearer",
  user,
};

function client(fetcher, settings = config) {
  return createSupabaseAuthClient(settings, fetcher);
}

function assertPublicHeaders(init) {
  assert.equal(init.headers.apikey, config.publishableKey);
  assert.equal(init.headers.Authorization, undefined);
  assert.notEqual(init.headers.apikey, config.serviceRoleKey);
}

function assertUserHeaders(init, token = session.access_token) {
  assert.equal(init.headers.apikey, config.publishableKey);
  assert.equal(init.headers.Authorization, `Bearer ${token}`);
}

function assertAdminHeaders(init) {
  assert.equal(init.headers.apikey, config.serviceRoleKey);
  assert.equal(init.headers.Authorization, `Bearer ${config.serviceRoleKey}`);
}

test("server environment factory uses publishable key for public Auth and fails closed without it", async () => {
  let captured;
  const fetcher = async (_url, init) => { captured = init; return Response.json(session); };
  const auth = createSchoolAuthClient({
    SUPABASE_URL: config.url,
    SUPABASE_PUBLISHABLE_KEY: config.publishableKey,
    SUPABASE_SECRET_KEY: config.serviceRoleKey,
  }, fetcher);
  await auth.signIn("family@example.com", "long-password");
  assertPublicHeaders(captured);

  const noPublicKey = createSchoolAuthClient({ SUPABASE_URL: config.url }, fetcher);
  await assert.rejects(noPublicKey.signIn("family@example.com", "long-password"), error => error instanceof SupabaseAuthError && error.code === "not_configured");
});

test("password recovery can validate its redirect against the current same-origin request", async () => {
  let captured;
  const auth = createSchoolAuthClient({
    SUPABASE_URL: config.url,
    SUPABASE_PUBLISHABLE_KEY: config.publishableKey,
  }, async (url, init) => {
    captured = { url: String(url), init };
    return new Response(null, { status: 200 });
  }, "https://school.example");

  await auth.requestPasswordRecovery("family@example.com", "https://school.example/restablecer");
  assert.equal(captured.url, `${config.url}/auth/v1/recover?redirect_to=https%3A%2F%2Fschool.example%2Frestablecer`);
  assert.deepEqual(JSON.parse(captured.init.body), { email: "family@example.com" });
});

test("sign-in uses the password grant and returns validated session data", async () => {
  let captured;
  const auth = client(async (url, init) => {
    captured = { url: String(url), init };
    return Response.json(session);
  });
  const result = await auth.signIn(" family@example.com ", "long-password");
  assert.equal(captured.url, `${config.url}/auth/v1/token?grant_type=password`);
  assert.equal(captured.init.method, "POST");
  assertPublicHeaders(captured.init);
  assert.deepEqual(JSON.parse(captured.init.body), { email: "family@example.com", password: "long-password" });
  assert.deepEqual(result.user, user);
  assert.equal(result.access_token, session.access_token);
  assert.equal(JSON.stringify(result).includes(config.serviceRoleKey), false);
});

test("refresh rotates tokens through the refresh-token grant", async () => {
  let captured;
  const auth = client(async (url, init) => {
    captured = { url: String(url), init };
    return Response.json(session);
  });
  const result = await auth.refresh("old-refresh-token");
  assert.equal(captured.url, `${config.url}/auth/v1/token?grant_type=refresh_token`);
  assertPublicHeaders(captured.init);
  assert.deepEqual(JSON.parse(captured.init.body), { refresh_token: "old-refresh-token" });
  assert.equal(result.refresh_token, session.refresh_token);
});

test("verify current user and change password send the access token as bearer", async () => {
  const calls = [];
  const auth = client(async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(user);
  });
  assert.deepEqual(await auth.verifyCurrentUser(session.access_token), user);
  assert.equal(calls[0].url, `${config.url}/auth/v1/user`);
  assert.equal(calls[0].init.method, "GET");
  assertUserHeaders(calls[0].init);

  assert.deepEqual(await auth.changePassword(session.access_token, "another-long-password"), user);
  assert.equal(calls[1].init.method, "PUT");
  assert.deepEqual(JSON.parse(calls[1].init.body), { password: "another-long-password" });
  assertUserHeaders(calls[1].init);
});

test("sign-out revokes only the current local session", async () => {
  let captured;
  const auth = client(async (url, init) => {
    captured = { url: String(url), init };
    return new Response(null, { status: 204 });
  });
  assert.equal(await auth.signOut(session.access_token), undefined);
  assert.equal(captured.url, `${config.url}/auth/v1/logout?scope=local`);
  assert.equal(captured.init.method, "POST");
  assertUserHeaders(captured.init);
});

test("password recovery constrains redirect to configured school origin", async () => {
  let captured;
  const auth = client(async (url, init) => {
    captured = { url: String(url), init };
    return new Response(null, { status: 200 });
  });
  await auth.requestPasswordRecovery("family@example.com", "https://school.example/restablecer-contrasena");
  assert.equal(captured.url, `${config.url}/auth/v1/recover?redirect_to=https%3A%2F%2Fschool.example%2Frestablecer-contrasena`);
  assert.deepEqual(JSON.parse(captured.init.body), { email: "family@example.com" });
  assertPublicHeaders(captured.init);
  await assert.rejects(auth.requestPasswordRecovery("family@example.com", "https://evil.example/reset"), error => error instanceof SupabaseAuthError && error.code === "invalid_input");
  await assert.rejects(auth.requestPasswordRecovery("bad-email"), error => error instanceof SupabaseAuthError && error.code === "invalid_input");
});

test("admin create, update, and disable use server-only service credentials", async () => {
  const calls = [];
  const auth = client(async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ user });
  });
  assert.deepEqual(await auth.admin.createUser({ email: "family@example.com", password: "long-password", email_confirm: true, user_metadata: { role: "family" } }), user);
  assert.equal(calls[0].url, `${config.url}/auth/v1/admin/users`);
  assert.equal(calls[0].init.method, "POST");
  assertAdminHeaders(calls[0].init);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    email: "family@example.com",
    password: "long-password",
    email_confirm: true,
    user_metadata: { role: "family" },
  });

  await auth.admin.updateUser(user.id, { user_metadata: { display_name: "Family" } });
  assert.equal(calls[1].url, `${config.url}/auth/v1/admin/users/${user.id}`);
  assert.equal(calls[1].init.method, "PUT");
  assertAdminHeaders(calls[1].init);

  await auth.admin.disableUser(user.id);
  assert.deepEqual(JSON.parse(calls[2].init.body), { ban_duration: "876000h" });
  assertAdminHeaders(calls[2].init);
  assert.equal(JSON.stringify(calls.map(call => call.init.headers)).includes(config.serviceRoleKey), true);
});

test("admin invitation constrains its redirect and deletes invited users safely", async () => {
  const calls = [];
  const auth = client(async (url, init) => {
    calls.push({ url: String(url), init });
    return init.method === "DELETE" ? new Response(null, { status: 204 }) : Response.json({ user });
  });
  assert.deepEqual(await auth.admin.inviteUserByEmail({ email: " Family@Example.com ", redirectTo: "https://school.example/restablecer", user_metadata: { name: "Family" } }), user);
  assert.equal(calls[0].url, `${config.url}/auth/v1/invite?redirect_to=https%3A%2F%2Fschool.example%2Frestablecer`);
  assert.deepEqual(JSON.parse(calls[0].init.body), { email: "family@example.com", data: { name: "Family" } });
  assertAdminHeaders(calls[0].init);
  await auth.admin.deleteUser(user.id);
  assert.equal(calls[1].url, `${config.url}/auth/v1/admin/users/${user.id}`);
  assert.equal(calls[1].init.method, "DELETE");
  assertAdminHeaders(calls[1].init);
  await assert.rejects(auth.admin.inviteUserByEmail({ email: "family@example.com", redirectTo: "https://evil.example/reset" }), error => error instanceof SupabaseAuthError && error.code === "invalid_input");
  await assert.rejects(auth.admin.deleteUser("../bad"), error => error instanceof SupabaseAuthError && error.code === "invalid_input");
});

test("new Supabase secret keys use apikey without legacy bearer headers", async () => {
  const secret = "sb_secret_synthetic-secret-key";
  const auth = client(async (_url, init) => {
    assert.equal(init.headers.apikey, secret);
    assert.equal(init.headers.Authorization, undefined);
    return Response.json({ user });
  }, { ...config, serviceRoleKey: secret });
  await auth.admin.inviteUserByEmail({ email: user.email, redirectTo: "https://school.example/restablecer" });
  await auth.admin.createUser({ email: user.email, password: "long-password" });
  await auth.admin.updateUser(user.id, { user_metadata: { name: "Family" } });
  await auth.admin.disableUser(user.id);
  await auth.admin.deleteUser(user.id);
});

test("invalid user ids, admin fields, and absent service key never call the network", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json({ user }); };
  const auth = client(fetcher);
  await assert.rejects(auth.admin.updateUser("../../users", { email: "family@example.com" }), error => error instanceof SupabaseAuthError && error.code === "invalid_input");
  await assert.rejects(auth.admin.updateUser(user.id, { admin: true }), error => error instanceof SupabaseAuthError && error.code === "invalid_input");
  const noAdminSecret = client(fetcher, { url: config.url, publishableKey: config.publishableKey });
  await assert.rejects(noAdminSecret.admin.disableUser(user.id), error => error instanceof SupabaseAuthError && error.code === "not_configured");
  await assert.rejects(auth.changePassword("bad token", "new-password"), error => error instanceof SupabaseAuthError && error.code === "invalid_input");
  assert.equal(calls, 0);
});

test("upstream errors and network failures are sanitized and never include credentials", async () => {
  const rejected = client(async () => Response.json({ message: config.serviceRoleKey }, { status: 401 }));
  await assert.rejects(rejected.signIn("family@example.com", "long-password"), error => {
    assert.ok(error instanceof SupabaseAuthError);
    assert.equal(error.status, 401);
    assert.equal(error.message.includes(config.serviceRoleKey), false);
    return true;
  });
  const unavailable = client(async () => { throw new Error(config.serviceRoleKey); });
  await assert.rejects(unavailable.refresh("some-refresh-token"), error => {
    assert.ok(error instanceof SupabaseAuthError);
    assert.equal(error.code, "unavailable");
    assert.equal(error.message.includes(config.serviceRoleKey), false);
    return true;
  });
});

test("auth cookie helpers enforce secure attributes, sane names, and bounded expiry", () => {
  const cookie = serializeAuthCookie("__Host-test", "token.with+symbols", { maxAgeSeconds: 60, expires: new Date("2026-10-07T00:01:00.000Z") });
  assert.equal(cookie, "__Host-test=token.with%2Bsymbols; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=60; Expires=Wed, 07 Oct 2026 00:01:00 GMT");
  const [accessCookie, refreshCookie] = serializeSessionCookies(session, Date.parse("2026-10-07T00:00:00.000Z"));
  assert.match(accessCookie, /^__Host-school-access=.*; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600; Expires=/);
  assert.match(refreshCookie, /^__Host-school-refresh=.*; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=34560000$/);
  const cleared = clearSessionCookies(Date.parse("2026-10-07T00:00:00.000Z"));
  assert.ok(cleared.every(value => value.includes("Max-Age=0") && value.includes("Expires=Thu, 01 Jan 1970 00:00:00 GMT")));
  assert.throws(() => serializeAuthCookie("bad name", "value"), TypeError);
  assert.throws(() => serializeAuthCookie("auth", "bad\r\nvalue"), TypeError);
  assert.throws(() => serializeAuthCookie("auth", "value", { maxAgeSeconds: 400 * 24 * 60 * 60 + 1 }), TypeError);
  assert.throws(() => serializeAuthCookie("auth", "value", { expires: new Date("invalid") }), TypeError);
  assert.throws(() => serializeSessionCookies({ ...session, expires_in: Number.NaN }), SupabaseAuthError);
});

test("Supabase cookie reader requires unique, bounded, well-formed tokens", () => {
  const cookie = "__Host-school-access=access.token; __Host-school-refresh=refresh-token";
  assert.deepEqual(readSupabaseAuthCookies(cookie), { accessToken: "access.token", refreshToken: "refresh-token" });
  assert.equal(readSupabaseAuthCookies(`${cookie}; __Host-school-access=other`), null);
  assert.equal(readSupabaseAuthCookies("__Host-school-access=access.token"), null);
  assert.equal(readSupabaseAuthCookies("__Host-school-access=%E0%A4%A; __Host-school-refresh=refresh-token"), null);
  assert.equal(readSupabaseAuthCookies(`x=${"a".repeat(33_000)}`), null);
});
