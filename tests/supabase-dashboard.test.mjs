import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createSupabaseDatabaseClient } from "../lib/supabase/database.ts";
import { readSchoolDashboard } from "../lib/supabase/dashboard.ts";

const config = { url: "https://school-project.supabase.co", publishableKey: "sb_publishable_synthetic" };
const payload = { mode: "tutor", counts: { linkedChildren: 0, pendingTasks: 0 }, events: [], announcements: [], children: [], tasks: [], classes: [], timeZone: "America/Mexico_City" };
test("dashboard reads a single user-scoped snapshot and preserves real zero counts", async () => {
  let seen;
  const client = createSupabaseDatabaseClient(config, async (input, init) => { seen = { input: String(input), init }; return Response.json(payload); });
  assert.deepEqual(await readSchoolDashboard(client, "synthetic-family-token"), payload);
  assert.equal(seen.init.headers.Authorization, "Bearer synthetic-family-token");
  assert.ok(seen.input.endsWith("/rest/v1/rpc/school_dashboard"));
  assert.deepEqual(JSON.parse(seen.init.body), { p_version: 1 });
});
test("dashboard errors remain errors rather than an empty fabricated summary", async () => {
  for (const response of [Response.json({}), Response.json({ ...payload, children: null }), new Response("private-upstream", { status: 503 })]) {
    const client = createSupabaseDatabaseClient(config, async () => response);
    await assert.rejects(readSchoolDashboard(client, "synthetic-token"));
  }
});
test("dashboard SQL invokes RLS and restricts pending tasks to each linked child's enrollment", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261020000000_school_dashboard_rpc.sql", import.meta.url), "utf8");
  assert.match(sql, /security invoker set search_path = ''/i);
  assert.match(sql, /school_actor_active\(\)/);
  assert.match(sql, /guardian\.user_id=v_actor/);
  assert.match(sql, /e\.group_id=t\.group_id and e\.ended_at is null/);
  assert.match(sql, /sub\.task_id=t\.id and sub\.student_id=s\.id/);
  assert.match(sql, /count\(distinct student_id\)/);
  assert.match(sql, /America\/Mexico_City/);
  assert.match(sql, /revoke all on function public\.school_dashboard\(integer\) from public,anon/);
});
