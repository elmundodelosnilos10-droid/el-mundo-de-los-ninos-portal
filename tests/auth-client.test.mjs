import assert from "node:assert/strict";
import test from "node:test";
import { authClient } from "../lib/auth-client.ts";

test("school auth client uses same-origin requests and sends the sign-in form", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return Response.json({ user: { email: "staff@example.test" } });
  };
  try {
    const result = await authClient.signIn.email({ email: "staff@example.test", password: "synthetic-password" });
    assert.equal(result.error, null);
    assert.equal(captured.url, "/api/auth/sign-in/email");
    assert.equal(captured.init.credentials, "same-origin");
    assert.deepEqual(JSON.parse(captured.init.body), { email: "staff@example.test", password: "synthetic-password" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("school auth client maps recovery, reset, change, and sign-out to allowlisted routes", async () => {
  const originalFetch = globalThis.fetch;
  const captured = [];
  globalThis.fetch = async (url, init) => {
    captured.push({ url, init });
    return Response.json({ success: true });
  };
  try {
    await authClient.requestPasswordReset({ email: "staff@example.test", redirectTo: "https://school.example/restablecer" });
    await authClient.resetPassword({ newPassword: "a-secure-synthetic-password", token: "synthetic-recovery-token" });
    await authClient.changePassword({ currentPassword: "a-secure-synthetic-password", newPassword: "another-synthetic-password" });
    await authClient.signOut();
    assert.deepEqual(captured.map(call => call.url), [
      "/api/auth/request-password-reset",
      "/api/auth/reset-password",
      "/api/auth/change-password",
      "/api/auth/sign-out",
    ]);
    assert.equal(captured[3].init.body, undefined);
    assert.equal(captured.every(call => call.init.credentials === "same-origin" && call.init.cache === "no-store"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("school auth client returns sanitized request errors to the form", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ message: "Revisa los datos." }, { status: 400 });
  try {
    const result = await authClient.signIn.email({ email: "bad@example.test", password: "bad" });
    assert.equal(result.data, null);
    assert.deepEqual(result.error, { message: "Revisa los datos." });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
