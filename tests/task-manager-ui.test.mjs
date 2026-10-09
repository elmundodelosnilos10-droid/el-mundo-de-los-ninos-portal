import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import * as limits from '../lib/school-upload-limits.ts';

const task = (id, stage = 'preescolar') => ({ id, groupId: 'group', groupName: 'Synthetic group', stage, title: `Task ${id}`, instructions: 'Synthetic instructions', dueAt: null, files: [], studentStatuses: [{ studentId: 'child', status: 'pendiente' }] });
const A = task('A'), B = task('B', 'maternal');
const submission = id => ({ id: `submission-${id}`, studentId: `child-${id}`, studentName: `Child ${id}`, studentFamilyName: 'Synthetic', status: 'entregada', note: null, reviewNote: null, evaluation: null, files: [] });
const defaults = { groups: [{ id: 'group', name: 'Synthetic group' }], familyChildren: [{ id: 'child', name: 'Child', familyName: 'Synthetic' }], canCreate: true, canReview: true, uploadsReady: true };
const jsx = (type, props) => ({ type, props });
const source = ts.transpileModule(readFileSync(new URL('../app/tareas/task-manager.tsx', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const date = { schoolDateTime: value => value, schoolLocalInputToISO: value => value };
function load(react, runtime, globals = {}) {
  const sandboxModule = { exports: {} };
  const dependencies = { react, 'react/jsx-runtime': runtime, '@/lib/datetime': date, '@/lib/school-upload-limits': limits };
  vm.runInNewContext(source, { module: sandboxModule, exports: sandboxModule.exports, require: name => dependencies[name] ?? assert.fail(`Unexpected import ${name}`), ...globals });
  return sandboxModule.exports.TaskManager;
}
function elements(tree, type) {
  const out = []; function walk(value) { if (!value || typeof value !== 'object') return; if (Array.isArray(value)) { value.forEach(walk); return; } if (value.type === type) out.push(value); walk(value.props?.children); }
  walk(tree); return out;
}
const text = value => value == null || typeof value === 'boolean' ? '' : Array.isArray(value) ? value.map(text).join(' ').replace(/\s+/g, ' ') : typeof value === 'object' ? text(value.props?.children) : String(value);
const tick = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const feed = (items = [A, B], total = items.length, page = 1) => ({ items, total, page, pageSize: 25, hasMore: page * 25 < total });
const createFields = (attachments = []) => ({ groupId: 'group', title: 'New task', instructions: 'Synthetic task', dueAt: '', attachments });
function harness(overrides = {}) {
  const state = { hooks: [], cursor: 0, effects: [], calls: [], unmounted: false, updates: 0, deadlines: [] };
  const react = {
    useState(initial) { const index = state.cursor++; state.hooks[index] ??= { value: initial }; return [state.hooks[index].value, next => { assert.equal(state.unmounted, false, 'No post-unmount update'); state.updates++; state.hooks[index].value = typeof next === 'function' ? next(state.hooks[index].value) : next; }]; },
    useRef(initial) { const index = state.cursor++; state.hooks[index] ??= { current: initial }; return state.hooks[index]; },
    useCallback(callback, deps) { const index = state.cursor++; if (!state.hooks[index] || !same(state.hooks[index].deps, deps)) state.hooks[index] = { callback, deps }; return state.hooks[index].callback; },
    useEffect(effect, deps) { const index = state.cursor++; const previous = state.hooks[index]; if (!previous || !same(previous.deps, deps)) { state.hooks[index] = { deps, cleanup: previous?.cleanup }; state.effects.push(() => { state.hooks[index].cleanup?.(); state.hooks[index].cleanup = effect(); }); } },
  };
  class SyntheticFormData extends FormData { constructor(form) { super(); for (const [key, value] of Object.entries(form?.fields ?? {})) { if (Array.isArray(value)) for (const item of value) this.append(key, item); else this.set(key, value); } } }
  const Component = load(react, { jsx, jsxs: jsx }, {
    File, FormData: SyntheticFormData, AbortController,
    AbortSignal: { any: signals => AbortSignal.any(signals), timeout: ms => { const controller = new AbortController(); state.deadlines.push({ ms, controller }); return controller.signal; } },
    fetch: (url, options) => new Promise((resolve, reject) => state.calls.push({ url, ...options, bodyJson: typeof options.body === 'string' ? JSON.parse(options.body) : null, resolve, reject })),
  });
  const render = () => { state.cursor = 0; const tree = Component({ ...defaults, ...overrides }); for (const effect of state.effects.splice(0)) effect(); return tree; };
  const button = label => elements(render(), 'button').find(item => text(item).includes(label)) ?? assert.fail(`Missing button ${label}`);
  const reply = async (index, data, status = 200) => { state.calls[index].resolve(Response.json(data, { status })); await tick(); };
  const ready = async (data = feed()) => { render(); await reply(0, data); };
  const open = index => elements(render(), 'button').filter(item => text(item) === 'Revisar entregas' || text(item) === 'Ver mi entrega')[index].props.onClick();
  const submit = (index, fields) => { const form = { fields, resets: 0, reset() { this.resets++; } }; const promise = elements(render(), 'form')[index].props.onSubmit({ preventDefault() {}, currentTarget: form }); return { form, promise }; };
  const review = fields => submit(elements(render(), 'form').length - 1, fields);
  const stop = () => { for (const hook of state.hooks) hook.cleanup?.(); state.unmounted = true; };
  return { state, render, button, reply, ready, open, submit, review, stop };
}

test('actual React SSR exposes loading and blocks task submission before its authenticated read', () => {
  const Component = load(React, jsxRuntime); const html = renderToStaticMarkup(React.createElement(Component, defaults));
  assert.match(html, /Cargando tareas/); assert.match(html, /<button disabled="">Publicar tarea/);
  assert.doesNotMatch(html, /No hay entregas registradas/);
});

test('default list GET uses server pagination 25 and a 20-second cancellation deadline', async () => {
  const ui = harness(); ui.render(); ui.submit(0, createFields()); assert.equal(ui.state.calls.length, 1);
  assert.equal(ui.state.calls[0].url, '/api/tasks?page=1&pageSize=25'); assert.equal(ui.state.calls[0].credentials, 'same-origin'); assert.equal(ui.state.calls[0].cache, 'no-store'); assert.equal(ui.state.deadlines[0].ms, 20_000);
  await ui.reply(0, feed()); assert.match(text(ui.render()), /Página 1 de 1/);
});

for (const order of [[1, 0], [0, 1]]) test(`A to B selection discards both stale arrival orders ${order}`, async () => {
  const ui = harness(); await ui.ready(); ui.open(0); ui.open(1); assert.equal(ui.state.calls[1].signal.aborted, true);
  assert.match(text(ui.render()), /Comprobando entregas/); assert.doesNotMatch(text(ui.render()), /No hay entregas registradas/);
  for (const index of order) await ui.reply(index + 1, { items: [submission(index ? 'B' : 'A')] });
  const section = elements(ui.render(), 'section').find(item => elements(item, 'h2').some(h => text(h).includes('Task B')));
  assert.match(text(section), /Child B/); assert.doesNotMatch(text(section), /Child A/);
  assert.match(text(section), /observaciones cualitativas/); assert.equal(elements(section, 'select').filter(item => item.props.name === 'evaluation').length, 0);
});

test('switching selection clears an already loaded list before B succeeds or fails', async () => {
  const ui = harness(); await ui.ready(); ui.open(0); await ui.reply(1, { items: [submission('A')] });
  ui.open(1); assert.doesNotMatch(text(ui.render()), /Child A/); await ui.reply(2, {}, 503);
  assert.doesNotMatch(text(ui.render()), /Child A|No hay entregas registradas/); assert.match(text(ui.render()), /No se pudo confirmar la lista/);
});

test('a stale review callback cannot mutate the previous task after selection changed', async () => {
  const ui = harness(); await ui.ready(); ui.open(0); await ui.reply(1, { items: [submission('A')] });
  const previous = elements(ui.render(), 'form').at(-1).props.onSubmit;
  ui.open(1); previous({ preventDefault() {}, currentTarget: { fields: { status: 'completada', reviewNote: 'Synthetic', evaluation: 'logrado' } } });
  assert.equal(ui.state.calls.filter(call => call.method === 'PATCH').length, 0);
  await ui.reply(2, { items: [submission('B')] });
  const { promise } = ui.review({ status: 'revisada', reviewNote: 'Synthetic', evaluation: 'logrado' });
  assert.equal(ui.state.calls[3].url, '/api/submissions/submission-B'); assert.equal(ui.state.calls[3].bodyJson.evaluation, null);
  await ui.reply(3, { reviewed: true }); await ui.reply(4, feed()); await ui.reply(5, { items: [submission('B')] }); await promise;
});

test('closing a pending submissions view cancels its request and never reopens on late response', async () => {
  const ui = harness(); await ui.ready(); ui.open(0); ui.button('Cerrar').props.onClick();
  assert.equal(ui.state.calls[1].signal.aborted, true); await ui.reply(1, { items: [submission('A')] });
  assert.doesNotMatch(text(ui.render()), /Entregas ·|Child A/);
});

test('POST201 independently confirms publication and all selected uploads before GET503', async () => {
  const ui = harness(); await ui.ready(); const file = new File(['synthetic'], 'synthetic.pdf', { type: 'application/pdf' });
  const { form, promise } = ui.submit(0, createFields([file, file]));
  await ui.reply(1, { id: '00000000-0000-4000-8000-000000000001' }, 201); assert.equal(form.resets, 1); assert.match(text(ui.render()), /Tarea publicada/);
  assert.equal(ui.state.calls[2].url, '/api/files'); assert.equal(ui.state.calls[2].body.get('taskId'), '00000000-0000-4000-8000-000000000001');
  await ui.reply(2, { id: '00000000-0000-4000-8000-000000000002' }, 201); await ui.reply(3, { id: '00000000-0000-4000-8000-000000000003' }, 201);
  assert.equal(ui.state.calls[4].url, '/api/tasks?page=1&pageSize=25'); await ui.reply(4, {}, 503); await promise;
  assert.match(text(ui.render()), /Tarea publicada.*2 de 2 materiales/); assert.match(text(ui.render()), /lista de tareas/);
  assert.equal(ui.state.calls.filter(call => call.url === '/api/files').length, 2); assert.match(text(ui.render()), /Task A/);
  assert.equal(ui.button('Publicar tarea').props.disabled, true); ui.button('Actualizar tareas').props.onClick(); await ui.reply(5, feed());
  assert.equal(ui.button('Publicar tarea').props.disabled, false); assert.equal(ui.state.calls.filter(call => call.url === '/api/tasks' && call.method === 'POST').length, 1);
});

test('failed attachment retains confirmed task, stops subsequent uploads and does not replay', async () => {
  const ui = harness(); await ui.ready(); const file = new File(['synthetic'], 'synthetic.pdf', { type: 'application/pdf' });
  const { promise } = ui.submit(0, createFields([file, file])); await ui.reply(1, { id: '00000000-0000-4000-8000-000000000004' }, 201);
  ui.state.calls[2].reject(Error('Synthetic unknown outcome')); await tick(); await ui.reply(3, feed()); await promise;
  assert.match(text(ui.render()), /Tarea publicada/); assert.match(text(ui.render()), /Revisa sus materiales/);
  assert.equal(ui.state.calls.filter(call => call.url === '/api/files').length, 1);
});

test('synchronous double submit and double review cause one write each', async () => {
  const ui = harness(); await ui.ready(); const first = ui.submit(0, createFields()), second = ui.submit(0, createFields()); await second.promise;
  assert.equal(ui.state.calls.length, 2); await ui.reply(1, { id: '00000000-0000-4000-8000-000000000005' }, 201); await ui.reply(2, feed()); await first.promise;
  ui.open(0); await ui.reply(3, { items: [submission('A')] }); const fields = { status: 'revisada', reviewNote: 'Synthetic', evaluation: '' };
  const review = ui.review(fields); ui.review(fields); ui.open(1); ui.button('Cerrar').props.onClick();
  assert.equal(ui.state.calls.length, 5); assert.match(text(ui.render()), /Task A/);
  await ui.reply(4, { reviewed: true }); await ui.reply(5, feed()); await ui.reply(6, { items: [submission('A')] }); await review.promise;
  assert.equal(ui.state.calls.filter(call => call.method === 'PATCH').length, 1);
});

for (const [receipt, status] of [[{}, 201], [{ id: 'texto' }, 201], [{ id: '00000000-0000-4000-8000-000000000005' }, 200]]) test(`invalid publication receipt ${status} never resets, uploads or claims success`, async () => {
  const ui = harness(); await ui.ready(); const { form, promise } = ui.submit(0, createFields()); await ui.reply(1, receipt, status); await promise;
  assert.equal(form.resets, 0); assert.doesNotMatch(text(ui.render()), /Tarea publicada/); assert.match(text(ui.render()), /No se pudo confirmar/);
  ui.submit(0, createFields()); assert.equal(ui.state.calls.length, 2);
});

test('invalid file and review receipts never claim their writes succeeded', async () => {
  const ui = harness(); await ui.ready(); const { form, promise } = ui.submit(1, { file: new File(['synthetic'], 'guide.pdf', { type: 'application/pdf' }) });
  await ui.reply(1, { id: 'texto' }, 201); await promise; assert.equal(form.resets, 0); assert.doesNotMatch(text(ui.render()), /Material adjuntado/);
  ui.button('Actualizar tareas').props.onClick(); await ui.reply(2, feed()); ui.open(0); await ui.reply(3, { items: [submission('A')] });
  const review = ui.review({ status: 'revisada', reviewNote: 'Synthetic', evaluation: '' }); await ui.reply(4, { reviewed: false }); await review.promise;
  assert.doesNotMatch(text(ui.render()), /Retroalimentación guardada/); assert.equal(ui.state.calls.length, 5);
});

test('page2 uses offset-capable API contract and retains page1 rows with honest page label on failure', async () => {
  const ui = harness(); await ui.ready(feed([A], 26)); assert.equal(ui.button('Anterior').props.disabled, true);
  ui.button('Siguiente').props.onClick(); ui.render(); assert.equal(ui.state.calls[1].url, '/api/tasks?page=2&pageSize=25');
  await ui.reply(1, {}, 503); assert.match(text(ui.render()), /Task A/); assert.match(text(ui.render()), /Página 1 de 2/);
  ui.button('Actualizar tareas').props.onClick(); await ui.reply(2, feed([B], 26, 2));
  assert.doesNotMatch(text(ui.render()), /Task A/); assert.match(text(ui.render()), /Página 2 de 2/); assert.equal(ui.button('Siguiente').props.disabled, true);
  ui.button('Anterior').props.onClick(); ui.render(); assert.equal(ui.state.calls[3].url, '/api/tasks?page=1&pageSize=25'); await ui.reply(3, feed([A], 26));
});

for (const status of [401, 403]) test(`GET${status} revokes private tasks/submissions and aborts late mutation`, async () => {
  const ui = harness(); await ui.ready(); ui.open(0); await ui.reply(1, { items: [submission('A')] });
  const { promise } = ui.review({ status: 'revisada', reviewNote: 'Synthetic', evaluation: '' }); await ui.reply(2, { reviewed: true }); await ui.reply(3, {}, status); await promise;
  assert.doesNotMatch(text(ui.render()), /Task A|Child A|Synthetic instructions|Retroalimentación guardada/); assert.equal(elements(ui.render(), 'form').length, 0);
  assert.match(text(ui.render()), /sesión o tus permisos cambiaron/); assert.equal(ui.state.calls[2].signal.aborted, true);
});

for (const status of [401, 403]) test(`submissionsGET${status} clears every private view and blocks stale review callback`, async () => {
  const ui = harness(); await ui.ready(); ui.open(0); await ui.reply(1, {}, status);
  assert.equal(elements(ui.render(), 'form').length, 0); assert.doesNotMatch(text(ui.render()), /Task A|Task B/); assert.equal(ui.state.calls.length, 2);
});

test('write401 clears data while write503 preserves confirmed rows without automatic replay', async () => {
  const denied = harness(); await denied.ready(); const first = denied.submit(0, createFields()); await denied.reply(1, {}, 401); await first.promise;
  assert.equal(elements(denied.render(), 'form').length, 0); assert.doesNotMatch(text(denied.render()), /Task A/);
  const failed = harness(); await failed.ready(); const second = failed.submit(0, createFields()); await failed.reply(1, { error: 'No se pudo guardar.' }, 503); await second.promise;
  assert.match(text(failed.render()), /Task A/); assert.doesNotMatch(text(failed.render()), /Tarea publicada/); assert.equal(second.form.resets, 0);
  failed.submit(0, createFields()); assert.equal(failed.state.calls.length, 2);
});

test('unmount cancels list/detail/write requests and ignores late receipts or private rows', async () => {
  const read = harness(); read.render(); read.stop(); const before = read.state.updates; await read.reply(0, feed()); assert.equal(read.state.updates, before); assert.equal(read.state.calls[0].signal.aborted, true);
  const detail = harness(); await detail.ready(); detail.open(0); detail.stop(); const detailBefore = detail.state.updates; await detail.reply(1, { items: [submission('A')] }); assert.equal(detail.state.updates, detailBefore);
  const write = harness(); await write.ready(); const { form, promise } = write.submit(0, createFields()); write.stop(); const writeBefore = write.state.updates;
  await write.reply(1, { id: '00000000-0000-4000-8000-000000000005' }, 201); await promise; assert.equal(write.state.updates, writeBefore); assert.equal(form.resets, 0); assert.equal(write.state.calls[1].signal.aborted, true);
});

test('malformed feeds and deadlines do not leave loading forever or render a false empty list', async () => {
  const ui = harness(); ui.render(); await ui.reply(0, { items: [], total: 0 }); assert.match(text(ui.render()), /No pudimos comprobar/);
  ui.button('Actualizar tareas').props.onClick(); ui.state.deadlines[1].controller.abort(); ui.state.calls[1].reject(new DOMException('Synthetic timeout', 'TimeoutError')); await tick();
  assert.match(text(ui.render()), /No se pudo actualizar/); assert.equal(ui.button('Actualizar tareas').props.disabled, false);
});

test('confirmed review survives failed list refresh and remains attached to its selected task', async () => {
  const ui = harness(); await ui.ready(); ui.open(0); await ui.reply(1, { items: [submission('A')] });
  const { promise } = ui.review({ status: 'completada', reviewNote: 'Synthetic', evaluation: 'logrado' });
  await ui.reply(2, { reviewed: true }); assert.match(text(ui.render()), /Retroalimentación guardada/);
  await ui.reply(3, {}, 503); await ui.reply(4, { items: [{ ...submission('A'), status: 'completada', evaluation: 'logrado' }] }); await promise;
  assert.match(text(ui.render()), /Retroalimentación guardada/); assert.match(text(ui.render()), /Child A/); assert.match(text(ui.render()), /Logrado/);
  assert.equal(ui.button('Guardar retroalimentación').props.disabled, true);
  assert.equal(ui.state.calls.filter(call => call.method === 'PATCH').length, 1);
});

test('old selection403 is discarded after current authorized selection succeeds', async () => {
  const ui = harness(); await ui.ready(); ui.open(0); ui.open(1);
  await ui.reply(2, { items: [submission('B')] }); await ui.reply(1, {}, 403);
  assert.match(text(ui.render()), /Child B/); assert.doesNotMatch(text(ui.render()), /sesión o tus permisos/);
});

test('a lost POST receipt has no reset, success or automatic retry and needs a fresh read', async () => {
  const ui = harness(); await ui.ready(); const { form, promise } = ui.submit(0, createFields());
  ui.state.calls[1].reject(Error('Synthetic private connection detail')); await promise;
  assert.equal(form.resets, 0); assert.match(text(ui.render()), /No se pudo confirmar/); assert.doesNotMatch(text(ui.render()), /Tarea publicada|private connection/);
  ui.submit(0, createFields()); assert.equal(ui.state.calls.length, 2);
  ui.button('Actualizar tareas').props.onClick(); await ui.reply(2, feed()); assert.equal(ui.button('Publicar tarea').props.disabled, false);
});

test('pending write locks attachment fields and independent uploads use one shared mutation lock', async () => {
  const ui = harness(); await ui.ready(); const file = new File(['synthetic'], 'guide.pdf', { type: 'application/pdf' });
  const first = ui.submit(1, { file }), second = ui.submit(2, { studentId: 'child', file }); await second.promise;
  assert.equal(ui.state.calls.length, 2); assert.ok(elements(ui.render(), 'input').filter(input => input.props.type === 'file').every(input => input.props.disabled));
  await ui.reply(1, { id: '00000000-0000-4000-8000-000000000006' }, 201); assert.match(text(ui.render()), /Material adjuntado/); await ui.reply(2, {}, 503); await first.promise;
  assert.match(text(ui.render()), /Material adjuntado/); assert.equal(first.form.resets, 1);
  assert.equal(ui.state.calls.filter(call => call.url === '/api/files').length, 1);
});
