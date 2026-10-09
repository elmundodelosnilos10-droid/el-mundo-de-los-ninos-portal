import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSchoolAuthLink, prepareSchoolAuthLink } from "../lib/supabase/auth-link.ts";

test("recognizes Supabase invitation links for private password setup", () => {
  assert.deepEqual(parseSchoolAuthLink("", "#access_token=invite-access-token&type=invite"), {
    token: "invite-access-token",
    kind: "invite",
  });
});

test("recovery fragment takes precedence over an unrelated legacy query token and rejects ambiguous callbacks", () => {
  assert.deepEqual(parseSchoolAuthLink("?token=legacy-token", "#access_token=recovery-access-token&type=recovery"), { token: "recovery-access-token", kind: "recovery" });
  for (const [search, hash] of [
    ["?token=a&token=b", ""],
    ["", "#access_token=a&access_token=b&type=recovery"],
    ["", "#access_token=a&type=invite&type=recovery"],
    ["", "#access_token=a&type=recovery&error=access_denied"],
    ["?error_code=otp_expired", "#access_token=a&type=recovery"],
  ]) assert.equal(parseSchoolAuthLink(search, hash), null);
});

test("callback preparation removes tokens and errors from successful and expired URLs", () => {
  const success = prepareSchoolAuthLink("https://portal.example.test/restablecer?source=email&token=legacy#access_token=recovery-access-token&refresh_token=secret-refresh&type=recovery&expires_at=2000000000");
  assert.deepEqual(success.link, { token: "recovery-access-token", kind: "recovery" });
  assert.equal(success.cleanPath, "/restablecer?source=email");
  assert.equal(success.issue, null);
  const expired = prepareSchoolAuthLink("https://portal.example.test/restablecer?source=email#access_token=expired-token&error=access_denied&error_code=otp_expired&error_description=Private%20description");
  assert.equal(expired.link, null);
  assert.equal(expired.issue, "expired");
  assert.equal(expired.cleanPath, "/restablecer?source=email");
  const unsupported = prepareSchoolAuthLink("https://portal.example.test/restablecer?code=pkce-code&token_hash=private-hash&type=recovery");
  assert.equal(unsupported.link, null);
  assert.equal(unsupported.issue, "invalid");
  assert.equal(unsupported.cleanPath, "/restablecer");
});

test("recognizes Supabase password recovery and Better Auth reset links", () => {
  assert.deepEqual(parseSchoolAuthLink("", "#access_token=recovery-access-token&type=recovery"), {
    token: "recovery-access-token",
    kind: "recovery",
  });
  assert.deepEqual(parseSchoolAuthLink("?token=reset-token&source=email", ""), {
    token: "reset-token",
    kind: "password-reset",
  });
});

test("rejects malformed, unsupported, or oversized access links", () => {
  assert.equal(parseSchoolAuthLink("", "#access_token=token&type=signup"), null);
  assert.equal(parseSchoolAuthLink("", "#access_token=bad%20token&type=invite"), null);
  assert.equal(parseSchoolAuthLink(`?token=${"x".repeat(16_385)}`, ""), null);
  assert.equal(parseSchoolAuthLink("", "#type=invite"), null);
});
