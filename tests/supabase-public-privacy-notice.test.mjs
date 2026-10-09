import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { readPublicPrivacyNotice } from "../lib/supabase/public-privacy-notice.ts";
const environment = { SUPABASE_URL: "https://school-project.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic" };
test("public notice reads only the dedicated endpoint without service credentials or user tokens", async () => {
  let seen;
  assert.equal(await readPublicPrivacyNotice(environment, async (input, init) => { seen = { url: String(input), init }; return Response.json({ notice: null }); }), null);
  assert.ok(seen.url.endsWith("/rpc/school_public_privacy_notice"));
  assert.equal(seen.init.headers.apikey, environment.SUPABASE_PUBLISHABLE_KEY);
  assert.equal(seen.init.headers.Authorization, undefined);
  assert.equal(seen.init.cache, "no-store");
});
test("public notice distinguishes an upstream error from absence of an approved notice", async () => {
  await assert.rejects(readPublicPrivacyNotice(environment, async () => new Response("private-cause", { status: 503 })), /Public privacy notice unavailable/);
  await assert.rejects(readPublicPrivacyNotice(environment, async () => Response.json({})), /Public privacy notice unavailable/);
  await assert.rejects(readPublicPrivacyNotice({ ...environment, SUPABASE_URL: "https://school-project.supabase.co/bad" }, async () => { throw new Error("must not call"); }));
});
test("public notice SQL exposes published legal fields and keeps school tables private", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261021000000_public_privacy_notice.sql", import.meta.url), "utf8");
  assert.match(sql, /approved_at <= pg_catalog.now\(\)/);
  assert.match(sql, /published_at <= pg_catalog.now\(\)/);
  assert.match(sql, /security definer set search_path = ''/);
  assert.doesNotMatch(sql, /grant select|approved_by|public\.students|public\.profiles/);
});
