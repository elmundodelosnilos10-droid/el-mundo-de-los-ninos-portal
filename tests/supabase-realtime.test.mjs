import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { buildRealtimePublicationRollbackSql } from "./supabase-realtime-publication.rollback.mjs";

const actor = "a1000000-0000-4000-8000-000000000001";
const conversation = "b1000000-0000-4000-8000-000000000001";
const other = "a1000000-0000-4000-8000-000000000002";
const key = "sb_publishable_synthetic_only_12345678901234567890";
const jwt = (claims = {}) => [ { alg: "HS256", typ: "JWT" }, { role: "authenticated", sub: actor, exp: Math.floor(Date.now() / 1000) + 300, ...claims } ]
  .map(value => Buffer.from(JSON.stringify(value)).toString("base64url")).join(".") + ".synthetic_signature";
const flush = () => new Promise(resolve => setImmediate(resolve));
class FixtureTransport {}

function harness({ globals = {}, auth = Promise.resolve(), throwAt, unsubscribe = Promise.resolve("ok"), disconnect } = {}) {
  const state = { factory: [], auth: [], names: [], filters: [], ready: 0, failed: [], invalidations: [], unsubscribed: 0, disconnected: 0, teardowns: 0, leaveTimeout: null, status: null, sdkOptions: null, sdkChannelOptions: null };
  const channel = {
    on: (filter, callback) => { if (throwAt === "on") throw Error("private-payload-token"); state.filters.push({ filter, callback }); },
    subscribe: callback => { if (throwAt === "subscribe") throw Error("private-payload-token"); state.status = callback; },
    unsubscribe: () => { state.unsubscribed++; return typeof unsubscribe === "function" ? unsubscribe() : unsubscribe; },
  };
  const client = {
    setAuth: token => { state.auth.push(token); return auth; },
    channel: name => { state.names.push(name); if (throwAt === "channel") throw Error("private-payload-token"); return channel; },
    disconnect: () => { state.disconnected++; return disconnect?.(); },
  };
  const factory = (endpoint, credentials) => { state.factory.push({ endpoint, credentials }); if (throwAt === "factory") throw Error("private-payload-token"); return client; };
  // Pure SDK seam: no WebSocket/server/database authorization exercised here.
  class FakeSdkClient {
    constructor(endpoint, options) { state.sdkOptions = options; state.factory.push({ endpoint }); }
    setAuth(token) { return client.setAuth(token); }
    channel(name, options) { state.names.push(name); state.sdkChannelOptions = options; return { on: (type, filter, callback) => { assert.equal(type, "postgres_changes"); channel.on(filter, callback); }, subscribe: callback => channel.subscribe(callback), unsubscribe: timeout => { state.leaveTimeout = timeout; return channel.unsubscribe(); }, teardown: () => { state.teardowns++; } }; }
    removeChannel() { return channel.unsubscribe(); }
    disconnect() { return client.disconnect(); }
  }
  const sandboxModule = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(new URL("../lib/supabase/realtime.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(source, { module: sandboxModule, exports: sandboxModule.exports, require: name => {
    if (name === "@/lib/runtime/realtime-transport") return { schoolRealtimeTransport: FixtureTransport };
    assert.equal(name, "@supabase/realtime-js"); return { RealtimeClient: FakeSdkClient };
  }, URL, atob, ...globals });
  const options = { url: "https://school.example.test", publishableKey: key, accessToken: jwt(), userId: actor, canMessage: true,
    onReady: () => { state.ready++; }, onFailure: reason => { state.failed.push(reason); }, onInvalidate: event => { state.invalidations.push(JSON.parse(JSON.stringify(event))); } };
  const subscribe = (overrides = {}, defaultSdk = false) => sandboxModule.exports.subscribeSchoolDatabaseChanges({ ...options, ...overrides }, defaultSdk ? undefined : factory);
  const emit = (table, eventType, row, overrides = {}) => state.filters.find(item => item.filter.table === table && item.filter.event === eventType)?.callback({ schema: "public", table, eventType, new: row, ...overrides });
  return { state, subscribe, emit };
}

test("uses caller JWT before joining; exactly five INSERT/UPDATE filters and no DELETE", async () => {
  const h = harness(); const handle = h.subscribe(); await flush();
  assert.equal(h.state.factory[0].endpoint, "https://school.example.test/realtime/v1");
  assert.equal(h.state.factory[0].credentials.publishableKey, key);
  assert.equal(h.state.auth[0], h.state.factory[0].credentials.accessToken);
  assert.equal(h.state.filters.length, 5);
  assert.deepEqual(h.state.filters.map(item => JSON.parse(JSON.stringify(item.filter))), [
    { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${actor}` },
    { event: "INSERT", schema: "public", table: "messages" },
    { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${actor}` },
    { event: "UPDATE", schema: "public", table: "messages" },
    { event: "UPDATE", schema: "public", table: "communication_settings", filter: "id=eq.school" },
  ]);
  h.emit("notifications", "INSERT", { user_id: actor });
  assert.deepEqual(h.state.invalidations, []); // No data before joined.
  h.state.status("SUBSCRIBED"); h.state.status("SUBSCRIBED");
  assert.equal(h.state.ready, 1);
  await handle.stop();
});

test("SDK bridge configures public apikey and JWT provider, suppressing SDK diagnostics", async () => {
  const h = harness(); const handle = h.subscribe({}, true); await flush();
  assert.equal(h.state.sdkOptions.transport, FixtureTransport);
  assert.equal(h.state.sdkOptions.params.apikey, key);
  assert.equal(await h.state.sdkOptions.accessToken(), h.state.auth[0]);
  assert.equal(h.state.sdkOptions.timeout, 10000);
  assert.equal(h.state.sdkOptions.logger("anything", "private payload", { access_token: "private" }), undefined);
  assert.ok(!JSON.stringify(h.state.sdkOptions.params).includes("service_role"));
  await handle.stop();
  assert.equal(h.state.leaveTimeout, 1000); assert.equal(h.state.teardowns, 1);
});

test("productive SDK channel waits for CDC and does not expose readiness on configuration or join creation", async () => {
  const h = harness(); const handle = h.subscribe({}, true); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(h.state.sdkChannelOptions)), {
    config: { postgres_changes_options: { wait: true, timeout: 10000 } },
  });
  assert.equal(h.state.ready, 0);
  h.emit("notifications", "INSERT", { user_id: actor });
  assert.deepEqual(h.state.invalidations, []);
  h.state.status("CHANNEL_ERROR");
  assert.equal(h.state.ready, 0); assert.deepEqual(h.state.failed, ["connection"]);
  h.state.status("SUBSCRIBED"); assert.equal(h.state.ready, 0);
  await handle.stop(); assert.equal(h.state.disconnected, 1);
});

test("forwarded notifications are strictly own-user signals, without titles or raw rows", async () => {
  const h = harness(); const handle = h.subscribe(); await flush(); h.state.status("SUBSCRIBED");
  h.emit("notifications", "INSERT", { user_id: other, title: "private-other" });
  h.emit("notifications", "INSERT", { user_id: actor, title: "private-title", body: "private-body", href: "private-href" });
  h.emit("notifications", "UPDATE", { user_id: actor, read_at: "private-date" });
  h.emit("notifications", "INSERT", { user_id: actor }, { eventType: "DELETE" });
  h.emit("notifications", "INSERT", { user_id: actor }, { schema: "private" });
  h.emit("notifications", "INSERT", { user_id: actor }, { table: "messages" });
  h.emit("notifications", "INSERT", [], {});
  assert.deepEqual(h.state.invalidations, [{ scope: "notifications" }, { scope: "notifications" }]);
  await handle.stop();
});

test("messages expose only valid conversation UUIDs; communication exposes only a scope", async () => {
  const h = harness(); const handle = h.subscribe(); await flush(); h.state.status("SUBSCRIBED");
  h.emit("messages", "INSERT", { conversation_id: "invalid", body: "private" });
  h.emit("messages", "UPDATE", { conversation_id: conversation, body: "private", file_id: "private" });
  h.emit("messages", "INSERT", { conversation_id: conversation }, { eventType: "DELETE" });
  h.emit("communication_settings", "UPDATE", { id: "other", start_time: "private" });
  h.emit("communication_settings", "UPDATE", { id: "school", start_time: "private", days: [1] });
  assert.deepEqual(h.state.invalidations, [{ scope: "messages", conversationId: conversation }, { scope: "communication" }]);
  await handle.stop();
});

test("actors who cannot message subscribe only to their notifications", async () => {
  const h = harness(); const handle = h.subscribe({ canMessage: false }); await flush();
  assert.equal(h.state.filters.length, 2);
  assert.ok(h.state.filters.every(item => item.filter.table === "notifications"));
  await handle.stop();
});

test("fails configuration before transport for secret keys, wrong/expired JWTs and unsafe origins", async () => {
  const cases = [
    { publishableKey: "sb_secret_never-send" }, { publishableKey: jwt({ role: "service_role" }) },
    { publishableKey: "arbitrary-key" }, { accessToken: jwt({ role: "service_role" }) },
    { accessToken: jwt({ sub: other }) }, { accessToken: jwt({ exp: 0 }) }, { accessToken: "not-a-jwt" },
    { userId: "not-a-uuid" }, { url: "http://public.example.test" }, { url: "https://user:secret@school.example.test" },
    { url: "https://school.example.test?token=private" }, { url: "https://school.example.test/rest/v1" }, { canMessage: "yes" },
  ];
  for (const overrides of cases) {
    const h = harness(); const handle = h.subscribe(overrides); await flush();
    assert.deepEqual(h.state.failed, ["configuration"]); assert.equal(h.state.factory.length, 0); await handle.stop();
  }
  const browser = harness({ globals: { window: {} } }); browser.subscribe(); await flush();
  assert.deepEqual(browser.state.failed, ["configuration"]); assert.equal(browser.state.factory.length, 0);
});

test("legacy anon apikey and local HTTP development are accepted without privileged keys", async () => {
  const h = harness(); const handle = h.subscribe({ publishableKey: jwt({ role: "anon" }), url: "http://127.0.0.1:54321" }); await flush();
  assert.equal(h.state.factory[0].endpoint, "http://127.0.0.1:54321/realtime/v1");
  assert.equal(h.state.failed.length, 0); await handle.stop();
});

test("stop before initialization never creates a transport or emits callbacks", async () => {
  const h = harness(); const handle = h.subscribe(); await handle.stop(); await flush();
  assert.equal(h.state.factory.length, 0); assert.equal(h.state.ready, 0); assert.deepEqual(h.state.failed, []);
});

test("stop during pending auth disconnects once and never subscribes after auth completes", async () => {
  let resolve; const auth = new Promise(done => { resolve = done; });
  const h = harness({ auth }); const handle = h.subscribe(); await flush();
  const stopped = handle.stop(); assert.equal(handle.stop(), stopped); await stopped;
  assert.equal(h.state.disconnected, 1); assert.equal(h.state.unsubscribed, 0);
  resolve(); await flush(); assert.equal(h.state.names.length, 0); assert.equal(h.state.filters.length, 0);
  assert.deepEqual(h.state.failed, []);
});

test("terminal statuses fail once, unsubscribe/disconnect and suppress subsequent delivery", async () => {
  for (const status of ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]) {
    const h = harness(); const handle = h.subscribe(); await flush(); h.state.status("SUBSCRIBED");
    h.state.status(status); h.state.status("CHANNEL_ERROR"); h.state.status("SUBSCRIBED");
    h.emit("messages", "INSERT", { conversation_id: conversation });
    assert.deepEqual(h.state.failed, ["connection"]); assert.equal(h.state.ready, 1); assert.deepEqual(h.state.invalidations, []);
    await handle.stop(); assert.equal(h.state.unsubscribed, 1); assert.equal(h.state.disconnected, 1);
  }
});

test("factory, auth, channel and subscribe failures are sanitized and cleaned up", async () => {
  for (const throwAt of ["factory", "channel", "on", "subscribe"]) {
    const h = harness({ throwAt }); const handle = h.subscribe(); await flush();
    assert.deepEqual(h.state.failed, ["connection"]); assert.equal(JSON.stringify(h.state.failed).includes("private"), false);
    await handle.stop(); assert.equal(h.state.disconnected, throwAt === "factory" ? 0 : 1);
  }
  const h = harness({ auth: Promise.reject(Error("private-jwt")) }); const handle = h.subscribe(); await flush();
  assert.deepEqual(h.state.failed, ["connection"]); assert.equal(h.state.disconnected, 1); await handle.stop();
});

test("failed unsubscribe still disconnects; consumer callbacks cannot leak SDK errors", async () => {
  const h = harness({ unsubscribe: () => Promise.reject(Error("private-error")) }); const handle = h.subscribe(); await flush();
  h.state.status("SUBSCRIBED"); await handle.stop(); assert.equal(h.state.disconnected, 1); assert.deepEqual(h.state.failed, []);
  const invalid = harness(); const invalidHandle = invalid.subscribe({ onInvalidate: () => { throw Error("private-body"); } }); await flush();
  invalid.state.status("SUBSCRIBED"); invalid.emit("notifications", "INSERT", { user_id: actor });
  assert.deepEqual(invalid.state.failed, ["connection"]); await invalidHandle.stop();
  const ready = harness(); const readyHandle = ready.subscribe({ onReady: () => { throw Error("private-ready"); }, onFailure: () => { throw Error("private-failure"); } }); await flush();
  ready.state.status("SUBSCRIBED"); await readyHandle.stop(); assert.equal(ready.state.disconnected, 1);
});

test("asynchronous disconnect rejection is handled and stop waits for teardown", async () => {
  let resolve;
  const h = harness({ disconnect: () => new Promise(done => { resolve = done; }) });
  const handle = h.subscribe(); await flush();
  let complete = false; const stopping = handle.stop().then(() => { complete = true; });
  await flush(); assert.equal(complete, false); resolve("ok"); await stopping; assert.equal(complete, true);
  const rejected = harness({ disconnect: () => Promise.reject(Error("private-disconnect")) });
  const rejectedHandle = rejected.subscribe(); await flush(); await rejectedHandle.stop();
  assert.equal(rejected.state.disconnected, 1); assert.deepEqual(rejected.state.failed, []);
});

test("migration adds three known tables and prohibits DELETE/TRUNCATE; no expanded grants/identity", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/20261030000000_school_realtime_publication.sql", import.meta.url), "utf8").replace(/--[^\n]*/g, "");
  assert.match(sql, /array\['notifications', 'messages', 'communication_settings'\]/);
  assert.match(sql, /alter publication supabase_realtime add table public\.%I/);
  assert.match(sql, /alter publication supabase_realtime set \(publish = 'insert, update'\)/);
  assert.match(sql, /pg_publication_namespace/);
  assert.match(sql, /school_realtime_publication_must_be_exclusive/);
  assert.ok(sql.indexOf("school_realtime_read_expression_not_ready") < sql.indexOf("alter publication supabase_realtime set"));
  assert.match(sql, /relrowsecurity and c\.relforcerowsecurity/);
  assert.match(sql, /has_table_privilege\('authenticated'/);
  assert.match(sql, /has_any_column_privilege\('anon'/);
  assert.match(sql, /notifications_read_own/); assert.match(sql, /messages_read_member/); assert.match(sql, /communication_settings_read_authenticated/);
  assert.doesNotMatch(sql, /\bgrant\b|\brevoke\b|replica\s+identity|create\s+(table|policy|publication)|drop\s+|disable\s+row/i);
});


test("rollback fixture is catalog-only and wraps duplicate migration bodies without COMMIT", () => {
  const sql = buildRealtimePublicationRollbackSql();
  assert.equal((sql.match(/^begin;$/gmi) ?? []).length, 1);
  assert.equal((sql.match(/^commit;$/gmi) ?? []).length, 0);
  assert.equal((sql.match(/alter publication supabase_realtime add table/g) ?? []).length, 2);
  assert.ok(sql.endsWith("rollback;\n"));
  assert.match(sql, /test\.realtime\.security_before/);
  assert.match(sql, /publication changed beyond three expected tables/);
  assert.match(sql, /table security, grants, policies or replica identity changed/);
  assert.doesNotMatch(sql, /insert\s+into\s+(auth|public)\.|update\s+(auth|public)\.|create\s+table/i);
});

test("SQL security guard permits only known baseline read policies and exact expressions", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/20261030000000_school_realtime_publication.sql", import.meta.url), "utf8");
  const baseline = fs.readFileSync(new URL("../supabase/migrations/20261008000002_school_rls_policies.sql", import.meta.url), "utf8");
  for (const name of ["notifications_read_own", "messages_read_member", "communication_settings_read_authenticated", "communication_settings_manage_leadership"]) {
    assert.ok(baseline.includes(`create policy ${name} on public.`)); assert.ok(sql.includes(`'${name}'`));
  }
  assert.match(sql, /authenticated_oid = any\(p\.polroles\) and p\.polname <> expected_policy/);
  assert.match(sql, /policy_expression not in/);
  assert.match(sql, /policy_expression <> expected_helper/);
  assert.match(sql, /= 'school_is_leader\(\)'/);
});
