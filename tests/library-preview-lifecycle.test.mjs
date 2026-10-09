import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { libraryPreviewKind } from "../lib/library-query.ts";

const material = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", fileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", groupId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", groupName: "Grupo sintético", title: "Recurso privado", category: "Actividad", fileName: "material.pdf", mimeType: "application/pdf", publishedAt: "2026-10-08T10:00:00Z", sizeBytes: 20 };
function harness(resource = material) {
  const state = { created: [], revoked: [], loads: [], closes: 0, effects: [], hooks: [], cursor: 0, dialog: { open: false, shows: 0, close() { this.open = false; state.closes++; }, showModal() { this.open = true; this.shows++; } } };
  const hooks = {
    useRef: () => { const index = state.cursor++; return state.hooks[index] ??= { current: state.dialog }; },
    useState: initial => { const index = state.cursor++; state.hooks[index] ??= { value: initial }; return [state.hooks[index].value, next => { state.hooks[index].value = next; }]; },
    useEffect: (effect, deps) => { const index = state.cursor++; if (!state.hooks[index]) { state.hooks[index] = { deps }; state.effects.push(effect); } },
  };
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    react: hooks, "react/jsx-runtime": { jsx, jsxs: jsx }, "next/image": { default: "Image", __esModule: true },
    "@/lib/library-query": { libraryPreviewKind }, "./library.module.css": { default: {}, __esModule: true },
    "@/lib/library-preview": { loadPrivateLibraryPreview: (fileId, mimeType, signal) => new Promise((resolve, reject) => { state.loads.push({ fileId, mimeType, signal, resolve, reject }); }) },
  };
  const sandboxModule = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(new URL("../app/biblioteca/library-preview.tsx", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInContext(source, vm.createContext({ module: sandboxModule, exports: sandboxModule.exports, require: name => { if (!dependencies[name]) throw new Error(`Unexpected dependency ${name}`); return dependencies[name]; }, AbortController, Error,
    URL: { createObjectURL: blob => { state.created.push(blob); return `blob:synthetic-${state.created.length}`; }, revokeObjectURL: url => state.revoked.push(url) }, }), { filename: "app/biblioteca/library-preview.tsx" });
  function render() { state.cursor = 0; return sandboxModule.exports.LibraryPreview({ material: resource, onClose: () => { state.closes++; } }); }
  render();
  return { state, render, runEffects: () => state.effects.map(effect => effect()) };
}
function elements(tree, type) {
  const found = [];
  function walk(value) { if (!value || typeof value !== "object") return; if (Array.isArray(value)) { value.forEach(walk); return; } if (value.type === type) found.push(value); walk(value.props?.children); }
  walk(tree); return found;
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test("actual preview effect fetches only the chosen private file and aborts/revokes its blob on cleanup", async () => {
  const runtime = harness(); const cleanup = runtime.runEffects();
  assert.equal(runtime.state.dialog.shows, 1); assert.equal(runtime.state.loads.length, 1);
  const load = runtime.state.loads[0]; assert.equal(load.fileId, material.fileId); assert.equal(load.mimeType, "application/pdf");
  load.resolve(new Blob(["synthetic PDF"], { type: "application/pdf" })); await settle();
  const tree = runtime.render(); const object = elements(tree, "object")[0];
  assert.equal(object.props.data, "blob:synthetic-1"); assert.equal(object.props.type, "application/pdf");
  assert.equal(tree.props["aria-labelledby"], "library-preview-title");
  assert.equal(elements(tree, "a")[0].props.href, `/api/files/${material.fileId}`);
  cleanup[1](); assert.equal(load.signal.aborted, true); assert.deepEqual(runtime.state.revoked, ["blob:synthetic-1"]);
});

test("closing while bytes are still loading aborts and never creates a stale object URL", async () => {
  const runtime = harness(); const cleanup = runtime.runEffects(); cleanup[1]();
  runtime.state.loads[0].resolve(new Blob(["late bytes"])); await settle();
  assert.equal(runtime.state.loads[0].signal.aborted, true); assert.equal(runtime.state.created.length, 0); assert.equal(runtime.state.revoked.length, 0);
});

test("Strict Mode effect cleanup does not close the native dialog and only the active request creates a blob", async () => {
  const runtime = harness(); const cleanup = runtime.runEffects();
  cleanup.forEach(fn => fn?.()); const activeCleanup = runtime.runEffects();
  assert.equal(runtime.state.dialog.open, true); assert.equal(runtime.state.dialog.shows, 1); assert.equal(runtime.state.closes, 0);
  runtime.state.loads[0].resolve(new Blob(["stale"])); runtime.state.loads[1].resolve(new Blob(["active"])); await settle();
  assert.equal(runtime.state.created.length, 1); activeCleanup[1](); assert.deepEqual(runtime.state.revoked, ["blob:synthetic-1"]);
});

test("actual preview exposes an accessible error with authenticated download when opening fails", async () => {
  const runtime = harness(); const cleanup = runtime.runEffects();
  runtime.state.loads[0].reject(new Error("El recurso ya no está disponible para tu cuenta.")); await settle();
  const tree = runtime.render();
  assert.equal(elements(tree, "p").find(p => p.props.role === "alert").props.children, "El recurso ya no está disponible para tu cuenta.");
  assert.equal(elements(tree, "button")[0].props["aria-label"], "Cerrar vista previa");
  tree.props.onClose(); assert.equal(runtime.state.closes, 1);
  assert.equal(runtime.state.created.length, 0); cleanup[1]();
});

test("actual preview renders native audio and an unoptimized private image with no external player", async () => {
  for (const [mimeType, name, type] of [["audio/ogg", "sonido.ogg", "audio"], ["image/png", "imagen.png", "Image"]]) {
    const runtime = harness({ ...material, mimeType, fileName: name }); const cleanup = runtime.runEffects();
    runtime.state.loads[0].resolve(new Blob(["synthetic bytes"], { type: mimeType })); await settle();
    const element = elements(runtime.render(), type)[0]; assert.equal(element.props.src, "blob:synthetic-1");
    if (type === "audio") assert.equal(element.props.controls, true); else assert.equal(element.props.unoptimized, true);
    cleanup[1](); assert.equal(runtime.state.revoked.length, 1);
  }
});
