import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/20261015000000_school_calendar_class_rpcs.sql", import.meta.url), "utf8");
const rls = await readFile(new URL("../supabase/migrations/20261008000002_school_rls_policies.sql", import.meta.url), "utf8");
const routes = await Promise.all([
  readFile(new URL("../app/api/calendar/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/calendar/[id]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/classes/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/notifications/route.ts", import.meta.url), "utf8"),
]);
const sql = migration.replace(/--.*$/gm, "");

function functionDefinition(name) {
  return sql.match(new RegExp(`create function public\\.${name}\\(([\\s\\S]*?)\\$\\$;`, "i"))?.[0] ?? "";
}

test("calendar and class RPCs expose stable route signatures and restrict direct writes", () => {
  assert.match(sql, /create function public\.school_calendar_feed\(\s*p_from timestamptz,\s*p_to_exclusive timestamptz,\s*p_limit integer default 500\s*\)\s*returns jsonb/i);
  assert.match(sql, /create function public\.school_create_calendar_event\(\s*p_id uuid,\s*p_group_id uuid,\s*p_kind text,\s*p_title text,\s*p_description text,\s*p_starts_at timestamptz,\s*p_ends_at timestamptz\s*\)\s*returns jsonb/i);
  assert.match(sql, /create function public\.school_update_calendar_event\(\s*p_id uuid,\s*p_kind text,\s*p_title text,\s*p_description text,\s*p_starts_at timestamptz,\s*p_ends_at timestamptz\s*\)\s*returns jsonb/i);
  assert.match(sql, /create function public\.school_delete_calendar_event\(p_id uuid\)\s*returns jsonb/i);
  assert.match(sql, /create function public\.school_list_class_options\(\)\s*returns jsonb/i);
  assert.match(sql, /create function public\.school_list_class_sessions\(p_limit integer default 100\)\s*returns jsonb/i);
  assert.match(sql, /create function public\.school_create_class_session\(\s*p_id uuid,\s*p_event_id uuid,\s*p_group_id uuid,\s*p_teacher_id uuid,\s*p_title text,\s*p_starts_at timestamptz,\s*p_ends_at timestamptz,\s*p_meet_url text\s*\)\s*returns jsonb/i);
  assert.match(sql, /revoke insert, update, delete on table public\.calendar_events from authenticated/i);
  assert.match(sql, /revoke insert, update, delete on table public\.class_sessions from authenticated/i);
});

test("calendar reads include only accessible active groups and tasks, with a bounded window", () => {
  const feed = functionDefinition("school_calendar_feed");
  assert.match(feed, /school_actor_active\(\)/i);
  assert.match(feed, /school_is_leader\(\)/i);
  assert.match(feed, /school_can_access_group\(event\.group_id\)/i);
  assert.match(feed, /school_can_access_group\(task\.group_id\)/i);
  assert.match(feed, /group_row\.active = true/i);
  assert.match(feed, /p_to_exclusive > p_from/i);
  assert.match(feed, /p_to_exclusive > p_from \+ interval '95 days'/i);
  assert.match(feed, /limit p_limit/i);
  assert.match(feed, /'source', 'tarea'/i);
});

test("event and class mutations validate role and relationships, then audit and notify atomically", () => {
  for (const name of ["school_create_calendar_event", "school_update_calendar_event", "school_delete_calendar_event", "school_create_class_session"]) {
    const definition = functionDefinition(name);
    assert.match(definition, /security definer\s+set search_path = ''/i, `${name} uses a fixed definer path`);
    assert.match(definition, /auth\.uid\(\)/i, `${name} derives the actor from the authenticated JWT`);
    assert.match(definition, /school_actor_active\(\)/i, `${name} rejects inactive actors`);
    assert.match(definition, /insert into public\.audit_log/i, `${name} writes its audit row in the same RPC`);
    assert.match(definition, /school_notify_calendar_families/i, `${name} creates notices in the same RPC`);
  }
  const createClass = functionDefinition("school_create_class_session");
  assert.match(createClass, /meet\[\.\]google\[\.\]com/i);
  assert.match(createClass, /teacher_groups/i);
  assert.match(createClass, /recording_allowed, recording_file_id\)\s*values[\s\S]*?false, null/i);
  assert.match(sql, /grant execute on function public\.school_create_class_session[\s\S]*?to authenticated/i);
  assert.match(sql, /revoke all on function public\.school_notify_calendar_families[\s\S]*?from public, anon, authenticated/i);
});

test("notifications remain private to the current user and updates cannot change other fields", () => {
  assert.match(rls, /create policy notifications_read_own on public\.notifications for select to authenticated\s+using \(user_id = \(select auth\.uid\(\)\) and public\.school_actor_active\(\)\)/i);
  assert.match(rls, /create policy notifications_update_own_read_at on public\.notifications for update to authenticated\s+using \(user_id = \(select auth\.uid\(\)\)[\s\S]*?with check \(user_id = \(select auth\.uid\(\)\)/i);
  assert.match(rls, /grant update \(read_at\) on table public\.notifications to authenticated/i);
  assert.match(routes[3], /value: actor\.supabaseAuth\.userId/i);
  assert.match(routes[3], /read_at: new Date\(\)\.toISOString\(\)/i);
});

test("calendar, classes and notifications route through Supabase RPCs only when the provider is enabled", () => {
  assert.match(routes[0], /SCHOOL_DATA_PROVIDER === "supabase"/);
  assert.match(routes[0], /school_calendar_feed/);
  assert.match(routes[0], /school_create_calendar_event/);
  assert.match(routes[1], /school_update_calendar_event/);
  assert.match(routes[1], /school_delete_calendar_event/);
  assert.match(routes[2], /school_list_class_sessions/);
  assert.match(routes[2], /school_create_class_session/);
  assert.match(routes[3], /SCHOOL_DATA_PROVIDER === "supabase"/);
  assert.match(routes[3], /actor\.supabaseAuth\.accessToken/);
});
