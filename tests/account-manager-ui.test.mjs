import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as runtime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const person = { id: 'legacy-person-id', name: 'Synthetic adult', email: 'adult@example.test', role: 'tutor', active: true };
const props = { initialUsers: [person], initialTotal: 1, actorId: 'school-admin', canCreateDirection: true, useSupabaseInvites: true };
const jsx = (type, props) => ({ type, props });
const source = ts.transpileModule(readFileSync(new URL('../app/cuentas/account-manager.tsx', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function load(dependencies, globals = {}) {
  const sandboxModule = { exports: {} };
  vm.runInNewContext(source, { module: sandboxModule, exports: sandboxModule.exports, require: name => dependencies[name] ?? assert.fail(`Unexpected import ${name}`), ...globals });
  return sandboxModule.exports.AccountManager;
}
function elements(tree, type) {
  const found = [];
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (value.type === type) found.push(value);
    walk(value.props?.children);
  }
  walk(tree); return found;
}
const text = value => value == null || typeof value === 'boolean' ? '' : Array.isArray(value) ? value.map(text).join(' ') : typeof value === 'object' ? text(value.props?.children) : String(value);
const tick = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
function harness(overrides = {}) {
  const state = { hooks: [], cursor: 0, effects: [], calls: [], timeouts: [], confirms: [], updates: 0, unmounted: false };
  const react = {
    useState(initial) {
      const index = state.cursor++; state.hooks[index] ??= { value: initial };
      return [state.hooks[index].value, next => { assert.equal(state.unmounted, false, 'No updates after unmount'); state.updates++; state.hooks[index].value = typeof next === 'function' ? next(state.hooks[index].value) : next; }];
    },
    useRef(initial) { const index = state.cursor++; state.hooks[index] ??= { current: initial }; return state.hooks[index]; },
    useCallback(callback, deps) {
      const index = state.cursor++; const previous = state.hooks[index];
      if (!previous || !same(previous.deps, deps)) state.hooks[index] = { callback, deps };
      return state.hooks[index].callback;
    },
    useEffect(effect, deps) {
      const index = state.cursor++; const previous = state.hooks[index];
      if (!previous || !same(previous.deps, deps)) {
        state.hooks[index] = { deps, cleanup: previous?.cleanup };
        state.effects.push(() => { state.hooks[index].cleanup?.(); state.hooks[index].cleanup = effect(); });
      }
    },
  };
  const Component = load({ react, 'react/jsx-runtime': { jsx, jsxs: jsx } }, {
    URLSearchParams, AbortController,
    AbortSignal: { any: signals => AbortSignal.any(signals), timeout: milliseconds => { const controller = new AbortController(); state.timeouts.push({ milliseconds, controller }); return controller.signal; } },
    FormData: class { constructor(form) { this.entries = Object.entries(form.fields); } [Symbol.iterator]() { return this.entries[Symbol.iterator](); } get(name) { return this.entries.find(entry => entry[0] === name)?.[1] ?? null; } },
    window: { confirm: message => { state.confirms.push(message); return true; } },
    fetch: (url, options) => new Promise((resolve, reject) => state.calls.push({ url, ...options, parsedBody: options.body ? JSON.parse(options.body) : null, resolve, reject })),
  });
  const render = () => {
    state.cursor = 0; const tree = Component({ ...props, ...overrides });
    for (const effect of state.effects.splice(0)) effect();
    return tree;
  };
  const button = label => elements(render(), 'button').find(item => text(item).includes(label)) ?? assert.fail(`Missing button ${label}`);
  const form = index => elements(render(), 'form')[index] ?? assert.fail(`Missing form ${index}`);
  const submit = (index = 0, fields = { name: 'New synthetic adult', email: 'new@example.test', role: 'tutor' }) => {
    const syntheticForm = { fields, resets: 0, reset() { this.resets++; } };
    const promise = form(index).props.onSubmit({ preventDefault() {}, currentTarget: syntheticForm });
    return { syntheticForm, promise };
  };
  const reply = async (index, data, status = 200) => { state.calls[index].resolve(Response.json(data, { status })); await tick(); };
  const ready = async () => { render(); await reply(0, { items: overrides.initialUsers ?? [person], total: overrides.initialTotal ?? 1 }); };
  const search = value => elements(render(), 'input').find(item => item.props.id === 'account-search').props.onChange({ target: { value } });
  const stop = () => { for (const hook of state.hooks) hook.cleanup?.(); state.unmounted = true; };
  return { state, render, button, submit, reply, ready, search, stop };
}

test('actual React SSR keeps account controls disabled until the authenticated list is read', () => {
  const Component = load({ react: React, 'react/jsx-runtime': runtime });
  const html = renderToStaticMarkup(React.createElement(Component, props));
  assert.match(html, /Actualizando lista de cuentas/);
  assert.match(html, /<input(?=[^>]*name="email")(?=[^>]*disabled="")[^>]*>/);
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /name="password"/);
});

test('initial authenticated read has a deadline, no cache, and blocks writes while pending', async () => {
  const ui = harness(); ui.render(); ui.submit();
  assert.equal(ui.state.calls.length, 1);
  assert.equal(ui.state.calls[0].method, 'GET'); assert.equal(ui.state.calls[0].credentials, 'same-origin');
  assert.equal(ui.state.calls[0].cache, 'no-store'); assert.equal(ui.state.timeouts[0].milliseconds, 20_000);
  await ui.reply(0, { items: [person], total: 1 });
  assert.equal(ui.button('Enviar invitación').props.disabled, false);
});

for (const status of [401, 403]) test(`GET ${status} clears names, emails and all account controls`, async () => {
  const ui = harness(); ui.render(); await ui.reply(0, { error: 'Synthetic private response' }, status);
  const tree = ui.render(); assert.doesNotMatch(text(tree), /Synthetic adult|adult@example.test|Nueva cuenta|private response/);
  assert.match(text(tree), /sesión o tus permisos cambiaron/); assert.equal(elements(tree, 'form').length, 0);
  assert.equal(elements(tree, 'a')[0].props.href, '/ingresar');
  assert.equal(ui.state.calls.length, 1);
});

test('GET 503 preserves the last valid list, reports a separate list error and permits only GET retry', async () => {
  const ui = harness(); await ui.ready(); ui.search('new'); ui.render();
  await ui.reply(1, { error: 'Synthetic private upstream message' }, 503);
  assert.match(text(ui.render()), /Synthetic adult/); assert.match(text(ui.render()), /puede estar desactualizada/);
  assert.doesNotMatch(text(ui.render()), /upstream message|No hay coincidencias/);
  assert.equal(ui.button('Enviar invitación').props.disabled, true);
  ui.submit(); assert.equal(ui.state.calls.length, 2);
  ui.button('Actualizar lista').props.onClick(); assert.equal(ui.state.calls[2].method, 'GET');
  await ui.reply(2, { items: [person], total: 1 }); assert.equal(ui.button('Enviar invitación').props.disabled, false);
});

test('failed initial empty read never claims a successful empty list', async () => {
  const ui = harness({ initialUsers: [], initialTotal: 0 }); ui.render(); await ui.reply(0, {}, 503);
  assert.match(text(ui.render()), /No se pudo comprobar si hay cuentas/);
  assert.doesNotMatch(text(ui.render()), /No hay coincidencias/);
});

test('POST 201 legacy ID confirms success and resets the form before a failed GET refresh', async () => {
  const ui = harness({ useSupabaseInvites: false }); await ui.ready();
  const { syntheticForm, promise } = ui.submit(0, { name: 'New adult', email: 'new@example.test', role: 'tutor', password: 'synthetic-local-only' });
  assert.equal(ui.state.calls[1].method, 'POST'); assert.equal(ui.state.calls[1].credentials, 'same-origin');
  await ui.reply(1, { id: 'd1-legacy-id-not-a-uuid' }, 201);
  assert.equal(syntheticForm.resets, 1); assert.match(text(ui.render()), /Cuenta creada/);
  assert.equal(ui.state.calls[2].method, 'GET');
  await ui.reply(2, {}, 503); await promise;
  assert.match(text(ui.render()), /Cuenta creada/); assert.match(text(ui.render()), /No se pudo actualizar la lista/);
  assert.equal(syntheticForm.resets, 1); assert.equal(ui.state.calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(ui.button('Crear cuenta').props.disabled, true);
  ui.button('Actualizar lista').props.onClick(); await ui.reply(3, { items: [person], total: 1 });
  assert.equal(ui.button('Crear cuenta').props.disabled, false);
});

test('confirmed invitation describes acceptance without claiming email delivery', async () => {
  const ui = harness(); await ui.ready(); const { syntheticForm, promise } = ui.submit();
  await ui.reply(1, { id: 'local-invited', invited: true }, 201);
  assert.equal(syntheticForm.resets, 1); assert.match(text(ui.render()), /Revisa con la persona la recepción/);
  await ui.reply(2, { items: [person], total: 1 }); await promise;
  assert.equal(ui.state.calls.filter(call => call.method === 'POST').length, 1);
});

test('synchronous double submit issues only one write, even before React rerenders', async () => {
  const ui = harness(); await ui.ready(); const first = ui.submit(); const second = ui.submit();
  assert.equal(ui.state.calls.length, 2); await second.promise;
  await ui.reply(1, { id: 'local-created' }, 201); await ui.reply(2, { items: [person], total: 1 }); await first.promise;
  assert.equal(first.syntheticForm.resets, 1); assert.equal(second.syntheticForm.resets, 0);
  assert.equal(ui.state.calls.filter(call => call.method === 'POST').length, 1);
});

for (const receipt of [{ updated: true }, { id: person.id, updated: true, role: 'tutor', active: true }]) test(`confirmed PATCH ${receipt.id ? 'Supabase' : 'D1'} survives a failed list refresh`, async () => {
  const ui = harness(); await ui.ready(); const { promise } = ui.submit(1, { name: 'Edited adult', email: person.email });
  assert.equal(ui.state.calls[1].method, 'PATCH'); assert.equal(ui.state.calls[1].url, `/api/users/${person.id}`);
  await ui.reply(1, receipt); assert.match(text(ui.render()), /Datos de la cuenta actualizados/);
  await ui.reply(2, {}, 503); await promise;
  assert.match(text(ui.render()), /Datos de la cuenta actualizados/); assert.match(text(ui.render()), /No se pudo actualizar la lista/);
  ui.submit(1); assert.equal(ui.state.calls.length, 3);
});

test('role changes and deactivation use a synchronous shared write lock', async () => {
  const ui = harness(); await ui.ready(); const first = ui.submit(2, { role: 'docente' });
  ui.submit(2, { role: 'docente' }); ui.button('Desactivar acceso').props.onClick();
  assert.equal(ui.state.confirms.length, 1); assert.equal(ui.state.calls.length, 2);
  assert.deepEqual(ui.state.calls[1].parsedBody, { role: 'docente' });
  await ui.reply(1, { updated: true }); await ui.reply(2, { items: [person], total: 1 }); await first.promise;
  ui.button('Desactivar acceso').props.onClick(); ui.button('Desactivar acceso').props.onClick();
  assert.equal(ui.state.confirms.length, 2); assert.deepEqual(ui.state.calls[3].parsedBody, { active: false });
  await ui.reply(3, { updated: true, active: false }); await ui.reply(4, { items: [{ ...person, active: false }], total: 1 });
  assert.match(text(ui.render()), /Cuenta desactivada/);
});

test('uncertain network outcome never resets the form, claims success, or automatically repeats POST', async () => {
  const ui = harness(); await ui.ready(); const { syntheticForm, promise } = ui.submit();
  ui.state.calls[1].reject(Error('Synthetic private network failure')); await promise;
  assert.equal(syntheticForm.resets, 0); assert.match(text(ui.render()), /No se pudo confirmar/);
  assert.doesNotMatch(text(ui.render()), /Cuenta creada|Invitación creada|private network/);
  ui.submit(); assert.equal(ui.state.calls.length, 2);
  ui.button('Actualizar lista').props.onClick(); assert.equal(ui.state.calls[2].method, 'GET');
  await ui.reply(2, { items: [person], total: 1 }); assert.equal(ui.state.calls.filter(call => call.method === 'POST').length, 1);
});

for (const [method, receipt, status] of [['POST', {}, 201], ['POST', { id: 'local' }, 200], ['PATCH', { updated: true, id: 'wrong-account' }, 200]]) test(`malformed ${method} confirmation ${JSON.stringify(receipt)} status ${status} remains uncertain`, async () => {
  const ui = harness(); await ui.ready(); const { syntheticForm, promise } = ui.submit(method === 'POST' ? 0 : 1);
  await ui.reply(1, receipt, status); await promise;
  assert.equal(syntheticForm.resets, 0); assert.match(text(ui.render()), /No se pudo confirmar/);
  assert.doesNotMatch(text(ui.render()), /Cuenta creada|cuenta actualizados/);
  assert.equal(ui.state.calls.length, 2);
});

test('known validation rejection displays the actual safe server error without claiming success', async () => {
  const ui = harness(); await ui.ready(); const { syntheticForm, promise } = ui.submit();
  await ui.reply(1, { error: 'Ese correo ya está registrado.' }, 409); await promise;
  assert.match(text(ui.render()), /Ese correo ya está registrado/); assert.equal(syntheticForm.resets, 0);
  assert.equal(ui.button('Enviar invitación').props.disabled, false); assert.equal(ui.state.calls.length, 2);
});

test('stale filter responses cannot replace the current list or revoke a newer successful read', async () => {
  const ui = harness(); await ui.ready(); ui.search('first'); ui.render(); ui.search('second'); ui.render();
  assert.equal(ui.state.calls[1].signal.aborted, true);
  await ui.reply(2, { items: [{ ...person, name: 'Current result' }], total: 1 });
  await ui.reply(1, {}, 401);
  assert.match(text(ui.render()), /Current result/); assert.doesNotMatch(text(ui.render()), /sesión o tus permisos/);
  assert.equal(ui.button('Enviar invitación').props.disabled, false);
});

test('revocation while a mutation is pending aborts it and rejects a late confirmed receipt', async () => {
  const ui = harness(); await ui.ready(); const { syntheticForm, promise } = ui.submit();
  ui.search('check-session'); ui.render(); await ui.reply(2, {}, 403);
  assert.equal(ui.state.calls[1].signal.aborted, true);
  await ui.reply(1, { id: 'late-confirmation' }, 201); await promise;
  assert.equal(syntheticForm.resets, 0); assert.equal(ui.state.calls.length, 3);
  assert.doesNotMatch(text(ui.render()), /adult@example.test|Synthetic adult|Cuenta creada|Invitación creada/);
});

for (const status of [401, 403]) test(`mutation ${status} immediately discards private list and controls`, async () => {
  const ui = harness(); await ui.ready(); const { promise } = ui.submit(1);
  await ui.reply(1, { error: 'Synthetic private rejection' }, status); await promise;
  assert.equal(elements(ui.render(), 'form').length, 0); assert.doesNotMatch(text(ui.render()), /adult@example.test|private rejection/);
  assert.equal(ui.state.calls.length, 2);
});

test('unmount aborts pending reads and writes and ignores their later responses', async () => {
  const read = harness(); read.render(); read.stop(); const readsBefore = read.state.updates;
  assert.equal(read.state.calls[0].signal.aborted, true); await read.reply(0, { items: [person], total: 1 }); assert.equal(read.state.updates, readsBefore);
  const write = harness(); await write.ready(); const { syntheticForm, promise } = write.submit(); write.stop(); const writesBefore = write.state.updates;
  assert.equal(write.state.calls[1].signal.aborted, true); await write.reply(1, { id: 'local-created' }, 201); await promise;
  assert.equal(write.state.updates, writesBefore); assert.equal(syntheticForm.resets, 0); assert.equal(write.state.calls.length, 2);
});

test('request deadlines turn pending reads and uncertain writes into explicit retry states without replay', async () => {
  const ui = harness(); ui.render(); ui.state.timeouts[0].controller.abort();
  assert.equal(ui.state.calls[0].signal.aborted, true); ui.state.calls[0].reject(new DOMException('Synthetic timeout', 'TimeoutError')); await tick();
  assert.match(text(ui.render()), /No se pudo actualizar/); ui.button('Actualizar lista').props.onClick();
  await ui.reply(1, { items: [person], total: 1 }); const { syntheticForm, promise } = ui.submit();
  ui.state.timeouts[2].controller.abort(); assert.equal(ui.state.calls[2].signal.aborted, true);
  ui.state.calls[2].reject(new DOMException('Synthetic timeout', 'TimeoutError')); await promise;
  assert.equal(syntheticForm.resets, 0); assert.match(text(ui.render()), /No se pudo confirmar/); assert.equal(ui.state.calls.length, 3);
});

test('protected self and superadmin rows have no editing controls', async () => {
  const ui = harness({ initialUsers: [{ ...person, id: 'school-admin' }, { ...person, id: 'superadmin', role: 'superadmin' }], initialTotal: 2 }); await ui.ready();
  assert.equal(elements(ui.render(), 'details').length, 0); assert.equal(elements(ui.render(), 'form').length, 1);
});
