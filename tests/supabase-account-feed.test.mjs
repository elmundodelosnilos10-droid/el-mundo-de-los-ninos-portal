import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createSupabaseDatabaseClient } from "../lib/supabase/database.ts";
import { readSchoolAccounts } from "../lib/supabase/account-feed.ts";

test("account page uses the verified user's JWT, shared filters, stable offset and exact RPC total", async () => {
  const client = createSupabaseDatabaseClient({ url: "https://school.example.test", publishableKey: "test-public" }, async (input, options) => {
    assert.equal(new URL(input).pathname, "/rest/v1/rpc/school_account_feed");
    assert.equal(options.headers.Authorization, "Bearer test-user-jwt");
    assert.equal(options.headers.apikey, "test-public");
    assert.deepEqual(JSON.parse(options.body), { p_query: "familia", p_role: "tutor", p_status: "activas", p_limit: 10, p_offset: 20 });
    return Response.json({ items: [{ id: "family-id", name: "Familia", email: "family@example.test", role: "tutor", active: true }], total: 23 });
  });
  const feed = await readSchoolAccounts(client, "test-user-jwt", { query: " familia ", role: "tutor", status: "activas", page: 3 });
  assert.equal(feed.items.length, 1);
  assert.equal(feed.total, 23);
  assert.equal(feed.page, 3);
});

test("empty account page retains the exact total rather than equating it with visible rows", async () => {
  const feed = await readSchoolAccounts({ rpc: async () => ({ data: [{ items: [], total: 20 }] }) }, "test-jwt", { page: 4 });
  assert.equal(feed.total, 20);
  assert.deepEqual(feed.items, []);
});

test("invalid account pagination never contacts Supabase and malformed upstream rows fail closed", async () => {
  let contacted = false;
  const client = { rpc: async () => { contacted = true; return { data: [] }; } };
  for (const options of [{ page: 0 }, { page: 100001 }, { pageSize: 0 }, { pageSize: 51 }, { page: 1.5 }]) {
    await assert.rejects(readSchoolAccounts(client, "test-jwt", options));
  }
  assert.equal(contacted, false);
  for (const data of [{ items: [], total: null }, { items: [], total: -1 }, { items: [{ id: "bad" }], total: 1 }]) {
    await assert.rejects(readSchoolAccounts({ rpc: async () => ({ data: [data] }) }, "test-jwt"));
  }
});

test("account feed SQL derives active leadership from Auth and cannot mutate users or permissions", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/20261019000000_accounts_feed.sql", import.meta.url), "utf8");
  assert.match(sql, /language plpgsql stable security definer\s+set search_path = ''/);
  assert.match(sql, /\(select auth.uid\(\)\) is null or not public.school_is_leader\(\)/);
  assert.match(sql, /pg_catalog\.lower\(p\.name\)[\s\S]+or pg_catalog\.strpos\(pg_catalog\.lower\(p\.email\)/);
  assert.match(sql, /'total', \(select pg_catalog\.count\(\*\) from filtered\)/);
  assert.match(sql, /order by name, id, role limit p_limit offset p_offset/);
  assert.match(sql, /revoke all on function[^;]+from public, anon, authenticated/);
  assert.match(sql, /grant execute on function[^;]+to authenticated/);
  assert.doesNotMatch(sql, /\b(?:insert into|update public|delete from)\b/i);
});
