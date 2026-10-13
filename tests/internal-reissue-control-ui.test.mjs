import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("../app/cuentas/internal-reissue-control.tsx", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const id = "a1000000-0000-4000-8000-000000000002";
const code = "EMDN1." + "a".repeat(120);
const payload = { id, invited: false, activation: { code, expiresAt: new Date(Date.now() + 1800_000).toISOString(), activationPath: "/activar-cuenta" } };
const tick = async () => { for (let i = 0; i < 5; i++) await new Promise(done => setImmediate(done)); };
const same = (a, b) => a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
const text = value => value == null || typeof value === "boolean" ? "" : Array.isArray(value) ? value.map(text).join(" ") : typeof value === "object" ? text(value.props?.children) : String(value);
function elements(tree, type) { const found = []; const walk = value => { if (!value || typeof value !== "object") return; if (Array.isArray(value)) return value.forEach(walk); if (value.type === type) found.push(value); walk(value.props?.children); }; walk(tree); return found; }
function harness() {
  const state = { hooks: [], cursor: 0, effects: [], calls: [], acquisitions: 0, releases: 0, unauthorized: 0, uncertain: 0, unmounted: false, acquireAllowed: true, confirm: true };
  const react = {
    useState: initial => { const index = state.cursor++; state.hooks[index] ??= { value: initial }; return [state.hooks[index].value, next => { assert.equal(state.unmounted, false); state.hooks[index].value = typeof next === "function" ? next(state.hooks[index].value) : next; }]; },
    useRef: initial => { const index = state.cursor++; state.hooks[index] ??= { current: initial }; return state.hooks[index]; },
    useEffect: (effect, deps) => { const index = state.cursor++; const previous = state.hooks[index]; if (!previous || !same(previous.deps, deps)) { state.hooks[index] = { deps, cleanup: previous?.cleanup }; state.effects.push(() => { state.hooks[index].cleanup?.(); state.hooks[index].cleanup = effect(); }); } },
  };
  const sandboxModule = { exports: {} };
  vm.runInNewContext(source, { module: sandboxModule, exports: sandboxModule.exports, require: name => name === "react" ? react : name === "react/jsx-runtime" ? { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) } : assert.fail(name), Date, Intl, AbortController, AbortSignal, queueMicrotask,
    window: { confirm: () => state.confirm }, fetch: (url, options) => new Promise((resolve, reject) => state.calls.push({ url, options, resolve, reject })),
  });
  const props = { targetId: id, email: "pending@example.invalid", contextKey: "leader:docente:active", disabled: false,
    beginOperation: () => { if (!state.acquireAllowed) return null; state.acquisitions++; return () => { state.releases++; }; },
    onUnauthorized: () => { state.unauthorized++; }, onUncertain: () => { state.uncertain++; },
  };
  const render = () => { state.cursor = 0; const tree = sandboxModule.exports.InternalReissueControl(props); for (const effect of state.effects.splice(0)) effect(); return tree; };
  const click = () => elements(render(), "button")[0].props.onClick();
  const reply = async (index, body = payload, status = 201) => { state.calls[index].resolve(Response.json(body, { status })); await tick(); };
  return { state, props, render, click, reply, ready: async () => { render(); await tick(); }, stop: () => { for (const hook of state.hooks) hook.cleanup?.(); state.unmounted = true; } };
}

test("reissue acquires the parent lock once, blocks duplicate callbacks and ignores own parent busy state", async () => {
  const ui = harness(); await ui.ready(); ui.click(); ui.click();
  assert.equal(ui.state.calls.length, 1); assert.equal(ui.state.acquisitions, 1);
  ui.props.disabled = true; ui.render();
  assert.equal(ui.state.calls[0].options.signal.aborted, false);
  assert.equal(ui.state.calls[0].url, `/api/users/${id}/activation/reissue`);
  assert.equal(ui.state.calls[0].options.credentials, "same-origin");
  assert.equal(ui.state.calls[0].options.body, "{}");
  await ui.reply(0);
  assert.equal(elements(ui.render(), "textarea")[0].props.value, code);
  assert.equal(ui.state.releases, 1);
});

test("cancelled confirmation, disabled controls or a denied parent lock never send a request", async () => {
  for (const kind of ["confirm", "disabled", "parent"]) {
    const ui = harness(); await ui.ready();
    if (kind === "confirm") ui.state.confirm = false;
    if (kind === "disabled") ui.props.disabled = true;
    if (kind === "parent") ui.state.acquireAllowed = false;
    ui.click(); assert.equal(ui.state.calls.length, 0); assert.equal(ui.state.acquisitions, 0);
  }
});

test("authorization failures clear receipt and notify the parent to revoke access", async () => {
  for (const status of [401, 403]) {
    const ui = harness(); await ui.ready(); ui.click(); await ui.reply(0, { error: "private-provider-message" }, status);
    assert.equal(ui.state.unauthorized, 1); assert.equal(ui.state.releases, 1);
    assert.equal(elements(ui.render(), "textarea").length, 0);
    assert.doesNotMatch(text(ui.render()), /private-provider-message/);
    ui.click(); assert.equal(ui.state.calls.length, 1);
  }
});

test("ineligible invitations report recovery and do not offer a password reset", async () => {
  const ui = harness(); await ui.ready(); ui.click(); await ui.reply(0, {}, 409);
  assert.match(text(ui.render()), /recuperación de acceso/);
  assert.equal(elements(ui.render(), "textarea").length, 0);
  assert.equal(ui.state.uncertain, 0);
  ui.click(); assert.equal(ui.state.calls.length, 1);
});

test("uncertain or malformed receipts lock retries and request fresh parent review", async () => {
  for (const [body, status] of [[{}, 503], [payload, 200], [{ ...payload, id: "other" }, 201], [{ ...payload, activation: {} }, 201]]) {
    const ui = harness(); await ui.ready(); ui.click(); await ui.reply(0, body, status);
    assert.equal(ui.state.uncertain, 1); assert.equal(ui.state.releases, 1);
    assert.equal(elements(ui.render(), "textarea").length, 0);
    ui.click(); assert.equal(ui.state.calls.length, 1);
  }
});

test("context changes hide and erase an existing private code and reset review state", async () => {
  const ui = harness(); await ui.ready(); ui.click(); await ui.reply(0);
  ui.props.contextKey = "another-leader:docente:active";
  assert.equal(elements(ui.render(), "textarea").length, 0);
  await tick();
  assert.equal(ui.state.hooks.some(hook => hook.value?.code?.code === code), false);
  assert.equal(elements(ui.render(), "button")[0].props.disabled, false);
});

test("a late previous-context response cannot publish credentials or unlock the new request", async () => {
  const ui = harness(); await ui.ready(); ui.click();
  ui.props.contextKey = "new-context"; ui.render(); await tick();
  assert.equal(ui.state.calls[0].options.signal.aborted, true);
  ui.click(); assert.equal(ui.state.calls.length, 2);
  await ui.reply(0);
  ui.click(); assert.equal(ui.state.calls.length, 2, "Late finally must not unlock the active new operation");
  assert.equal(elements(ui.render(), "textarea").length, 0);
  await ui.reply(1);
  assert.equal(elements(ui.render(), "textarea")[0].props.value, code);
});

test("unmount aborts the request, releases its parent lease and never updates component state", async () => {
  const ui = harness(); await ui.ready(); ui.click(); ui.stop();
  assert.equal(ui.state.calls[0].options.signal.aborted, true);
  await ui.reply(0);
  assert.equal(ui.state.releases, 1); assert.equal(ui.state.uncertain, 0);
});
