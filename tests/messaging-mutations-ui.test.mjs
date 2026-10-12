import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as limits from '../lib/school-upload-limits.ts';
import { DEFAULT_COMMUNICATION_HOURS } from '../lib/communication-hours-policy.ts';
import * as polling from '../lib/polling-policy.ts';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const receipt = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const conversations = [A, B].map((id, index) => ({ id, studentId: id, studentName: `Synthetic ${index}`, studentFamilyName: 'Family' }));
const contact = { studentId: A, studentName: 'Synthetic 0', teacherId: B, teacherName: 'Teacher' };
const ownMessage = { id: receipt, body: 'Existing private message', sentAt: '2026-10-12T10:00:00Z', order: 1, authorName: 'Synthetic teacher', isMine: true, readAt: null, file: null };
const source = ts.transpileModule(readFileSync(new URL('../app/comunicacion/messaging-panel.tsx', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const text = value => value == null || typeof value === 'boolean' ? '' : Array.isArray(value) ? value.map(text).join(' ').replace(/\s+/g, ' ') : typeof value === 'object' ? text(value.props?.children) : String(value);
function elements(tree, type) { const result = []; function walk(value) { if (!value || typeof value !== 'object') return; if (Array.isArray(value)) { value.forEach(walk); return; } if (value.type === type) result.push(value); walk(value.props?.children); } walk(tree); return result; }
async function settle() { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); }
function harness() {
  const state = { hooks: [], cursor: 0, effects: [], calls: [], deadlines: [], timers: new Map(), timerId: 0, listeners: new Map(), realtime: null, canMessage: true, unmounted: false };
  const react = {
    useState(initial) { const index = state.cursor++; state.hooks[index] ??= { value: initial }; return [state.hooks[index].value, next => { assert.equal(state.unmounted, false, 'No post-unmount private update'); state.hooks[index].value = typeof next === 'function' ? next(state.hooks[index].value) : next; }]; },
    useRef(initial) { const index = state.cursor++; return state.hooks[index] ??= { current: initial }; },
    useCallback(callback, deps) { const index = state.cursor++; if (!state.hooks[index] || !same(state.hooks[index].deps, deps)) state.hooks[index] = { callback, deps }; return state.hooks[index].callback; },
    useEffect(effect, deps) { const index = state.cursor++; const previous = state.hooks[index]; if (!previous || !same(previous.deps, deps)) { const hook = { deps, cleanup: previous?.cleanup }; state.hooks[index] = hook; state.effects.push(() => { hook.cleanup?.(); hook.cleanup = effect(); }); } },
  };
  class SyntheticFormData extends FormData { constructor(form) { super(); for (const [key, value] of Object.entries(form?.fields ?? {})) this.set(key, value); } }
  const jsx = (type, props, key) => ({ type, props, key });
  const listen = (type, listener) => { if (!state.listeners.has(type)) state.listeners.set(type, new Set()); state.listeners.get(type).add(listener); };
  const unlisten = (type, listener) => state.listeners.get(type)?.delete(listener);
  const dependencies = { react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'next/navigation': { useRouter: () => ({ refresh() {} }) }, '@/lib/school-upload-limits': limits, '@/lib/polling-policy': polling, '@/lib/school-realtime-client': { subscribeSchoolRealtime: listener => { state.realtime = listener; return () => { state.realtime = null; }; } } };
  const sandboxModule = { exports: {} };
  vm.runInNewContext(source, { module: sandboxModule, exports: sandboxModule.exports, require: name => dependencies[name] ?? assert.fail(`Unexpected ${name}`), File, FormData: SyntheticFormData, AbortController, DOMException, URLSearchParams, Date,
    AbortSignal: { any: AbortSignal.any, timeout: delay => { const controller = new AbortController(); state.deadlines.push({ delay, controller }); return controller.signal; } },
    navigator: { onLine: true }, document: { visibilityState: 'visible', addEventListener: listen, removeEventListener: unlisten },
    window: { addEventListener: listen, removeEventListener: unlisten, location: { reload() {} }, setTimeout(callback, delay) { const id = ++state.timerId; state.timers.set(id, { callback, delay }); return id; }, clearTimeout: id => state.timers.delete(id) },
    fetch: (url, options) => new Promise((resolve, reject) => state.calls.push({ url, ...options, resolve, reject })),
  });
  const render = () => { state.cursor = 0; const tree = sandboxModule.exports.MessagingPanel({ contacts: [contact], canMessage: state.canMessage, communicationHours: DEFAULT_COMMUNICATION_HOURS, uploadsReady: true }); state.effects.splice(0).forEach(effect => effect()); return tree; };
  const respond = async (index, data, status = 200) => { state.calls[index].resolve(Response.json(data, { status })); await settle(); };
  const form = { fields: { body: 'New synthetic message' }, resets: 0, reset() { this.resets++; } };
  const submit = () => elements(render(), 'form')[0].props.onSubmit({ preventDefault() {}, currentTarget: form });
  const start = () => elements(render(), 'button').find(button => text(button).includes('Teacher')).props.onClick();
  const open = index => elements(render(), 'button').filter(button => text(button).startsWith('Abrir chat'))[index].props.onClick();
  const cleanup = () => { state.hooks.forEach(hook => hook.cleanup?.()); state.unmounted = true; };
  return { state, render, respond, form, submit, start, open, cleanup };
}
async function ready(fake, messages = [ownMessage]) { fake.render(); await fake.respond(0, { items: conversations }); fake.open(0); fake.render(); await fake.respond(1, { items: messages }); if (fake.state.calls[2]?.url === '/api/conversations') await fake.respond(2, { items: conversations }); fake.render(); }

test('two same-tick sends produce one POST and block switching or starting another conversation until receipt', async () => {
  const fake = harness(); await ready(fake); const staleForm = elements(fake.render(), 'form')[0];
  const send = fake.submit(); await staleForm.props.onSubmit({ preventDefault() {}, currentTarget: fake.form }); fake.open(1); await fake.start();
  assert.equal(fake.state.calls.length, 4); assert.equal(fake.state.calls[3].url, `/api/conversations/${A}/messages`);
  assert.equal(fake.state.calls[3].credentials, 'same-origin'); assert.ok(fake.state.calls[3].signal); assert.match(text(fake.render()), /Chat · Synthetic 0/);
  assert.equal(elements(fake.render(), 'textarea')[0].props.disabled, true);
  await fake.respond(3, { id: receipt }, 201); await send; assert.equal(fake.form.resets, 1); assert.match(text(fake.render()), /Mensaje enviado/); fake.cleanup();
});

test('two same-tick start actions cannot create two conversations or switch to a different row', async () => {
  const fake = harness(); await ready(fake); const oldStart = elements(fake.render(), 'button').find(button => text(button).includes('Teacher'));
  const start = fake.start(); await oldStart.props.onClick(); fake.open(1); assert.equal(fake.state.calls.length, 4);
  assert.equal(fake.state.calls[3].method, 'POST'); assert.equal(fake.state.calls[3].url, '/api/conversations'); assert.match(text(fake.render()), /Chat · Synthetic 0/);
  await fake.respond(3, { id: B }, 200); assert.equal(fake.state.calls[4].url, '/api/conversations'); await fake.respond(4, { items: conversations }); await start; assert.match(text(fake.render()), /Chat · Synthetic 1/); fake.cleanup();
});

for (const [status, data] of [[200, { id: receipt }], [201, { id: 'not-a-uuid' }], [201, {}], [202, { id: receipt }], [500, { error: 'No se pudo guardar el mensaje.' }]]) {
  test(`send ${status} with an unconfirmed receipt preserves draft and never reports success`, async () => {
    const fake = harness(); await ready(fake); const send = fake.submit(); await fake.respond(3, data, status); await send;
    assert.equal(fake.form.resets, 0); assert.doesNotMatch(text(fake.render()), /Mensaje enviado/); assert.match(text(fake.render()), /confirm/); assert.equal(fake.state.calls.filter(call => call.method === 'POST').length, 1); fake.cleanup();
  });
}

for (const status of [401, 403]) test(`send ${status} clears cached messages before attempting to parse HTML`, async () => {
  const fake = harness(); await ready(fake); const send = fake.submit(); fake.state.calls[3].resolve(new Response('<p>Session expired</p>', { status })); await send;
  assert.match(text(fake.render()), /Verifica tu acceso/); assert.doesNotMatch(text(fake.render()), /Existing private message|Synthetic 0|Mensaje enviado/); assert.equal(fake.form.resets, 0); fake.cleanup();
});

test('SSE access revocation during send rejects a late confirmed receipt and cannot reset private draft', async () => {
  const fake = harness(); await ready(fake); const send = fake.submit(); fake.state.realtime({ type: 'status', status: 'unauthorized' }); await fake.respond(3, { id: receipt }, 201); await send;
  assert.match(text(fake.render()), /Verifica tu acceso/); assert.equal(fake.form.resets, 0); assert.doesNotMatch(text(fake.render()), /Existing private message|Mensaje enviado/); fake.cleanup();
});

test('role removal and reauthorization during start cannot revive an old confirmed conversation', async () => {
  const fake = harness(); await ready(fake); const start = fake.start(); fake.state.canMessage = false; fake.render(); fake.state.canMessage = true; fake.render();
  assert.doesNotMatch(text(fake.render()), /Existing private message|Chat ·/);
  await fake.respond(3, { id: B }, 201); await start; assert.doesNotMatch(text(fake.render()), /Chat · Synthetic 1|Conversación lista/); assert.equal(fake.state.calls[4].url, '/api/conversations'); fake.cleanup();
});

test('role removal during send rejects receipt and leaves the reauthorized view empty until a new read', async () => {
  const fake = harness(); await ready(fake); const send = fake.submit(); fake.state.canMessage = false; fake.render(); fake.state.canMessage = true; fake.render(); await fake.respond(3, { id: receipt }, 201); await send;
  assert.equal(fake.form.resets, 0); assert.doesNotMatch(text(fake.render()), /Existing private message|Mensaje enviado|Chat ·/); fake.cleanup();
});

for (const action of ['start', 'send']) test(`${action} receipt after unmount causes no state changes or follow-up requests`, async () => {
  const fake = harness(); await ready(fake); const pending = action === 'send' ? fake.submit() : fake.start(); fake.cleanup(); await fake.respond(3, { id: receipt }, 201); await pending; assert.equal(fake.state.calls.length, 4); assert.equal(fake.form.resets, 0);
});

test('a confirmed chat remains confirmed when the subsequent list GET fails, and manual refresh retries only GET', async () => {
  const fake = harness(); await ready(fake); const start = fake.start(); await fake.respond(3, { id: B }, 201); await fake.respond(4, { error: 'Unavailable' }, 503); await start;
  assert.match(text(fake.render()), /Conversación lista/); assert.match(text(fake.render()), /El chat está confirmado/); assert.doesNotMatch(text(fake.render()), /No pudimos confirmar el chat/);
  fake.render(); // Poll for the confirmed selection can run independently of the failed list refresh.
  elements(fake.render(), 'button').find(button => text(button) === 'Actualizar conversaciones').props.onClick(); assert.equal(fake.state.calls.at(-1).url, '/api/conversations'); assert.equal(fake.state.calls.at(-1).method, undefined); fake.cleanup();
});

test('switching conversations creates a fresh uncontrolled form and clears the former success notice', async () => {
  const fake = harness(); await ready(fake); const formA = elements(fake.render(), 'form')[0]; const send = fake.submit(); await fake.respond(3, { id: receipt }, 201); await send;
  fake.open(1); const formB = elements(fake.render(), 'form')[0]; assert.equal(formA.key, A); assert.equal(formB.key, B); assert.notEqual(formA.key, formB.key); assert.doesNotMatch(text(fake.render()), /Mensaje enviado/); fake.cleanup();
});

for (const readAt of [true, 'invalid-date', '']) test(`malformed read receipt ${JSON.stringify(readAt)} never marks or exposes incoming unread content`, async () => {
  const fake = harness(); await ready(fake, []);
  const [, timer] = [...fake.state.timers].find(([, entry]) => entry.delay === 10_000); timer.callback();
  await fake.respond(3, { items: [{ ...ownMessage, isMine: false, body: 'Unread incoming', readAt: null }] }); assert.equal(fake.state.calls[4].url, `/api/conversations/${A}/messages/read`);
  await fake.respond(4, { readAt }); assert.doesNotMatch(text(fake.render()), /Unread incoming|Chat sincronizado/); assert.match(text(fake.render()), /Reintentaremos automáticamente/); fake.cleanup();
});

test('a current chat GET 404 erases cached private messages and removes the inaccessible row', async () => {
  const fake = harness(); await ready(fake); const [, timer] = [...fake.state.timers].find(([, entry]) => entry.delay === 10_000); timer.callback();
  fake.state.calls[3].resolve(new Response('<p>Missing relationship</p>', { status: 404 })); await settle();
  assert.doesNotMatch(text(fake.render()), /Existing private message|Chat · Synthetic 0/); assert.equal(elements(fake.render(), 'form').length, 0); assert.equal(elements(fake.render(), 'button').filter(button => text(button).startsWith('Abrir chat')).length, 1); assert.match(text(fake.render()), /La conversación ya no está disponible/); fake.cleanup();
});

test('a current mark-read 404 hides cached history after the relationship is revoked', async () => {
  const fake = harness(); await ready(fake); const [, timer] = [...fake.state.timers].find(([, entry]) => entry.delay === 10_000); timer.callback();
  await fake.respond(3, { items: [{ ...ownMessage, id: B, isMine: false, order: 2, body: 'Unread after revocation' }] }); await fake.respond(4, { error: 'Unavailable' }, 404);
  assert.doesNotMatch(text(fake.render()), /Existing private message|Unread after revocation|Chat ·/); assert.match(text(fake.render()), /La conversación ya no está disponible/); fake.cleanup();
});

test('a send 404 erases the inaccessible chat without pretending the pending message was delivered', async () => {
  const fake = harness(); await ready(fake); const send = fake.submit(); await fake.respond(3, { error: 'Unavailable' }, 404); await send;
  assert.doesNotMatch(text(fake.render()), /Existing private message|Mensaje enviado|Chat ·/); assert.equal(fake.form.resets, 0); assert.match(text(fake.render()), /La conversación ya no está disponible/); fake.cleanup();
});

test('a delayed old-chat 404 cannot clear the new chat before the next effect cleanup', async () => {
  const fake = harness(); await ready(fake); const [, timer] = [...fake.state.timers].find(([, entry]) => entry.delay === 10_000); timer.callback();
  const staleOpenB = elements(fake.render(), 'button').filter(button => text(button).startsWith('Abrir chat'))[1]; staleOpenB.props.onClick(); // Change selection before committing effect cleanup.
  await fake.respond(3, { error: 'Unavailable' }, 404);
  assert.match(text(fake.render()), /Chat · Synthetic 1/); assert.doesNotMatch(text(fake.render()), /La conversación ya no está disponible/); assert.equal(elements(fake.render(), 'button').filter(button => text(button).startsWith('Abrir chat')).length, 2); fake.cleanup();
});
