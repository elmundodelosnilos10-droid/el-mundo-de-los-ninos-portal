import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const jsx = (type, props) => ({ type, props });
function load(file, dependencies, globals = {}) {
  const sandboxModule = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInContext(code, vm.createContext({ module: sandboxModule, exports: sandboxModule.exports, require: name => dependencies[name] ?? assert.fail(`Unexpected dependency ${name}`), ...globals }), { filename: file });
  return sandboxModule.exports;
}
function elements(tree, type) {
  const found = [];
  function walk(value) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (value.type === type) found.push(value);
    walk(value.props?.children);
  }
  walk(tree); return found;
}
function harness() {
  const state = { hooks: [], cursor: 0, calls: [], navigations: [], throwUnexpected: false, effects: [], cleanups: [] };
  const { authClient } = load("lib/auth-client.ts", {}, { fetch: (url, options) => new Promise((resolve, reject) => state.calls.push({ url, options, resolve, reject })) });
  const { SignOutButton } = load("app/sign-out-button.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    react: {
      useState: initial => { const index = state.cursor++; state.hooks[index] ??= { value: initial }; return [state.hooks[index].value, value => { state.hooks[index].value = value; }]; },
      useRef: initial => { const index = state.cursor++; state.hooks[index] ??= { current: initial }; return state.hooks[index]; },
      useEffect: effect => { const index = state.cursor++; if (!state.hooks[index]) { state.hooks[index] = {}; state.effects.push(effect); } },
    },
    "next/navigation": { useRouter: () => ({ push: path => state.navigations.push(path) }) },
    "@/lib/auth-client": { authClient: { signOut: () => { if (state.throwUnexpected) throw Error("Synthetic unexpected failure"); return authClient.signOut(); } } },
  });
  const render = () => { state.cursor = 0; return SignOutButton(); };
  return { state, render, click: () => elements(render(), "button")[0].props.onClick(),
    ready: async () => { render(); for (const effect of state.effects.splice(0)) state.cleanups.push(effect()); await Promise.resolve(); render(); },
    unmount: () => { for (const cleanup of state.cleanups.splice(0)) cleanup?.(); },
  };
}

test("sign out navigates only after the real auth client confirms HTTP success and disables pending reentry", async () => {
  const fake = harness();
  await fake.ready();
  const pending = fake.click();
  assert.equal(fake.state.calls.length, 1);
  assert.equal(fake.state.calls[0].url, "/api/auth/sign-out");
  assert.equal(fake.state.calls[0].options.method, "POST");
  assert.equal(fake.state.calls[0].options.credentials, "same-origin");
  assert.equal(elements(fake.render(), "button")[0].props.disabled, true);
  assert.equal(elements(fake.render(), "button")[0].props.children, "Cerrando sesión…");
  assert.deepEqual(fake.state.navigations, []);
  await fake.click(); assert.equal(fake.state.calls.length, 1);
  fake.state.calls[0].resolve(Response.json({ success: true })); await pending;
  assert.deepEqual(fake.state.navigations, ["/ingresar"]);
  assert.equal(elements(fake.render(), "p").length, 0);
});

test("HTTP sign out failure keeps the current page, announces an error and permits a successful retry", async () => {
  const fake = harness(); await fake.ready(); const pending = fake.click();
  fake.state.calls[0].resolve(Response.json({ message: "Synthetic server failure" }, { status: 503 })); await pending;
  assert.deepEqual(fake.state.navigations, []);
  let tree = fake.render();
  assert.equal(elements(tree, "button")[0].props.disabled, false);
  assert.equal(elements(tree, "p")[0].props.role, "alert");
  assert.match(elements(tree, "p")[0].props.children, /No se pudo cerrar tu sesión/);
  const retry = fake.click(); tree = fake.render();
  assert.equal(elements(tree, "p").length, 0);
  fake.state.calls[1].resolve(Response.json({ success: true })); await retry;
  assert.deepEqual(fake.state.navigations, ["/ingresar"]);
});

test("network failure returned by the real auth client never redirects and re-enables sign out", async () => {
  const fake = harness(); await fake.ready(); const pending = fake.click();
  fake.state.calls[0].reject(Error("Synthetic network failure")); await pending;
  assert.deepEqual(fake.state.navigations, []);
  const tree = fake.render();
  assert.equal(elements(tree, "button")[0].props.disabled, false);
  assert.equal(elements(tree, "p")[0].props.role, "alert");
  assert.match(elements(tree, "p")[0].props.children, /Revisa la conexión/);
});

test("unexpected sign out exception is announced safely without navigation or a permanently disabled button", async () => {
  const fake = harness(); await fake.ready(); fake.state.throwUnexpected = true; await fake.click();
  assert.deepEqual(fake.state.navigations, []);
  const tree = fake.render();
  assert.equal(elements(tree, "button")[0].props.disabled, false);
  assert.equal(elements(tree, "p")[0].props.role, "alert");
  assert.doesNotMatch(elements(tree, "p")[0].props.children, /Synthetic unexpected/);
});

test("sign out stays disabled before hydration and sends nothing from an early callback", async () => {
  const fake = harness();
  assert.equal(elements(fake.render(), "button")[0].props.disabled, true);
  await fake.click(); assert.equal(fake.state.calls.length, 0);
  await fake.ready(); assert.equal(elements(fake.render(), "button")[0].props.disabled, false);
});

test("two invocations of the same rendered sign out callback send one request", async () => {
  const fake = harness(); await fake.ready();
  const callback = elements(fake.render(), "button")[0].props.onClick;
  const first = callback(); await callback(); assert.equal(fake.state.calls.length, 1);
  fake.state.calls[0].resolve(Response.json({ success: true })); await first;
  assert.deepEqual(fake.state.navigations, ["/ingresar"]);
});

test("a sign out response after unmount does not navigate away from a newer screen", async () => {
  const fake = harness(); await fake.ready(); const first = fake.click(); fake.unmount();
  fake.state.calls[0].resolve(Response.json({ success: true })); await first;
  assert.deepEqual(fake.state.navigations, []);
});
