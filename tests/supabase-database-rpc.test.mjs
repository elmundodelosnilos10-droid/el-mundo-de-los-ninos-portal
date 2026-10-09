import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseDatabaseClient, SupabaseDatabaseError } from "../lib/supabase/database.ts";

const config = { url: "https://school-project.supabase.co", publishableKey: "sb_publishable_test-key" };
const jwt = "synthetic-user-access-token";

test("RPC uses the authenticated user's JWT and the publishable key", async () => {
  let request;
  const client = createSupabaseDatabaseClient(config, async (url, init) => {
    request = { url: String(url), init };
    return Response.json({ assigned: true });
  });

  const result = await client.rpc(jwt, "school_assign_teacher_to_group", {
    p_group_id: "1a5c57ef-1060-43ce-90cb-9653735d8325",
    p_teacher_id: "15a99b0f-e2d2-4d8e-8e18-0de5dcdb5d31",
  });

  assert.equal(request.url, `${config.url}/rest/v1/rpc/school_assign_teacher_to_group`);
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers.apikey, config.publishableKey);
  assert.equal(request.init.headers.Authorization, `Bearer ${jwt}`);
  assert.equal(request.init.headers.Prefer, "return=representation");
  assert.deepEqual(JSON.parse(request.init.body), {
    p_group_id: "1a5c57ef-1060-43ce-90cb-9653735d8325",
    p_teacher_id: "15a99b0f-e2d2-4d8e-8e18-0de5dcdb5d31",
  });
  assert.deepEqual(result.data, [{ assigned: true }]);
});

test("RPC rejects unsafe function names and malformed arguments before network access", async () => {
  let calls = 0;
  const client = createSupabaseDatabaseClient(config, async () => { calls++; return Response.json({}); });
  for (const [name, args] of [["school.test", { p_id: "x" }], ["school_create_year", null], ["school_create_year", []]]) {
    await assert.rejects(client.rpc(jwt, name, args), error => error instanceof SupabaseDatabaseError && error.code === "invalid_input");
  }
  assert.equal(calls, 0);
});

test("RPC permits an empty object for functions without parameters", async () => {
  let body;
  const client = createSupabaseDatabaseClient(config, async (_input, init) => { body = init.body; return Response.json({ items: [] }); });
  assert.deepEqual(await client.rpc(jwt, "school_conversation_feed", {}), { data: [{ items: [] }] });
  assert.equal(body, "{}");
});

test("RPC hides upstream error bodies", async () => {
  const secret = "server-only-upstream-error";
  const client = createSupabaseDatabaseClient(config, async () => new Response(secret, { status: 403 }));
  await assert.rejects(client.rpc(jwt, "school_create_group", { p_id: "synthetic" }), error => {
    assert.ok(error instanceof SupabaseDatabaseError);
    assert.equal(error.status, 403);
    assert.equal(error.message.includes(secret), false);
    return true;
  });
});
