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

test('RPC translates actual PostgREST HTTP500/P0002 into unavailable404 without retaining upstream details', async () => {
  const privateValue = 'private-internal-details-and-tokens';
  const client = createSupabaseDatabaseClient(config, async () => Response.json({ code: 'P0002', message: privateValue, details: privateValue, hint: privateValue }, { status: 500 }));
  await assert.rejects(client.rpc(jwt, 'school_submit_task', {}), error => {
    assert.equal(error.status, 404); assert.equal(error.code, 'rejected');
    assert.equal(JSON.stringify(error).includes(privateValue), false);
    assert.equal(error.message.includes(privateValue), false); return true;
  });
});

test('RPC status translation rejects unknown, malformed, misleading and oversized JSON; all other HTTP states remain intact', async () => {
  const cases = [
    [{ code: '42501', message: 'P0002' }, 500, 500],
    [{ code: '22023' }, 500, 500], [{ code: '23505' }, 500, 500],
    [{ code: 'XX000', message: 'P0002' }, 500, 500],
    [{ code: 'PGRST000', details: 'P0002' }, 500, 500],
    [{ code: 'P0002-evil' }, 500, 500], [{ code: 123 }, 500, 500],
    [{ message: 'P0002', details: { code: 'P0002' } }, 500, 500],
    [[{ code: 'P0002' }], 500, 500], [null, 500, 500],
    [{ code: 'P0002', message: 'x'.repeat(17 * 1024) }, 500, 500],
    [{ code: 'P0002' }, 403, 403], [{ code: 'P0002' }, 401, 401],
    [{ code: 'P0002' }, 503, 503], [{ code: 'P0002' }, 502, 502],
  ];
  for (const [body, status, expected] of cases) {
    const client = createSupabaseDatabaseClient(config, async () => Response.json(body, { status }));
    await assert.rejects(client.rpc(jwt, 'school_submit_task', {}), error => error instanceof SupabaseDatabaseError && error.status === expected);
  }
  for (const [body, contentType] of [['{invalid JSON P0002', 'application/json'], ['{"code":"P0002"}', 'text/html']]) {
    const client = createSupabaseDatabaseClient(config, async () => new Response(body, { status: 500, headers: { 'content-type': contentType } }));
    await assert.rejects(client.rpc(jwt, 'school_submit_task', {}), error => error.status === 500);
  }
});

test('ordinary table HTTP500 is never translated using an RPC-domain SQLSTATE', async () => {
  const client = createSupabaseDatabaseClient(config, async () => Response.json({ code: 'P0002' }, { status: 500 }));
  await assert.rejects(client.select(jwt, 'students', { columns: ['id'] }), error => error.status === 500);
});

test('RPC error-body deadline cancels a stalled stream and returns sanitized500 without mutation replay', async () => {
  let calls = 0; let canceled = false;
  const client = createSupabaseDatabaseClient(config, async () => {
    calls++;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"code":"P0002","private":')); }, cancel() { canceled = true; } }), { status: 500, headers: { 'content-type': 'application/json' } });
  });
  const start = Date.now();
  await assert.rejects(client.rpc(jwt, 'school_submit_task', {}), error => error.status === 500 && !error.message.includes('private'));
  assert.ok(Date.now() - start >= 1900 && Date.now() - start < 5000); assert.equal(calls, 1);
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(canceled, true);
});
