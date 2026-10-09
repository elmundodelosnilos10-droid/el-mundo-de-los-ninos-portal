import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseDatabaseClient } from "../lib/supabase/database.ts";
import { readSchoolDirectory } from "../lib/supabase/school-directory.ts";

const config = { url: "https://school-project.supabase.co", publishableKey: "sb_publishable_test-key" };
const jwt = "synthetic-user-access-token";

test("directory resolves only active teacher links and their RLS-visible profiles", async () => {
  const requests = [];
  const client = createSupabaseDatabaseClient(config, async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).includes("/teachers?")) {
      return Response.json([
        { id: "teacher-1", user_id: "auth-1" },
        { id: "teacher-2", user_id: "auth-missing-profile" },
      ]);
    }
    return Response.json([{ id: "auth-1", name: "Maestra Uno", email: "teacher@example.invalid" }]);
  });

  const people = await readSchoolDirectory(client, jwt, "teachers");

  assert.deepEqual(people, [{ id: "teacher-1", name: "Maestra Uno", email: "teacher@example.invalid" }]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].init.headers.Authorization, `Bearer ${jwt}`);
  assert.match(requests[0].url, /\/rest\/v1\/teachers\?/);
  assert.match(requests[0].url, /active=eq\.true/);
  assert.match(requests[1].url, /\/rest\/v1\/profiles\?/);
  assert.match(requests[1].url, /id=in\./);
  assert.equal(requests[1].init.headers.Authorization, `Bearer ${jwt}`);
});

test("empty directory avoids profile lookup", async () => {
  let calls = 0;
  const client = createSupabaseDatabaseClient(config, async () => { calls++; return Response.json([]); });
  assert.deepEqual(await readSchoolDirectory(client, jwt, "guardians"), []);
  assert.equal(calls, 1);
});
