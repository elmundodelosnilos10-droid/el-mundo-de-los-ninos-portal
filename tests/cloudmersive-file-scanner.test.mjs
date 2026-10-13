import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLOUDMERSIVE_ADAPTER_MAX_FILE_BYTES,
  CLOUDMERSIVE_PUBLIC_ENDPOINT,
  isCloudmersiveFileScannerConfigured,
  scanCloudmersiveFile,
} from "../lib/cloudmersive-file-scanner.ts";

const config = Object.freeze({ enabled: true, region: "north-america-public", endpoint: CLOUDMERSIVE_PUBLIC_ENDPOINT, apiKey: "synthetic-cloudmersive-key" });
const bytes = new TextEncoder().encode("%PDF-synthetic-only");
const positive = { CleanResult: false, FoundViruses: [{ FileName: "upload.pdf", VirusName: "Synthetic.Test.Detection" }] };
const clean = () => Response.json({ CleanResult: true, FoundViruses: [] });
const scan = (response, options = {}) => scanCloudmersiveFile(config, "application/pdf", bytes, async () => response, options.timeoutMs ?? 15_000);

test("optional adapter requires explicit enablement, region, endpoint and header-safe key before fetch", async () => {
  let calls = 0;
  const rejected = [{}, { ...config, enabled: undefined }, { ...config, enabled: false }, { ...config, region: undefined },
    { ...config, region: "canada" }, { ...config, apiKey: undefined }, { ...config, apiKey: "" },
    { ...config, apiKey: "secret\r\nInjected: header" }, { ...config, apiKey: " leading" },
    { ...config, apiKey: "trailing " }, { ...config, apiKey: "á" }, { ...config, apiKey: "x".repeat(257) }];
  for (const settings of rejected) {
    assert.equal(isCloudmersiveFileScannerConfigured(settings), false);
    assert.equal(await scanCloudmersiveFile(settings, "application/pdf", bytes, async () => { calls++; return clean(); }), "unavailable");
  }
  assert.equal(calls, 0);
  assert.equal(isCloudmersiveFileScannerConfigured(config), true);
});

test("only the documented HTTPS public endpoint is allowed; arbitrary regional hosts and URL credentials are refused", async () => {
  let calls = 0;
  for (const endpoint of [undefined, "http://api.cloudmersive.com", "https://api.cloudmersive.com/", "https://api.cloudmersive.com:443",
    "https://api.cloudmersive.com/virus/scan/file", "https://api.cloudmersive.com?key=value", "https://api.cloudmersive.com#hash",
    "https://key@api.cloudmersive.com", "https://api.cloudmersive.com.evil.example", "https://ca.api.cloudmersive.com",
    "http://localhost:8080", "https://127.0.0.1", "https://scanner.example"] ) {
    assert.equal(await scanCloudmersiveFile({ ...config, endpoint }, "application/pdf", bytes, async () => { calls++; return clean(); }), "unavailable");
  }
  assert.equal(calls, 0);
});

test("real provider protocol uses inputFile multipart, Apikey and fixed name without setting a multipart boundary", async () => {
  let request;
  assert.equal(await scanCloudmersiveFile(config, "application/pdf", bytes, async (url, init) => { request = { url, init }; return clean(); }), "clean");
  assert.equal(request.url, "https://api.cloudmersive.com/virus/scan/file");
  assert.equal(request.init.method, "POST");
  assert.deepEqual(request.init.headers, { Apikey: config.apiKey, Accept: "application/json" });
  assert.equal(request.init.redirect, "error"); assert.equal(request.init.credentials, "omit");
  assert.equal(request.init.cache, "no-store"); assert.equal(request.init.referrerPolicy, "no-referrer");
  assert.ok(request.init.signal instanceof AbortSignal);
  assert.ok(request.init.body instanceof FormData);
  assert.deepEqual([...request.init.body.keys()], ["inputFile"]);
  const file = request.init.body.get("inputFile");
  assert.equal(file.name, "upload.pdf"); assert.equal(file.type, "application/pdf");
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
});

test("all currently supported photos, PDFs and audio use synthetic names and unchanged bytes", async () => {
  for (const [mime, name] of [["application/pdf", "upload.pdf"], ["image/jpeg", "upload.jpg"], ["image/png", "upload.png"],
    ["image/webp", "upload.webp"], ["audio/mpeg", "upload.mp3"], ["audio/ogg", "upload.ogg"], ["audio/wav", "upload.wav"]]) {
    assert.equal(await scanCloudmersiveFile(config, mime, bytes, async (_url, init) => {
      const file = init.body.get("inputFile"); assert.equal(file.name, name); assert.equal(file.type, mime);
      assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes); return clean();
    }), "clean");
  }
});

test("multipart snapshots only the supplied view and never retains a caller-mutated buffer", async () => {
  const original = new TextEncoder().encode("xx%PDF-originalxx");
  const view = original.subarray(2, original.length - 2); const expected = view.slice();
  assert.equal(await scanCloudmersiveFile(config, "application/pdf", view, async (_url, init) => {
    original.fill(0); assert.deepEqual(new Uint8Array(await init.body.get("inputFile").arrayBuffer()), expected); return clean();
  }), "clean");
});

test("invalid MIME, tiny and oversized files and unapproved timeout do not contact the provider", async () => {
  let calls = 0; const fetcher = async () => { calls++; return clean(); };
  for (const mime of ["application/octet-stream", "image/svg+xml", "video/mp4", "application/pdf; charset=utf-8", "text/html", "__proto__", "constructor"])
    assert.equal(await scanCloudmersiveFile(config, mime, bytes, fetcher), "unavailable");
  for (const input of [new Uint8Array(), new Uint8Array(5), new Uint8Array(CLOUDMERSIVE_ADAPTER_MAX_FILE_BYTES + 1), new ArrayBuffer(10)])
    assert.equal(await scanCloudmersiveFile(config, "application/pdf", input, fetcher), "unavailable");
  for (const timeout of [0, -1, 15_001, NaN, Infinity, 1.5])
    assert.equal(await scanCloudmersiveFile(config, "application/pdf", bytes, fetcher, timeout), "unavailable");
  assert.equal(calls, 0);
});

test("adapter 20 MiB ceiling and configurable plan cap do not imply increasing the separate portal limit", async () => {
  assert.equal(CLOUDMERSIVE_ADAPTER_MAX_FILE_BYTES, 20 * 1024 * 1024);
  let calls = 0;
  for (const maxFileBytes of [0, 5, 1.5, Infinity, NaN, CLOUDMERSIVE_ADAPTER_MAX_FILE_BYTES + 1]) {
    const settings = { ...config, maxFileBytes }; assert.equal(isCloudmersiveFileScannerConfigured(settings), false);
    assert.equal(await scanCloudmersiveFile(settings, "application/pdf", bytes, async () => { calls++; return clean(); }), "unavailable");
  }
  assert.equal(await scanCloudmersiveFile({ ...config, maxFileBytes: bytes.length - 1 }, "application/pdf", bytes, async () => { calls++; return clean(); }), "unavailable");
  assert.equal(calls, 0);
  assert.equal(await scanCloudmersiveFile({ ...config, maxFileBytes: bytes.length }, "application/pdf", bytes, async () => clean()), "clean");
});

test("only typed, consistent provider verdicts are accepted; optional findings follow the official schema", async () => {
  assert.equal(await scan(clean()), "clean");
  assert.equal(await scan(Response.json({ CleanResult: true })), "clean");
  assert.equal(await scan(Response.json(positive)), "infected");
  assert.equal(await scan(Response.json({ CleanResult: false, FoundViruses: [{ VirusName: "Synthetic.Test" }] })), "infected");
});

test("unknown, malformed, alternate/cloud-storage errors and conflicting verdicts always fail closed", async () => {
  for (const value of [null, true, [], "clean", {}, { status: "clean" }, { CleanResult: "true" }, { CleanResult: 1 },
    { CleanResult: true, FoundViruses: null }, { CleanResult: true, FoundViruses: "none" }, positive && { ...positive, CleanResult: true },
    { CleanResult: false }, { CleanResult: false, FoundViruses: [] }, { CleanResult: true, ErrorDetailedDescription: "quota exhausted" },
    { CleanResult: true, Successful: false }, { CleanResult: true, FoundViruses: [null] },
    { CleanResult: false, FoundViruses: [{ VirusName: "" }] }, { CleanResult: false, FoundViruses: [{ VirusName: "  " }] },
    { CleanResult: false, FoundViruses: [{ VirusName: 1 }] }, { CleanResult: false, FoundViruses: [{ VirusName: "test", FileName: null }] },
    { CleanResult: false, FoundViruses: [{ VirusName: "test", FileName: "x".repeat(513) }] },
    { CleanResult: false, FoundViruses: [{ VirusName: "x".repeat(513) }] },
    { CleanResult: false, FoundViruses: [{ VirusName: "test", Error: "provider error" }] },
    { CleanResult: false, FoundViruses: Array.from({ length: 129 }, () => ({ VirusName: "test" })) }]) {
    assert.equal(await scan(Response.json(value)), "unavailable");
  }
});

test("quota, permissions, auth, oversized requests and all non-200 statuses reject without reading provider error bodies", async () => {
  for (const status of [201, 202, 204, 301, 302, 400, 401, 403, 413, 429, 500, 503]) {
    let cancelled = false;
    const response = new Response(status === 204 ? null : new ReadableStream({ cancel() { cancelled = true; } }), { status });
    assert.equal(await scan(response), "unavailable");
    if (status !== 204) assert.equal(cancelled, true);
  }
});

test("only JSON response types are accepted even when another type contains an apparent clean result", async () => {
  for (const type of [null, "text/html", "text/plain", "application/xml", "application/jsonp", "application/json; charset=latin1"])
    assert.equal(await scan(new Response('{"CleanResult":true}', { headers: type ? { "Content-Type": type } : {} })), "unavailable");
  assert.equal(await scan(new Response('{"CleanResult":true}', { headers: { "Content-Type": "text/json; charset=utf-8" } })), "clean");
});

test("redirect and unexpected final URLs cannot grant a verdict", async () => {
  const redirected = clean(); Object.defineProperty(redirected, "redirected", { value: true });
  assert.equal(await scan(redirected), "unavailable");
  const moved = clean(); Object.defineProperty(moved, "url", { value: "https://other.example/virus/scan/file" });
  assert.equal(await scan(moved), "unavailable");
  const exact = clean(); Object.defineProperty(exact, "url", { value: "https://api.cloudmersive.com/virus/scan/file" });
  assert.equal(await scan(exact), "clean");
});

test("response length is bounded before and during streaming with cancellation", async () => {
  for (const length of ["16385", "-1", "Infinity", "9007199254740992", "unknown"]) {
    let cancelled = false;
    const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "Content-Type": "application/json", "Content-Length": length } });
    assert.equal(await scan(response), "unavailable"); assert.equal(cancelled, true);
  }
  let cancelled = false;
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(16 * 1024 + 1)); }, cancel() { cancelled = true; } }), { headers: { "Content-Type": "application/json" } });
  assert.equal(await scan(response), "unavailable"); assert.equal(cancelled, true);
});

test("invalid JSON, invalid UTF-8, missing body and stream errors cannot produce success", async () => {
  for (const body of ["not JSON", new Uint8Array([0xff, 0xfe])])
    assert.equal(await scan(new Response(body, { headers: { "Content-Type": "application/json" } })), "unavailable");
  assert.equal(await scan(new Response(null, { headers: { "Content-Type": "application/json" } })), "unavailable");
  assert.equal(await scan(new Response(new ReadableStream({ start(controller) { controller.error(new Error("private provider error")); } }), { headers: { "Content-Type": "application/json" } })), "unavailable");
});

test("streamed JSON is reconstructed across chunks without interpreting partial clean markers", async () => {
  const source = new TextEncoder().encode('{"CleanResult":true,"FoundViruses":[]}');
  const response = new Response(new ReadableStream({ start(controller) {
    for (const byte of source) controller.enqueue(new Uint8Array([byte])); controller.close();
  } }), { headers: { "Content-Type": "application/json" } });
  assert.equal(await scan(response), "clean");
});

test("network failure, abort-aware timeout and abort-ignoring fetch all finish unavailable without exposing errors", async () => {
  assert.equal(await scanCloudmersiveFile(config, "application/pdf", bytes, async () => { throw new Error("private provider key/error"); }), "unavailable");
  let aborted = false;
  assert.equal(await scanCloudmersiveFile(config, "application/pdf", bytes, (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true });
  }), 2), "unavailable"); assert.equal(aborted, true);
  assert.equal(await scanCloudmersiveFile(config, "application/pdf", bytes, async () => new Promise(() => {}), 2), "unavailable");
});

test("deadline includes response-body reading and cancels a stalled stream", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "Content-Type": "application/json" } });
  assert.equal(await scan(response, { timeoutMs: 2 }), "unavailable"); assert.equal(cancelled, true);
});

test("late clean response after deadline is cancelled and never grants a verdict", async () => {
  let finish; let cancelled = false;
  const result = await scanCloudmersiveFile(config, "application/pdf", bytes, () => new Promise(resolve => { finish = resolve; }), 2);
  assert.equal(result, "unavailable");
  finish(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "Content-Type": "application/json" } }));
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(cancelled, true);
});
