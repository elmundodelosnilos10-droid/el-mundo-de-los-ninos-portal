import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { SCHOOL_UPLOAD_MAX_FILE_BYTES, SCHOOL_UPLOAD_LIMIT_LABEL, SCHOOL_UPLOAD_SIZE_MESSAGE, SCHOOL_UPLOAD_UNAVAILABLE_MESSAGE, readSchoolUploadResponse } from "../lib/school-upload-limits.ts";
import { DEFAULT_COMMUNICATION_HOURS } from "../lib/communication-hours-policy.ts";
import { CHAT_POLL_BASE_DELAY_MS, chatPollDelayForFailures } from "../lib/polling-policy.ts";

const contact = { studentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", studentName: "Alumno sintético", teacherId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", teacherName: "Docente sintética" };
const conversation = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", studentId: contact.studentId, studentName: contact.studentName, studentFamilyName: "Prueba" };
const jsx = (type, props) => ({ type, props });
function compile(file, dependencies, globals = {}) {
  const sandboxModule = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInContext(source, vm.createContext({ module: sandboxModule, exports: sandboxModule.exports, require: name => { if (!dependencies[name]) throw new Error(`Unexpected dependency ${name}`); return dependencies[name]; }, ...globals }), { filename: file });
  return sandboxModule.exports;
}
function elements(tree, type) { const found = []; function walk(value) { if (!value || typeof value !== "object") return; if (Array.isArray(value)) { value.forEach(walk); return; } if (value.type === type) found.push(value); walk(value.props?.children); } walk(tree); return found; }
function text(value) { if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" ? text(value.props?.children) : typeof value === "string" || typeof value === "number" ? String(value) : ""; }
const settle = () => new Promise(resolve => setImmediate(resolve));

function pageHarness(roles) {
  const state = { actor: { id: "synthetic-school-user", name: "Cuenta sintética", roles, supabaseAuth: { userId: "synthetic-school-user", accessToken: "synthetic-school-jwt" } }, calls: [], d1: 0, hours: [], rejected: false, storageReady: true, scannerReady: true };
  const failD1 = () => { state.d1++; throw new Error("D1 must not run in Supabase mode"); };
  const dependencies = {
    "react/jsx-runtime": { jsx, jsxs: jsx }, "@/lib/runtime/env": { env: { SCHOOL_DATA_PROVIDER: "supabase" } }, "next/headers": { headers: async () => new Headers() }, "next/navigation": { redirect: route => { throw new Error(`redirect:${route}`); } },
    "drizzle-orm": {}, "@/db": { getDb: failD1 }, "@/db/schema": {}, "@/lib/supabase/page-actor": { getSchoolPageActor: async () => state.actor },
    "@/lib/file-scanner": { isFileScannerConfigured: () => state.scannerReady }, "@/lib/file-storage": { isFileStorageConfigured: () => state.storageReady },
    "@/lib/access": { hasRole: (actor, ...allowed) => allowed.some(role => actor.roles.includes(role)) },
    "@/lib/communication-hours": { getCommunicationHours: async actor => { state.hours.push(actor); return DEFAULT_COMMUNICATION_HOURS; } },
    "@/components/portal-shell": { PortalShell: "PortalShell" }, "./communication-hours-form": { CommunicationHoursForm: "CommunicationHoursForm" }, "./messaging-panel": { MessagingPanel: "MessagingPanel" },
    "@/lib/supabase/database": { createSchoolDatabaseClient: () => ({ rpc: async (jwt, name) => { state.calls.push({ jwt, name }); if (state.rejected) throw new Error("RPC unavailable"); return { data: [{ items: [contact] }] }; } }) },
  };
  return { state, ...compile("app/comunicacion/page.tsx", dependencies, { Headers }) };
}

test("real communication page never requests private contacts for administrative-only accounts and retains hours form", async () => {
  for (const roles of [["superadmin"], ["direccion"], ["superadmin", "direccion"]]) {
    const fake = pageHarness(roles); const tree = await fake.default();
    assert.equal(fake.state.calls.length, 0); assert.equal(fake.state.d1, 0); assert.equal(fake.state.hours[0], fake.state.actor);
    assert.equal(elements(tree, "CommunicationHoursForm").length, 1);
    const panel = elements(tree, "MessagingPanel")[0]; assert.equal(panel.props.canMessage, false); assert.equal(panel.props.contacts.length, 0);
    assert.doesNotMatch(text(tree), /No se pudo cargar la lista de contactos/);
  }
});

test("real communication page allows contacts only for an actual teacher/family role, including mixed roles", async () => {
  for (const roles of [["docente"], ["tutor"], ["superadmin", "docente"], ["direccion", "tutor"]]) {
    const fake = pageHarness(roles); const tree = await fake.default();
    assert.deepEqual(fake.state.calls, [{ jwt: "synthetic-school-jwt", name: "school_conversation_contacts" }]); assert.equal(fake.state.d1, 0);
    const panel = elements(tree, "MessagingPanel")[0]; assert.equal(panel.props.canMessage, true); assert.equal(panel.props.contacts.length, 1); assert.equal(panel.props.contacts[0], contact);
  }
  const fake = pageHarness(["alumno"]); const tree = await fake.default(); assert.equal(fake.state.calls.length, 0); assert.equal(elements(tree, "MessagingPanel")[0].props.canMessage, false);
});

test("authorized contacts lookup failure remains a genuine visible error", async () => {
  const fake = pageHarness(["docente"]); fake.state.rejected = true; const tree = await fake.default();
  assert.match(text(tree), /No se pudo cargar la lista de contactos del chat/); assert.equal(fake.state.calls.length, 1); assert.equal(fake.state.d1, 0);
});

function panelHarness(canMessage = false, FormDataConstructor = FormData, uploadsReady = true) {
  const state = { canMessage, uploadsReady, online: true, visible: true, routeRefreshes: 0, reloads: 0, deadlines: [], realtimeListeners: new Set(), calls: [], hooks: [], cursor: 0, pending: [], listeners: new Map(), timers: new Map(), timerId: 0 };
  const react = {
    useState: initial => { const index = state.cursor++; state.hooks[index] ??= { value: initial }; return [state.hooks[index].value, next => { state.hooks[index].value = typeof next === "function" ? next(state.hooks[index].value) : next; }]; },
    useRef: initial => { const index = state.cursor++; return state.hooks[index] ??= { current: initial }; },
    useCallback: (callback, deps) => { const index = state.cursor++; const previous = state.hooks[index]; if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) state.hooks[index] = { deps, callback }; return state.hooks[index].callback; },
    useEffect: (effect, deps) => { const index = state.cursor++; const previous = state.hooks[index]; if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) { previous?.cleanup?.(); const current = { deps }; state.hooks[index] = current; state.pending.push(() => { current.cleanup = effect(); }); } },
  };
  function listen(type, listener) { if (!state.listeners.has(type)) state.listeners.set(type, new Set()); state.listeners.get(type).add(listener); }
  function unlisten(type, listener) { state.listeners.get(type)?.delete(listener); }
  const router = { refresh: () => { state.routeRefreshes++; } };
  const dependencies = { react, "@/lib/school-upload-limits": { SCHOOL_UPLOAD_MAX_FILE_BYTES, SCHOOL_UPLOAD_LIMIT_LABEL, SCHOOL_UPLOAD_SIZE_MESSAGE, SCHOOL_UPLOAD_UNAVAILABLE_MESSAGE, readSchoolUploadResponse }, "next/navigation": { useRouter: () => router }, "@/lib/school-realtime-client": { subscribeSchoolRealtime: listener => { state.realtimeListeners.add(listener); return () => state.realtimeListeners.delete(listener); } }, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" }, "@/lib/polling-policy": { CHAT_POLL_BASE_DELAY_MS, chatPollDelayForFailures } };
  const loaded = compile("app/comunicacion/messaging-panel.tsx", dependencies, {
    AbortController, DOMException, AbortSignal: { any: AbortSignal.any, timeout: delay => { const controller = new AbortController(); state.deadlines.push({ delay, controller }); return controller.signal; } }, URLSearchParams, FormData: FormDataConstructor, File, Error, navigator: { get onLine() { return state.online; } }, document: { get visibilityState() { return state.visible ? "visible" : "hidden"; }, addEventListener: listen, removeEventListener: unlisten },
    window: { location: { reload: () => { state.reloads++; } }, addEventListener: listen, removeEventListener: unlisten, setTimeout: (callback, delay) => { const id = ++state.timerId; state.timers.set(id, { callback, delay }); return id; }, clearTimeout: id => state.timers.delete(id) },
    fetch: (url, options) => new Promise((resolve, reject) => state.calls.push({ url, options, resolve, reject })),
  });
  function render() { state.cursor = 0; return loaded.MessagingPanel({ canMessage: state.canMessage, contacts: [contact], communicationHours: DEFAULT_COMMUNICATION_HOURS, uploadsReady: state.uploadsReady }); }
  function effects() { state.pending.splice(0).forEach(effect => effect()); }
  async function respond(index, payload, status = 200) { state.calls[index].resolve(Response.json(payload, { status })); await settle(); }
  return { state, render, effects, respond, realtime: update => [...state.realtimeListeners].forEach(listener => listener(update)), cleanup: () => state.hooks.forEach(hook => hook.cleanup?.()) };
}

test("real messaging panel effects make zero conversation requests and show informative private-chat scope for admin-only access", () => {
  const fake = panelHarness(); const tree = fake.render(); fake.effects();
  assert.equal(fake.state.calls.length, 0); assert.equal(fake.state.timers.size, 0); assert.equal(fake.state.listeners.size, 0);
  assert.match(text(tree), /Chat privado de docentes y familias/); assert.match(text(tree), /Tu cuenta no tiene habilitado este chat/);
  assert.doesNotMatch(text(tree), /Aún no hay conversaciones|No se cargaron|Escribe el primer mensaje/);
  assert.equal(elements(tree, "form").length, 0); assert.equal(elements(tree, "a")[0].props.href, "/comunicados"); fake.cleanup();
});

test("real messaging panel fetches for authorized role, aborts loading when permission is removed and ignores late private history", async () => {
  const fake = panelHarness(true); fake.render(); fake.effects(); assert.equal(fake.state.calls.length, 1); assert.equal(fake.state.calls[0].url, "/api/conversations");
  fake.state.canMessage = false; let tree = fake.render(); fake.effects(); assert.equal(fake.state.calls[0].options.signal.aborted, true);
  await fake.respond(0, { items: [conversation] }); tree = fake.render(); assert.doesNotMatch(text(tree), /Alumno sintético|Abrir chat/); assert.equal(fake.state.calls.length, 1);
  fake.state.canMessage = true; fake.render(); fake.effects(); assert.equal(fake.state.calls.length, 2); await fake.respond(1, { items: [conversation] });
  assert.match(text(fake.render()), /Abrir chat/); fake.cleanup();
});

test("real active chat polling cancels requests and listeners when the account loses chat access", async () => {
  const fake = panelHarness(true); fake.render(); fake.effects(); await fake.respond(0, { items: [conversation] });
  elements(fake.render(), "button").find(button => text(button).startsWith("Abrir chat")).props.onClick(); fake.render(); fake.effects();
  assert.equal(fake.state.calls.length, 2); assert.equal(fake.state.calls[1].url, `/api/conversations/${conversation.id}/messages`);
  fake.state.canMessage = false; const tree = fake.render(); fake.effects(); assert.equal(fake.state.calls[1].options.signal.aborted, true);
  assert.ok([...fake.state.listeners.values()].every(listeners => listeners.size === 0)); assert.equal(fake.state.timers.size, 0); assert.match(text(tree), /Tu cuenta no tiene habilitado/);
  await fake.respond(1, { items: [{ id: "message-synthetic", isMine: false, readAt: null, order: "2026-10-08T10:00:00Z|message-synthetic" }] });
  assert.equal(fake.state.calls.length, 2); fake.cleanup();
});


test("authorized chat signals coalesce current-chat polls, filter unrelated notices and refresh another conversation list only", async () => {
  const fake = panelHarness(true); fake.render(); fake.effects(); await fake.respond(0, { items: [conversation] });
  assert.equal(fake.state.realtimeListeners.size, 1);
  elements(fake.render(), "button").find(button => text(button).startsWith("Abrir chat")).props.onClick(); fake.render(); fake.effects();
  assert.equal(fake.state.calls.length, 2);
  fake.realtime({ type: "status", status: "connected" });
  fake.realtime({ type: "invalidate", scope: "messages", conversationId: conversation.id });
  fake.realtime({ type: "invalidate", scope: "messages", conversationId: conversation.id });
  fake.realtime({ type: "invalidate", scope: "notifications" }); assert.equal(fake.state.calls.length, 2);
  await fake.respond(1, { items: [] }); assert.equal(fake.state.calls[2].url, "/api/conversations");
  await fake.respond(2, { items: [conversation] }); assert.equal(fake.state.calls[3].url, `/api/conversations/${conversation.id}/messages`);
  await fake.respond(3, { items: [] }); await fake.respond(4, { items: [conversation] });
  assert.equal(fake.state.calls.length, 5); assert.ok([...fake.state.timers.values()].some(timer => timer.delay === 10_000));
  fake.realtime({ type: "invalidate", scope: "messages", conversationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" });
  assert.equal(fake.state.calls[5].url, "/api/conversations"); await fake.respond(5, { items: [conversation] });
  assert.match(text(fake.render()), /Conexión del chat en vivo activa/);
  fake.realtime({ type: "status", status: "disabled" }); assert.match(text(fake.render()), /consultas periódicas cada 10 segundos/); assert.doesNotMatch(text(fake.render()), /Conexión del chat en vivo activa/); fake.cleanup();
});

test("chat connects after missed events with serialized list reload and coalesced router refresh for hours", async () => {
  const fake = panelHarness(true); fake.render(); fake.effects();
  fake.realtime({ type: "status", status: "connected" }); fake.realtime({ type: "status", status: "connected" });
  fake.realtime({ type: "invalidate", scope: "communication" }); fake.realtime({ type: "invalidate", scope: "communication" });
  assert.equal(fake.state.calls.length, 1); assert.equal(fake.state.timers.size, 1);
  await fake.respond(0, { items: [conversation] }); assert.equal(fake.state.calls.length, 2); await fake.respond(1, { items: [conversation] });
  const [id, timer] = [...fake.state.timers.entries()].find(([, value]) => value.delay === 200); fake.state.timers.delete(id); timer.callback(); assert.equal(fake.state.routeRefreshes, 1);
  fake.realtime({ type: "status", status: "reconnecting" }); fake.realtime({ type: "status", status: "connected" });
  assert.equal(fake.state.calls.length, 3); assert.equal(fake.state.timers.size, 1); fake.cleanup(); await fake.respond(2, { items: [conversation] });
});

test("administrative chat does not subscribe to private signals; authorized cleanup rejects late invalidations and settings refresh", async () => {
  const admin = panelHarness(false); admin.render(); admin.effects(); admin.realtime({ type: "status", status: "connected" }); admin.realtime({ type: "invalidate", scope: "communication" });
  assert.equal(admin.state.realtimeListeners.size, 0); assert.equal(admin.state.calls.length, 0); assert.equal(admin.state.routeRefreshes, 0); admin.cleanup();
  const fake = panelHarness(true); fake.render(); fake.effects(); await fake.respond(0, { items: [conversation] });
  const late = [...fake.state.realtimeListeners][0]; fake.realtime({ type: "invalidate", scope: "communication" }); fake.cleanup();
  late({ type: "status", status: "connected" }); late({ type: "invalidate", scope: "messages", conversationId: conversation.id }); late({ type: "invalidate", scope: "communication" });
  assert.equal(fake.state.realtimeListeners.size, 0); assert.equal(fake.state.calls.length, 1); assert.equal(fake.state.timers.size, 0); assert.equal(fake.state.routeRefreshes, 0);
});


class SyntheticChatFormData extends FormData {
  constructor(form) { super(); for (const [key, value] of form.payload.entries()) this.append(key, value); }
}
async function openSyntheticChat(fake) {
  fake.render(); fake.effects(); await fake.respond(0, { items: [conversation] });
  elements(fake.render(), "button").find(button => text(button).startsWith("Abrir chat")).props.onClick(); fake.render(); fake.effects();
  await fake.respond(1, { items: [] }); await fake.respond(2, { items: [conversation] });
}
test("chat attachment preflight blocks a file over four MiB before any upload request and shows the shared limit", async () => {
  const fake = panelHarness(true, SyntheticChatFormData); await openSyntheticChat(fake);
  const payload = new FormData(); payload.set("body", "Mensaje sintético"); payload.set("file", new File([new Uint8Array(SCHOOL_UPLOAD_MAX_FILE_BYTES + 1)], "exceso.pdf", { type: "application/pdf" }));
  let reset = false; const before = fake.state.calls.length;
  await elements(fake.render(), "form")[0].props.onSubmit({ preventDefault() {}, currentTarget: { payload, reset() { reset = true; } } });
  assert.equal(fake.state.calls.length, before); assert.equal(reset, false); assert.match(text(fake.render()), /máximo 4 MB/);
  assert.equal(elements(fake.render(), "p").find(p => p.props.role === "alert").props.children, SCHOOL_UPLOAD_SIZE_MESSAGE); fake.cleanup();
});

test("chat attachment exactly at four MiB reaches the existing private POST and still requires server success", async () => {
  const fake = panelHarness(true, SyntheticChatFormData); await openSyntheticChat(fake);
  const payload = new FormData(); payload.set("body", ""); payload.set("file", new File([new Uint8Array(SCHOOL_UPLOAD_MAX_FILE_BYTES)], "limite.pdf", { type: "application/pdf" }));
  let reset = false; const request = elements(fake.render(), "form")[0].props.onSubmit({ preventDefault() {}, currentTarget: { payload, reset() { reset = true; } } });
  assert.equal(fake.state.calls[3].url, `/api/conversations/${conversation.id}/messages`); assert.equal(fake.state.calls[3].options.method, "POST");
  assert.equal(fake.state.calls[3].options.body.get("file").size, SCHOOL_UPLOAD_MAX_FILE_BYTES);
  await fake.respond(3, { error: "La verificación de archivos está pendiente." }, 503); await request;
  assert.equal(reset, false); assert.match(text(fake.render()), /La verificación de archivos está pendiente/); assert.doesNotMatch(text(fake.render()), /Mensaje enviado/); fake.cleanup();
});


test("communication page passes only a readiness boolean and disables attachments without either scanner or storage", async () => {
  for (const [storageReady, scannerReady, expected] of [[true,true,true], [false,true,false], [true,false,false], [false,false,false]]) {
    const fake = pageHarness(["docente"]); fake.state.storageReady = storageReady; fake.state.scannerReady = scannerReady;
    const tree = await fake.default(); const props = elements(tree, "MessagingPanel")[0].props;
    assert.equal(props.uploadsReady, expected); assert.deepEqual(Object.keys(props).sort(), ["canMessage", "communicationHours", "contacts", "uploadsReady"]);
  }
});

test("chat disabled attachments reject programmatic file submission without a POST while text messages remain available", async () => {
  const fake = panelHarness(true, SyntheticChatFormData, false); await openSyntheticChat(fake);
  assert.equal(elements(fake.render(), "input").find(input => input.props.id === "chat-file").props.disabled, true); assert.match(text(fake.render()), /Puedes enviar mensajes de texto/);
  const payload = new FormData(); payload.set("body", "Texto permitido"); payload.set("file", new File(["%PDF-synthetic"], "material.pdf", { type: "application/pdf" }));
  const before = fake.state.calls.length; const form = { payload, reset() {} };
  await elements(fake.render(), "form")[0].props.onSubmit({ preventDefault() {}, currentTarget: form });
  assert.equal(fake.state.calls.length, before); assert.equal(elements(fake.render(), "p").find(p => p.props.role === "alert").props.children, SCHOOL_UPLOAD_UNAVAILABLE_MESSAGE);
  payload.delete("file"); const send = elements(fake.render(), "form")[0].props.onSubmit({ preventDefault() {}, currentTarget: form });
  assert.equal(fake.state.calls[3].options.method, "POST"); assert.equal(fake.state.calls[3].options.body.get("file"), null);
  await fake.respond(3, { id: "message-synthetic" }, 201); await send; assert.match(text(fake.render()), /Mensaje enviado/); fake.cleanup();
  await fake.respond(4, { items: [] });
});

test("chat handles a hosting HTML 413 response with the shared limit message instead of a JSON parsing error", async () => {
  const fake = panelHarness(true, SyntheticChatFormData); await openSyntheticChat(fake);
  const payload = new FormData(); payload.set("file", new File(["%PDF-synthetic"], "material.pdf", { type: "application/pdf" }));
  let reset = false; const send = elements(fake.render(), "form")[0].props.onSubmit({ preventDefault() {}, currentTarget: { payload, reset() { reset = true; } } });
  fake.state.calls[3].resolve(new Response("<h1>Payload too large</h1>", { status: 413, headers: { "content-type": "text/html" } })); await settle(); await send;
  assert.equal(reset, false); assert.equal(elements(fake.render(), "p").find(p => p.props.role === "alert").props.children, SCHOOL_UPLOAD_SIZE_MESSAGE); assert.doesNotMatch(text(fake.render()), /Unexpected token|JSON|Mensaje enviado/); fake.cleanup();
});

const ownMessage = { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", body: "Mensaje actual A", sentAt: "2026-10-08T10:00:00Z", order: "2026-10-08T10:00:00Z|eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", authorName: "Cuenta sintética", isMine: true, readAt: null, file: null };
const otherConversation = { ...conversation, id: "ffffffff-ffff-4fff-8fff-ffffffffffff", studentName: "Alumno B sintético" };
function runChatTimer(fake, delay = 10_000) {
  const [id, timer] = [...fake.state.timers.entries()].find(([, value]) => value.delay === delay); fake.state.timers.delete(id); timer.callback();
}
async function openHistory(fake) {
  fake.render(); fake.effects(); await fake.respond(0, { items: [conversation, otherConversation] });
  elements(fake.render(), "button").find(button => text(button).startsWith("Abrir chat")).props.onClick(); fake.render(); fake.effects();
  await fake.respond(1, { items: [ownMessage], hasOlder: true }); await fake.respond(2, { items: [conversation, otherConversation] });
}

test("chat GET deadline frees a pending list read and active polling falls back after a twenty-second timeout", async () => {
  const list = panelHarness(true); list.render(); list.effects(); assert.equal(list.state.deadlines[0].delay, 20_000);
  const timeout = new DOMException("Synthetic deadline detail", "TimeoutError"); list.state.deadlines[0].controller.abort(timeout); list.state.calls[0].reject(timeout); await settle();
  assert.equal(list.state.calls[0].options.signal.aborted, true); assert.match(text(list.render()), /Revisa la conexión/); assert.doesNotMatch(text(list.render()), /Synthetic deadline detail/);
  list.realtime({ type: "status", status: "connected" }); assert.equal(list.state.calls.length, 2); await list.respond(1, { items: [conversation] }); list.cleanup();
  const fake = panelHarness(true); await openHistory(fake); runChatTimer(fake); assert.equal(fake.state.calls.length, 4);
  assert.ok(fake.state.deadlines.every(deadline => deadline.delay === 20_000)); fake.state.deadlines.at(-1).controller.abort(timeout); fake.state.calls[3].reject(timeout); await settle();
  assert.match(text(fake.render()), /Reintentaremos automáticamente/); assert.match(text(fake.render()), /Mensaje actual A/);
  runChatTimer(fake); assert.equal(fake.state.calls.length, 5); await fake.respond(4, { items: [ownMessage] }); await fake.respond(5, { items: [conversation, otherConversation] }); fake.cleanup();
});

test("chat read-receipt deadline schedules a fallback GET instead of replaying the pending POST", async () => {
  const fake = panelHarness(true); fake.render(); fake.effects(); await fake.respond(0, { items: [conversation] });
  elements(fake.render(), "button").find(button => text(button).startsWith("Abrir chat")).props.onClick(); fake.render(); fake.effects();
  const unread = { ...ownMessage, isMine: false }; await fake.respond(1, { items: [unread] }); assert.equal(fake.state.calls[2].url, `/api/conversations/${conversation.id}/messages/read`);
  assert.equal(fake.state.deadlines.at(-1).delay, 20_000); const timeout = new DOMException("receipt deadline", "TimeoutError"); fake.state.deadlines.at(-1).controller.abort(timeout); fake.state.calls[2].reject(timeout); await settle();
  assert.match(text(fake.render()), /Reintentaremos automáticamente/); assert.equal(fake.state.calls.filter(call => call.options.method === "POST").length, 1);
  runChatTimer(fake); assert.equal(fake.state.calls[3].options.method, undefined); fake.cleanup(); await fake.respond(3, { items: [] });
});

test("non-JSON list and message 401/403 clear private chat contents and expose a session check", async () => {
  for (const status of [401, 403]) {
    const fake = panelHarness(true); await openHistory(fake); runChatTimer(fake);
    fake.state.calls[3].resolve(new Response("<h1>private upstream access error</h1>", { status })); await settle(); const tree = fake.render(); fake.effects();
    assert.match(text(tree), /Verifica tu acceso al chat/); assert.doesNotMatch(text(tree), /Mensaje actual A|Alumno sintético|Docente sintética|private upstream/);
    assert.equal(elements(tree, "form").length, 0); assert.equal(elements(tree, "article").length, 0);
    elements(tree, "button").find(button => text(button) === "Volver a cargar").props.onClick(); assert.equal(fake.state.reloads, 1);
    fake.realtime({ type: "invalidate", scope: "messages", conversationId: conversation.id }); assert.equal(fake.state.calls.length, 4); fake.cleanup();
    const initial = panelHarness(true); initial.render(); initial.effects(); initial.state.calls[0].resolve(new Response("Forbidden", { status })); await settle();
    assert.match(text(initial.render()), /Verifica tu acceso al chat/); assert.doesNotMatch(text(initial.render()), /Alumno sintético|Aún no hay conversaciones/); initial.cleanup();
  }
});

test("SSE unauthorized cancels a deferred private list refresh and ignores late data or subsequent invalidations", async () => {
  const fake = panelHarness(true); await openHistory(fake);
  fake.realtime({ type: "invalidate", scope: "messages", conversationId: otherConversation.id }); assert.equal(fake.state.calls[3].url, "/api/conversations");
  fake.realtime({ type: "status", status: "unauthorized" }); assert.equal(fake.state.calls[3].options.signal.aborted, true);
  await fake.respond(3, { items: [conversation, otherConversation] }); const tree = fake.render(); fake.effects();
  assert.match(text(tree), /Verifica tu acceso al chat/); assert.doesNotMatch(text(tree), /Mensaje actual A|Alumno sintético/);
  fake.realtime({ type: "status", status: "connected" }); fake.realtime({ type: "invalidate", scope: "all" }); assert.equal(fake.state.calls.length, 4); fake.cleanup();
});

test("history GET from a previous chat is aborted and cannot merge private messages into the new chat", async () => {
  const fake = panelHarness(true); await openHistory(fake);
  elements(fake.render(), "button").find(button => text(button) === "Cargar mensajes anteriores").props.onClick(); assert.match(fake.state.calls[3].url, /beforeOrder=/);
  elements(fake.render(), "button").filter(button => text(button).startsWith("Abrir chat"))[1].props.onClick(); assert.equal(fake.state.calls[3].options.signal.aborted, true);
  fake.render(); fake.effects(); const newer = { ...ownMessage, id: "00000000-0000-4000-8000-000000000001", body: "Mensaje actual B" };
  await fake.respond(4, { items: [newer] }); await fake.respond(5, { items: [conversation, otherConversation] });
  await fake.respond(3, { items: [{ ...ownMessage, isMine: false, body: "Historial anterior privado A" }], hasOlder: false });
  assert.match(text(fake.render()), /Mensaje actual B/); assert.doesNotMatch(text(fake.render()), /Historial anterior privado A|Mensaje actual A/);
  assert.ok(fake.state.calls.every(call => !call.url.endsWith("/messages/read"))); fake.cleanup();
});

test("history read receipt cancelled after switching chats cannot update the new conversation", async () => {
  const fake = panelHarness(true); await openHistory(fake);
  elements(fake.render(), "button").find(button => text(button) === "Cargar mensajes anteriores").props.onClick();
  await fake.respond(3, { items: [{ ...ownMessage, isMine: false, body: "Historial A en lectura" }], hasOlder: false }); assert.ok(fake.state.calls[4].url.endsWith("/messages/read"));
  elements(fake.render(), "button").filter(button => text(button).startsWith("Abrir chat"))[1].props.onClick(); assert.equal(fake.state.calls[4].options.signal.aborted, true);
  fake.render(); fake.effects(); await fake.respond(5, { items: [{ ...ownMessage, body: "Mensaje actual B" }] }); await fake.respond(6, { items: [conversation, otherConversation] });
  await fake.respond(4, { readAt: "2026-10-08T10:01:00Z" }); assert.match(text(fake.render()), /Mensaje actual B/); assert.doesNotMatch(text(fake.render()), /Historial A en lectura/); fake.cleanup();
});

test("a current history 403 clears cached chat and a stale previous-chat 403 does not invalidate the new conversation", async () => {
  const current = panelHarness(true); await openHistory(current); elements(current.render(), "button").find(button => text(button) === "Cargar mensajes anteriores").props.onClick();
  current.state.calls[3].resolve(new Response("forbidden", { status: 403 })); await settle(); assert.match(text(current.render()), /Verifica tu acceso al chat/); assert.doesNotMatch(text(current.render()), /Mensaje actual A/); current.cleanup();
  const stale = panelHarness(true); await openHistory(stale); elements(stale.render(), "button").find(button => text(button) === "Cargar mensajes anteriores").props.onClick();
  elements(stale.render(), "button").filter(button => text(button).startsWith("Abrir chat"))[1].props.onClick(); stale.render(); stale.effects();
  await stale.respond(4, { items: [{ ...ownMessage, body: "Mensaje actual B" }] }); await stale.respond(5, { items: [conversation, otherConversation] });
  stale.state.calls[3].resolve(new Response("stale forbidden", { status: 403 })); await settle(); assert.match(text(stale.render()), /Mensaje actual B/); assert.doesNotMatch(text(stale.render()), /Verifica tu acceso/); stale.cleanup();
});

test("all invalidation after server account verification refreshes chat and hours once per burst without overlapping reads", async () => {
  const fake = panelHarness(true); await openHistory(fake); fake.realtime({ type: "invalidate", scope: "all" }); fake.realtime({ type: "invalidate", scope: "all" });
  assert.equal(fake.state.calls.length, 4); assert.equal(fake.state.calls[3].url, `/api/conversations/${conversation.id}/messages`);
  assert.equal([...fake.state.timers.values()].filter(timer => timer.delay === 200).length, 1);
  await fake.respond(3, { items: [ownMessage] }); await fake.respond(4, { items: [conversation, otherConversation] });
  assert.equal(fake.state.calls[5].url, `/api/conversations/${conversation.id}/messages`); await fake.respond(5, { items: [ownMessage] }); await fake.respond(6, { items: [conversation, otherConversation] });
  runChatTimer(fake, 200); assert.equal(fake.state.routeRefreshes, 1); assert.ok([...fake.state.timers.values()].some(timer => timer.delay === 10_000)); fake.cleanup();
});


test("current receipt 403 clears cached private messages before a late receipt can mark or display them", async () => {
  const fake = panelHarness(true); await openHistory(fake); runChatTimer(fake);
  await fake.respond(3, { items: [{ ...ownMessage, isMine: false, body: "Lectura privada pendiente" }] }); assert.ok(fake.state.calls[4].url.endsWith("/messages/read"));
  fake.state.calls[4].resolve(new Response("forbidden receipt", { status: 403 })); await settle(); const tree = fake.render(); fake.effects();
  assert.match(text(tree), /Verifica tu acceso al chat/); assert.doesNotMatch(text(tree), /Mensaje actual A|Lectura privada pendiente/); assert.equal(elements(tree, "article").length, 0); fake.cleanup();
});

test("an old active-poll permission response cannot clear a newly selected conversation before effect cleanup", async () => {
  const fake = panelHarness(true); await openHistory(fake); runChatTimer(fake);
  elements(fake.render(), "button").filter(button => text(button).startsWith("Abrir chat"))[1].props.onClick();
  fake.state.calls[3].resolve(new Response("stale forbidden", { status: 403 })); await settle();
  fake.render(); fake.effects(); await fake.respond(4, { items: [{ ...ownMessage, body: "Mensaje actual B" }] }); await fake.respond(5, { items: [conversation, otherConversation] });
  assert.match(text(fake.render()), /Mensaje actual B/); assert.doesNotMatch(text(fake.render()), /Verifica tu acceso al chat/); fake.cleanup();
});
