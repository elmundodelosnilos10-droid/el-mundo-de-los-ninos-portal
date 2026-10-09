import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseDatabaseClient } from "../lib/supabase/database.ts";
import { readStudentGuardians } from "../lib/supabase/student-guardians.ts";

const config = { url: "https://school-project.supabase.co", publishableKey: "sb_publishable_test-key" };
const jwt = "synthetic-user-access-token";
const studentId = "11111111-1111-4111-8111-111111111111";

test("resolves only links for the requested student through RLS-visible guardian profiles", async () => {
  const calls = [];
  const client = createSupabaseDatabaseClient(config, async (url, init) => {
    calls.push({ url: String(url), init });
    const target = new URL(url);
    if (target.pathname.endsWith("/student_guardians")) {
      return Response.json([
        { guardian_id: "guardian-1", relationship: "Madre", active: true, may_collect: true },
        { guardian_id: "guardian-hidden", relationship: "Tutor", active: true, may_collect: false },
      ]);
    }
    if (target.pathname.endsWith("/guardians")) {
      return Response.json([{ id: "guardian-1", user_id: "profile-1" }, { id: "guardian-hidden", user_id: "profile-hidden" }]);
    }
    return Response.json([{ id: "profile-1", name: "Tutora Uno" }]);
  });

  const items = await readStudentGuardians(client, jwt, studentId);

  assert.deepEqual(items, [{ id: "guardian-1", name: "Tutora Uno", relationship: "Madre", active: true, mayCollect: true }]);
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /student_id=eq\.11111111-1111-4111-8111-111111111111/);
  assert.match(calls[0].url, /select=guardian_id%2Crelationship%2Cactive%2Cmay_collect/);
  for (const call of calls) assert.equal(call.init.headers.Authorization, `Bearer ${jwt}`);
  assert.match(calls[1].url, /id=in\./);
  assert.match(calls[2].url, /id=in\./);
});

test("empty guardian links do not query guardian profiles", async () => {
  let calls = 0;
  const client = createSupabaseDatabaseClient(config, async () => { calls += 1; return Response.json([]); });

  assert.deepEqual(await readStudentGuardians(client, jwt, studentId), []);
  assert.equal(calls, 1);
});
