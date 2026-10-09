import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as uploadLimits from "../lib/school-upload-limits.ts";
import * as uploadGuard from "../lib/upload-request-guard.ts";

const require = createRequire(import.meta.url);
const ids = {
  group: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", task: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  student: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", material: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  file: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", submission: "ffffffff-ffff-4fff-8fff-ffffffffffff",
};
const pdf = new TextEncoder().encode("%PDF-1.7 synthetic private material");
const oldKey = "supabase:private/material/old-synthetic-file";
const jwt = "synthetic-file-user-jwt";
const origin = "https://portal.example.test";

function harness(route) {
  const state = {
    actor: { id: "school-user", roles: ["superadmin"], supabaseAuth: { userId: "school-user", accessToken: jwt } },
    visible: true, status: 200, scan: "clean", d1Calls: 0, scans: 0, calls: [], storage: [],
    filePurpose: "material", downloadBytes: pdf,
  };
  const failD1 = () => { state.d1Calls++; throw new Error("D1 must not be reached in Supabase mode"); };
  const dependencies = {
    "@/lib/runtime/env": { env: { SCHOOL_DATA_PROVIDER: "supabase", SCHOOL_FILE_STORAGE_PROVIDER: "supabase", SUPABASE_URL: "https://files.example.test", SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable-key" } },
    "@/db": { getDb: failD1 }, "@/db/schema": {}, "drizzle-orm": {}, "zod": require("zod"),
    "@/lib/access": {
      actorFromRequest: async () => state.actor,
      hasRole: (actor, ...roles) => roles.some(role => actor.roles.includes(role)),
      mayTeachGroup: failD1, maySeeGroup: failD1, maySeeStudent: failD1,
      errorResponse: (status, error) => Response.json({ error }, { status }),
    },
    "@/lib/conversation-access": { authorizedConversation: failD1 },
    "@/lib/communication-hours": { getCommunicationHours: async () => ({ enabled: false }), isWithinCommunicationHours: () => true },
    "@/lib/image-metadata": { stripImageMetadata: () => { throw new Error("PDF must not use image sanitizer"); } },
    "@/lib/file-scanner": { scanUploadedFile: async () => { state.scans++; return state.scan; } },
    "@/lib/upload-request-guard": uploadGuard,
    "@/lib/school-upload-limits": uploadLimits,
    "@/lib/file-storage": {
      isFileStorageConfigured: () => true,
      newFileObjectKey: (_environment, purpose) => `supabase:private/${purpose}/new-synthetic-file`,
      putSchoolFile: async (...args) => { state.storage.push({ method: "put", key: args[1] }); },
      deleteSchoolFile: async (...args) => { state.storage.push({ method: "delete", key: args[1] }); },
      readSchoolFile: async () => { throw new Error("D1 compensation must not run for Supabase"); },
      getSchoolFile: async (...args) => { state.storage.push({ method: "get", key: args[1] }); return { body: new Response(state.downloadBytes).body, sizeBytes: state.downloadBytes.length }; },
    },
  };
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const sandboxModule = { exports: {} }; modules.set(file, sandboxModule);
    const source = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const fetcher = async (input, options) => {
      const url = new URL(input); state.calls.push({ url, options });
      assert.equal(options.headers.Authorization, `Bearer ${jwt}`);
      assert.equal(options.headers.apikey, "synthetic-publishable-key");
      if (state.status !== 200) return Response.json({ message: "private upstream details" }, { status: state.status });
      const functionName = url.pathname.split("/").at(-1);
      if (url.pathname.includes("/rpc/")) {
        const args = JSON.parse(options.body);
        const results = {
          school_publish_material_file: { published: true, fileId: args.p_file_id },
          school_send_message: { id: args.p_id, sentAt: "2026-10-08T16:00:00Z" },
          school_attach_task_file: { attached: true, fileId: args.p_file_id },
          school_submit_task_file: { submissionId: ids.submission, fileId: args.p_file_id, status: "entregada" },
          school_remove_material: { removed: true, fileId: ids.file, objectKey: oldKey },
          school_replace_material_file: { replaced: true, fileId: ids.file, oldObjectKey: oldKey },
        };
        assert.ok(functionName in results, `unexpected RPC ${functionName}`);
        return Response.json(results[functionName]);
      }
      if (!state.visible) return Response.json([]);
      const rows = {
        groups: [{ id: ids.group }], tasks: [{ group_id: ids.group }], conversations: [{ id: ids.group }],
        materials: [{ id: ids.material, group_id: ids.group, file_id: ids.file }],
        files: [{ id: ids.file, object_key: oldKey, original_name: "material.pdf", mime_type: "application/pdf", size_bytes: pdf.length, purpose: state.filePurpose, group_id: ids.group, student_id: null, deleted_at: null }],
        messages: [{ conversation_id: ids.group }],
      };
      assert.ok(functionName in rows, `unexpected table ${functionName}`);
      return Response.json(rows[functionName]);
    };
    const mockRequire = name => {
      if (dependencies[name]) return dependencies[name];
      const known = { "./local-http-test-policy.ts": "lib/supabase/local-http-test-policy.ts", "@/lib/supabase/auth-route-utils": "lib/supabase/auth-route-utils.ts", "@/lib/supabase/database": "lib/supabase/database.ts" };
      if (!known[name]) throw new Error(`Unexpected import ${name}`);
      return load(known[name]);
    };
    vm.runInContext(source, vm.createContext({ module: sandboxModule, exports: sandboxModule.exports, require: mockRequire, fetch: fetcher,
      URL, Response, Request, Headers, FormData, File, TextEncoder, TextDecoder, Uint8Array, AbortSignal, crypto: webcrypto }), { filename: file });
    return sandboxModule.exports;
  }
  return { state, ...load(route) };
}
function context(id = ids.material) { return { params: Promise.resolve({ id }) }; }
function upload(purpose, route = "/api/files") {
  const form = new FormData();
  form.set("file", new File([pdf], "material.pdf", { type: "application/pdf" }));
  if (purpose) form.set("purpose", purpose);
  form.set("groupId", ids.group); form.set("title", "Material sintético"); form.set("category", "Prueba");
  form.set("taskId", ids.task); form.set("studentId", ids.student);
  return new Request(origin + route, { method: "POST", headers: { origin }, body: form });
}
function deletion() { return new Request(`${origin}/api/materials/${ids.material}`, { method: "DELETE", headers: { origin } }); }

for (const [purpose, rpc] of [["material", "school_publish_material_file"], ["task", "school_attach_task_file"], ["submission", "school_submit_task_file"]]) {
  test(`Supabase ${purpose} upload runs JWT RPC without initializing D1`, async () => {
    const runtime = harness("app/api/files/route.ts");
    if (purpose === "submission") runtime.state.actor.roles = ["tutor"];
    const response = await runtime.POST(upload(purpose));
    assert.equal(response.status, 201, await response.text());
    assert.equal(runtime.state.d1Calls, 0);
    assert.equal(runtime.state.scans, 1);
    assert.deepEqual(runtime.state.storage.map(call => call.method), ["put"]);
    assert.equal(runtime.state.calls.at(-1).url.pathname, `/rest/v1/rpc/${rpc}`);
  });
}

test("Supabase material removal and replacement never use D1 queries or compensation", async () => {
  const removal = harness("app/api/materials/[id]/route.ts");
  const removed = await removal.DELETE(deletion(), context());
  assert.equal(removed.status, 200, await removed.text());
  assert.equal(removal.state.d1Calls, 0);
  assert.deepEqual(removal.state.storage.map(call => call.method), ["delete"]);
  assert.match(removal.state.calls.at(-1).url.pathname, /school_remove_material$/);
  const replace = harness("app/api/materials/[id]/replace/route.ts");
  const replaced = await replace.POST(upload(null, `/api/materials/${ids.material}/replace`), context());
  assert.equal(replaced.status, 200, await replaced.text());
  assert.equal(replace.state.d1Calls, 0);
  assert.equal(replace.state.scans, 1);
  assert.deepEqual(replace.state.storage.map(call => call.method), ["put", "delete"]);
  assert.match(replace.state.calls.at(-1).url.pathname, /school_replace_material_file$/);
});

test("unconfigured scanner blocks Supabase upload/replacement before writing storage or metadata and never initializes D1", async () => {
  for (const route of ["app/api/files/route.ts", "app/api/materials/[id]/replace/route.ts"]) {
    const runtime = harness(route); runtime.state.scan = "unavailable";
    const response = await runtime.POST(upload("material"), context());
    assert.equal(response.status, 503);
    assert.equal(runtime.state.d1Calls, 0);
    assert.equal(runtime.state.storage.length, 0);
    assert.ok(runtime.state.calls.every(call => !call.url.pathname.includes("/rpc/")));
  }
});

test("Supabase download returns authorized private bytes and resolves message attachments using JWT only", async () => {
  for (const purpose of ["material", "message"]) {
    const runtime = harness("app/api/files/[id]/route.ts"); runtime.state.filePurpose = purpose;
    const response = await runtime.GET(new Request(`${origin}/api/files/${ids.file}`), context(ids.file));
    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), pdf);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(runtime.state.d1Calls, 0);
    if (purpose === "message") assert.ok(runtime.state.calls.some(call => call.url.pathname.endsWith("/messages")));
  }
});

test("missing RLS file returns 404 without D1 fallback or storage access", async () => {
  const runtime = harness("app/api/files/[id]/route.ts"); runtime.state.visible = false;
  const response = await runtime.GET(new Request(`${origin}/api/files/${ids.file}`), context(ids.file));
  assert.equal(response.status, 404);
  assert.equal(runtime.state.d1Calls, 0);
  assert.equal(runtime.state.storage.length, 0);
});

test("missing Supabase JWT returns an explicit unavailable response instead of consulting D1", async () => {
  for (const route of ["app/api/files/route.ts", "app/api/materials/[id]/route.ts", "app/api/materials/[id]/replace/route.ts", "app/api/files/[id]/route.ts"]) {
    const runtime = harness(route); runtime.state.actor.supabaseAuth = null;
    const response = route.endsWith("files/[id]/route.ts")
      ? await runtime.GET(new Request(`${origin}/api/files/${ids.file}`), context(ids.file))
      : route.endsWith("materials/[id]/route.ts") ? await runtime.DELETE(deletion(), context()) : await runtime.POST(upload("material"), context());
    assert.equal(response.status, 503);
    assert.equal(runtime.state.d1Calls, 0);
    assert.equal(runtime.state.calls.length, 0);
    assert.equal(runtime.state.storage.length, 0);
  }
});

test("RLS failures return sanitized errors and never cross over to D1", async () => {
  for (const [route, method] of [["app/api/files/[id]/route.ts", "GET"], ["app/api/materials/[id]/route.ts", "DELETE"], ["app/api/materials/[id]/replace/route.ts", "POST"], ["app/api/files/route.ts", "POST"]]) {
    const runtime = harness(route); runtime.state.status = 403;
    const response = await runtime[method](method === "GET" ? new Request(`${origin}/api/files/${ids.file}`) : method === "DELETE" ? deletion() : upload("material"), context());
    assert.equal(response.status, 503);
    assert.equal(runtime.state.d1Calls, 0);
    assert.doesNotMatch(await response.text(), /private upstream details|synthetic-file-user-jwt|synthetic-publishable-key/);
    assert.equal(runtime.state.storage.length, 0);
  }
});


for (const route of ["app/api/files/route.ts", "app/api/materials/[id]/replace/route.ts"]) {
  test(`${route} enforces exact file and multipart boundaries before scan/storage`, async () => {
    const fileRequest = async size => {
      const bytes = new Uint8Array(size); bytes.set(new TextEncoder().encode("%PDF-1.7"));
      const data = new FormData(); data.set("file", new File([bytes], "large.pdf", { type: "application/pdf" }));
      data.set("purpose", "material"); data.set("groupId", ids.group); data.set("title", "Synthetic"); data.set("category", "Prueba");
      const encoded = new Request(origin + "/api/files", { method: "POST", headers: { origin }, body: data });
      const body = await encoded.arrayBuffer();
      return new Request(encoded.url, { method: "POST", headers: encoded.headers, body });
    };
    const exact = harness(route); const response = await exact.POST(await fileRequest(uploadLimits.SCHOOL_UPLOAD_MAX_FILE_BYTES), context());
    assert.equal(response.status, route.includes("replace") ? 200 : 201);
    assert.equal(exact.state.scans, 1); assert.ok(exact.state.storage.some(call => call.method === "put"));
    const tooBig = harness(route); const rejected = await tooBig.POST(await fileRequest(uploadLimits.SCHOOL_UPLOAD_MAX_FILE_BYTES + 1), context());
    assert.equal(rejected.status, 400); assert.match((await rejected.json()).error, /hasta 4 MB/);
    assert.equal(tooBig.state.scans, 0); assert.equal(tooBig.state.storage.length, 0); assert.equal(tooBig.state.calls.length, 0);
    const overhead = harness(route);
    assert.equal((await overhead.POST(await fileRequest(uploadLimits.SCHOOL_UPLOAD_MAX_BODY_BYTES), context())).status, 413);
    assert.equal(overhead.state.scans, 0); assert.equal(overhead.state.storage.length, 0); assert.equal(overhead.state.calls.length, 0);
    const declared = harness(route);
    const request = new Request(origin + "/api/files", { method: "POST", headers: { origin, "content-length": String(uploadLimits.SCHOOL_UPLOAD_MAX_BODY_BYTES + 1) }, body: "not multipart" });
    assert.equal((await declared.POST(request, context())).status, 413); assert.equal(declared.state.calls.length, 0); assert.equal(declared.state.scans, 0);
  });
}

test("private download keeps streaming existing authorized files larger than the new upload cap", async () => {
  const runtime = harness("app/api/files/[id]/route.ts"); runtime.state.downloadBytes = new Uint8Array(5 * 1024 * 1024);
  const response = await runtime.GET(new Request(`${origin}/api/files/${ids.file}`), context(ids.file));
  assert.equal(response.status, 200); assert.equal(response.headers.get("content-length"), String(5 * 1024 * 1024));
  const reader = response.body.getReader(); let total = 0;
  for (;;) { const { value, done } = await reader.read(); if (done) break; total += value.byteLength; }
  assert.equal(total, 5 * 1024 * 1024); assert.equal(runtime.state.d1Calls, 0);
});


test("actual chat POST enforces the same 4 MiB file/body limits and fails closed without scanner", async () => {
  const route = "app/api/conversations/[id]/messages/route.ts";
  async function payload(size) {
    const bytes = new Uint8Array(size); bytes.set(new TextEncoder().encode("%PDF-1.7"));
    const data = new FormData(); data.set("file", new File([bytes], "synthetic.pdf", { type: "application/pdf" })); data.set("body", "Mensaje sintético");
    const encoded = new Request(origin + "/api/conversations/synthetic/messages", { method: "POST", headers: { origin }, body: data });
    return new Request(encoded.url, { method: "POST", headers: encoded.headers, body: await encoded.arrayBuffer() });
  }
  for (const [size, status] of [[uploadLimits.SCHOOL_UPLOAD_MAX_FILE_BYTES, 201], [uploadLimits.SCHOOL_UPLOAD_MAX_FILE_BYTES + 1, 400], [uploadLimits.SCHOOL_UPLOAD_MAX_BODY_BYTES, 413]]) {
    const runtime = harness(route); runtime.state.actor.roles = ["tutor"];
    const response = await runtime.POST(await payload(size), context(ids.group)); assert.equal(response.status, status);
    assert.equal(runtime.state.scans, status === 201 ? 1 : 0);
    assert.equal(runtime.state.storage.filter(item => item.method === "put").length, status === 201 ? 1 : 0);
    assert.equal(runtime.state.calls.filter(item => item.url.pathname.includes("/rpc/")).length, status === 201 ? 1 : 0);
    assert.equal(runtime.state.d1Calls, 0);
  }
  const scanner = harness(route); scanner.state.actor.roles = ["docente"]; scanner.state.scan = "unavailable";
  assert.equal((await scanner.POST(await payload(10), context(ids.group))).status, 503);
  assert.equal(scanner.state.storage.length, 0); assert.equal(scanner.state.calls.filter(item => item.url.pathname.includes("/rpc/")).length, 0);
});

test("audio keeps its allowed type but uses the same new 4 MiB upload maximum", async () => {
  for (const [size, status] of [[uploadLimits.SCHOOL_UPLOAD_MAX_FILE_BYTES, 201], [uploadLimits.SCHOOL_UPLOAD_MAX_FILE_BYTES + 1, 400]]) {
    const bytes = new Uint8Array(size); bytes.set(new TextEncoder().encode("OggS"));
    const data = new FormData(); data.set("file", new File([bytes], "synthetic.ogg", { type: "audio/ogg" }));
    data.set("purpose", "material"); data.set("groupId", ids.group); data.set("title", "Pronunciación"); data.set("category", "Audio");
    const request = new Request(origin + "/api/files", { method: "POST", headers: { origin }, body: data });
    const r = harness("app/api/files/route.ts"); const response = await r.POST(request);
    assert.equal(response.status, status); assert.equal(r.state.scans, status === 201 ? 1 : 0);
    if (status === 201) assert.equal(JSON.parse(r.state.calls.at(-1).options.body).p_mime_type, "audio/ogg");
    else assert.equal(r.state.storage.length, 0);
  }
});
