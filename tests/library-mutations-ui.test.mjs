import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import * as limits from '../lib/school-upload-limits.ts';
import { libraryListUrl, libraryPreviewKind } from '../lib/library-query.ts';

const group = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Grupo sintético' };
const material = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', fileId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', groupId: group.id, groupName: group.name, title: 'Guía sintética', category: 'Categoría privada', publishedAt: '2026-10-12T10:00:00Z', fileName: 'guia.pdf', mimeType: 'application/pdf', sizeBytes: 50 };
const file = () => new File(['%PDF-1.7 synthetic'], 'nuevo.pdf', { type: 'application/pdf' });
const feed = (items = [material], page = 1) => ({ items, total: items.length, categories: items.length ? [material.category] : [], page, pageSize: 12 });
const uploadReceipt = { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'nuevo.pdf', sizeBytes: file().size };
const replacementReceipt = { id: material.id, fileId: material.fileId, name: 'nuevo.pdf', mimeType: 'application/pdf', sizeBytes: file().size };
const source = ts.transpileModule(readFileSync(new URL('../app/biblioteca/library-manager.tsx', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const jsx = (type, props) => ({ type, props });
function load(react, runtime, globals = {}) {
  const sandboxModule = { exports: {} };
  const deps = { react, 'react/jsx-runtime': runtime, '@/lib/library-query': { libraryListUrl, libraryPreviewKind }, '@/lib/school-upload-limits': limits, './library-preview': { LibraryPreview: 'LibraryPreview' }, './library.module.css': { default: {}, __esModule: true } };
  vm.runInNewContext(source, { module: sandboxModule, exports: sandboxModule.exports, require: name => deps[name] ?? assert.fail(`Unexpected dependency ${name}`), ...globals });
  return sandboxModule.exports.LibraryManager;
}
function elements(tree, type) {
  const out = []; function walk(value) { if (!value || typeof value !== 'object') return; if (Array.isArray(value)) return value.forEach(walk); if (value.type === type) out.push(value); walk(value.props?.children); } walk(tree); return out;
}
const text = value => value == null || typeof value === 'boolean' ? '' : Array.isArray(value) ? value.map(text).join(' ') : typeof value === 'object' ? text(value.props?.children) : String(value);
const tick = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
function harness() {
  const state = { hooks: [], cursor: 0, layout: [], effects: [], calls: [], deadlines: [], updates: 0, unmounted: false, confirms: 0, props: { groups: [group], canUpload: true, uploadsReady: true } };
  const registerEffect = (effect, deps, queue) => {
    const index = state.cursor++; const old = state.hooks[index];
    if (!old || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) {
      const hook = { deps, cleanup: old?.cleanup }; state.hooks[index] = hook;
      queue.push(() => { hook.cleanup?.(); hook.cleanup = effect(); });
    }
  };
  const react = {
    useState(initial) { const index = state.cursor++; state.hooks[index] ??= { value: initial }; return [state.hooks[index].value, next => { assert.equal(state.unmounted, false, 'No updates after unmount'); state.updates++; state.hooks[index].value = typeof next === 'function' ? next(state.hooks[index].value) : next; }]; },
    useRef(initial) { const index = state.cursor++; return state.hooks[index] ??= { current: initial }; },
    useEffect(effect, deps) { registerEffect(effect, deps, state.effects); },
    useLayoutEffect(effect, deps) { registerEffect(effect, deps, state.layout); },
  };
  class SyntheticFormData extends FormData { constructor(form) { super(); for (const [key, value] of Object.entries(form?.fields ?? {})) this.set(key, value); } }
  const Component = load(react, { jsx, jsxs: jsx }, {
    File, FormData: SyntheticFormData, AbortController,
    AbortSignal: { any: signals => AbortSignal.any(signals), timeout: ms => { const controller = new AbortController(); state.deadlines.push({ ms, controller }); return controller.signal; } },
    fetch: (url, options) => new Promise((resolve, reject) => state.calls.push({ url, ...options, resolve, reject })),
    window: { confirm() { state.confirms++; return true; } },
  });
  const render = (props = {}) => { Object.assign(state.props, props); state.cursor = 0; const tree = Component(state.props); for (const callback of state.layout.splice(0)) callback(); for (const callback of state.effects.splice(0)) callback(); return tree; };
  const button = label => elements(render(), 'button').find(item => text(item) === label) ?? assert.fail(`Missing button ${label}`);
  const reply = async (index, data, status = 200) => { state.calls[index].resolve(Response.json(data, { status })); await tick(); };
  const ready = async () => { render(); await reply(0, feed()); };
  const upload = () => {
    const form = { fields: { file: file(), groupId: group.id, title: 'Nueva guía', category: 'Guía' }, resets: 0, reset() { this.resets++; } };
    const callback = elements(render(), 'form').find(item => item.props.className === 'school-form event-form').props.onSubmit;
    const event = { preventDefault() {}, currentTarget: form }; return { form, callback, event, promise: callback(event) };
  };
  const replace = () => {
    button('Reemplazar archivo').props.onClick();
    const callback = elements(render(), 'input').find(item => item.props.hidden).props.onChange;
    const event = { currentTarget: { files: [file()], value: 'selection' } }; callback(event); return { callback, event };
  };
  const remove = () => { const callback = button('Retirar').props.onClick; return { callback, promise: callback() }; };
  const open = () => button('Vista previa').props.onClick();
  const stop = () => { for (const hook of state.hooks) hook.cleanup?.(); state.unmounted = true; };
  return { state, render, button, reply, ready, upload, replace, remove, open, stop };
}

test('library SSR blocks mutation until its first authenticated feed and shows no false empty result', () => {
  const Component = load(React, jsxRuntime); const html = renderToStaticMarkup(React.createElement(Component, { groups: [group], canUpload: true, uploadsReady: true }));
  assert.match(html, /Cargando recursos/); assert.match(html, /<button disabled="">Subir y compartir/); assert.doesNotMatch(html, /No hay recursos que coincidan/);
});

test('library GET and mutations send same-origin no-store requests with 20/60-second deadlines', async () => {
  const ui = harness(); await ui.ready(); ui.upload();
  assert.equal(ui.state.calls[0].credentials, 'same-origin'); assert.equal(ui.state.calls[0].cache, 'no-store'); assert.equal(ui.state.deadlines[0].ms, 20_000);
  assert.equal(ui.state.calls[1].credentials, 'same-origin'); assert.equal(ui.state.calls[1].cache, 'no-store'); assert.equal(ui.state.deadlines[1].ms, 60_000);
});

test('same upload callback reentry and simultaneous retire issue only one write', async () => {
  const ui = harness(); await ui.ready(); const retire = ui.button('Retirar').props.onClick; const first = ui.upload(); await first.callback(first.event); await retire();
  assert.equal(ui.state.calls.length, 2); assert.equal(ui.state.confirms, 0); assert.equal(ui.button('Subiendo…').props.disabled, true);
  await ui.reply(1, uploadReceipt, 201); await first.promise; assert.equal(first.form.resets, 1);
});

test('same retire callback reentry asks once and sends one DELETE', async () => {
  const ui = harness(); await ui.ready(); const first = ui.remove(); await first.callback();
  assert.equal(ui.state.confirms, 1); assert.equal(ui.state.calls.length, 2); assert.equal(ui.state.calls[1].method, 'DELETE');
  await ui.reply(1, { ok: true }); await first.promise;
});

test('reentrant replacement selection cannot duplicate a pending POST', async () => {
  const ui = harness(); await ui.ready(); const select = ui.button('Reemplazar archivo').props.onClick; const first = ui.replace();
  select(); first.callback(first.event); assert.equal(ui.state.calls.length, 2); assert.equal(first.event.currentTarget.value, '');
  await ui.reply(1, replacementReceipt); assert.match(text(ui.render()), /Se reemplazó/);
});

for (const kind of ['upload', 'replace', 'remove']) test(`confirmed ${kind} survives GET503 with no reset/replay of its successful write`, async () => {
  const ui = harness(); await ui.ready(); ui.open(); const attempt = ui[kind]();
  await ui.reply(1, kind === 'upload' ? uploadReceipt : kind === 'replace' ? replacementReceipt : { ok: true }, kind === 'upload' ? 201 : 200);
  if (attempt.promise) await attempt.promise;
  if (kind === 'upload') assert.equal(attempt.form.resets, 1);
  const expected = kind === 'upload' ? /Material publicado/ : kind === 'replace' ? /Se reemplazó/ : /Se retiró/;
  assert.match(text(ui.render()), expected); assert.equal(elements(ui.render(), 'LibraryPreview').length, 0);
  await ui.reply(2, {}, 503); assert.match(text(ui.render()), expected); assert.match(text(ui.render()), /No se pudieron consultar/);
  assert.equal(ui.button('Subir y compartir').props.disabled, true); ui.button('Consultar recursos').props.onClick(); ui.render(); await ui.reply(3, feed());
  assert.equal(ui.button('Subir y compartir').props.disabled, false); assert.equal(ui.state.calls.filter(call => call.method).length, 1);
});

for (const [payload, status] of [[{}, 201], [{ ...uploadReceipt, id: 'texto' }, 201], [uploadReceipt, 200], [{ ...uploadReceipt, sizeBytes: 0 }, 201]]) test(`invalid upload receipt ${JSON.stringify(payload)} ${status} never resets, claims success or replays`, async () => {
  const ui = harness(); await ui.ready(); const attempt = ui.upload(); await ui.reply(1, payload, status); await attempt.promise;
  assert.equal(attempt.form.resets, 0); assert.match(text(ui.render()), /No se pudo confirmar/); assert.doesNotMatch(text(ui.render()), /Material publicado/);
  await attempt.callback(attempt.event); assert.equal(ui.state.calls.length, 2);
});

for (const payload of [{ ...replacementReceipt, id: group.id }, { ...replacementReceipt, fileId: group.id }, { ...replacementReceipt, mimeType: 'audio/ogg' }, { ...replacementReceipt, sizeBytes: 0 }]) test(`replacement receipt must correlate to the chosen file and valid metadata ${JSON.stringify(payload)}`, async () => {
  const ui = harness(); await ui.ready(); ui.replace(); await ui.reply(1, payload);
  assert.doesNotMatch(text(ui.render()), /Se reemplazó/); assert.match(text(ui.render()), /No se pudo confirmar/); assert.equal(ui.button('Subir y compartir').props.disabled, true);
});

test('retirement needs exactly 200 and ok true', async () => {
  for (const [data, status] of [[{ ok: false }, 200], [{ ok: true }, 201]]) {
    const ui = harness(); await ui.ready(); const attempt = ui.remove(); await ui.reply(1, data, status); await attempt.promise;
    assert.doesNotMatch(text(ui.render()), /Se retiró/); assert.match(text(ui.render()), /No se pudo confirmar/); await attempt.callback(); assert.equal(ui.state.calls.length, 2);
  }
});

test('unknown network outcome preserves form and requires explicit fresh GET before another upload', async () => {
  const ui = harness(); await ui.ready(); const attempt = ui.upload(); ui.state.calls[1].reject(Error('private transport detail')); await attempt.promise;
  assert.equal(attempt.form.resets, 0); assert.doesNotMatch(text(ui.render()), /private transport|Material publicado/); await attempt.callback(attempt.event); assert.equal(ui.state.calls.length, 2);
  ui.button('Consultar recursos').props.onClick(); ui.render(); await ui.reply(2, feed()); ui.upload(); assert.equal(ui.state.calls.length, 4);
});

for (const status of [401, 403]) test(`write${status} removes all private material/category/preview data and stale handlers`, async () => {
  const ui = harness(); await ui.ready(); ui.open(); const stalePreview = ui.button('Vista previa').props.onClick; const attempt = ui.upload();
  await ui.reply(1, {}, status); await attempt.promise; stalePreview(); await attempt.callback(attempt.event);
  assert.match(text(ui.render()), /sesión o tus permisos cambiaron/); assert.doesNotMatch(text(ui.render()), /Guía sintética|Categoría privada|Grupo sintético/);
  assert.equal(elements(ui.render(), 'LibraryPreview').length, 0); assert.equal(elements(ui.render(), 'form').length, 0); assert.equal(ui.state.calls.length, 2);
});

for (const status of [401, 403]) test(`GET${status} clears an existing preview, categories and any publication notice`, async () => {
  const ui = harness(); await ui.ready(); ui.open(); const attempt = ui.upload(); await ui.reply(1, uploadReceipt, 201); await attempt.promise; ui.render(); await ui.reply(2, {}, status);
  assert.doesNotMatch(text(ui.render()), /Material publicado|Guía sintética|Categoría privada|Grupo sintético/); assert.equal(elements(ui.render(), 'LibraryPreview').length, 0);
});

test('stale GET403 cannot revoke a newer authorized filter result', async () => {
  const ui = harness(); ui.render(); ui.button('Limpiar').props.onClick(); ui.render();
  assert.equal(ui.state.calls[0].signal.aborted, true); await ui.reply(1, feed()); await ui.reply(0, {}, 403);
  assert.match(text(ui.render()), /Guía sintética/); assert.doesNotMatch(text(ui.render()), /sesión o tus permisos cambiaron/);
});

test('role change hides old data synchronously, cancels upload and ignores its late receipt', async () => {
  const ui = harness(); await ui.ready(); ui.open(); const attempt = ui.upload(); const tree = ui.render({ groups: [], canUpload: false });
  assert.equal(elements(tree, 'LibraryPreview').length, 0); assert.doesNotMatch(text(tree), /Guía sintética|Categoría privada|Grupo sintético/); assert.equal(ui.state.calls[1].signal.aborted, true);
  await tick(); await ui.reply(1, uploadReceipt, 201); await attempt.promise; assert.equal(attempt.form.resets, 0); assert.doesNotMatch(text(ui.render()), /Material publicado/);
  await attempt.callback(attempt.event); assert.equal(ui.state.calls.filter(call => call.method).length, 1);
  await ui.reply(2, feed([])); assert.equal(elements(ui.render(), 'form').filter(item => item.props.className === 'school-form event-form').length, 0);
});

test('unmount aborts pending GET and suppresses all late private-data updates', async () => {
  const ui = harness(); ui.render(); ui.stop(); const before = ui.state.updates; await ui.reply(0, feed()); assert.equal(ui.state.updates, before); assert.equal(ui.state.calls[0].signal.aborted, true);
});

test('unmount aborts write without reset, success, late state update or refresh', async () => {
  const ui = harness(); await ui.ready(); const attempt = ui.upload(); ui.stop(); const before = ui.state.updates; await ui.reply(1, uploadReceipt, 201); await attempt.promise;
  assert.equal(ui.state.updates, before); assert.equal(attempt.form.resets, 0); assert.equal(ui.state.calls.length, 2); assert.equal(ui.state.calls[1].signal.aborted, true);
});

test('GET timeout terminates loading and allows an explicit retry without exposing stale categories', async () => {
  const ui = harness(); ui.render(); ui.state.deadlines[0].controller.abort(); ui.state.calls[0].reject(new DOMException('synthetic timeout', 'TimeoutError')); await tick();
  assert.match(text(ui.render()), /No se pudieron consultar/); assert.doesNotMatch(text(ui.render()), /Cargando recursos|Categoría privada/); ui.button('Consultar recursos').props.onClick(); ui.render(); await ui.reply(1, feed()); assert.match(text(ui.render()), /Guía sintética/);
});

test('write timeout cannot claim success even if a valid receipt arrives after its deadline', async () => {
  const ui = harness(); await ui.ready(); const attempt = ui.upload(); ui.state.deadlines[1].controller.abort(); await ui.reply(1, uploadReceipt, 201); await attempt.promise;
  assert.equal(attempt.form.resets, 0); assert.doesNotMatch(text(ui.render()), /Material publicado/); assert.match(text(ui.render()), /No se pudo confirmar/); await attempt.callback(attempt.event); assert.equal(ui.state.calls.length, 2);
});

test('malformed feed cannot render a success-like empty view or enable writing', async () => {
  const ui = harness(); ui.render(); await ui.reply(0, { ...feed(), pageSize: 25 }); assert.doesNotMatch(text(ui.render()), /Guía sintética|No hay recursos que coincidan/); assert.match(text(ui.render()), /No se pudieron consultar/); assert.equal(ui.button('Subir y compartir').props.disabled, true);
});

test('non-JSON hosting413 gives the size explanation and permits a corrected upload without pretending it saved', async () => {
  const ui = harness(); await ui.ready(); const attempt = ui.upload(); ui.state.calls[1].resolve(new Response('hosting body', { status: 413 })); await attempt.promise;
  assert.match(text(ui.render()), /hasta 4 MB/); assert.equal(attempt.form.resets, 0); assert.doesNotMatch(text(ui.render()), /Material publicado|No se pudo confirmar/); await tick(); attempt.callback(attempt.event); assert.equal(ui.state.calls.length, 3);
});

test('known file rejection400 is useful and permits correction while unexpected errors remain sanitized', async () => {
  const ui = harness(); await ui.ready(); const attempt = ui.upload(); await ui.reply(1, { error: 'El contenido del archivo no coincide con su tipo.' }, 400); await attempt.promise;
  assert.match(text(ui.render()), /El contenido del archivo no coincide con su tipo/); assert.doesNotMatch(text(ui.render()), /No se pudo confirmar|Material publicado/); assert.equal(ui.button('Subir y compartir').props.disabled, false);
  const next = ui.upload(); await ui.reply(2, { error: 'secret upstream detail' }, 400); await next.promise; assert.doesNotMatch(text(ui.render()), /secret upstream/); assert.equal(ui.button('Subir y compartir').props.disabled, true);
});

for (const kind of ['replace', 'remove']) test(`${kind}404 clears unavailable material, preview and actions until another GET`, async () => {
  const ui = harness(); await ui.ready(); ui.open(); const attempt = ui[kind](); await ui.reply(1, { error: 'Recurso no disponible.' }, 404); if (attempt.promise) await attempt.promise;
  assert.doesNotMatch(text(ui.render()), /Guía sintética|Categoría privada|Se retiró|Se reemplazó/); assert.equal(elements(ui.render(), 'LibraryPreview').length, 0); assert.equal(ui.button('Subir y compartir').props.disabled, true);
  ui.button('Consultar recursos').props.onClick(); ui.render(); await ui.reply(2, feed([])); assert.equal(elements(ui.render(), 'li').length, 0); assert.equal(ui.button('Subir y compartir').props.disabled, false);
});

test('empty or unsupported file MIME and invalid title are rejected locally before any POST', async () => {
  const ui = harness(); await ui.ready(); const callback = elements(ui.render(), 'form').find(item => item.props.className === 'school-form event-form').props.onSubmit;
  for (const fields of [
    { file: new File(['synthetic'], 'unknown.wav', { type: 'audio/x-wav' }), title: 'Guía', category: 'Guía' },
    { file: new File(['synthetic'], 'unknown.pdf'), title: 'Guía', category: 'Guía' },
    { file: file(), title: 'x', category: 'Guía' },
    { file: new File([], 'empty.pdf', { type: 'application/pdf' }), title: 'Guía', category: 'Guía' },
  ]) await callback({ preventDefault() {}, currentTarget: { fields: { groupId: group.id, ...fields } } });
  assert.equal(ui.state.calls.length, 1); assert.doesNotMatch(text(ui.render()), /Material publicado/);
});

test('upload and replacement require matching sanitized file name and exact PDF bytes in receipt', async () => {
  for (const kind of ['upload', 'replace']) for (const bad of [{ name: 'different.pdf' }, { sizeBytes: file().size + 1 }]) {
    const ui = harness(); await ui.ready(); const attempt = ui[kind](); await ui.reply(1, { ...(kind === 'upload' ? uploadReceipt : replacementReceipt), ...bad }, kind === 'upload' ? 201 : 200); if (attempt.promise) await attempt.promise;
    assert.doesNotMatch(text(ui.render()), /Material publicado|Se reemplazó/); assert.match(text(ui.render()), /No se pudo confirmar/);
  }
});
