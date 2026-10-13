import assert from 'node:assert/strict';
import test from 'node:test';
import { createSchoolRealtimeClient, parseSchoolRealtimeInvalidation, subscribeSchoolRealtime } from '../lib/school-realtime-client.ts';

const settle = () => new Promise(resolve => setImmediate(resolve));
const conversationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function harness() {
  const state = { online: true, visible: true, requests: [], streams: [], timers: new Map(), timerId: 0, environment: new Set(), updates: [] };
  const runtime = {
    fetcher: (url, options) => new Promise((resolve, reject) => state.requests.push({ url, options, resolve, reject })),
    openStream: url => {
      const handlers = new Map();
      const stream = { url, closed: 0, addEventListener(name, cb) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(cb); }, close() { this.closed++; },
        emit(name, data = {}) { for (const cb of handlers.get(name) ?? []) cb({ data: typeof data === 'string' ? data : JSON.stringify(data) }); } };
      state.streams.push(stream); return stream;
    },
    isOnline: () => state.online, isVisible: () => state.visible,
    subscribeEnvironment(cb) { state.environment.add(cb); return () => state.environment.delete(cb); },
    setTimer(cb, delay) { const id = ++state.timerId; state.timers.set(id, { cb, delay }); return id; },
    clearTimer(id) { state.timers.delete(id); },
  };
  const client = createSchoolRealtimeClient(runtime);
  const subscribe = () => client.subscribe(event => state.updates.push(event));
  async function respond(i = 0, config = { enabled: true }, status = 200) { state.requests[i].resolve(Response.json(config, { status })); await settle(); }
  function change() { for (const cb of state.environment) cb(); }
  function tick(delay) { const entry = [...state.timers.entries()].find(([, timer]) => timer.delay === delay); assert.ok(entry, `timer ${delay}`); state.timers.delete(entry[0]); entry[1].cb(); }
  return { state, client, subscribe, respond, change, tick };
}
test('strict invalidation protocol accepts scope/id only and rejects private row data or arbitrary routes', () => {
  for (const scope of ['notifications', 'communication', 'all']) assert.deepEqual(parseSchoolRealtimeInvalidation({ data: JSON.stringify({ scope }) }), { type: 'invalidate', scope });
  assert.deepEqual(parseSchoolRealtimeInvalidation({ data: JSON.stringify({ scope: 'messages', conversationId }) }), { type: 'invalidate', scope: 'messages', conversationId });
  for (const payload of [null, [], {}, { scope: 'unknown' }, { scope: 'messages' }, { scope: 'messages', conversationId: '//external' }, { scope: 'notifications', title: 'private' }, { scope: 'messages', conversationId, body: 'private' }]) assert.equal(parseSchoolRealtimeInvalidation({ data: JSON.stringify(payload) }), null);
  for (const data of ['invalid', 'x'.repeat(257), undefined]) assert.equal(parseSchoolRealtimeInvalidation({ data }), null);
});
test('transport uses only private same-origin GET without credentials in payload and waits for actual subscription', async () => {
  const h = harness(); const stop = h.subscribe(); await h.respond();
  const request = h.state.requests[0]; assert.equal(request.url, '/api/realtime/config');
  assert.equal(request.options.method, 'GET'); assert.equal(request.options.credentials, 'same-origin'); assert.equal(request.options.cache, 'no-store'); assert.equal(request.options.headers, undefined); assert.equal(request.options.body, undefined);
  const stream = h.state.streams[0]; assert.equal(stream.url, '/api/realtime/events');
  stream.emit('invalidate', { scope: 'notifications' }); assert.equal(h.state.updates.filter(e => e.type === 'invalidate').length, 0);
  stream.emit('ready', {}); assert.equal(h.state.updates.at(-1).status, 'connected');
  stream.emit('invalidate', { scope: 'notifications' }); assert.deepEqual(h.state.updates.at(-1), { type: 'invalidate', scope: 'notifications' });
  stop(); assert.equal(stream.closed, 1); assert.equal(h.state.timers.size, 0); assert.equal(h.state.environment.size, 0);
});
test('multiple sections share one stream, receive current status and release only when all dispose', async () => {
  const h = harness(); const stop1 = h.subscribe(); await h.respond(); h.state.streams[0].emit('ready');
  const stop2 = h.subscribe(); assert.equal(h.state.updates.at(-1).status, 'connected'); assert.equal(h.state.requests.length, 1);
  stop1(); stop1(); assert.equal(h.state.streams[0].closed, 0); stop2(); assert.equal(h.state.streams[0].closed, 1);
});
test('duplicate function subscriptions are independently ref counted', async () => {
  const h = harness(); const listener = e => h.state.updates.push(e); const stop1 = h.client.subscribe(listener); const stop2 = h.client.subscribe(listener);
  await h.respond(); stop1(); assert.equal(h.state.streams[0].closed, 0); stop2(); assert.equal(h.state.streams[0].closed, 1);
});
test('disabled provider stops transport with honest fallback until next mount', async () => {
  const h = harness(); const stop = h.subscribe(); await h.respond(0, { enabled: false });
  assert.equal(h.state.updates.at(-1).status, 'disabled'); assert.equal(h.state.streams.length, 0); assert.equal(h.state.timers.size, 0);
  h.change(); assert.equal(h.state.requests.length, 1); stop(); const stop2 = h.subscribe(); assert.equal(h.state.requests.length, 2); stop2();
});
test('access rejection is terminal and discards late events; a new mount checks access again', async () => {
  for (const status of [401, 403]) {
    const h = harness(); const stop = h.subscribe(); await h.respond(0, {}, status);
    assert.equal(h.state.updates.at(-1).status, 'unauthorized'); assert.equal(h.state.timers.size, 0); h.change(); assert.equal(h.state.requests.length, 1); stop();
  }
  const h = harness(); const stop = h.subscribe(); await h.respond(); const s = h.state.streams[0]; s.emit('ready'); s.emit('end', { reason: 'unauthorized' });
  const count = h.state.updates.length; s.emit('invalidate', { scope: 'notifications' }); assert.equal(h.state.updates.length, count); assert.equal(s.closed, 1); assert.equal(h.state.timers.size, 0); stop();
});
test('stream error closes native reconnect loop and retries GET with bounded exponential backoff', async () => {
  const h = harness(); const stop = h.subscribe(); await h.respond(); const s = h.state.streams[0]; s.emit('error'); s.emit('error');
  assert.equal(s.closed, 1); assert.equal(h.state.timers.size, 1); assert.equal(h.state.updates.at(-1).status, 'reconnecting');
  h.tick(2_000); await h.respond(1, {}, 503); h.tick(4_000); await h.respond(2, {}, 503); h.tick(8_000); await h.respond(3, {}, 503); h.tick(16_000); await h.respond(4, {}, 503); h.tick(30_000); await h.respond(5, {}, 503);
  assert.equal([...h.state.timers.values()][0].delay, 30_000); stop();
});
test('ready after reconnect resets backoff and refresh signal; rotation uses controlled reconnect', async () => {
  const h = harness(); const stop = h.subscribe(); await h.respond(); h.state.streams[0].emit('error'); h.tick(2_000); await h.respond(1);
  const s = h.state.streams[1]; s.emit('ready'); s.emit('end', { reason: 'rotate' }); assert.equal(s.closed, 1); h.tick(1_000); await h.respond(2); h.state.streams[2].emit('error');
  assert.equal([...h.state.timers.values()][0].delay, 2_000); stop();
});
test('hidden/offline aborts reads and closes streams; return starts a new private read with no overlap', async () => {
  const h = harness(); const stop = h.subscribe(); h.state.visible = false; h.change(); assert.equal(h.state.requests[0].options.signal.aborted, true); assert.equal(h.state.timers.size, 0);
  await h.respond(0); assert.equal(h.state.streams.length, 0); h.state.visible = true; h.change(); assert.equal(h.state.requests.length, 2); h.change(); assert.equal(h.state.requests.length, 2);
  await h.respond(1); h.state.streams[0].emit('ready'); h.state.online = false; h.change(); assert.equal(h.state.streams[0].closed, 1); h.state.online = true; h.change(); assert.equal(h.state.requests.length, 3); stop();
});
test('unmount aborts pending request and late response cannot revive client or timers', async () => {
  const h = harness(); const stop = h.subscribe(); stop(); assert.equal(h.state.requests[0].options.signal.aborted, true); await h.respond(); assert.equal(h.state.streams.length, 0); assert.equal(h.state.timers.size, 0);
});
test('config timeout and ready timeout recover with one retry; malformed responses never connect', async () => {
  const h = harness(); const stop = h.subscribe(); h.tick(20_000); assert.equal(h.state.requests[0].options.signal.aborted, true); h.tick(2_000); await h.respond(1);
  h.tick(30_000); assert.equal(h.state.streams[0].closed, 1); h.tick(4_000); await h.respond(2, { enabled: 'yes' }); assert.equal(h.state.streams.length, 1); stop();
});
test('configuration keeps 20s budget while CDC ready waits 30s without showing connected early', async () => {
  const h = harness(); const stop = h.subscribe();
  assert.deepEqual([...h.state.timers.values()].map(timer => timer.delay), [20_000]);
  await h.respond();
  assert.deepEqual([...h.state.timers.values()].map(timer => timer.delay), [30_000]);
  const stream = h.state.streams[0];
  stream.emit('invalidate', { scope: 'notifications' });
  assert.equal(h.state.updates.at(-1).status, 'connecting');
  assert.equal(h.state.updates.filter(event => event.type === 'invalidate').length, 0);
  stream.emit('ready'); assert.equal(h.state.updates.at(-1).status, 'connected');
  assert.deepEqual([...h.state.timers.values()].map(timer => timer.delay), [250_000]);
  stop();
});
test('unknown or oversized protocol frames are ignored and cannot change connection state', async () => {
  const h = harness(); const stop = h.subscribe(); await h.respond(); const s = h.state.streams[0]; s.emit('ready', { token: 'private' }); assert.equal(h.state.updates.at(-1).status, 'connecting'); s.emit('ready');
  const count = h.state.updates.length; s.emit('end', { reason: 'redirect', url: '//outside' }); s.emit('invalidate', { scope: 'messages', conversationId, private: true }); s.emit('invalidate', 'x'.repeat(257)); assert.equal(h.state.updates.length, count); assert.equal(s.closed, 0); stop();
});
test('client lifetime is bounded even if server rotation frame is lost', async () => {
  const h = harness(); const stop = h.subscribe(); await h.respond(); h.state.streams[0].emit('ready'); h.tick(250_000); assert.equal(h.state.streams[0].closed, 1); assert.equal([...h.state.timers.values()][0].delay, 1_000); stop();
});
test('bad consumer does not disconnect transport used by another section', async () => {
  const h = harness(); const stop1 = h.client.subscribe(() => { throw new Error('synthetic consumer error'); }); const stop2 = h.subscribe(); await h.respond(); h.state.streams[0].emit('ready'); h.state.streams[0].emit('invalidate', { scope: 'notifications' }); assert.equal(h.state.updates.at(-1).type, 'invalidate'); stop1(); stop2();
});
test('SSR never creates a stream or requests private API', () => {
  const events = []; const stop = subscribeSchoolRealtime(e => events.push(e)); assert.deepEqual(events, [{ type: 'status', status: 'disabled' }]); stop();
});
