import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deleteSchoolFile,
  getSchoolFile,
  isFileStorageConfigured,
  newFileObjectKey,
  putSchoolFile,
  readSchoolFile,
} from "../lib/file-storage.ts";

const supabaseEnvironment = {
  SCHOOL_FILE_STORAGE_PROVIDER: "supabase",
  SUPABASE_URL: "https://school-project.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_synthetic-server-key",
};
const pdf = new TextEncoder().encode("%PDF-1.7 synthetic private file");

function privateObjectKey(key) {
  return key.slice("supabase:".length);
}

test("selects Supabase only for new objects when enabled and keeps R2 object routing stable", async () => {
  const supabaseKey = newFileObjectKey(supabaseEnvironment, "material");
  const r2Key = "private/material/legacy-object";
  assert.match(supabaseKey, /^supabase:private\/material\/[0-9a-f-]{36}$/);
  assert.equal(newFileObjectKey({}, "submission").startsWith("supabase:"), false);
  assert.equal(isFileStorageConfigured(supabaseEnvironment), true);
  assert.equal(isFileStorageConfigured({}, supabaseKey), false);
  assert.equal(isFileStorageConfigured({ BUCKET: {} }, r2Key), true);
});

test("routes Supabase uploads, private reads, delete compensation reads, and deletes through the service adapter", async (t) => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    if (init.method === "GET") return new Response(pdf, { headers: { "content-type": "application/pdf", "content-length": String(pdf.length) } });
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    return new Response(null, { status: 200 });
  };

  const objectKey = newFileObjectKey(supabaseEnvironment, "message");
  const path = privateObjectKey(objectKey);
  await putSchoolFile(supabaseEnvironment, objectKey, pdf, "application/pdf", "file-1");
  const downloaded = await getSchoolFile(supabaseEnvironment, objectKey);
  assert.ok(downloaded);
  assert.equal(downloaded.contentType, "application/pdf");
  assert.deepEqual(new Uint8Array(await new Response(downloaded.body).arrayBuffer()), pdf);

  const compensation = await readSchoolFile(supabaseEnvironment, objectKey);
  assert.deepEqual(compensation.bytes, pdf);
  assert.equal(compensation.contentType, "application/pdf");
  await deleteSchoolFile(supabaseEnvironment, objectKey);

  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => call.url.includes(`/storage/v1/object/school-files/${path}`)));
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.apikey, supabaseEnvironment.SUPABASE_SECRET_KEY);
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(calls[1].init.method, "GET");
  assert.equal(calls[2].init.method, "GET");
  assert.equal(calls[3].init.method, "DELETE");
});

test("legacy unprefixed objects keep using R2 even after new uploads switch to Supabase", async () => {
  const calls = [];
  const bucket = {
    async put(key, body, options) { calls.push(["put", key, body, options]); },
    async get(key) {
      calls.push(["get", key]);
      return { body: new ReadableStream({ start(controller) { controller.enqueue(pdf); controller.close(); } }), size: pdf.length, httpMetadata: { contentType: "application/pdf" } };
    },
    async delete(key) { calls.push(["delete", key]); },
  };
  const environment = { ...supabaseEnvironment, BUCKET: bucket };
  const key = "private/material/old-r2-object";
  await putSchoolFile({ ...environment, SCHOOL_FILE_STORAGE_PROVIDER: "r2" }, key, pdf, "application/pdf", "old-file");
  const object = await getSchoolFile(environment, key);
  assert.ok(object);
  assert.equal(object.sizeBytes, pdf.length);
  assert.deepEqual(new Uint8Array(await new Response(object.body).arrayBuffer()), pdf);
  await deleteSchoolFile(environment, key);
  assert.deepEqual(calls.map(call => call[0]), ["put", "get", "delete"]);
  assert.equal(calls.every(call => call[1] === key), true);
});

test("maps a missing Supabase object to null and rejects malformed stored keys", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(null, { status: 404 }); };

  assert.equal(await getSchoolFile(supabaseEnvironment, "supabase:private/material/missing"), null);
  await assert.rejects(getSchoolFile(supabaseEnvironment, "supabase:public/file"));
  assert.equal(calls, 1);
});
