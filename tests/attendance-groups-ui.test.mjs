import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const group = (n, name = `Group ${n}`) => ({ id: id(n), yearId: id(100), name, stage: 'maternal', active: true });
const year = { id: id(100), name: 'Synthetic 2026', startsOn: '2026-01-01', endsOn: '2026-12-31', active: true };
const roster = n => ({ studentId: id(n + 10), givenName: `Child ${n}`, familyName: 'Synthetic', status: null, note: null });
const justification = n => ({ id: id(n + 20), studentId: id(n + 10), studentName: `Child ${n}`, studentFamilyName: 'Synthetic', groupName: `Group ${n}`, onDate: '2026-10-12', reason: `Reason ${n}`, status: 'pendiente', createdAt: '2026-10-12' });
const students = [1, 2].map(n => ({ id: id(n + 10), name: `Child ${n}`, familyName: 'Synthetic', displayName: `Child ${n} Synthetic`, groupId: id(n) }));
const defaults = {
  AttendanceManager: { groups: [group(1), group(2)], historyStudents: students, canEdit: true, canReportAll: false },
  GroupManager: { initialYears: [year], initialGroups: [group(1)], initialTotal: 1, selectableGroups: [group(1)], teachers: [{ id: id(200), name: 'Synthetic teacher', email: 'teacher@example.test' }] },
};
const modules = Object.fromEntries(['AttendanceManager', 'GroupManager'].map(name => [name, ts.transpileModule(readFileSync(new URL(name === 'AttendanceManager' ? '../app/asistencia/attendance-manager.tsx' : '../app/grupos/group-manager.tsx', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText]));
const jsx = (type, props) => ({ type, props });
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
function elements(tree, type) { const out = []; function walk(value) { if (!value || typeof value !== 'object') return; if (Array.isArray(value)) { value.forEach(walk); return; } if (value.type === type) out.push(value); walk(value.props?.children); } walk(tree); return out; }
const text = value => value == null || typeof value === 'boolean' ? '' : Array.isArray(value) ? value.map(text).join(' ').replace(/\s+/g, ' ') : typeof value === 'object' ? text(value.props?.children) : String(value);
const tick = async () => { for (let n = 0; n < 8; n++) await new Promise(resolve => setImmediate(resolve)); };
function load(name, react, runtime, globals = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(modules[name], { module: mod, exports: mod.exports, URLSearchParams, require: name => ({ react, 'react/jsx-runtime': runtime, '@/lib/datetime': { schoolDateKey: () => '2026-10-12' } })[name] ?? assert.fail(`Unexpected dependency ${name}`), ...globals });
  return mod.exports[name];
}
function harness(name, overrides = {}) {
  const state = { hooks: [], cursor: 0, layouts: [], effects: [], calls: [], unmounted: false, downloads: [], deadlines: [] };
  function effect(effect, deps, queue) { const index = state.cursor++, previous = state.hooks[index]; if (!previous || !same(previous.deps, deps)) { state.hooks[index] = { deps, cleanup: previous?.cleanup }; queue.push(() => { state.hooks[index].cleanup?.(); state.hooks[index].cleanup = effect(); }); } }
  const react = {
    useState(initial) { const index = state.cursor++; state.hooks[index] ??= { value: typeof initial === 'function' ? initial() : initial }; return [state.hooks[index].value, next => { assert.equal(state.unmounted, false, 'No update after unmount'); state.hooks[index].value = typeof next === 'function' ? next(state.hooks[index].value) : next; }]; },
    useRef(initial) { const index = state.cursor++; state.hooks[index] ??= { current: initial }; return state.hooks[index]; },
    useCallback(callback, deps) { const index = state.cursor++; if (!state.hooks[index] || !same(state.hooks[index].deps, deps)) state.hooks[index] = { deps, callback }; return state.hooks[index].callback; },
    useLayoutEffect(callback, deps) { effect(callback, deps, state.layouts); }, useEffect(callback, deps) { effect(callback, deps, state.effects); },
  };
  class SyntheticFormData extends FormData { constructor(form) { super(); for (const [key, value] of Object.entries(form?.fields ?? {})) this.set(key, value); } }
  const Component = load(name, react, { jsx, jsxs: jsx }, {
    FormData: SyntheticFormData, AbortController, queueMicrotask,
    AbortSignal: { any: signals => AbortSignal.any(signals), timeout: ms => { const controller = new AbortController(); state.deadlines.push({ ms, controller }); return controller.signal; } },
    URL: { createObjectURL: () => 'blob:synthetic', revokeObjectURL() {} }, URLSearchParams,
    window: { setTimeout(callback) { callback(); } }, document: { body: { appendChild() {} }, createElement() { const link = { click() { state.downloads.push(link.download); }, remove() {} }; return link; } },
    fetch: (url, options = {}) => new Promise((resolve, reject) => state.calls.push({ url, ...options, bodyJson: typeof options.body === 'string' ? JSON.parse(options.body) : null, resolve, reject })),
  });
  const render = () => { state.cursor = 0; const tree = Component({ ...defaults[name], ...overrides }); for (const effect of [...state.layouts.splice(0), ...state.effects.splice(0)]) effect(); return tree; };
  const button = label => elements(render(), 'button').find(element => text(element) === label) ?? assert.fail(`Missing button ${label}`);
  const input = label => elements(render(), 'select').concat(elements(render(), 'input')).find(element => element.props.id === label || element.props['aria-label'] === label) ?? assert.fail(`Missing control ${label}`);
  const change = (label, value) => input(label).props.onChange({ target: { value } });
  const submit = (index, fields = {}) => { const form = { fields, resets: 0, reset() { this.resets++; } }; const promise = elements(render(), 'form')[index].props.onSubmit({ preventDefault() {}, currentTarget: form }); return { form, promise }; };
  const reply = async (index, data, status = 200) => { state.calls[index].resolve(Response.json(data, { status })); await tick(); };
  const ready = async () => { render(); await tick(); if (name === 'AttendanceManager') { await reply(0, { items: [roster(1)] }); await reply(1, { items: [justification(1)] }); } else await reply(0, { items: [group(1)], total: 1, page: 1, pageSize: 10 }); render(); };
  const stop = () => { for (const hook of state.hooks) hook.cleanup?.(); state.unmounted = true; };
  return { state, render, button, input, change, submit, reply, ready, stop };
}
const groupsFields = { name: 'Repeated name', yearId: id(100), stage: 'maternal' };
const yearFields = { name: 'Synthetic 2027', startsOn: '2027-01-01', endsOn: '2027-12-31' };
const assignmentFields = { groupId: id(1), teacherId: id(200) };

for (const name of ['AttendanceManager', 'GroupManager']) test(`${name} real React SSR exposes a pending read and disabled writes`, () => {
  const Component = load(name, React, jsxRuntime); const html = renderToStaticMarkup(React.createElement(Component, defaults[name])); assert.match(html, /Comprobando/); assert.match(html, /<button[^>]*disabled=""/);
});

test('attendance initial history selection belongs to the selected group even when props are differently ordered', async () => {
  const ui = harness('AttendanceManager', { historyStudents: [...students].reverse() }); await ui.ready();
  const select = elements(ui.render(), 'select').find(element => elements(element, 'option').some(option => text(option).includes('Child 1')) && element.props.required); assert.equal(select.props.value, id(11));
});

test('attendance clears loaded A immediately on B selection and prevents its saved callback from writing', async () => {
  const ui = harness('AttendanceManager'); await ui.ready(); const oldSave = elements(ui.render(), 'form')[0].props.onSubmit;
  const select = elements(ui.render(), 'select')[0]; select.props.onChange({ target: { value: id(2) } });
  assert.doesNotMatch(text(ui.render()), /Child 1 Synthetic|Reason 1/); await oldSave({ preventDefault() {} }); assert.equal(ui.state.calls.filter(call => call.method === 'POST').length, 0);
  await tick(); await ui.reply(2, { items: [roster(2)] }); await ui.reply(3, { items: [justification(2)] }); assert.match(text(ui.render()), /Child 2 Synthetic/);
});

for (const order of [[0, 1], [1, 0]]) test(`attendance discards late group A result after B is selected in arrival order ${order}`, async () => {
  const ui = harness('AttendanceManager'); ui.render(); await tick(); elements(ui.render(), 'select')[0].props.onChange({ target: { value: id(2) } }); ui.render(); await tick();
  for (const offset of order) await ui.reply(offset ? 2 : 0, { items: [roster(offset ? 2 : 1)] }); await ui.reply(3, { items: [] }); await ui.reply(1, {}, 403);
  assert.match(text(ui.render()), /Child 2 Synthetic/); assert.doesNotMatch(text(ui.render()), /Child 1 Synthetic|Acceso a asistencia no disponible/);
});

test('teacher report after selecting group B exports group B rather than the initial group A', async () => {
  const ui = harness('AttendanceManager'); await ui.ready(); elements(ui.render(), 'select')[0].props.onChange({ target: { value: id(2) } }); ui.render(); await tick();
  await ui.reply(2, { items: [roster(2)] }); await ui.reply(3, { items: [] }); const promise = ui.button('Descargar reporte').props.onClick();
  assert.equal(ui.state.calls[4].bodyJson.groupId, id(2)); ui.state.calls[4].resolve(new Response('synthetic csv', { status: 200 })); await promise; assert.equal(ui.state.downloads.length, 1);
});

test('attendance synchronous double submit writes once and locks context while pending', async () => {
  const ui = harness('AttendanceManager'); await ui.ready(); const first = ui.submit(0); await ui.submit(0).promise;
  elements(ui.render(), 'select')[0].props.onChange({ target: { value: id(2) } }); assert.equal(elements(ui.render(), 'select')[0].props.value, id(1)); assert.equal(ui.state.calls.length, 3);
  await ui.reply(2, { saved: 1 }); await ui.reply(3, { items: [roster(1)] }); await first.promise; assert.match(text(ui.render()), /Asistencia guardada para 1/);
});

test('attendance confirmed save survives failed read and requires a fresh read without repeating POST', async () => {
  const ui = harness('AttendanceManager'); await ui.ready(); const first = ui.submit(0); await ui.reply(2, { saved: 1 }); await ui.reply(3, {}, 503); await first.promise;
  assert.match(text(ui.render()), /Asistencia guardada para 1/); assert.equal(ui.button('Guardar asistencia').props.disabled, true); await ui.submit(0).promise; assert.equal(ui.state.calls.length, 4);
  ui.button('Consultar estado de nuevo').props.onClick(); await ui.reply(4, { items: [roster(1)] }); await ui.reply(5, { items: [] }); assert.equal(ui.button('Guardar asistencia').props.disabled, false);
  assert.equal(ui.state.calls.filter(call => call.method === 'POST').length, 1);
});

test('attendance malformed save receipt cannot claim success and preserves data for review', async () => {
  const ui = harness('AttendanceManager'); await ui.ready(); const first = ui.submit(0); await ui.reply(2, { saved: 0 }); await first.promise;
  assert.match(text(ui.render()), /No se pudo confirmar/); assert.doesNotMatch(text(ui.render()), /Asistencia guardada/); assert.equal(ui.button('Guardar asistencia').props.disabled, true);
});

test('attendance a previous pending justification callback cannot resolve after selecting B', async () => {
  const ui = harness('AttendanceManager'); await ui.ready(); const previous = ui.button('Aceptar').props.onClick;
  elements(ui.render(), 'select')[0].props.onChange({ target: { value: id(2) } }); ui.render(); previous(); assert.equal(ui.state.calls.filter(call => call.method === 'PATCH').length, 0);
});

test('attendance revoked access clears pupils, history and justification content', async () => {
  const ui = harness('AttendanceManager'); await ui.ready(); const save = ui.submit(0); await ui.reply(2, {}, 403); await save.promise;
  assert.match(text(ui.render()), /Acceso a asistencia no disponible/); assert.doesNotMatch(text(ui.render()), /Child 1|Reason 1/);
});

test('family justification requires a valid UUID201 receipt and does not reset on an ambiguous reply', async () => {
  const ui = harness('AttendanceManager', { canEdit: false, groups: [] }); ui.render(); await tick(); await ui.reply(0, { items: [] });
  const request = ui.submit(1, { reason: 'Synthetic reason' }); await ui.reply(1, { id: 'invalid', status: 'pendiente' }, 201); await request.promise;
  assert.equal(request.form.resets, 0); assert.doesNotMatch(text(ui.render()), /La justificación se envió/); assert.match(text(ui.render()), /No se pudo confirmar/);
});

test('group list A to B filters hide A immediately and discard its late403 without revoking B', async () => {
  const ui = harness('GroupManager'); ui.render(); await tick(); ui.change('group-search', 'Group 2'); ui.render(); await tick();
  await ui.reply(1, { items: [group(2)], total: 1, page: 1, pageSize: 10 }); await ui.reply(0, {}, 403);
  const section = elements(ui.render(), 'section').find(section => text(section).includes('Grupos registrados')); assert.match(text(section), /Group 2/); assert.doesNotMatch(text(section), /Group 1|Acceso a grupos no disponible/);
});

test('group creation selects the POST UUID even if the first fetched result has the same name in another cycle', async () => {
  const ui = harness('GroupManager'); await ui.ready(); const request = ui.submit(1, groupsFields); await ui.reply(1, { id: id(3) }, 201);
  assert.equal(request.form.resets, 1); assert.equal(ui.input('assign-group').props.value, id(3)); assert.match(text(ui.render()), /Grupo creado correctamente/); await tick();
  await ui.reply(2, { items: [group(1, 'Repeated name'), group(3, 'Repeated name')], total: 2, page: 1, pageSize: 50 });
  const listIndex = ui.state.calls.findIndex((call, index) => index > 2 && call.url.includes('pageSize=10')); await ui.reply(listIndex, { items: [group(1, 'Repeated name'), group(3, 'Repeated name')], total: 2, page: 1, pageSize: 10 }); await request.promise;
  assert.equal(ui.input('assign-group').props.value, id(3)); const assign = ui.submit(2, { groupId: id(3), teacherId: id(200) }); assert.equal(ui.state.calls.at(-1).url, `/api/groups/${id(3)}/teachers`); await ui.reply(ui.state.calls.length - 1, { assigned: true }, 201); await assign.promise;
});

test('group confirmed creation survives failed follow-up GET and no duplicate is sent', async () => {
  const ui = harness('GroupManager'); await ui.ready(); const request = ui.submit(1, groupsFields); await ui.reply(1, { id: id(3) }, 201); await ui.reply(2, {}, 503); await request.promise; ui.render(); await tick();
  const listIndex = ui.state.calls.findIndex((call, index) => index > 2 && call.url.includes('pageSize=10')); await ui.reply(listIndex, {}, 503);
  assert.match(text(ui.render()), /Grupo creado correctamente/); assert.equal(ui.input('assign-group').props.value, id(3)); assert.equal(request.form.resets, 1);
  await ui.submit(1, groupsFields).promise; assert.equal(ui.state.calls.filter(call => call.method === 'POST').length, 1); assert.equal(ui.button('Guardar grupo').props.disabled, true);
});

for (const bad of [{ id: 'first-result' }, {}, { id: id(3) }]) test(`group creation rejects a malformed or non201 receipt ${JSON.stringify(bad)}`, async () => {
  const ui = harness('GroupManager'); await ui.ready(); const request = ui.submit(1, groupsFields); await ui.reply(1, bad, bad.id === id(3) ? 200 : 201); await request.promise;
  assert.equal(request.form.resets, 0); assert.match(text(ui.render()), /No se pudo confirmar el grupo/); assert.doesNotMatch(text(ui.render()), /Grupo creado correctamente/); assert.equal(ui.state.calls.length, 2);
});

test('year POST201 is independently confirmed before failed refresh and double submission is locked', async () => {
  const ui = harness('GroupManager'); await ui.ready(); const first = ui.submit(0, yearFields); await ui.submit(0, yearFields).promise; assert.equal(ui.state.calls.length, 2);
  await ui.reply(1, { id: id(101) }, 201); await ui.reply(2, {}, 503); await first.promise;
  assert.equal(first.form.resets, 1); assert.match(text(ui.render()), /Ciclo creado correctamente/); assert.match(text(ui.render()), /Synthetic 2027/); assert.match(text(ui.render()), /El ciclo se guardó/); assert.equal(ui.button('Guardar ciclo').props.disabled, true);
});

test('teacher assignment requires its assigned201 acknowledgement and uses one synchronous mutation lock', async () => {
  const ui = harness('GroupManager'); await ui.ready(); const first = ui.submit(2, assignmentFields); await ui.submit(0, yearFields).promise; assert.equal(ui.state.calls.length, 2);
  await ui.reply(1, { assigned: false }, 201); await first.promise; assert.doesNotMatch(text(ui.render()), /Maestra asignada al grupo/); assert.match(text(ui.render()), /No se pudo confirmar la asignación/);
});

test('group failed list is visibly unknown, sanitized and recoverable by three fresh authenticated reads', async () => {
  const ui = harness('GroupManager'); ui.render(); await tick(); ui.state.calls[0].reject(Error('secret connection detail')); await tick();
  assert.match(text(ui.render()), /No se pudo comprobar la lista/); assert.doesNotMatch(text(ui.render()), /Todavía no hay|secret connection/); ui.button('Consultar estado de nuevo').props.onClick(); await tick();
  await ui.reply(1, { items: [group(1)], total: 1, page: 1, pageSize: 10 }); await ui.reply(2, { items: [year] }); await ui.reply(3, { items: [group(1)] });
  assert.equal(ui.button('Guardar grupo').props.disabled, false); assert.ok(ui.state.calls.every(call => call.credentials === 'same-origin')); assert.ok(ui.state.deadlines.every(deadline => deadline.ms === 20_000));
});

test('group current revocation hides cycles, groups and teacher addresses', async () => {
  const ui = harness('GroupManager'); await ui.ready(); const request = ui.submit(2, assignmentFields); await ui.reply(1, {}, 401); await request.promise;
  assert.match(text(ui.render()), /Acceso a grupos no disponible/); assert.doesNotMatch(text(ui.render()), /Synthetic 2026|Group 1|teacher@example/);
});

for (const name of ['AttendanceManager', 'GroupManager']) test(`${name} pending reads are aborted on unmount and their late replies cannot update UI`, async () => {
  const ui = harness(name); ui.render(); await tick(); ui.stop(); assert.ok(ui.state.calls.every(call => call.signal.aborted)); for (let index = 0; index < ui.state.calls.length; index++) await ui.reply(index, { items: [] });
});
