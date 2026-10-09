import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createSupabaseDatabaseClient } from "../lib/supabase/database.ts";
import { readSupabaseCommunicationSettings, writeSupabaseCommunicationSettings, SchoolCommunicationSettingsError } from "../lib/supabase/communication-settings.ts";
import { DEFAULT_COMMUNICATION_HOURS } from "../lib/communication-hours-policy.ts";

const actor = { id: "auth-leader", name: "Dirección", email: "school@example.invalid", roles: ["direccion"], supabaseAuth: { userId: "auth-leader", accessToken: "synthetic-leader-jwt" } };
const config = { url: "https://school-project.supabase.co", publishableKey: "sb_publishable_test-key" };
const row = { id: "school", enabled: true, weekdays: "1,3,5", start_time: "08:30", end_time: "16:45", updated_at: "2026-10-08T19:00:00Z" };
const clientWith = fetcher => createSupabaseDatabaseClient(config, fetcher);

test("settings reads use the verified user's JWT and only the school row", async () => {
  let request;
  const result = await readSupabaseCommunicationSettings(clientWith(async (input, init) => {
    request = { url: new URL(input), init };
    return Response.json([row]);
  }), actor);
  assert.equal(request.url.pathname, "/rest/v1/communication_settings");
  assert.equal(request.url.searchParams.get("id"), "eq.school");
  assert.equal(request.init.headers.Authorization, "Bearer synthetic-leader-jwt");
  assert.equal(request.init.headers.apikey, config.publishableKey);
  assert.deepEqual(result, { settings: { enabled: true, weekdays: [1, 3, 5], startTime: "08:30", endTime: "16:45" }, configured: true, updatedAt: row.updated_at });
});

test("a successful empty read reports the existing unrestricted policy without writing a row", async () => {
  let calls = 0;
  const result = await readSupabaseCommunicationSettings(clientWith(async (input, init) => {
    calls++;
    assert.equal(init.method, "GET");
    return Response.json([]);
  }), actor);
  assert.deepEqual(result, { settings: DEFAULT_COMMUNICATION_HOURS, configured: false, updatedAt: null });
  assert.equal(calls, 1);
  assert.notEqual(result.settings.weekdays, DEFAULT_COMMUNICATION_HOURS.weekdays);
});

test("provider failures never fall back to unrestricted hours", async () => {
  await assert.rejects(readSupabaseCommunicationSettings(clientWith(async () => new Response("private cause", { status: 503 })), actor));
  await assert.rejects(readSupabaseCommunicationSettings(clientWith(async () => { throw Error("private cause"); }), actor));
});

test("missing or mismatched Auth identities are rejected before a request", async () => {
  let calls = 0;
  const client = clientWith(async () => { calls++; return Response.json([]); });
  await assert.rejects(readSupabaseCommunicationSettings(client), SchoolCommunicationSettingsError);
  await assert.rejects(readSupabaseCommunicationSettings(client, { ...actor, supabaseAuth: { ...actor.supabaseAuth, userId: "other-auth-id" } }), SchoolCommunicationSettingsError);
  assert.equal(calls, 0);
});

test("invalid persisted schedule data is rejected instead of silently relaxing restrictions", async () => {
  for (const invalid of [
    { ...row, weekdays: "1,1" }, { ...row, weekdays: "1,9" }, { ...row, weekdays: "" },
    { ...row, end_time: "08:00" }, { ...row, start_time: "24:00" },
    { ...row, updated_at: "not-a-date" }, { ...row, id: "other-school" },
  ]) {
    await assert.rejects(readSupabaseCommunicationSettings(clientWith(async () => Response.json([invalid])), actor), SchoolCommunicationSettingsError);
  }
});

test("writes call the atomic RPC without supplying a caller-controlled actor or audit timestamp", async () => {
  let request;
  const settings = { enabled: true, weekdays: [1, 3, 5], startTime: "08:30", endTime: "16:45" };
  const result = await writeSupabaseCommunicationSettings(clientWith(async (input, init) => {
    request = { url: String(input), init };
    return Response.json(row);
  }), actor, settings);
  assert.equal(request.url, `${config.url}/rest/v1/rpc/school_update_communication_settings`);
  assert.equal(request.init.headers.Authorization, "Bearer synthetic-leader-jwt");
  assert.deepEqual(JSON.parse(request.init.body), { p_enabled: true, p_weekdays: [1, 3, 5], p_start_time: "08:30", p_end_time: "16:45" });
  assert.deepEqual(result.settings, settings);
  assert.equal(result.updatedAt, row.updated_at);
});

test("a write response without persisted metadata is not reported as saved", async () => {
  await assert.rejects(writeSupabaseCommunicationSettings(clientWith(async () => Response.json({ ...row, updated_at: null })), actor,
    { enabled: true, weekdays: [1], startTime: "08:30", endTime: "16:45" }), SchoolCommunicationSettingsError);
});

test("migration restricts writes to the audited leadership RPC", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261018000000_school_communication_settings_rpc.sql", import.meta.url), "utf8");
  assert.match(sql, /school_actor_active\(\).*school_is_leader\(\)/);
  assert.match(sql, /updated_by = excluded.updated_by/);
  assert.match(sql, /insert into public\.audit_log/);
  assert.match(sql, /'update_communication_hours', 'school_settings', 'school'/);
  assert.match(sql, /revoke insert, update, delete on table public\.communication_settings from authenticated/);
  assert.match(sql, /grant execute on function public\.school_update_communication_settings\(boolean, integer\[\], text, text\) to authenticated/);
});

test("database trigger enforces hours for JWT participants and protects RPC calls", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261018000000_school_communication_settings_rpc.sql", import.meta.url), "utf8");
  assert.match(sql, /create trigger school_message_communication_hours\s+before insert on public\.messages/);
  assert.match(sql, /if auth\.uid\(\) is not null then/);
  assert.match(sql, /school_communication_hours_open\(clock_timestamp\(\)\)/);
  assert.match(sql, /at time zone 'America\/Mexico_City'/);
  assert.match(sql, /local_instant::time >= settings\.start_time::time/);
  assert.match(sql, /local_instant::time < settings\.end_time::time/);
  assert.match(sql, /revoke all on function public\.school_communication_hours_open\(timestamptz\) from public, anon, authenticated/);
});
