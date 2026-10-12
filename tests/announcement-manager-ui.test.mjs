import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const announcementId = '11111111-1111-4111-8111-111111111111';
const createdId = '22222222-2222-4222-8222-222222222222';
const groupId = '33333333-3333-4333-8333-333333333333';
const announcement = { id: announcementId, groupId, title: 'Aviso sintético privado', body: 'Contenido sintético para su familia', important: false, publishedAt: '2026-10-12T12:00:00Z', readAt: null };
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
const jsx = (type, props) => ({ type, props });
function elements(tree, type) {
  const result = [];
  const visit = value => { if (!value || typeof value !== 'object') return; if (Array.isArray(value)) { value.forEach(visit); return; } if (value.type === type) result.push(value); visit(value.props?.children); };
  visit(tree); return result;
}
const text = tree => tree == null ? '' : typeof tree === 'string' ? tree : Array.isArray(tree) ? tree.map(text).join(' ') : typeof tree === 'object' ? text(tree.props?.children) : String(tree);

function harness({ rows = [announcement], canCreate = true, canCreateGeneral = true } = {}) {
  const state = { hooks: [], cursor: 0, effects: [], calls: [], handler: null, resets: 0, stopped: false, lateStateChanges: 0 };
  const depsEqual = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const react = {
    useState: initial => { const index = state.cursor++; state.hooks[index] ??= { value: initial }; return [state.hooks[index].value, next => { if (state.stopped) state.lateStateChanges++; state.hooks[index].value = typeof next === 'function' ? next(state.hooks[index].value) : next; }]; },
    useRef: initial => { const index = state.cursor++; state.hooks[index] ??= { current: initial }; return state.hooks[index]; },
    useCallback: (callback, deps) => { const index = state.cursor++; if (!depsEqual(state.hooks[index]?.deps, deps)) state.hooks[index] = { value: callback, deps }; return state.hooks[index].value; },
    useEffect: (effect, deps) => { const index = state.cursor++; if (!depsEqual(state.hooks[index]?.deps, deps)) { const previous = state.hooks[index]; state.hooks[index] = { deps, cleanup: previous?.cleanup }; state.effects.push(() => { previous?.cleanup?.(); state.hooks[index].cleanup = effect(); }); } },
  };
  class SyntheticFormData { constructor(form) { this.fields = form.fields; } get(name) { return this.fields[name] ?? null; } }
  const sandboxModule = { exports: {} };
  const source = ts.transpileModule(readFileSync(new URL('../app/comunicados/announcement-manager.tsx', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInContext(source, vm.createContext({ module: sandboxModule, exports: sandboxModule.exports, require: name => name === 'react' ? react : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx, Fragment: 'Fragment' } : assert.fail('Unexpected import ' + name), AbortController, AbortSignal, Promise, FormData: SyntheticFormData,
    fetch: async (url, options = {}) => {
      const call = { url, ...options, method: options.method ?? 'GET', body: options.body ? JSON.parse(options.body) : null };
      state.calls.push(call);
      if (state.handler) { const response = await state.handler(call); if (response !== undefined) return response; }
      return call.method === 'GET' ? Response.json({ items: rows }) : url.endsWith('/read') ? Response.json({ read: true }) : Response.json({ id: createdId, notified: 1 }, { status: 201 });
    },
  }), { filename: 'announcement-manager.tsx' });
  const render = () => { state.cursor = 0; const tree = sandboxModule.exports.AnnouncementManager({ groups: [{ id: groupId, name: 'Grupo sintético' }], canCreate, canCreateGeneral }); for (const effect of state.effects.splice(0)) effect(); return tree; };
  const form = { fields: { groupId, title: 'Nuevo aviso sintético', body: 'Contenido nuevo', important: 'on' }, reset: () => { state.resets++; } };
  const event = { preventDefault() {}, currentTarget: form };
  const button = label => { const result = elements(render(), 'button').find(item => text(item).includes(label)); assert.ok(result, 'Missing button ' + label); return result; };
  const send = () => elements(render(), 'form')[0].props.onSubmit(event);
  const read = () => button('Marcar como visto').props.onClick();
  const refresh = () => button('Actualizar avisos').props.onClick();
  const stop = () => { state.stopped = true; for (const hook of state.hooks) hook?.cleanup?.(); };
  return { state, render, form, event, button, send, read, refresh, stop, mount: async () => { render(); await tick(); render(); } };
}

test('mount reads a private feed and tutor has reading controls without publication form', async () => {
  const ui = harness({ canCreate: false }); await ui.mount(); assert.equal(elements(ui.render(), 'form').length, 0); assert.match(text(ui.render()), /Aviso sintético privado/);
  const request = ui.state.calls[0]; assert.equal(request.credentials, 'same-origin'); assert.equal(request.cache, 'no-store'); assert.ok(request.signal); ui.stop();
});

test('confirmed 201 resets and displays success before GET503, retaining previous feed and avoiding replay', async () => {
  const ui = harness(); await ui.mount(); const nextRead = deferred(); ui.state.handler = call => call.method === 'GET' ? nextRead.promise : undefined;
  const pending = ui.send(); await tick(); assert.equal(ui.state.resets, 1); assert.match(text(ui.render()), /Comunicado enviado/);
  nextRead.resolve(Response.json({ error: 'Synthetic unavailable' }, { status: 503 })); await pending;
  assert.match(text(ui.render()), /Comunicado enviado/); assert.match(text(ui.render()), /No se pudo actualizar el listado/); assert.match(text(ui.render()), /Aviso sintético privado/); assert.doesNotMatch(text(ui.render()), /Puede haberse guardado/);
  ui.state.handler = null; ui.refresh(); await tick(); assert.equal(ui.state.calls.filter(call => call.method === 'POST').length, 1); assert.equal(ui.state.resets, 1); ui.stop();
});

test('synchronous repeated submit sends only one POST and locks draft fields', async () => {
  const ui = harness(); await ui.mount(); const write = deferred(); ui.state.handler = call => call.method === 'POST' ? write.promise : undefined;
  const callback = elements(ui.render(), 'form')[0].props.onSubmit; const first = callback(ui.event); await callback(ui.event);
  assert.equal(ui.state.calls.filter(call => call.method === 'POST').length, 1);
  for (const field of [...elements(ui.render(), 'input'), ...elements(ui.render(), 'textarea'), ...elements(ui.render(), 'select')]) assert.equal(field.props.disabled, true);
  assert.equal(ui.button('Actualizar avisos').props.disabled, true); write.resolve(Response.json({ id: createdId }, { status: 201 })); await first; assert.equal(ui.state.resets, 1); ui.stop();
});

test('only 201 with a valid UUID confirms publication; ambiguous receipts require a successful fresh GET', async () => {
  for (const [status, payload] of [[200, { id: createdId }], [202, { id: createdId }], [201, {}], [201, { id: 'arbitrary' }], [201, null]]) {
    const ui = harness(); await ui.mount(); ui.state.handler = call => call.method === 'POST' ? Response.json(payload, { status }) : undefined;
    await ui.send(); assert.equal(ui.state.resets, 0); assert.match(text(ui.render()), /Puede haberse guardado/); assert.equal(ui.button('Enviar aviso').props.disabled, true);
    await ui.send(); assert.equal(ui.state.calls.filter(call => call.method === 'POST').length, 1);
    ui.state.handler = call => call.method === 'GET' ? Response.json({}, { status: 503 }) : undefined; ui.refresh(); await tick(); assert.equal(ui.button('Enviar aviso').props.disabled, true);
    ui.state.handler = null; ui.refresh(); await tick(); assert.equal(ui.button('Enviar aviso').props.disabled, false); await ui.send(); assert.equal(ui.state.resets, 1); ui.stop();
  }
});

test('network or unreadable POST response remains uncertain and never leaks provider details or auto retries', async () => {
  for (const response of [() => Promise.reject(Error('SYNTHETIC PRIVATE DETAIL')), () => new Response('unreadable', { status: 201 })]) {
    const ui = harness(); await ui.mount(); ui.state.handler = call => call.method === 'POST' ? response() : undefined; await ui.send(); await tick();
    assert.equal(ui.state.calls.length, 2); assert.equal(ui.state.resets, 0); assert.match(text(ui.render()), /Puede haberse guardado/); assert.doesNotMatch(text(ui.render()), /SYNTHETIC PRIVATE DETAIL|unreadable/); ui.stop();
  }
});

test('400 and 404 reject publication without resetting or blocking a corrected explicit draft', async () => {
  for (const status of [400, 404]) {
    const ui = harness(); await ui.mount(); ui.state.handler = call => call.method === 'POST' ? Response.json({ error: 'private upstream' }, { status }) : undefined;
    await ui.send(); assert.equal(ui.state.resets, 0); assert.match(text(ui.render()), /Revisa el título/); assert.doesNotMatch(text(ui.render()), /private upstream|Puede haberse guardado/); assert.equal(ui.button('Enviar aviso').props.disabled, false); ui.stop();
  }
});

test('GET401403 clears the private feed, removes the form and never reports successful empty state', async () => {
  for (const status of [401, 403]) {
    const ui = harness(); await ui.mount(); const retainedSubmit = elements(ui.render(), 'form')[0].props.onSubmit; const retainedRead = ui.button('Marcar como visto').props.onClick;
    ui.state.handler = () => Response.json({ error: 'denied' }, { status }); ui.refresh(); await tick();
    assert.match(text(ui.render()), /Tu sesión o tus permisos/); assert.doesNotMatch(text(ui.render()), /Aviso sintético privado|Contenido sintético|Aún no hay comunicados/); assert.equal(elements(ui.render(), 'form').length, 0);
    const before = ui.state.calls.length; await retainedSubmit(ui.event); await retainedRead(); assert.equal(ui.state.calls.length, before); assert.equal(elements(ui.render(), 'a')[0].props.href, '/ingresar'); ui.stop();
  }
});

test('POST401403 immediately clears feed without parsing potentially sensitive failure body', async () => {
  for (const status of [401, 403]) {
    const ui = harness(); await ui.mount(); ui.state.handler = call => call.method === 'POST' ? new Response('not JSON', { status }) : undefined; await ui.send();
    assert.match(text(ui.render()), /Tu sesión o tus permisos/); assert.doesNotMatch(text(ui.render()), /Aviso sintético privado|Comunicado enviado/); assert.equal(ui.state.resets, 0); ui.stop();
  }
});

test('read 200 read:true survives GET503 and a captured callback cannot repost an already confirmed read', async () => {
  const ui = harness({ canCreate: false }); await ui.mount(); const callback = ui.button('Marcar como visto').props.onClick;
  ui.state.handler = call => call.method === 'GET' ? Response.json({}, { status: 503 }) : undefined; await callback();
  assert.match(text(ui.render()), /Visto/); assert.match(text(ui.render()), /No se pudo actualizar el listado/); assert.doesNotMatch(text(ui.render()), /Pendiente de lectura|No pudimos confirmar la lectura/);
  assert.equal(elements(ui.render(), 'button').filter(item => text(item).includes('Marcar como visto')).length, 0);
  await callback(); assert.equal(ui.state.calls.filter(call => call.method === 'POST').length, 1); ui.stop();
});

test('read network failures and unconfirmed receipts remain pending and do not auto retry or leak errors', async () => {
  for (const response of [() => Promise.reject(Error('SYNTHETIC PRIVATE DETAIL')), () => Response.json({ read: false }), () => Response.json({}), () => Response.json({ read: true }, { status: 202 }), () => Response.json(null), () => new Response('unreadable')]) {
    const ui = harness({ canCreate: false }); await ui.mount(); ui.state.handler = call => call.method === 'POST' ? response() : undefined; await ui.read(); await tick();
    assert.match(text(ui.render()), /No pudimos confirmar la lectura/); assert.match(text(ui.render()), /Pendiente de lectura/); assert.doesNotMatch(text(ui.render()), /SYNTHETIC PRIVATE DETAIL/); assert.equal(ui.state.calls.length, 2); assert.equal(ui.button('Marcar como visto').props.disabled, false); ui.stop();
  }
});

test('read double click posts once before React rerenders and a denial clears every private row', async () => {
  for (const status of [401, 403]) {
    const ui = harness(); await ui.mount(); const pending = deferred(); ui.state.handler = call => call.method === 'POST' ? pending.promise : undefined;
    const callback = ui.button('Marcar como visto').props.onClick; const first = callback(); await callback(); assert.equal(ui.state.calls.filter(call => call.method === 'POST').length, 1); assert.equal(ui.button('Confirmando…').props.disabled, true);
    pending.resolve(new Response('', { status })); await first; assert.match(text(ui.render()), /Tu sesión o tus permisos/); assert.doesNotMatch(text(ui.render()), /Aviso sintético privado|Pendiente de lectura/); ui.stop();
  }
});

test('an older list response cannot overwrite a newer successful list or restore data after access denial', async () => {
  for (const denied of [false, true]) {
    const ui = harness(); await ui.mount(); const old = deferred(); let reads = 0;
    ui.state.handler = call => call.method === 'GET' ? ++reads === 1 ? old.promise : denied ? Response.json({}, { status: 403 }) : Response.json({ items: [{ ...announcement, title: 'Nuevo contenido vigente' }] }) : undefined;
    const callback = ui.button('Actualizar avisos').props.onClick; callback(); callback(); await tick();
    old.resolve(Response.json({ items: [{ ...announcement, title: 'Respuesta antigua privada' }] })); await tick();
    assert.doesNotMatch(text(ui.render()), /Respuesta antigua privada/); assert.match(text(ui.render()), denied ? /Tu sesión o tus permisos/ : /Nuevo contenido vigente/); ui.stop();
  }
});

test('malformed list payloads retain the known feed with a failure alert rather than false empty success', async () => {
  for (const payload of [null, {}, { items: [null] }, { items: [{ ...announcement, id: 'bad' }] }, { items: [{ ...announcement, publishedAt: 'bad' }] }, { items: [{ ...announcement, readAt: 'bad' }] }]) {
    const ui = harness(); await ui.mount(); ui.state.handler = () => Response.json(payload); ui.refresh(); await tick();
    assert.match(text(ui.render()), /Aviso sintético privado|No se pudo actualizar el listado/); assert.match(text(ui.render()), /No se pudo actualizar el listado/); assert.doesNotMatch(text(ui.render()), /Aún no hay comunicados/); ui.stop();
  }
});

test('late publication and read results after unmount cannot reset or change state', async () => {
  for (const operation of ['send', 'read']) for (const failure of [false, true]) {
    const ui = harness(); await ui.mount(); const pending = deferred(); ui.state.handler = call => call.method === 'POST' ? pending.promise : undefined;
    const action = ui[operation](); ui.stop();
    if (failure) pending.reject(Error('Synthetic unavailable'));
    else pending.resolve(operation === 'send' ? Response.json({ id: createdId }, { status: 201 }) : Response.json({ read: true }));
    await action; assert.equal(ui.state.lateStateChanges, 0); assert.equal(ui.state.resets, 0); assert.equal(ui.state.calls.length, 2);
  }
});

test('a stale GET started before an uncertain POST cannot unlock direct publication', async () => {
  const ui = harness(); await ui.mount(); const old = deferred(); ui.state.handler = call => call.method === 'GET' ? old.promise : Response.json({ id: createdId }, { status: 202 });
  ui.refresh(); await ui.send(); old.resolve(Response.json({ items: [announcement] })); await tick();
  assert.equal(ui.button('Enviar aviso').props.disabled, true); await ui.send(); assert.equal(ui.state.calls.filter(call => call.method === 'POST').length, 1); ui.stop();
});
