import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createSchoolRealtimeClient } from "../lib/school-realtime-client.ts";
import { createNotificationController, INITIAL_NOTIFICATION_STATE, loadSchoolNotices, confirmNoticeRead, notificationPollDelay } from "../lib/notification-client.ts";

const notice = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "tarea", title: "Nueva tarea sintética", href: "/tareas", createdAt: "2026-10-08T10:00:00Z", readAt: null };
const settle = () => new Promise(resolve => setImmediate(resolve));
function browserRuntime() {
  const state = { online: true, visible: true, calls: [], changes: [], navigations: [], timers: new Map(), listeners: new Map(), timerId: 0, snapshot: INITIAL_NOTIFICATION_STATE };
  const fetcher = (url, options) => new Promise((resolve, reject) => { state.calls.push({ url, options, resolve, reject }); });
  function listen(type, listener) { if (!state.listeners.has(type)) state.listeners.set(type, new Set()); state.listeners.get(type).add(listener); }
  function unlisten(type, listener) { state.listeners.get(type)?.delete(listener); }
  function event(type) { for (const listener of [...state.listeners.get(type) ?? []]) listener(); }
  const runtime = { fetcher, isOnline: () => state.online, isVisible: () => state.visible,
    subscribe: listener => { ["visibilitychange", "online", "offline"].forEach(type => listen(type, listener)); return () => ["visibilitychange", "online", "offline"].forEach(type => unlisten(type, listener)); },
    setTimer: (callback, delay) => { const id = ++state.timerId; state.timers.set(id, { callback, delay }); return id; }, clearTimer: id => state.timers.delete(id),
    onChange: value => { state.snapshot = value; state.changes.push(value); }, onNavigate: href => state.navigations.push(href) };
  async function respond(index, payload = { items: [notice] }, status = 200) { state.calls[index].resolve(Response.json(payload, { status })); await settle(); }
  function tick() { const [id, timer] = state.timers.entries().next().value; state.timers.delete(id); timer.callback(); }
  return { state, fetcher, runtime, event, listen, unlisten, respond, tick };
}

test("notification requests use same-origin private API, validate fields and prevent external navigation", async () => {
  let call;
  const rows = await loadSchoolNotices(new AbortController().signal, async (url, options) => { call = { url, options }; return Response.json({ items: [{ ...notice, user_id: "private-not-returned", secret: "private" }] }); });
  assert.deepEqual(rows, [notice]); assert.equal(call.url, "/api/notifications"); assert.equal(call.options.credentials, "same-origin"); assert.equal(call.options.cache, "no-store"); assert.equal(call.options.headers, undefined);
  for (const href of ["https://outside.example", "//outside.example", "javascript:alert(1)", "/\\outside.example", "/bad\npath"]) {
    await assert.rejects(loadSchoolNotices(new AbortController().signal, async () => Response.json({ items: [{ ...notice, href }] })), /No se pudieron actualizar/);
  }
  for (const items of [[notice, notice], [{ ...notice, createdAt: "bad" }], [{ ...notice, readAt: false }], [{ ...notice, id: "invalid" }]]) {
    await assert.rejects(loadSchoolNotices(new AbortController().signal, async () => Response.json({ items })), /No se pudieron actualizar/);
  }
});

test("notification transport rejects non-OK and malformed PATCH confirmation without exposing upstream data", async () => {
  for (const status of [401, 403, 404, 503]) {
    await assert.rejects(confirmNoticeRead(notice.id, new AbortController().signal, async () => Response.json({ read: true, error: "private upstream detail" }, { status })), error => !error.message.includes("private upstream detail"));
  }
  for (const payload of [{}, { read: false }, { read: "true" }]) await assert.rejects(confirmNoticeRead(notice.id, new AbortController().signal, async () => Response.json(payload)), /No se pudo confirmar/);
  let request;
  await confirmNoticeRead(notice.id, new AbortController().signal, async (url, options) => { request = { url, options }; return Response.json({ read: true }); });
  assert.equal(request.options.method, "PATCH"); assert.deepEqual(JSON.parse(request.options.body), { id: notice.id }); assert.equal(request.options.credentials, "same-origin");
});

test("notification polling preserves valid list on errors, backs off and resumes thirty-second interval on success", async () => {
  const fake = browserRuntime(); const controller = createNotificationController(fake.runtime); controller.start();
  await fake.respond(0); assert.equal(fake.state.snapshot.loaded, true); assert.equal(fake.state.snapshot.items.length, 1);
  assert.equal([...fake.state.timers.values()][0].delay, 30_000); fake.tick();
  await fake.respond(1, { error: "private upstream detail" }, 503);
  assert.deepEqual(fake.state.snapshot.items, [notice]); assert.match(fake.state.snapshot.error, /No se pudieron actualizar/);
  assert.equal([...fake.state.timers.values()][0].delay, 60_000); fake.tick();
  await fake.respond(2, { items: null }); assert.equal([...fake.state.timers.values()][0].delay, 120_000);
  controller.refresh(); await fake.respond(3); assert.equal(fake.state.snapshot.error, ""); assert.equal([...fake.state.timers.values()][0].delay, 30_000);
  controller.dispose();
});

test("notification reads do not overlap when opened or refreshed repeatedly during an active request", async () => {
  const fake = browserRuntime(); const controller = createNotificationController(fake.runtime); controller.start();
  controller.refresh(); controller.refresh(); controller.refresh(); assert.equal(fake.state.calls.length, 1);
  await fake.respond(0); assert.equal(fake.state.calls.length, 2); assert.equal(fake.state.timers.size, 0);
  await fake.respond(1); assert.equal(fake.state.timers.size, 1); controller.dispose();
});

test("hidden and offline tabs pause polling, abort active requests and refresh once on return", async () => {
  const fake = browserRuntime(); fake.state.visible = false; const controller = createNotificationController(fake.runtime); controller.start();
  assert.equal(fake.state.calls.length, 0); assert.equal(fake.state.timers.size, 0);
  fake.state.visible = true; fake.event("visibilitychange"); assert.equal(fake.state.calls.length, 1);
  fake.state.online = false; fake.event("offline"); assert.equal(fake.state.calls[0].options.signal.aborted, true); assert.equal(fake.state.snapshot.online, false);
  await fake.respond(0); assert.equal(fake.state.snapshot.loaded, false); assert.equal(fake.state.timers.size, 0);
  fake.state.online = true; fake.event("online"); assert.equal(fake.state.calls.length, 2); await fake.respond(1);
  fake.state.visible = false; fake.event("visibilitychange"); assert.equal(fake.state.timers.size, 0);
  fake.state.visible = true; fake.event("visibilitychange"); assert.equal(fake.state.calls.length, 3); controller.dispose();
});

test("cleanup prevents late state updates, navigation and future timers or requests", async () => {
  const fake = browserRuntime(); const controller = createNotificationController(fake.runtime); controller.start(); const changes = fake.state.changes.length;
  controller.dispose(); assert.equal(fake.state.calls[0].options.signal.aborted, true);
  await fake.respond(0); fake.event("online"); fake.event("visibilitychange"); controller.refresh(); controller.mark(notice);
  assert.equal(fake.state.changes.length, changes); assert.equal(fake.state.calls.length, 1); assert.equal(fake.state.timers.size, 0); assert.equal(fake.state.navigations.length, 0);
  assert.ok([...fake.state.listeners.values()].every(listeners => listeners.size === 0));
});

test("marking is serialized with reads, changes unread only after confirmed success and navigates once", async () => {
  const fake = browserRuntime(); const controller = createNotificationController(fake.runtime); controller.start(); await fake.respond(0);
  controller.refresh(); controller.mark(notice); controller.mark(notice); assert.equal(fake.state.calls.length, 2); assert.equal(fake.state.snapshot.markingId, notice.id);
  await fake.respond(1); assert.equal(fake.state.calls.length, 3); assert.equal(fake.state.calls[2].options.method, "PATCH");
  assert.equal(fake.state.snapshot.confirmedReadIds.length, 0); assert.equal(fake.state.navigations.length, 0);
  controller.refresh(); await fake.respond(2, { read: true });
  assert.deepEqual(fake.state.snapshot.confirmedReadIds, [notice.id]); assert.deepEqual(fake.state.navigations, ["/tareas"]); assert.equal(fake.state.calls[3].options.method, undefined);
  await fake.respond(3, { items: [{ ...notice, readAt: "2026-10-08T10:01:00Z" }] });
  assert.equal(fake.state.snapshot.confirmedReadIds.length, 0); assert.equal(fake.state.snapshot.items[0].readAt, "2026-10-08T10:01:00Z"); controller.dispose();
});

test("failed or uncertain mark stays unread, never auto-retries PATCH, and allows explicit retry", async () => {
  const fake = browserRuntime(); const controller = createNotificationController(fake.runtime); controller.start(); await fake.respond(0);
  controller.mark(notice); await fake.respond(1, { read: true }, 503);
  assert.equal(fake.state.snapshot.confirmedReadIds.length, 0); assert.equal(fake.state.snapshot.items[0].readAt, null); assert.equal(fake.state.navigations.length, 0); assert.match(fake.state.snapshot.markError, /No se pudo confirmar/);
  fake.tick(); assert.equal(fake.state.calls[2].options.method, undefined); await fake.respond(2); assert.equal(fake.state.snapshot.markError, "");
  controller.mark(notice); await fake.respond(3, { read: false }); assert.equal(fake.state.navigations.length, 0);
  controller.mark(notice); fake.state.visible = false; fake.event("visibilitychange"); assert.equal(fake.state.calls[4].options.signal.aborted, true);
  await fake.respond(4, { read: true }); assert.equal(fake.state.navigations.length, 0); assert.equal(fake.state.snapshot.confirmedReadIds.length, 0); assert.match(fake.state.snapshot.markError, /No se pudo confirmar/); controller.dispose();
});

test("lost session clears private notices and cancels a queued mark", async () => {
  const fake = browserRuntime(); const controller = createNotificationController(fake.runtime); controller.start(); await fake.respond(0);
  controller.refresh(); controller.mark(notice); await fake.respond(1, { items: [notice] }, 401);
  assert.equal(fake.state.snapshot.items.length, 0); assert.equal(fake.state.snapshot.loaded, false); assert.equal(fake.state.snapshot.markingId, ""); assert.match(fake.state.snapshot.error, /sesión terminó/);
  assert.ok(fake.state.calls.every(call => call.options.method !== "PATCH")); controller.dispose();
});

test("notification delay is bounded and invalid failure counts stay at the normal interval", () => {
  assert.deepEqual([0, 1, 2, 3, 100].map(notificationPollDelay), [30_000, 60_000, 120_000, 120_000, 120_000]);
  assert.equal(notificationPollDelay(-1), 30_000); assert.equal(notificationPollDelay(Number.NaN), 30_000);
});

function componentHarness(subscribeRealtime) {
  const fake = browserRuntime(); fake.state.realtimeListeners = new Set(); const hooks = []; let cursor = 0; const pending = [];
  const react = {
    useId: () => "notifications-synthetic", useState: initial => { const index = cursor++; hooks[index] ??= { value: initial }; return [hooks[index].value, next => { hooks[index].value = typeof next === "function" ? next(hooks[index].value) : next; }]; },
    useRef: initial => { const index = cursor++; return hooks[index] ??= { current: initial }; },
    useEffect: (effect, deps) => { const index = cursor++; if (!hooks[index] || deps.some((dep, i) => dep !== hooks[index].deps[i])) { hooks[index]?.cleanup?.(); const current = { deps, effect }; hooks[index] = current; pending.push(() => { current.cleanup = effect(); }); } },
  };
  const jsx = (type, props) => ({ type, props }); const router = { push: href => fake.state.navigations.push(href) };
  const dependencies = { react, "react/jsx-runtime": { jsx, jsxs: jsx }, "next/navigation": { useRouter: () => router },
    "@/lib/school-realtime-client": { subscribeSchoolRealtime: subscribeRealtime ?? (listener => { fake.state.realtimeListeners.add(listener); return () => fake.state.realtimeListeners.delete(listener); }) },
    "@/lib/notification-client": { INITIAL_NOTIFICATION_STATE, createNotificationController: runtime => createNotificationController({ ...runtime, fetcher: fake.fetcher }) }, "./notification-center.module.css": { default: {}, __esModule: true } };
  const sandboxModule = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(new URL("../components/notification-center.tsx", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInContext(source, vm.createContext({ module: sandboxModule, exports: sandboxModule.exports, require: name => { if (!dependencies[name]) throw new Error(`Unexpected dependency ${name}`); return dependencies[name]; },
    navigator: { get onLine() { return fake.state.online; } }, document: { get visibilityState() { return fake.state.visible ? "visible" : "hidden"; }, addEventListener: fake.listen, removeEventListener: fake.unlisten },
    window: { addEventListener: fake.listen, removeEventListener: fake.unlisten, setTimeout: fake.runtime.setTimer, clearTimeout: fake.runtime.clearTimer } }), { filename: "components/notification-center.tsx" });
  return { ...fake, realtime: update => [...fake.state.realtimeListeners].forEach(listener => listener(update)), render: () => { cursor = 0; return sandboxModule.exports.NotificationCenter(); }, runEffects: () => pending.splice(0).forEach(effect => effect()), cleanup: () => hooks.forEach(hook => hook.cleanup?.()), replayEffects: () => hooks.filter(hook => hook.effect).forEach(hook => { hook.cleanup?.(); hook.cleanup = hook.effect(); }) };
}
function elements(tree, type) { const found = []; function walk(value) { if (!value || typeof value !== "object") return; if (Array.isArray(value)) { value.forEach(walk); return; } if (value.type === type) found.push(value); walk(value.props?.children); } walk(tree); return found; }
function text(value) { if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" ? text(value.props?.children) : typeof value === "string" || typeof value === "number" ? String(value) : ""; }

test("closing the real notice panel restores focus to its Avisos trigger", () => {
  const fake = componentHarness(); let tree = fake.render();
  const trigger = elements(tree, "button")[0];
  let focusCalls = 0;
  trigger.props.ref.current = { focus: () => { focusCalls++; } };
  trigger.props.onClick(); tree = fake.render();
  assert.equal(elements(tree, "button")[0].props["aria-expanded"], true);
  elements(tree, "button").find(button => text(button) === "Cerrar").props.onClick();
  tree = fake.render();
  assert.equal(focusCalls, 1);
  assert.equal(elements(tree, "button")[0].props["aria-expanded"], false);
  assert.equal(elements(tree, "section").length, 0);
  fake.cleanup();
});

test("actual notification component effects show loading, confirmed empty and failure/retry without false empty or replacing valid rows", async () => {
  const fake = componentHarness(); let tree = fake.render(); fake.runEffects();
  elements(tree, "button")[0].props.onClick(); tree = fake.render(); assert.match(text(tree), /Cargando avisos/); assert.doesNotMatch(text(tree), /No tienes avisos disponibles/);
  await fake.respond(0, { items: [] }); await fake.respond(1, { items: [] }); tree = fake.render(); assert.match(text(tree), /No tienes avisos disponibles/);
  fake.tick(); await fake.respond(2); tree = fake.render(); assert.match(text(tree), /Nueva tarea sintética/);
  fake.tick(); await fake.respond(3, { error: "private backend detail" }, 503); tree = fake.render(); assert.match(text(tree), /Nueva tarea sintética/); assert.match(text(tree), /No se pudieron actualizar/); assert.doesNotMatch(text(tree), /private backend detail/);
  assert.ok(elements(tree, "p").some(p => p.props.role === "alert"));
  elements(tree, "button").find(button => text(button) === "Actualizar avisos").props.onClick(); await fake.respond(4); tree = fake.render(); assert.doesNotMatch(text(tree), /No se pudieron actualizar/);
  assert.match(text(tree), /cada 30 segundos/); fake.cleanup();
});

test("actual notification component keeps failed mark unread and disables duplicate action while awaiting confirmation", async () => {
  const fake = componentHarness(); let tree = fake.render(); fake.runEffects(); await fake.respond(0);
  elements(tree, "button")[0].props.onClick(); await fake.respond(1); tree = fake.render();
  const row = () => elements(fake.render(), "button").find(button => button.props["aria-label"]?.startsWith(notice.title));
  row().props.onClick(); tree = fake.render(); assert.equal(row().props.disabled, true); assert.match(text(tree), /Confirmando/); assert.equal(fake.state.navigations.length, 0);
  await fake.respond(2, { read: false }); assert.match(row().props["aria-label"], /sin leer/); assert.equal(fake.state.navigations.length, 0); assert.match(text(fake.render()), /No se pudo confirmar/);
  row().props.onClick(); await fake.respond(3, { read: true }); assert.match(row().props["aria-label"], /, leído/); assert.deepEqual(fake.state.navigations, ["/tareas"]);
  const changesBefore = text(fake.render()); fake.cleanup(); await fake.respond(4); assert.equal(text(fake.render()), changesBefore); assert.equal(fake.state.timers.size, 0);
});

test("actual notification component effects unsubscribe and pause offline without background requests", async () => {
  const fake = componentHarness(); fake.state.online = false; let tree = fake.render(); fake.runEffects(); elements(tree, "button")[0].props.onClick(); tree = fake.render();
  assert.match(text(tree), /Sin conexión/); assert.equal(fake.state.calls.length, 0);
  fake.state.online = true; fake.event("online"); await fake.respond(0);
  fake.state.visible = false; fake.event("visibilitychange"); assert.equal(fake.state.timers.size, 0);
  fake.state.visible = true; fake.event("visibilitychange"); assert.equal(fake.state.calls.length, 2); fake.cleanup(); assert.equal(fake.state.calls[1].options.signal.aborted, true);
  await fake.respond(1); fake.event("online"); assert.equal(fake.state.calls.length, 2);
});


test("network failures preserve cached notices and never expose browser error details", async () => {
  const fake = browserRuntime(); const controller = createNotificationController(fake.runtime); controller.start(); await fake.respond(0);
  fake.tick(); fake.state.calls[1].reject(new TypeError("private connection detail")); await settle();
  assert.deepEqual(fake.state.snapshot.items, [notice]); assert.match(fake.state.snapshot.error, /No se pudieron actualizar/); assert.doesNotMatch(fake.state.snapshot.error, /private connection detail/);
  controller.mark(notice); fake.state.calls[2].reject(new TypeError("private connection detail")); await settle();
  assert.equal(fake.state.snapshot.confirmedReadIds.length, 0); assert.equal(fake.state.navigations.length, 0); assert.match(fake.state.snapshot.markError, /No se pudo confirmar/); controller.dispose();
});

test("actual notification Strict Mode effect replay aborts the first controller and leaves one subscribed poller", async () => {
  const fake = componentHarness(); fake.render(); fake.runEffects(); fake.replayEffects();
  assert.equal(fake.state.calls.length, 2); assert.equal(fake.state.calls[0].options.signal.aborted, true);
  assert.ok([...fake.state.listeners.values()].every(listeners => listeners.size === 1));
  await fake.respond(0, { items: [] }); await fake.respond(1); assert.equal(fake.state.timers.size, 1);
  let tree = fake.render(); elements(tree, "button")[0].props.onClick(); tree = fake.render(); assert.match(text(tree), /Nueva tarea sintética/);
  fake.cleanup(); await fake.respond(2); assert.equal(fake.state.timers.size, 0);
});


test("a refreshed list that removes a queued notice cancels its mark and navigation", async () => {
  const fake = browserRuntime(); const controller = createNotificationController(fake.runtime); controller.start(); await fake.respond(0);
  controller.refresh(); controller.mark(notice); await fake.respond(1, { items: [] });
  assert.equal(fake.state.snapshot.markingId, ""); assert.match(fake.state.snapshot.markError, /ya no está disponible/);
  assert.equal(fake.state.navigations.length, 0); assert.ok(fake.state.calls.every(call => call.options.method !== "PATCH")); controller.dispose();
});


test("actual notice effects refresh on connected and notification invalidations, coalesce bursts and retain polling fallback", async () => {
  const fake = componentHarness(); let tree = fake.render(); fake.runEffects(); await fake.respond(0);
  assert.equal(fake.state.realtimeListeners.size, 1);
  fake.realtime({ type: "status", status: "connecting" }); fake.realtime({ type: "status", status: "connected" });
  assert.equal(fake.state.calls.length, 2);
  fake.realtime({ type: "status", status: "connected" });
  fake.realtime({ type: "invalidate", scope: "notifications" }); fake.realtime({ type: "invalidate", scope: "notifications" });
  fake.realtime({ type: "invalidate", scope: "messages", conversationId: notice.id }); assert.equal(fake.state.calls.length, 2);
  await fake.respond(1); assert.equal(fake.state.calls.length, 3); await fake.respond(2);
  elements(tree, "button")[0].props.onClick(); tree = fake.render(); assert.match(text(tree), /Conexión de avisos en vivo activa/); await fake.respond(3);
  fake.realtime({ type: "status", status: "reconnecting" }); assert.match(text(fake.render()), /Reconectando/);
  fake.tick(); assert.equal(fake.state.calls.length, 5); await fake.respond(4);
  fake.realtime({ type: "status", status: "disabled" }); assert.match(text(fake.render()), /Actualización de avisos por consultas periódicas/); assert.doesNotMatch(text(fake.render()), /Conexión de avisos en vivo activa/);
  assert.equal([...fake.state.timers.values()][0].delay, 30_000); fake.cleanup();
});

test("notice signal cleanup removes subscription and ignores late events; offline invalidations cannot start requests", async () => {
  const fake = componentHarness(); fake.render(); fake.runEffects(); await fake.respond(0);
  fake.state.online = false; fake.event("offline"); fake.realtime({ type: "invalidate", scope: "notifications" }); assert.equal(fake.state.calls.length, 1);
  const late = [...fake.state.realtimeListeners][0]; fake.cleanup(); const before = text(fake.render());
  late({ type: "status", status: "connected" }); late({ type: "invalidate", scope: "notifications" });
  assert.equal(fake.state.realtimeListeners.size, 0); assert.equal(fake.state.calls.length, 1); assert.equal(text(fake.render()), before);
});


test("real shared SSE client invalidates the mounted notice component through private API and cleans up its last subscriber", async () => {
  const signals = new Map(); const timers = new Map(); let timerId = 0; let closed = 0; const configRequests = []; const streamUrls = [];
  const stream = { addEventListener: (name, listener) => signals.set(name, listener), close: () => { closed++; } };
  const realtime = createSchoolRealtimeClient({
    fetcher: async (url, options) => { configRequests.push({ url, options }); return Response.json({ enabled: true }); }, openStream: url => { streamUrls.push(url); return stream; },
    isOnline: () => true, isVisible: () => true, subscribeEnvironment: () => () => {},
    setTimer: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; }, clearTimer: id => timers.delete(id),
  });
  const fake = componentHarness(listener => realtime.subscribe(listener)); let tree = fake.render(); fake.runEffects(); await fake.respond(0);
  const otherConsumer = realtime.subscribe(() => {}); assert.equal(configRequests.length, 1); assert.deepEqual(streamUrls, ["/api/realtime/events"]);
  assert.equal(configRequests[0].url, "/api/realtime/config"); assert.equal(configRequests[0].options.credentials, "same-origin"); assert.equal(configRequests[0].options.headers, undefined);
  signals.get("ready")({ data: "{}" }); assert.equal(fake.state.calls.length, 2);
  signals.get("invalidate")({ data: JSON.stringify({ scope: "notifications" }) }); signals.get("invalidate")({ data: JSON.stringify({ scope: "notifications" }) });
  signals.get("invalidate")({ data: JSON.stringify({ scope: "notifications", secret: "ignored-invalid-signal" }) }); assert.equal(fake.state.calls.length, 2);
  await fake.respond(1); assert.equal(fake.state.calls.length, 3); await fake.respond(2);
  elements(tree, "button")[0].props.onClick(); tree = fake.render(); assert.match(text(tree), /Conexión de avisos en vivo activa/); await fake.respond(3);
  otherConsumer(); assert.equal(closed, 0); fake.cleanup(); assert.equal(closed, 1); assert.equal(timers.size, 0); assert.equal(fake.state.timers.size, 0);
});

test("real shared client disabled configuration preserves periodic notice loading without opening an event stream", async () => {
  let streams = 0; const realtime = createSchoolRealtimeClient({ fetcher: async () => Response.json({ enabled: false }), openStream: () => { streams++; throw new Error("Disabled must not open SSE"); },
    isOnline: () => true, isVisible: () => true, subscribeEnvironment: () => () => {}, setTimer: () => 1, clearTimer: () => {} });
  const fake = componentHarness(listener => realtime.subscribe(listener)); let tree = fake.render(); fake.runEffects(); await fake.respond(0);
  elements(tree, "button")[0].props.onClick(); await fake.respond(1); tree = fake.render();
  assert.equal(streams, 0); assert.match(text(tree), /Actualización de avisos por consultas periódicas/); assert.doesNotMatch(text(tree), /Conexión de avisos en vivo activa/);
  assert.equal([...fake.state.timers.values()][0].delay, 30_000); fake.cleanup();
});

test("all invalidation after permission verification reloads notice API once with burst coalescence", async () => {
  const fake = componentHarness(); fake.render(); fake.runEffects(); await fake.respond(0);
  fake.realtime({ type: "invalidate", scope: "all" }); fake.realtime({ type: "invalidate", scope: "all" }); assert.equal(fake.state.calls.length, 2);
  await fake.respond(1); assert.equal(fake.state.calls.length, 3); await fake.respond(2); assert.equal(fake.state.calls.length, 3); fake.cleanup();
});
