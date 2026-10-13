import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as runtime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const jsx = (type, props) => ({ type, props });
const source = ts.transpileModule(readFileSync(new URL('../app/activar-cuenta/page.tsx', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function load(dependencies, globals = {}) {
  const fixtureModule = { exports: {} };
  vm.runInNewContext(source, { module: fixtureModule, exports: fixtureModule.exports, require: name => dependencies[name] ?? assert.fail(`Unexpected import ${name}`), ...globals });
  return fixtureModule.exports.default;
}
function elements(tree, type) {
  const found = [];
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (value.type === type) found.push(value); walk(value.props?.children);
  }
  walk(tree); return found;
}
const text = value => value == null || typeof value === 'boolean' ? '' : Array.isArray(value) ? value.map(text).join(' ') : typeof value === 'object' ? text(value.props?.children) : String(value);
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const code = `EMDN1.${'SyntheticOnly_NotARealCredential'.repeat(4)}`;
function harness() {
  const state = { hooks: [], cursor: 0, effects: [], calls: [], timeouts: [], updates: 0, unmounted: false };
  const react = {
    useState(initial) { const index = state.cursor++; state.hooks[index] ??= { value: initial }; return [state.hooks[index].value, next => { assert.equal(state.unmounted, false, 'No updates after unmount'); state.updates++; state.hooks[index].value = typeof next === 'function' ? next(state.hooks[index].value) : next; }]; },
    useRef(initial) { const index = state.cursor++; state.hooks[index] ??= { current: initial }; return state.hooks[index]; },
    useCallback(callback, deps) { const index = state.cursor++; const previous = state.hooks[index]; if (!previous || !same(previous.deps, deps)) state.hooks[index] = { callback, deps }; return state.hooks[index].callback; },
    useEffect(effect, deps) { const index = state.cursor++; const previous = state.hooks[index]; if (!previous || !same(previous.deps, deps)) { state.hooks[index] = { deps, cleanup: previous?.cleanup }; state.effects.push(() => { state.hooks[index].cleanup?.(); state.hooks[index].cleanup = effect(); }); } },
  };
  const Component = load({ react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'next/image': { default: 'Image' } }, {
    AbortController,
    AbortSignal: { any: signals => AbortSignal.any(signals), timeout: milliseconds => { const controller = new AbortController(); state.timeouts.push({ milliseconds, controller }); return controller.signal; } },
    fetch: (url, options) => new Promise((resolve, reject) => state.calls.push({ url, ...options, parsedBody: options.body ? JSON.parse(options.body) : undefined, resolve, reject })),
  });
  const render = (effects = true) => { state.cursor = 0; const tree = Component(); if (effects) for (const effect of state.effects.splice(0)) effect(); return tree; };
  const field = (id, value) => [...elements(render(), 'input'), ...elements(render(), 'textarea')].find(item => item.props.id === id).props.onChange({ target: { value } });
  const submit = () => elements(render(), 'form')[0].props.onSubmit({ preventDefault() {} });
  const reply = async (index, body, status = 200) => { await tick(); state.calls[index].resolve(Response.json(body, { status })); await tick(); };
  const ready = async (pending = false) => { render(); await reply(0, pending ? { pending, email: 'adult@example.test' } : { pending }); };
  const button = label => elements(render(), 'button').find(item => text(item).includes(label)) ?? assert.fail(`Missing button ${label}`);
  const stop = () => { for (const hook of state.hooks) hook.cleanup?.(); state.unmounted = true; };
  const verify = async () => { await ready(); field('activation-email', ' ADULT@EXAMPLE.TEST '); field('activation-code', code); const promise = submit(); await reply(1, { verified: true, email: 'adult@example.test' }); await promise; };
  return { state, render, field, submit, reply, ready, button, stop, verify };
}

test('activation real React SSR disables fields and contains no account enrollment or token', () => {
  const Component = load({ react: React, 'react/jsx-runtime': runtime, 'next/image': { default: props => React.createElement('img', { src: props.src, alt: props.alt }) } });
  const html = renderToStaticMarkup(React.createElement(Component));
  assert.match(html, /<input(?=[^>]*id="activation-email")(?=[^>]*disabled="")[^>]*>/);
  assert.match(html, /<textarea(?=[^>]*id="activation-code")(?=[^>]*disabled="")[^>]*>/);
  assert.match(html, /Preparando activación/); assert.doesNotMatch(html, /access_token|refresh_token|name="role"|activation-password/);
});

test('early pre-hydration callback and pending read send no activation POST', async () => {
  const ui = harness(); const form = elements(ui.render(false), 'form')[0]; await form.props.onSubmit({ preventDefault() {} });
  assert.equal(ui.state.calls.length, 0); ui.render(); await tick(); await ui.submit(); assert.equal(ui.state.calls.length, 1);
  assert.equal(ui.state.calls[0].method, 'GET'); assert.equal(ui.state.calls[0].cache, 'no-store');
  assert.equal(ui.state.calls[0].credentials, 'same-origin'); assert.equal(ui.state.timeouts[0].milliseconds, 20_000);
});

test('verified receipt advances to personal password creation, erases raw code and sends no password in phase one', async () => {
  const ui = harness(); await ui.verify();
  assert.deepEqual(ui.state.calls[1].parsedBody, { email: 'adult@example.test', code });
  assert.equal(ui.state.calls[1].url, '/api/account-activation/verify');
  assert.equal(elements(ui.render(), 'textarea').length, 0); assert.match(text(ui.render()), /Crea tu contraseña|adult@example.test/);
  assert.equal(elements(ui.render(), 'input')[0].props.type, 'password');
  assert.equal(elements(ui.render(), 'input')[0].props.minLength, 12); assert.equal(elements(ui.render(), 'input')[0].props.maxLength, 128);
});

test('resumption reads only pending email from the HttpOnly provisional server session', async () => {
  const ui = harness(); await ui.ready(true);
  assert.match(text(ui.render()), /Crea tu contraseña|adult@example.test/); assert.equal(ui.state.calls.length, 1);
  assert.equal(elements(ui.render(), 'textarea').length, 0); assert.equal(ui.state.calls[0].parsedBody, undefined);
});

test('a matching password confirmed by the server finishes without logging in or exposing any session token', async () => {
  const ui = harness(); await ui.verify(); ui.field('activation-password', 'Synthetic-password-only'); ui.field('activation-confirm-password', 'Synthetic-password-only');
  const promise = ui.submit(); const second = ui.submit(); await second; assert.equal(ui.state.calls.length, 3);
  assert.deepEqual(ui.state.calls[2].parsedBody, { password: 'Synthetic-password-only', confirmPassword: 'Synthetic-password-only' });
  assert.equal(ui.state.calls[2].url, '/api/account-activation/complete');
  await ui.reply(2, { activated: true }); await promise;
  assert.match(text(ui.render()), /Tu cuenta está lista|quedó confirmada/); assert.equal(elements(ui.render(), 'input').length, 0);
  assert.ok(elements(ui.render(), 'a').some(item => item.props.href === '/ingresar')); assert.equal(ui.state.calls.length, 3);
});

for (const [label, pwd, confirm] of [['too short', 'short', 'short'], ['too long', 'a'.repeat(129), 'a'.repeat(129)], ['mismatch', 'Synthetic-password-only', 'Synthetic-other-password']]) test(`password ${label} is rejected before any write`, async () => {
  const ui = harness(); await ui.ready(true); ui.field('activation-password', pwd); ui.field('activation-confirm-password', confirm); await ui.submit();
  assert.equal(ui.state.calls.length, 1); assert.equal(elements(ui.render(), 'p').filter(item => item.props.role === 'alert').length, 1);
});

test('double invocation of one verify callback sends one private POST', async () => {
  const ui = harness(); await ui.ready(); ui.field('activation-email', 'adult@example.test'); ui.field('activation-code', code);
  const callback = elements(ui.render(), 'form')[0].props.onSubmit; const event = { preventDefault() {} };
  const first = callback(event); await callback(event); assert.equal(ui.state.calls.length, 2);
  await ui.reply(1, { verified: true, email: 'adult@example.test' }); await first;
});

for (const [body, status] of [[{ verified: true, email: 'other@example.test' }, 200], [{ verified: true, email: 'adult@example.test' }, 201], [{ access_token: 'synthetic-upstream-secret' }, 200], [null, 200], [{ error: 'Synthetic private upstream detail' }, 403]]) test(`untrusted verify receipt ${JSON.stringify(body)} status ${status} never grants password access`, async () => {
  const ui = harness(); await ui.ready(); ui.field('activation-email', 'adult@example.test'); ui.field('activation-code', code);
  const first = ui.submit(); await ui.reply(1, body, status); await first;
  assert.equal(elements(ui.render(), 'textarea')[0].props.value, code); assert.doesNotMatch(text(ui.render()), /Crea tu contraseña|synthetic-upstream-secret|upstream detail/);
  assert.equal(ui.state.calls.length, 2);
});

test('failed verify preserves email and code and does not replay, allowing only explicit user retry', async () => {
  const ui = harness(); await ui.ready(); ui.field('activation-email', 'adult@example.test'); ui.field('activation-code', code);
  const first = ui.submit(); ui.state.calls[1].reject(Error('Synthetic network failure')); await first;
  assert.equal(elements(ui.render(), 'textarea')[0].props.value, code); assert.equal(elements(ui.render(), 'input')[0].props.value, 'adult@example.test');
  assert.match(text(ui.render()), /No se pudo confirmar/); assert.equal(ui.state.calls.length, 2); assert.equal(ui.button('Verificar mi código').props.disabled, false);
});

test('timeout rejects an uncertain completion without clearing password, claiming success or retrying automatically', async () => {
  const ui = harness(); await ui.ready(true); ui.field('activation-password', 'Synthetic-password-only'); ui.field('activation-confirm-password', 'Synthetic-password-only');
  const first = ui.submit(); ui.state.timeouts[1].controller.abort(); assert.equal(ui.state.calls[1].signal.aborted, true);
  ui.state.calls[1].reject(new DOMException('Synthetic timeout', 'TimeoutError')); await first;
  assert.equal(elements(ui.render(), 'input')[0].props.value, 'Synthetic-password-only');
  assert.match(text(ui.render()), /Si ya creaste tu contraseña, intenta entrar/); assert.doesNotMatch(text(ui.render()), /Tu cuenta está lista|quedó confirmada/);
  assert.equal(ui.state.calls.length, 2);
});

test('cancel requires a confirmed server receipt before returning to code and clearing passwords', async () => {
  const ui = harness(); await ui.ready(true); ui.field('activation-password', 'Synthetic-password-only');
  ui.button('Cancelar y usar otro código').props.onClick(); assert.equal(ui.state.calls[1].url, '/api/account-activation/cancel');
  await ui.reply(1, { cancelled: true }); assert.match(text(ui.render()), /Activa tu cuenta escolar/);
  assert.equal(elements(ui.render(), 'textarea')[0].props.value, ''); assert.equal(elements(ui.render(), 'input')[0].props.value, 'adult@example.test');
});

for (const [receipt, status] of [[{ activated: false }, 200], [{ updated: true }, 200], [{ activated: true }, 201], [{ error: 'Synthetic private upstream error' }, 503]]) test(`completion ${JSON.stringify(receipt)} status ${status} is not accepted as activated`, async () => {
  const ui = harness(); await ui.ready(true); ui.field('activation-password', 'Synthetic-password-only'); ui.field('activation-confirm-password', 'Synthetic-password-only');
  const first = ui.submit(); await ui.reply(1, receipt, status); await first;
  assert.equal(elements(ui.render(), 'input')[0].props.value, 'Synthetic-password-only');
  assert.doesNotMatch(text(ui.render()), /Tu cuenta está lista|quedó confirmada|upstream error/); assert.match(text(ui.render()), /No se pudo confirmar/);
  assert.equal(ui.state.calls.length, 2);
});

test('malformed cancel receipt keeps the verified phase and password until confirmed cancellation', async () => {
  const ui = harness(); await ui.ready(true); ui.field('activation-password', 'Synthetic-password-only');
  ui.button('Cancelar y usar otro código').props.onClick(); await ui.reply(1, { cancelled: false });
  assert.equal(elements(ui.render(), 'input')[0].props.value, 'Synthetic-password-only'); assert.match(text(ui.render()), /Crea tu contraseña|No se pudo confirmar/);
});

for (const [status, code] of [[401, 'activation_expired'], [403, undefined], [409, 'activation_consumed'], [503, 'activation_consumed']]) test(`closed completion ${status} clears credentials and offers login without replay`, async () => {
  const ui = harness(); await ui.ready(true); ui.field('activation-password', 'Synthetic-password-only'); ui.field('activation-confirm-password', 'Synthetic-password-only');
  const first = ui.submit(); await ui.reply(1, { code, message: 'Synthetic private provider detail' }, status); await first;
  assert.match(text(ui.render()), /Activa tu cuenta escolar|consulta a la escuela|Consulta a la escuela/);
  assert.doesNotMatch(text(ui.render()), /Synthetic-password-only|Synthetic private provider detail|Crea tu contraseña|Tu cuenta está lista/);
  assert.equal(elements(ui.render(), 'textarea')[0].props.value, '');
  assert.equal(elements(ui.render(), 'input')[0].props.type, 'email');
  assert.ok(elements(ui.render(), 'a').some(item => item.props.href === '/ingresar'));
  assert.equal(ui.state.calls.length, 2);
});

test('unmount before the initial readiness microtask performs no request or late updates', async () => {
  const ui = harness(); ui.render(); ui.stop(); const updates = ui.state.updates; await tick();
  assert.equal(ui.state.calls.length, 0); assert.equal(ui.state.updates, updates);
});

test('invalid email and short or unexpected-format codes stay in phase one without writes', async () => {
  for (const [email, badCode] of [['not-email', code], ['adult@example.test', '123456'], ['adult@example.test', 'https://example.test/activation']]) {
    const ui = harness(); await ui.ready(); ui.field('activation-email', email); ui.field('activation-code', badCode); await ui.submit();
    assert.equal(ui.state.calls.length, 1); assert.match(text(ui.render()), /No pudimos verificar el código/);
  }
});

test('a failed initial read blocks writes, reports no fake activation and offers a GET-only retry', async () => {
  const ui = harness(); ui.render(); await ui.reply(0, {}, 503);
  assert.equal(ui.button('Verificar mi código').props.disabled, true); assert.match(text(ui.render()), /No se pudo confirmar/);
  ui.button('Volver a comprobar').props.onClick(); assert.equal(ui.state.calls[1].method, 'GET');
  await ui.reply(1, { pending: false }); assert.equal(ui.button('Verificar mi código').props.disabled, false);
});

test('malformed pending session without an email cannot expose a password form', async () => {
  const ui = harness(); ui.render(); await ui.reply(0, { pending: true });
  assert.doesNotMatch(text(ui.render()), /Crea tu contraseña/); assert.equal(ui.button('Verificar mi código').props.disabled, true);
});

test('unmount aborts pending reads and writes and ignores all late state changes', async () => {
  const read = harness(); read.render(); await tick(); read.stop(); const readUpdates = read.state.updates;
  assert.equal(read.state.calls[0].signal.aborted, true); await read.reply(0, { pending: true, email: 'adult@example.test' }); assert.equal(read.state.updates, readUpdates);
  const write = harness(); await write.ready(); write.field('activation-email', 'adult@example.test'); write.field('activation-code', code);
  const first = write.submit(); write.stop(); const writeUpdates = write.state.updates;
  assert.equal(write.state.calls[1].signal.aborted, true); await write.reply(1, { verified: true, email: 'adult@example.test' }); await first;
  assert.equal(write.state.updates, writeUpdates);
});

test('public activation source has no client auth, persistent secret storage or query-driven code', () => {
  assert.doesNotMatch(readFileSync(new URL('../app/activar-cuenta/page.tsx', import.meta.url), 'utf8'), /localStorage|sessionStorage|access_token|refresh_token|authClient|useSearchParams|location\.search/);
});
