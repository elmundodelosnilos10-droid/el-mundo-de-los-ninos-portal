import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPrivateStorageClient,
  createSchoolStorageClient,
  SupabaseStorageError,
} from "../lib/supabase/storage.ts";

const config = {
  url: "https://school-project.supabase.co",
  serviceRoleKey: "server-only-synthetic-service-role-key",
  bucket: "school-files",
};
const pdf = new TextEncoder().encode("%PDF-1.7 synthetic file");
const objectKey = "private/material/65e4785a-94f4-4f67-98a7-8d8aee1e42f1";

function client(fetcher, settings = config) {
  return createPrivateStorageClient(settings, fetcher);
}

function assertServiceHeaders(init) {
  assert.equal(init.headers.apikey, config.serviceRoleKey);
  assert.equal(init.headers.Authorization, `Bearer ${config.serviceRoleKey}`);
}

test("client reads only server service credentials and fails closed when they are absent", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return new Response(); };
  const storage = createSchoolStorageClient({ SUPABASE_URL: config.url, SUPABASE_SECRET_KEY: config.serviceRoleKey }, fetcher);
  await storage.upload(objectKey, pdf, { contentType: "application/pdf" });
  assert.equal(calls, 1);

  const noSecret = createSchoolStorageClient({ SUPABASE_URL: config.url }, fetcher);
  await assert.rejects(noSecret.download(objectKey), error => error instanceof SupabaseStorageError && error.code === "not_configured");
  assert.equal(calls, 1);
});

test("uploads only allowlisted MIME with matching signature and bounded bytes to the private object API", async () => {
  let captured;
  const storage = client(async (url, init) => {
    captured = { url: String(url), init, body: new Uint8Array(await new Response(init.body).arrayBuffer()) };
    return Response.json({ Key: objectKey });
  });

  await storage.upload(objectKey, pdf, { contentType: "application/pdf" });
  assert.equal(captured.url, `https://school-project.supabase.co/storage/v1/object/${config.bucket}/${objectKey}`);
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.redirect, "error");
  assert.equal(captured.init.headers["Content-Type"], "application/pdf");
  assert.equal(captured.init.headers["x-upsert"], "false");
  assert.equal(captured.init.headers["Cache-Control"], "private, no-store");
  assertServiceHeaders(captured.init);
  assert.deepEqual(captured.body, pdf);

  const invalid = [
    ["private/material/file", pdf, "text/html", {}],
    ["private/material/file", new TextEncoder().encode("not a pdf"), "application/pdf", {}],
    ["private/material/file", pdf, "application/pdf", { maxBytes: 1 }],
    ["private/material/file", new Uint8Array(), "application/pdf", {}],
  ];
  for (const [key, bytes, contentType, options] of invalid) {
    await assert.rejects(storage.upload(key, bytes, { contentType, ...options }), error => error instanceof SupabaseStorageError && error.code === "invalid_input");
  }
});

test("object paths cannot escape the private namespace or inject URL syntax", async () => {
  let calls = 0;
  const storage = client(async () => { calls++; return new Response(); });
  for (const key of [
    "public/material/file.pdf",
    "private/../public/file.pdf",
    "private/%2e%2e/file.pdf",
    "private//file.pdf",
    "private/material/file?download=1",
    "private/material/file\\name",
    "/private/material/file.pdf",
  ]) {
    await assert.rejects(storage.remove(key), error => error instanceof SupabaseStorageError && error.code === "invalid_input");
  }
  assert.equal(calls, 0);
});

test("downloads private objects with no-store and safe response headers", async () => {
  let captured;
  const storage = client(async (url, init) => {
    captured = { url: String(url), init };
    return new Response(pdf, { headers: { "content-type": "application/pdf", "content-length": String(pdf.length), "cache-control": "public, max-age=86400", location: "https://attacker.example" } });
  });
  const result = await storage.download(objectKey);
  assert.equal(captured.url, `https://school-project.supabase.co/storage/v1/object/${config.bucket}/${objectKey}`);
  assert.equal(captured.init.method, "GET");
  assert.equal(captured.init.redirect, "error");
  assertServiceHeaders(captured.init);
  assert.equal(result.contentType, "application/pdf");
  assert.equal(result.sizeBytes, pdf.length);
  assert.equal(result.response.headers.get("cache-control"), "private, no-store");
  assert.equal(result.response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(result.response.headers.get("location"), null);
  assert.deepEqual(new Uint8Array(await result.response.arrayBuffer()), pdf);
});

test("rejects unexpected download MIME, oversized objects, and unsuccessful storage responses", async () => {
  const badMime = client(async () => new Response("<html>", { headers: { "content-type": "text/html" } }));
  await assert.rejects(badMime.download(objectKey), error => error instanceof SupabaseStorageError && error.code === "rejected");

  const tooLarge = client(async () => new Response(pdf, { headers: { "content-type": "application/pdf", "content-length": String(25 * 1024 * 1024 + 1) } }));
  await assert.rejects(tooLarge.download(objectKey), error => error instanceof SupabaseStorageError && error.status === 502);

  const oversizedBytes = new Uint8Array(10 * 1024 * 1024 + 1);
  const noLength = client(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(oversizedBytes); controller.close(); },
  }), { headers: { "content-type": "application/pdf" } }));
  const unboundedDownload = await noLength.download(objectKey);
  await assert.rejects(unboundedDownload.response.arrayBuffer());

  const unauthorized = client(async () => new Response("", { status: 401 }));
  await assert.rejects(unauthorized.download(objectKey), error => error instanceof SupabaseStorageError && error.status === 401);
});

test("deletes only private object endpoints and keeps service key out of returned data", async () => {
  let captured;
  const storage = client(async (url, init) => {
    captured = { url: String(url), init };
    return new Response(null, { status: 204 });
  });
  const result = await storage.remove(objectKey);
  assert.equal(result, undefined);
  assert.equal(captured.url, `https://school-project.supabase.co/storage/v1/object/${config.bucket}/${objectKey}`);
  assert.equal(captured.init.method, "DELETE");
  assertServiceHeaders(captured.init);
  assert.equal(captured.url.includes(config.serviceRoleKey), false);
});

test("returns only a validated short-lived signed URL for the requested private key", async () => {
  let captured;
  const privateUrl = `https://school-project.supabase.co/storage/v1/object/sign/${config.bucket}/${objectKey}?token=synthetic-signed-token`;
  const storage = client(async (url, init) => {
    captured = { url: String(url), init };
    return Response.json({ signedURL: privateUrl });
  });
  const signed = await storage.createSignedUrl(objectKey, 120);
  assert.equal(captured.url, `https://school-project.supabase.co/storage/v1/object/sign/${config.bucket}/${objectKey}`);
  assert.equal(captured.init.method, "POST");
  assert.deepEqual(JSON.parse(captured.init.body), { expiresIn: 120 });
  assertServiceHeaders(captured.init);
  assert.equal(signed, privateUrl);
  assert.equal(signed.includes("/public/"), false);

  for (const invalidExpiry of [0, -1, 3601, 1.5]) {
    await assert.rejects(storage.createSignedUrl(objectKey, invalidExpiry), error => error instanceof SupabaseStorageError && error.code === "invalid_input");
  }
});

test("rejects signed URL responses for public objects, another host, or missing token", async () => {
  for (const signedURL of [
    `https://school-project.supabase.co/storage/v1/object/public/${config.bucket}/${objectKey}?token=bad`,
    `https://other-project.supabase.co/storage/v1/object/sign/${config.bucket}/${objectKey}?token=bad`,
    `https://school-project.supabase.co/storage/v1/object/sign/${config.bucket}/${objectKey}`,
  ]) {
    const storage = client(async () => Response.json({ signedURL }));
    await assert.rejects(storage.createSignedUrl(objectKey), error => error instanceof SupabaseStorageError && error.code === "rejected");
  }
});

test("requires HTTPS and a clean Supabase project origin", async () => {
  for (const url of [
    "http://school-project.supabase.co",
    "https://user:password@school-project.supabase.co",
    "https://school-project.supabase.co/path",
    "https://school-project.supabase.co?key=secret",
  ]) {
    const storage = client(async () => { throw new Error("must not call fetch"); }, { ...config, url });
    await assert.rejects(storage.upload(objectKey, pdf, { contentType: "application/pdf" }), error => error instanceof SupabaseStorageError && error.code === "not_configured");
  }
});

test("existing private downloads retain exact 10 MiB document and 25 MiB audio streaming limits", async () => {
  for (const [contentType, size] of [["application/pdf", 10 * 1024 * 1024], ["audio/ogg", 25 * 1024 * 1024]]) {
    let produced = 0;
    const storage = client(async (_url, init) => {
      assertServiceHeaders(init);
      return new Response(new ReadableStream({ pull(controller) {
        const length = Math.min(65536, size - produced);
        if (!length) { controller.close(); return; }
        produced += length; controller.enqueue(new Uint8Array(length));
      } }), { headers: { "content-type": contentType, "content-length": String(size) } });
    });
    const object = await storage.download(objectKey); assert.equal(object.sizeBytes, size);
    assert.equal(object.response.headers.get("authorization"), null); assert.equal(object.response.headers.get("apikey"), null);
    const reader = object.body.getReader(); let received = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; received += value.byteLength; }
    assert.equal(received, size);
  }
});
