import assert from "node:assert/strict";
import test from "node:test";
import { isSupabaseAccessTokenNearExpiry, replaceSupabaseSessionCookies } from "../lib/supabase/session-utils.ts";

function token(exp) {
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `header.${payload}.signature`;
}

test("refresh decision treats malformed tokens as expired and refreshes shortly before expiry", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  assert.equal(isSupabaseAccessTokenNearExpiry("not-a-jwt", now), true);
  assert.equal(isSupabaseAccessTokenNearExpiry(token(Math.floor(now / 1000) - 60), now), true);
  assert.equal(isSupabaseAccessTokenNearExpiry(token(Math.floor(now / 1000) + 60), now), true);
  assert.equal(isSupabaseAccessTokenNearExpiry(token(Math.floor(now / 1000) + 600), now), false);
});

test("request cookie replacement preserves unrelated cookies and replaces each auth value once", () => {
  assert.equal(
    replaceSupabaseSessionCookies("theme=dark; __Host-school-access=old; session=x", ["__Host-school-access=new; Path=/", "__Host-school-refresh=refresh; Path=/"]),
    "theme=dark; session=x; __Host-school-access=new; __Host-school-refresh=refresh",
  );
});
