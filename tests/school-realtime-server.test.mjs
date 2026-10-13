import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const origin = "https://portal.example.test";
const userId = "a1000000-0000-4000-8000-000000000001";
const conversationId = "a1000000-0000-4000-8000-000000000002";
const actor = () => ({ id: userId, name: "Synthetic", email: "synthetic@example.invalid", roles: ["tutor"], supabaseAuth: { userId, accessToken: "verified-user-jwt-private" } });
function runtime() {
  const state = {
    actor: actor(), actorCalls: 0, actorFailure: false, pending: null, stops: 0, options: null, subscribeFailure: false, syncFailure: false,
    env: { SCHOOL_AUTH_PROVIDER: "supabase", SCHOOL_DATA_PROVIDER: "supabase", SCHOOL_REALTIME_PROVIDER: "supabase", SUPABASE_URL: "https://school.example.test", SUPABASE_PUBLISHABLE_KEY: "publishable-private-to-server" },
    intervals: new Map(), timeouts: new Map(), sequence: 0,
  };
  const actorFromRequest = async () => { state.actorCalls++; if (state.actorFailure) throw Error("private-db-diagnostic"); if (state.pending) return state.pending; return state.actor; };
  const subscribe = options => {
    state.options = options;
    if (state.subscribeFailure) throw Error("secret transport diagnostic");
    if (state.syncFailure) options.onFailure("configuration");
    return { stop: async () => { state.stops++; } };
  };
  const dependencies = { "@/lib/access": { actorFromRequest }, "@/lib/runtime/env": { env: state.env }, "@/lib/supabase/realtime": { subscribeSchoolDatabaseChanges: subscribe } };
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const sandboxModule = { exports: {} }; modules.set(file, sandboxModule);
    const source = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const require = name => name === "@/lib/school-realtime-server" ? load("lib/school-realtime-server.ts") : dependencies[name] ?? assert.fail(`Unexpected ${name}`);
    const setInterval = (callback, ms) => { const id = ++state.sequence; state.intervals.set(id, { callback, ms }); return id; };
    const setTimeout = (callback, ms) => { const id = ++state.sequence; state.timeouts.set(id, { callback, ms }); return id; };
    vm.runInContext(source, vm.createContext({ module: sandboxModule, exports: sandboxModule.exports, require, URL, Request, Response, Headers, ReadableStream, TextEncoder, setInterval, setTimeout, clearInterval: id => state.intervals.delete(id), clearTimeout: id => state.timeouts.delete(id) }), { filename: file });
    return sandboxModule.exports;
  }
  const config = load("app/api/realtime/config/route.ts");
  const events = load("app/api/realtime/events/route.ts");
  return { state, config, events, async tick(ms, timeout = false) { for (const timer of [...(timeout ? state.timeouts : state.intervals).values()]) if (timer.ms === ms) timer.callback(); await flush(); } };
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
function request(headers = {}, signal) { return new Request(`${origin}/api/realtime/events`, { headers, signal }); }
async function frame(reader) { const { value, done } = await reader.read(); return done ? null : new TextDecoder().decode(value); }
async function start(runtime, signal) { const response = await runtime.events.GET(request({}, signal)); assert.equal(response.status, 200); return { response, reader: response.body.getReader() }; }
function assertClosed(state) { assert.equal(state.intervals.size, 0); assert.equal(state.timeouts.size, 0); assert.equal(state.stops, 1); }

test("authenticated config exposes only enabled and enables exactly matching provider modes with verified UUID", async () => {
  const r = runtime(); const response = await r.config.GET(request());
  assert.deepEqual(await response.json(), { enabled: true });
  for (const key of ["SCHOOL_REALTIME_PROVIDER", "SCHOOL_AUTH_PROVIDER", "SCHOOL_DATA_PROVIDER"]) {
    const r = runtime(); r.state.env[key] = "legacy";
    assert.deepEqual(await (await r.config.GET(request())).json(), { enabled: false });
    assert.equal((await r.events.GET(request())).status, 503);
    assert.equal(r.state.options, null);
  }
  const noJwt = runtime(); noJwt.state.actor.supabaseAuth = null;
  assert.deepEqual(await (await noJwt.config.GET(request())).json(), { enabled: false });
  assert.equal((await noJwt.events.GET(request())).status, 401);
  const mismatch = runtime(); mismatch.state.actor.supabaseAuth.userId = conversationId;
  assert.equal((await mismatch.events.GET(request())).status, 401);
});

test("both real GET routes require actor and sanitize actor errors without credentials", async () => {
  for (const route of ["config", "events"]) {
    const r = runtime(); r.state.actor = null;
    assert.equal((await r[route].GET(request())).status, 401);
    r.state.actorFailure = true;
    const response = await r[route].GET(request()); assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /private-db|jwt|publishable/);
    assert.equal(r.state.options, null);
  }
});

test("Origin absent and exact same Origin work; foreign, null, malformed and cross-site fail before auth", async () => {
  for (const headers of [{ origin: "https://foreign.test" }, { origin: "null" }, { origin: `${origin}/path` }, { origin: "invalid" }, { "sec-fetch-site": "cross-site" }, { origin, "sec-fetch-site": "cross-site" }]) {
    for (const route of ["config", "events"]) {
      const r = runtime(); assert.equal((await r[route].GET(request(headers))).status, 403); assert.equal(r.state.actorCalls, 0);
    }
  }
  for (const headers of [{}, { origin }, { "sec-fetch-site": "same-origin" }]) {
    const r = runtime(); assert.equal((await r.config.GET(request(headers))).status, 200);
  }
});

test("SSE headers and route limits disable caching and CORS; transport gets verified credentials only server-side", async () => {
  const r = runtime(); const { response, reader } = await start(r);
  assert.equal(r.events.maxDuration, 300); assert.equal(r.events.dynamic, "force-dynamic"); assert.equal(r.config.dynamic, "force-dynamic");
  assert.match(response.headers.get("content-type"), /^text\/event-stream/);
  assert.match(response.headers.get("cache-control"), /private.*no-store.*no-cache/);
  assert.match(response.headers.get("cache-control"), /no-transform/);
  assert.equal(response.headers.get("vary"), "Cookie"); assert.equal(response.headers.get("x-accel-buffering"), "no");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(r.state.options.accessToken, "verified-user-jwt-private"); assert.equal(r.state.options.userId, userId); assert.equal(r.state.options.canMessage, true);
  await reader.cancel(); assertClosed(r.state);
});

test("ready sends empty envelope once; invalidations strip rows, tokens and unrecognized data", async () => {
  const r = runtime(); const { reader } = await start(r);
  r.state.options.onInvalidate({ scope: "notifications" }); // Not ready yet.
  r.state.options.onReady(); r.state.options.onReady();
  assert.equal(await frame(reader), "event: ready\ndata: {}\n\n");
  for (const value of [{ scope: "notifications", token: "secret" }, { scope: "messages", conversationId, body: "private-row" }, { scope: "communication", settings: { secret: "private" } }]) {
    r.state.options.onInvalidate(value);
    const result = await frame(reader); assert.doesNotMatch(result, /secret|private-row|settings|token/);
    assert.equal(result, `event: invalidate\ndata: ${JSON.stringify(value.scope === "messages" ? { scope: "messages", conversationId } : { scope: value.scope })}\n\n`);
  }
  r.state.options.onInvalidate({ scope: "messages", conversationId: "invalid" }); r.state.options.onInvalidate({ scope: "secret" });
  await r.tick(15_000); assert.equal(await frame(reader), ": heartbeat\n\n");
  await reader.cancel(); assertClosed(r.state);
});

test("notification-only actors cannot receive messages/communication envelopes even if adapter invokes callbacks", async () => {
  for (const roles of [["alumno"], ["direccion"], ["superadmin"]]) {
    const r = runtime(); r.state.actor.roles = roles; const { reader } = await start(r);
    assert.equal(r.state.options.canMessage, false);
    r.state.options.onReady(); await frame(reader);
    r.state.options.onInvalidate({ scope: "messages", conversationId }); r.state.options.onInvalidate({ scope: "communication" });
    r.state.options.onInvalidate({ scope: "notifications" }); assert.match(await frame(reader), /notifications/);
    await reader.cancel();
  }
});

test("heartbeat 15s, TTL 240s rotates once and late callbacks cannot enqueue", async () => {
  const r = runtime(); const { reader } = await start(r); r.state.options.onReady(); await frame(reader);
  await r.tick(15_000); assert.equal(await frame(reader), ": heartbeat\n\n");
  await r.tick(240_000, true); assert.equal(await frame(reader), 'event: end\ndata: {"reason":"rotate"}\n\n');
  assert.equal(await frame(reader), null); assertClosed(r.state);
  r.state.options.onReady(); r.state.options.onInvalidate({ scope: "notifications" }); r.state.options.onFailure("connection"); assertClosed(r.state);
});

test("30s actor revocation and changed roles/identity end unauthorized", async () => {
  for (const replacement of [null, { ...actor(), id: conversationId }, { ...actor(), roles: ["docente"] }, { ...actor(), supabaseAuth: null }]) {
    const r = runtime(); const { reader } = await start(r); r.state.options.onReady(); await frame(reader);
    r.state.actor = replacement; await r.tick(30_000);
    assert.equal(await frame(reader), 'event: end\ndata: {"reason":"unauthorized"}\n\n'); assert.equal(await frame(reader), null); assertClosed(r.state);
  }
});

test("revalidation never overlaps and coalesces missed signals only after authorization succeeds", async () => {
  const r = runtime(); const { reader } = await start(r); r.state.options.onReady(); await frame(reader);
  let resolve; r.state.pending = new Promise(done => { resolve = done; });
  await r.tick(30_000); await r.tick(30_000); assert.equal(r.state.actorCalls, 2);
  r.state.options.onInvalidate({ scope: "messages", conversationId });
  r.state.options.onInvalidate({ scope: "notifications" });
  resolve(actor()); await flush(); r.state.pending = null;
  assert.equal(await frame(reader), 'event: invalidate\ndata: {"scope":"all"}\n\n');
  r.state.options.onInvalidate({ scope: "notifications" }); assert.match(await frame(reader), /notifications/);
  await r.tick(30_000); assert.equal(r.state.actorCalls, 3);
  await reader.cancel(); assertClosed(r.state);
});

test("pending authorization has its own deadline and never delivers buffered private signals on failure", async () => {
  for (const denied of [true, false]) {
    const r = runtime(); const { reader } = await start(r); r.state.options.onReady(); await frame(reader);
    let resolve; r.state.pending = new Promise(done => { resolve = done; }); await r.tick(30_000);
    r.state.options.onInvalidate({ scope: "messages", conversationId });
    if (denied) { resolve(null); await flush(); assert.equal(await frame(reader), 'event: end\ndata: {"reason":"unauthorized"}\n\n'); }
    else { await r.tick(20_000, true); assert.equal(await frame(reader), 'event: end\ndata: {"reason":"unavailable"}\n\n'); resolve(actor()); await flush(); }
    assert.equal(await frame(reader), null); assertClosed(r.state);
  }
});

test("auth verification errors close unavailable and never leak upstream diagnostics", async () => {
  const r = runtime(); const { reader } = await start(r); r.state.options.onReady(); await frame(reader);
  r.state.actorFailure = true; await r.tick(30_000);
  assert.equal(await frame(reader), 'event: end\ndata: {"reason":"unavailable"}\n\n'); assertClosed(r.state);
});

test("abort and reader cancellation close timers and transport once, including pre-aborted request", async () => {
  const aborted = runtime(); const controller = new AbortController(); controller.abort();
  assert.equal((await aborted.events.GET(request({}, controller.signal))).status, 401); assert.equal(aborted.state.options, null);
  const r = runtime(); const active = new AbortController(); const { reader } = await start(r, active.signal);
  active.abort(); assert.equal(await frame(reader), null); assertClosed(r.state); await reader.cancel(); assertClosed(r.state);
  const cancelled = runtime(); const s = await start(cancelled); await s.reader.cancel(); assertClosed(cancelled.state);
});

test("adapter failures, throws, synchronous failure and missing readiness terminate sanitized streams", async () => {
  for (const kind of ["configuration", "connection", "throw", "sync", "timeout"]) {
    const r = runtime(); r.state.subscribeFailure = kind === "throw"; r.state.syncFailure = kind === "sync";
    const { reader } = await start(r);
    if (kind === "configuration" || kind === "connection") r.state.options.onFailure(kind);
    if (kind === "timeout") await r.tick(25_000, true);
    assert.equal(await frame(reader), 'event: end\ndata: {"reason":"unavailable"}\n\n'); assert.equal(await frame(reader), null);
    assert.equal(r.state.intervals.size, 0); assert.equal(r.state.timeouts.size, 0);
    assert.equal(r.state.stops, kind === "throw" ? 0 : 1);
  }
});

test("CDC readiness has a 25s deadline; heartbeat alone cannot authorize invalidations", async () => {
  const r = runtime(); const { reader } = await start(r);
  assert.ok([...r.state.timeouts.values()].some(timer => timer.ms === 25_000));
  assert.ok(![...r.state.timeouts.values()].some(timer => timer.ms === 15_000));
  await r.tick(15_000); assert.equal(await frame(reader), ": heartbeat\n\n");
  r.state.options.onInvalidate({ scope: "notifications" });
  await r.tick(25_000, true);
  assert.equal(await frame(reader), 'event: end\ndata: {"reason":"unavailable"}\n\n');
  assert.equal(await frame(reader), null); assertClosed(r.state);
});

test("slow reader backpressure keeps queued bytes bounded and stops transport without retries", async () => {
  const r = runtime(); const { reader } = await start(r); r.state.options.onReady();
  for (let i = 0; i < 1000; i++) r.state.options.onInvalidate({ scope: "messages", conversationId });
  let bytes = 0; for (;;) { const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength; }
  assert.ok(bytes <= 4096, `queued ${bytes}`); assertClosed(r.state); assert.equal(r.state.actorCalls, 1);
});

test("lifetime byte limit closes even when a fast reader drains every event", async () => {
  const r = runtime(); const { reader } = await start(r); r.state.options.onReady(); let bytes = (await frame(reader)).length; let ended = false;
  for (let i = 0; i < 1500; i++) {
    r.state.options.onInvalidate({ scope: "messages", conversationId });
    const value = await frame(reader); if (value === null) { ended = true; break; }
    bytes += value.length;
    if (value.startsWith("event: end")) { assert.match(value, /unavailable/); assert.equal(await frame(reader), null); ended = true; break; }
  }
  assert.ok(ended); assert.ok(bytes <= 65_536); assertClosed(r.state);
});
