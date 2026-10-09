import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const childA = { id: "synthetic-child-a", name: "Alumno sintético A", groupName: "Grupo sintético", stage: "maternal" };
const childB = { ...childA, id: "synthetic-child-b", name: "Alumno sintético B" };
const completedAt = "2026-10-09T12:00:00Z";
const jsx = (type, props) => ({ type, props });
function load(file, dependencies = {}, globals = {}) {
  const sandboxModule = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInContext(code, vm.createContext({ module: sandboxModule, exports: sandboxModule.exports, require: name => dependencies[name] ?? assert.fail(`Unexpected dependency ${name}`), ...globals }), { filename: file });
  return sandboxModule.exports;
}
function elements(tree, type) {
  const result = [];
  function walk(value) { if (!value || typeof value !== "object") return; if (Array.isArray(value)) { value.forEach(walk); return; } if (value.type === type) result.push(value); walk(value.props?.children); }
  walk(tree); return result;
}
function text(value) { if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" ? text(value.props?.children) : typeof value === "string" || typeof value === "number" ? String(value) : ""; }
const catalog = load("app/actividades/catalog.ts");
const settle = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const state = { hooks: [], cursor: 0, effects: [], calls: [], props: { students: [childA, childB], canPlay: true } };
  const react = {
    useState: initial => { const index = state.cursor++; state.hooks[index] ??= { value: initial }; return [state.hooks[index].value, next => { state.hooks[index].value = typeof next === "function" ? next(state.hooks[index].value) : next; }]; },
    useRef: initial => { const index = state.cursor++; return state.hooks[index] ??= { current: initial }; },
    useMemo: callback => callback(),
    useEffect: (effect, deps) => { const index = state.cursor++; const previous = state.hooks[index]; if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) { previous?.cleanup?.(); const current = { deps }; state.hooks[index] = current; state.effects.push(() => { current.cleanup = effect(); }); } },
  };
  react.useLayoutEffect = react.useEffect;
  const { ActivityLibrary } = load("app/actividades/activity-library.tsx", { react, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" }, "./catalog": catalog }, { fetch: (url, options) => new Promise((resolve, reject) => state.calls.push({ url, options, resolve, reject })) });
  const render = () => { state.cursor = 0; return ActivityLibrary(state.props); };
  const effects = () => state.effects.splice(0).forEach(effect => effect());
  const respond = async (index, body, status = 200) => { state.calls[index].resolve(Response.json(body, { status })); await settle(); };
  const chooseStudent = id => elements(render(), "select")[0].props.onChange({ target: { value: id } });
  const answer = () => elements(render(), "div").find(div => div.props.className === "activity-options").props.children[0].props.onClick();
  return { state, render, effects, respond, chooseStudent, answer, cleanup: () => state.hooks.forEach(hook => hook.cleanup?.()) };
}

test("activity save locks child/challenge controls and rejects duplicate or programmatic context changes until confirmation", async () => {
  const fake = harness(); fake.render(); fake.effects(); await fake.respond(0, { items: [] });
  fake.answer(); const tree = fake.render();
  assert.equal(fake.state.calls.length, 2);
  assert.deepEqual(JSON.parse(fake.state.calls[1].options.body), { studentId: childA.id, activityId: "palabra-cat", answer: "cat" });
  assert.equal(elements(tree, "select")[0].props.disabled, true);
  const nav = elements(tree, "nav")[0];
  assert.ok(elements(nav, "button").every(button => button.props.disabled));
  fake.chooseStudent(childB.id);
  elements(nav, "button")[1].props.onClick(); fake.answer();
  assert.equal(elements(fake.render(), "select")[0].props.value, childA.id);
  assert.equal(fake.state.calls.length, 2);
  await fake.respond(1, { saved: true, completedAt });
  const saved = fake.render();
  assert.equal(elements(saved, "select")[0].props.disabled, false);
  assert.match(text(saved), /1 de 6 logros/);
  assert.match(text(saved), /¡Logro guardado!/);
  fake.chooseStudent(childB.id); fake.render(); fake.effects();
  assert.equal(fake.state.calls[2].url, `/api/activity-progress?studentId=${childB.id}`);
  fake.cleanup();
});

test("saving a new child before its GET completes never imports the previous child's progress or lets a stale GET erase confirmation", async () => {
  const fake = harness(); fake.render(); fake.effects();
  await fake.respond(0, { items: [{ activityId: "huerto-cuidado", completedAt, artwork: null }] });
  fake.chooseStudent(childB.id); fake.render(); fake.effects();
  fake.answer(); await fake.respond(2, { saved: true, completedAt });
  let tree = fake.render(); assert.match(text(tree), /1 de 6 logros/);
  const nav = elements(tree, "nav")[0];
  assert.equal(elements(nav, "span").filter(span => span.props["aria-label"] === "Completada").length, 1);
  assert.match(text(elements(nav, "button")[0]), /✓/);
  assert.doesNotMatch(text(elements(nav, "button")[2]), /✓/);
  await fake.respond(1, { items: [] });
  tree = fake.render(); assert.match(text(tree), /1 de 6 logros/); assert.match(text(tree), /¡Logro guardado!/);
  fake.cleanup();
});

test("a deferred initial GET preserves historical achievements and the newer confirmed save for the same child", async () => {
  const fake = harness(); fake.render(); fake.effects();
  fake.answer(); await fake.respond(1, { saved: true, completedAt });
  assert.match(text(fake.render()), /1 de 6 logros/);
  await fake.respond(0, { items: [
    { activityId: "equipo-amable", completedAt: "2026-10-08T12:00:00Z", artwork: null },
    { activityId: "palabra-cat", completedAt: "2026-10-07T12:00:00Z", artwork: null },
  ] });
  const tree = fake.render();
  assert.match(text(tree), /2 de 6 logros/);
  const nav = elements(tree, "nav")[0];
  assert.match(text(elements(nav, "button")[0]), /✓/);
  assert.match(text(elements(nav, "button")[3]), /✓/);
  assert.equal(fake.state.hooks[1].value.find(item => item.activityId === "palabra-cat").completedAt, completedAt);
  assert.equal(fake.state.hooks[1].value.length, 2);
  assert.match(text(tree), /¡Logro guardado!/);
  fake.cleanup();
});

test("a delayed save success or failure cannot alter feedback/progress after an external child-context transition", async () => {
  for (const status of [200, 503]) {
    const fake = harness(); fake.render(); fake.effects(); await fake.respond(0, { items: [] }); fake.answer();
    // Force the state transition a parent/remount integration could cause,
    // independently of the disabled UI: exercise the response context guard.
    fake.state.hooks[0].value = childB.id; fake.render(); fake.effects();
    await fake.respond(2, { items: [{ activityId: "equipo-amable", completedAt, artwork: null }] });
    await fake.respond(1, status === 200 ? { saved: true, completedAt } : { error: "Synthetic old-child failure" }, status);
    const tree = fake.render();
    assert.match(text(tree), /1 de 6 logros/);
    assert.doesNotMatch(text(tree), /¡Logro guardado!|Synthetic old-child failure/);
    const nav = elements(tree, "nav")[0];
    assert.doesNotMatch(text(elements(nav, "button")[0]), /✓/);
    assert.match(text(elements(nav, "button")[3]), /✓/);
    assert.equal(elements(tree, "select")[0].props.disabled, false);
    fake.cleanup();
  }
});

test("unmount and loss of play capability reject late save feedback", async () => {
  for (const transition of ["unmount", "read-only"]) {
    const fake = harness(); fake.render(); fake.effects(); await fake.respond(0, { items: [] }); fake.answer();
    if (transition === "unmount") fake.cleanup();
    else { fake.state.props.canPlay = false; fake.render(); fake.effects(); }
    await fake.respond(1, { saved: true, completedAt });
    const tree = fake.render();
    assert.doesNotMatch(text(tree), /¡Logro guardado!/);
    assert.match(text(tree), /0 de 6 logros/);
    fake.cleanup();
  }
});
