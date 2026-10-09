import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as uploadLimits from "../lib/school-upload-limits.ts";
import { libraryListUrl, libraryPreviewKind } from "../lib/library-query.ts";

const group = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Grupo sintético" };
const material = { id: group.id, fileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", groupId: group.id, groupName: group.name, title: "Colores", category: "Audio", fileName: "colores.ogg", mimeType: "audio/ogg", publishedAt: "2026-10-08T10:00:00Z", sizeBytes: 20 };
function harness({ uploadsReady = false } = {}) {
  const state = { hooks: [], cursor: 0, pending: [], loads: [] };
  const hooks = {
    useState: initial => { const index = state.cursor++; state.hooks[index] ??= { value: initial }; return [state.hooks[index].value, next => { state.hooks[index].value = typeof next === "function" ? next(state.hooks[index].value) : next; }]; },
    useRef: initial => { const index = state.cursor++; return state.hooks[index] ??= { current: initial }; },
    useEffect: (effect, deps) => { const index = state.cursor++; const previous = state.hooks[index]; if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) { previous?.cleanup?.(); const current = { deps }; state.hooks[index] = current; state.pending.push(() => { current.cleanup = effect(); }); } },
  };
  const jsx = (type, props) => ({ type, props });
  const dependencies = { react: hooks, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" }, "@/lib/library-query": { libraryListUrl, libraryPreviewKind }, "@/lib/school-upload-limits": uploadLimits,
    "./library-preview": { LibraryPreview: "LibraryPreview" }, "./library.module.css": { default: {}, __esModule: true } };
  const sandboxModule = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(new URL("../app/biblioteca/library-manager.tsx", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInContext(source, vm.createContext({ module: sandboxModule, exports: sandboxModule.exports, require: name => { if (!dependencies[name]) throw new Error(`Unexpected dependency ${name}`); return dependencies[name]; }, AbortController, Error, File, FormData: class extends FormData { constructor(form) { super(); for (const [key, value] of Object.entries(form?.fields ?? {})) this.set(key, value); } },
    fetch: (url, options) => new Promise((resolve, reject) => state.loads.push({ url, options, resolve, reject })) }), { filename: "app/biblioteca/library-manager.tsx" });
  function render() { state.cursor = 0; return sandboxModule.exports.LibraryManager({ groups: [group], canUpload: true, uploadsReady }); }
  return { state, render, runEffects: () => state.pending.splice(0).forEach(effect => effect()) };
}
function elements(tree, type) {
  const found = []; function walk(value) { if (!value || typeof value !== "object") return; if (Array.isArray(value)) { value.forEach(walk); return; } if (value.type === type) found.push(value); walk(value.props?.children); } walk(tree); return found;
}
function byId(tree, type, id) { return elements(tree, type).find(element => element.props.id === id); }
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };
async function answer(load, payload = { items: [material], total: 25, categories: ["Audio", "Guía"], page: 1, pageSize: 12 }, status = 200) { load.resolve(Response.json(payload, { status })); await settle(); }

test("actual library UI submits title/file search and group/category filters with page reset and cancels stale reads", async () => {
  const runtime = harness(); let tree = runtime.render(); runtime.runEffects();
  assert.equal(runtime.state.loads[0].url, "/api/materials?page=1&pageSize=12");
  await answer(runtime.state.loads[0]); tree = runtime.render();
  assert.equal(elements(tree, "form").find(form => form.props.role === "search").props["aria-label"], "Buscar recursos de la biblioteca");
  byId(tree, "input", "library-search").props.onChange({ target: { value: " Colores% " } }); tree = runtime.render();
  elements(tree, "form").find(form => form.props.role === "search").props.onSubmit({ preventDefault() {} });
  tree = runtime.render(); runtime.runEffects();
  assert.equal(runtime.state.loads[0].options.signal.aborted, true);
  assert.equal(new URL(runtime.state.loads[1].url, "https://test.invalid").searchParams.get("q"), "Colores%");
  byId(tree, "select", "library-group-filter").props.onChange({ target: { value: group.id } }); tree = runtime.render(); runtime.runEffects();
  assert.equal(runtime.state.loads[1].options.signal.aborted, true);
  const groupQuery = new URL(runtime.state.loads[2].url, "https://test.invalid").searchParams;
  assert.equal(groupQuery.get("groupId"), group.id); assert.equal(groupQuery.get("page"), "1");
  await answer(runtime.state.loads[2]); tree = runtime.render();
  byId(tree, "select", "library-category-filter").props.onChange({ target: { value: "Audio" } }); runtime.render(); runtime.runEffects();
  assert.equal(new URL(runtime.state.loads[3].url, "https://test.invalid").searchParams.get("category"), "Audio");
});

test("actual library UI uses server total for paging, opens private preview and preserves disabled scanner upload", async () => {
  const runtime = harness(); runtime.render(); runtime.runEffects(); await answer(runtime.state.loads[0]); let tree = runtime.render();
  assert.equal(elements(tree, "nav")[0].props["aria-label"], "Páginas de recursos");
  const buttons = elements(tree, "button"); const previous = buttons.find(button => button.props.children === "Anterior"); const next = buttons.find(button => button.props.children === "Siguiente");
  assert.equal(previous.props.disabled, true); assert.equal(next.props.disabled, false);
  assert.equal(byId(tree, "input", "library-file").props.disabled, true);
  buttons.find(button => button.props.children === "Escuchar").props.onClick(); tree = runtime.render();
  assert.equal(elements(tree, "LibraryPreview")[0].props.material.fileId, material.fileId);
  next.props.onClick(); tree = runtime.render(); runtime.runEffects();
  assert.equal(elements(tree, "LibraryPreview").length, 0);
  assert.equal(new URL(runtime.state.loads[1].url, "https://test.invalid").searchParams.get("page"), "2");
});

test("actual library UI discards cancelled results and exposes server failure as an error with retry", async () => {
  const runtime = harness(); let tree = runtime.render(); runtime.runEffects();
  elements(tree, "button").find(button => button.props.children === "Limpiar").props.onClick(); runtime.render(); runtime.runEffects();
  assert.equal(runtime.state.loads[0].options.signal.aborted, true);
  await answer(runtime.state.loads[0]); await answer(runtime.state.loads[1], { error: "No se pudieron consultar los materiales." }, 503); tree = runtime.render();
  assert.equal(elements(tree, "p").find(p => p.props.role === "alert").props.children, "No se pudieron consultar los materiales.");
  assert.equal(elements(tree, "li").length, 0);
  elements(tree, "button").find(button => button.props.children === "Intentar de nuevo").props.onClick(); runtime.render(); runtime.runEffects();
  assert.equal(runtime.state.loads.length, 3);
});


test("library actual upload/replacement handlers preflight 4 MiB and guard disabled scanner without POST", async () => {
  const file = new File([new Uint8Array(uploadLimits.SCHOOL_UPLOAD_MAX_FILE_BYTES + 1)], "too-large.pdf", { type: "application/pdf" });
  const ready = harness({ uploadsReady: true }); let tree = ready.render();
  await elements(tree, "form").find(form => form.props.className === "school-form event-form").props.onSubmit({ preventDefault() {}, currentTarget: { fields: { file } } });
  assert.equal(ready.state.loads.length, 0);
  assert.match(JSON.stringify(ready.render()), /hasta 4 MB/);
  ready.runEffects(); await answer(ready.state.loads[0]); tree = ready.render();
  elements(tree, "button").find(button => button.props.children === "Reemplazar archivo").props.onClick();
  elements(tree, "input").find(input => input.props.hidden).props.onChange({ currentTarget: { files: [file], value: "x" } });
  assert.equal(ready.state.loads.length, 1); assert.match(JSON.stringify(ready.render()), /hasta 4 MB/);
  const disabled = harness(); tree = disabled.render();
  await elements(tree, "form").find(form => form.props.className === "school-form event-form").props.onSubmit({ preventDefault() {}, currentTarget: {} });
  assert.equal(disabled.state.loads.length, 0); assert.match(JSON.stringify(disabled.render()), /pendiente de habilitación/);
  assert.equal(elements(tree, "input").find(input => input.props.hidden).props.disabled, true);
});
