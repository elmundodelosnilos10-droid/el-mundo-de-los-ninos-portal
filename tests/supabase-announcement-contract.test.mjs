import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/20261016000000_school_announcement_rpcs.sql", import.meta.url), "utf8");
const [feedRoute, readRoute, page] = await Promise.all([
  readFile(new URL("../app/api/announcements/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/announcements/[id]/read/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/comunicados/page.tsx", import.meta.url), "utf8"),
]);
const sql = migration.replace(/--.*$/gm, "");

function definition(name) {
  return sql.match(new RegExp(`create function public\\.${name}\\(([\\s\\S]*?)\\$\\$;`, "i"))?.[0] ?? "";
}

test("announcement RPC signatures match route payloads and grants are least-privilege", () => {
  assert.match(sql, /create function public\.school_announcement_feed\(p_limit integer default 200\)\s*returns jsonb/i);
  assert.match(sql, /create function public\.school_create_announcement\(\s*p_id uuid,\s*p_group_id uuid,\s*p_title text,\s*p_body text,\s*p_important boolean\s*\)\s*returns jsonb/i);
  assert.match(sql, /create function public\.school_mark_announcement_read\(p_announcement_id uuid\)\s*returns jsonb/i);
  assert.match(sql, /revoke all on function public\.school_notify_announcement_families\(uuid, uuid, boolean\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.school_announcement_feed\(integer\) to authenticated/i);
  assert.match(sql, /grant execute on function public\.school_create_announcement\(uuid, uuid, text, text, boolean\) to authenticated/i);
  assert.match(sql, /grant execute on function public\.school_mark_announcement_read\(uuid\) to authenticated/i);
});

test("the announcement feed is authenticated, group-scoped, ordered, and capped", () => {
  const feed = definition("school_announcement_feed");
  assert.match(feed, /security definer\s+set search_path = ''/i);
  assert.match(feed, /school_actor_active\(\)/i);
  assert.match(feed, /school_can_access_group\(announcement\.group_id\)/i);
  assert.match(feed, /group_row\.active = true/i);
  assert.match(feed, /p_limit < 1 or p_limit > 200/i);
  assert.match(feed, /order by announcement\.published_at desc, announcement\.id desc\s+limit p_limit/i);
  assert.match(feed, /receipt\.user_id = auth\.uid\(\)/i);
});

test("publishing derives identity, validates scope, and atomically audits and notifies active families", () => {
  const publish = definition("school_create_announcement");
  const notify = definition("school_notify_announcement_families");
  assert.match(publish, /auth\.uid\(\)/i);
  assert.match(publish, /school_actor_active\(\)/i);
  assert.match(publish, /school_has_role\(array\['superadmin', 'direccion', 'docente'\]/i);
  assert.match(publish, /school_is_leader_or_teacher\(p_group_id\)/i);
  assert.match(publish, /insert into public\.audit_log/i);
  assert.match(publish, /school_notify_announcement_families/i);
  assert.match(notify, /enrollment\.ended_at is null/i);
  assert.match(notify, /student\.active = true/i);
  assert.match(notify, /link\.active = true/i);
  assert.match(notify, /guardian\.active = true/i);
  assert.match(notify, /on conflict \(dedupe_key\) do nothing/i);
  assert.ok(notify.includes("'/comunicados'"));
});

test("read receipts can only be created for an announcement visible to the current active user", () => {
  const markRead = definition("school_mark_announcement_read");
  assert.match(markRead, /auth\.uid\(\)/i);
  assert.match(markRead, /school_actor_active\(\)/i);
  assert.match(markRead, /school_can_access_group\(announcement\.group_id\)/i);
  assert.match(markRead, /on conflict \(announcement_id, user_id\) do nothing/i);
  assert.match(markRead, /values \(p_announcement_id, v_actor/i);
});

test("the Routes and group picker use user-scoped Supabase APIs only when the provider is enabled", () => {
  assert.match(feedRoute, /SCHOOL_DATA_PROVIDER === "supabase"/);
  assert.match(feedRoute, /actor\.supabaseAuth\.accessToken/);
  assert.match(feedRoute, /school_announcement_feed/);
  assert.match(feedRoute, /school_create_announcement/);
  assert.match(feedRoute, /isSameOriginAuthRequest\(request\)/);
  assert.match(readRoute, /SCHOOL_DATA_PROVIDER === "supabase"/);
  assert.match(readRoute, /school_mark_announcement_read/);
  assert.match(readRoute, /isSameOriginAuthRequest\(request\)/);
  assert.match(page, /SCHOOL_DATA_PROVIDER === "supabase"/);
  assert.match(page, /createSchoolDatabaseClient\(env\)\.select/);
  assert.match(page, /"groups"/);
});
