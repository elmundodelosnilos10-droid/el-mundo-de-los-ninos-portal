import assert from "node:assert/strict";
import test from "node:test";
import { serializeSessionCookies } from "../lib/supabase/auth.ts";
import { createSchoolLoginPayload, isPasswordRecoveryRateLimit, isSameOriginAuthRequest } from "../lib/supabase/auth-route-utils.ts";

const session = {
  access_token: "synthetic-access-token",
  refresh_token: "synthetic-refresh-token",
  expires_in: 3600,
  token_type: "bearer",
  user: { id: "65e4785a-94f4-4f67-98a7-8d8aee1e42f1", email: "staff@example.test" },
};

test("Supabase auth POST requires a matching browser origin", () => {
  assert.equal(isSameOriginAuthRequest(new Request("https://school.example/api/auth/sign-out", { method: "POST" })), false);
  assert.equal(isSameOriginAuthRequest(new Request("https://school.example/api/auth/sign-out", { method: "POST", headers: { origin: "https://school.example" } })), true);
  assert.equal(isSameOriginAuthRequest(new Request("https://school.example/api/auth/sign-out", { method: "POST", headers: { origin: "https://evil.example" } })), false);
  assert.equal(isSameOriginAuthRequest(new Request("https://school.example/api/auth/sign-out", { method: "POST", headers: { origin: "null" } })), false);
});

test("school account mutations reject missing and cross-site browser origins", () => {
  assert.equal(isSameOriginAuthRequest(new Request("https://school.example/api/users", { method: "POST" })), false);
  assert.equal(isSameOriginAuthRequest(new Request("https://school.example/api/users", { method: "POST", headers: { origin: "https://attacker.example" } })), false);
  assert.equal(isSameOriginAuthRequest(new Request("https://school.example/api/users/abc", { method: "PATCH", headers: { origin: "https://school.example" } })), true);
});

test("password recovery rate limits get a temporary retry response", () => {
  assert.equal(isPasswordRecoveryRateLimit("password_recovery", 429), true);
  assert.equal(isPasswordRecoveryRateLimit("password_recovery", 400), false);
  assert.equal(isPasswordRecoveryRateLimit("sign_in", 429), false);
});

test("school sign-in payload keeps Supabase bearer tokens out of JSON", () => {
  const payload = createSchoolLoginPayload({ id: "school-user-1", name: "Equipo escolar", email: "staff@example.test" });
  const serializedBody = JSON.stringify(payload);
  assert.deepEqual(payload.user, { id: "school-user-1", name: "Equipo escolar", email: "staff@example.test" });
  assert.equal(serializedBody.includes(session.access_token), false);
  assert.equal(serializedBody.includes(session.refresh_token), false);
  const cookies = serializeSessionCookies(session);
  assert.equal(cookies.length, 2);
  assert.ok(cookies.every(cookie => cookie.includes("HttpOnly") && cookie.includes("Secure") && cookie.includes("SameSite=Lax")));
});
