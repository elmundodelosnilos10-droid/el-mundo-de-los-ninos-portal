import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as uploadLimits from "../lib/school-upload-limits.ts";

const task = { id: "synthetic-task", groupId: "synthetic-group", groupName: "Grupo", stage: "preescolar", title: "Tarea sintética", instructions: "Aprende", dueAt: null, files: [], studentStatuses: [{ studentId: "synthetic-child", status: "pendiente" }] };
function elements(tree, type) {
  const found = []; function walk(value) { if (!value || typeof value !== "object") return; if (Array.isArray(value)) { value.forEach(walk); return; } if (value.type === type) found.push(value); walk(value.props?.children); } walk(tree); return found;
}
function harness({ uploadsReady = true, uploadStatus = 201 } = {}) {
  const state = { hooks: [], cursor: 0, calls: [] };
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    react: { useEffect() {}, useCallback: callback => callback, useRef(initial) { const index = state.cursor++; state.hooks[index] ??= { current: initial }; return state.hooks[index]; }, useState(initial) { const index = state.cursor++; state.hooks[index] ??= { value: index === 0 ? [task] : index === 1 ? false : initial }; return [state.hooks[index].value, next => { state.hooks[index].value = typeof next === "function" ? next(state.hooks[index].value) : next; }]; } },
    "react/jsx-runtime": { jsx, jsxs: jsx }, "@/lib/datetime": { schoolDateTime: value => value, schoolLocalInputToISO: value => value }, "@/lib/school-upload-limits": uploadLimits,
  };
  class TaskFormData extends FormData { constructor(form) { super(); for (const [key, value] of Object.entries(form?.fields ?? {})) { if (Array.isArray(value)) for (const item of value) this.append(key, item); else this.set(key, value); } } }
  const sandboxModule = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(new URL("../app/tareas/task-manager.tsx", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInContext(source, vm.createContext({ module: sandboxModule, exports: sandboxModule.exports, require: name => dependencies[name] ?? assert.fail(`Unexpected ${name}`), File, FormData: TaskFormData,
    AbortController, AbortSignal,
    fetch: async (url, options) => { state.calls.push({ url, options }); if (options?.method === "POST") return url === "/api/files" && uploadStatus === 413 ? new Response("FUNCTION_PAYLOAD_TOO_LARGE", { status: 413 }) : Response.json({ id: "00000000-0000-4000-8000-000000000001" }, { status: 201 }); return Response.json({ items: [], total: 0, page: 1, pageSize: 25, hasMore: false }); },
  }), { filename: "task-manager.tsx" });
  const render = () => { state.cursor = 0; return sandboxModule.exports.TaskManager({ groups: [{ id: task.groupId, name: "Grupo" }], familyChildren: [{ id: "synthetic-child", name: "Alumno", familyName: "Sintético" }], canCreate: true, canReview: true, uploadsReady }); };
  return { state, render };
}
const file = size => new File([new Uint8Array(size)], "synthetic.pdf", { type: "application/pdf" });
const event = fields => ({ preventDefault() {}, currentTarget: { fields, reset() {} } });
const createFields = attachments => ({ attachments, title: "Tarea", instructions: "Aprende", groupId: task.groupId, dueAt: "" });

test("task creation preflights every selected attachment before publishing any metadata", async () => {
  const r = harness(); const create = elements(r.render(), "form")[0];
  await create.props.onSubmit(event(createFields([file(10), file(uploadLimits.SCHOOL_UPLOAD_MAX_FILE_BYTES + 1)])));
  assert.equal(r.state.calls.length, 0); assert.match(JSON.stringify(r.render()), /hasta 4 MB/);
});

test("task attachment and family evidence reject oversized files before network", async () => {
  for (const index of [1, 2]) {
    const r = harness(); const form = elements(r.render(), "form")[index];
    await form.props.onSubmit(event({ file: file(uploadLimits.SCHOOL_UPLOAD_MAX_FILE_BYTES + 1), studentId: "synthetic-child" }));
    assert.equal(r.state.calls.length, 0); assert.match(JSON.stringify(r.render()), /hasta 4 MB/);
  }
});

test("task exact 4 MiB attachment is allowed; files upload one at a time and size label is shared", async () => {
  const r = harness(); const tree = r.render();
  assert.match(JSON.stringify(tree), /4 MB/); assert.doesNotMatch(JSON.stringify(tree), /10 MB|25 MB/);
  await elements(tree, "form")[0].props.onSubmit(event(createFields([file(uploadLimits.SCHOOL_UPLOAD_MAX_FILE_BYTES)])));
  const posts = r.state.calls.filter(call => call.options?.method === "POST");
  assert.deepEqual(posts.map(call => call.url), ["/api/tasks", "/api/files"]);
  assert.equal(posts[1].options.body.get("file").size, uploadLimits.SCHOOL_UPLOAD_MAX_FILE_BYTES);
});

test("task inputs and writes are blocked without scanner while plain task metadata remains available", async () => {
  const r = harness({ uploadsReady: false }); let tree = r.render();
  assert.ok(elements(tree, "input").filter(input => input.props.type === "file").every(input => input.props.disabled));
  assert.match(JSON.stringify(tree), /pendiente de habilitación/);
  for (const index of [1, 2]) await elements(tree, "form")[index].props.onSubmit(event({ file: file(10), studentId: "synthetic-child" }));
  await elements(tree, "form")[0].props.onSubmit(event(createFields([file(10)])));
  assert.equal(r.state.calls.length, 0);
  tree = r.render(); await elements(tree, "form")[0].props.onSubmit(event(createFields([])));
  assert.deepEqual(r.state.calls.filter(call => call.options?.method === "POST").map(call => call.url), ["/api/tasks"]);
});

test("task upload handles non-JSON hosting 413 as a clear size error", async () => {
  const r = harness({ uploadStatus: 413 });
  await elements(r.render(), "form")[1].props.onSubmit(event({ file: file(10) }));
  assert.match(JSON.stringify(r.render()), /hasta 4 MB/); assert.doesNotMatch(JSON.stringify(r.render()), /Unexpected token|FUNCTION_PAYLOAD/);
});
