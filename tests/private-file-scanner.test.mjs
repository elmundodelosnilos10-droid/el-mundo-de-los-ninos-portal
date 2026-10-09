// TCP/HTTP protocol tests against a SYNTHETIC daemon. No antivirus runs here.
import assert from "node:assert/strict";
import test from "node:test";
import net from "node:net";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { clamdCommand, scanClamdStream, verifyLoadedDatabase } from "../services/file-scanner/clamd.mjs";
import { loadScannerConfig, createScannerServer } from "../services/file-scanner/server.mjs";
import { scanUploadedFile } from "../lib/file-scanner.ts";

const token = "synthetic_test_only_" + "t".repeat(50);
function version(time = Date.now()) {
  const date = new Date(time);
  const [weekday, day, month, year, clock] = date.toUTCString().split(" ");
  return `ClamAV 1.4.6/12345/${weekday.slice(0, 3)} ${month} ${day} ${clock} ${year}`;
}

async function daemon(t, { verdict = "stream: OK", loadedVersion = version(), rawReply, hang = false, early = false } = {}) {
  const calls = [];
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let data = Buffer.alloc(0);
    let command;
    const chunks = [];
    socket.on("data", chunk => {
      data = Buffer.concat([data, chunk]);
      if (!command) {
        const end = data.indexOf(0);
        if (end < 0) return;
        command = data.subarray(0, end).toString("ascii");
        data = data.subarray(end + 1);
        if (command === "zVERSION") { calls.push(command); return socket.end(`${loadedVersion}\0`); }
        if (command === "zPING") { calls.push(command); return socket.end("PONG\0"); }
        if (early) return socket.end("stream: OK\0");
      }
      while (data.length >= 4) {
        const length = data.readUInt32BE(0);
        if (data.length < 4 + length) return;
        data = data.subarray(4);
        if (length === 0) {
          calls.push({ command, bytes: Buffer.concat(chunks) });
          if (!hang) socket.end(rawReply ?? `${verdict}\0`);
          return;
        }
        chunks.push(data.subarray(0, length));
        data = data.subarray(length);
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { for (const socket of sockets) socket.destroy(); server.close(); });
  return { endpoint: { host: "127.0.0.1", port: server.address().port }, calls };
}

async function service(t, options = {}, overrides = {}) {
  const backend = await daemon(t, options);
  const config = { ...(await loadScannerConfig({ SCANNER_TOKEN: token })), endpoint: backend.endpoint, ...overrides };
  const server = createScannerServer(config);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { ...backend, base: `http://127.0.0.1:${server.address().port}`, config };
}

function headers(extra = {}) { return { Authorization: `Bearer ${token}`, "Content-Type": "application/pdf", ...extra }; }

test("synthetic clamd receives complete big-endian INSTREAM chunks, never a filename", async t => {
  const backend = await daemon(t);
  const bytes = Buffer.alloc(140_000, 65);
  assert.equal(await scanClamdStream(backend.endpoint, Readable.from([bytes]), { expectedBytes: bytes.length }), "clean");
  assert.equal(backend.calls[0].command, "zINSTREAM");
  assert.deepEqual(backend.calls[0].bytes, bytes);
  assert.equal(await clamdCommand(backend.endpoint, "PING"), "PONG");
});

test("synthetic findings block; incomplete coverage, errors and unknown responses never become clean", async t => {
  for (const [verdict, expected] of [["stream: Synthetic.Test FOUND", "infected"], ["stream: Heuristics.Limits.Exceeded.MaxScanSize FOUND", null], ["stream: Heuristics.Encrypted.PDF FOUND", null], ["stream: unknown ERROR", null], ["OK", null]]) {
    const backend = await daemon(t, { verdict });
    const operation = scanClamdStream(backend.endpoint, Readable.from([Buffer.from("synthetic bytes")]));
    if (expected) assert.equal(await operation, expected);
    else await assert.rejects(operation, /Scanner unavailable/);
  }
});

test("synthetic protocol rejects early OK, empty files, overflow, wrong length, oversized/truncated replies and timeouts", async t => {
  const early = await daemon(t, { early: true });
  async function* slow() { await new Promise(resolve => setTimeout(resolve, 30)); yield Buffer.from("synthetic"); }
  await assert.rejects(scanClamdStream(early.endpoint, slow()), /Scanner unavailable/);
  const normal = await daemon(t);
  await assert.rejects(scanClamdStream(normal.endpoint, Readable.from([])), /Scanner unavailable/);
  await assert.rejects(scanClamdStream(normal.endpoint, Readable.from([Buffer.alloc(10)]), { maxBytes: 5 }), /Scanner unavailable/);
  await assert.rejects(scanClamdStream(normal.endpoint, Readable.from([Buffer.alloc(10)]), { expectedBytes: 12 }), /Scanner unavailable/);
  for (const rawReply of ["stream: OK", "x".repeat(1025) + "\0", "stream: OK\0extra"]) {
    const backend = await daemon(t, { rawReply });
    await assert.rejects(scanClamdStream(backend.endpoint, Readable.from([Buffer.from("synthetic")])), /Scanner unavailable/);
  }
  const blocked = await daemon(t, { hang: true });
  await assert.rejects(scanClamdStream(blocked.endpoint, Readable.from([Buffer.from("synthetic")]), { timeoutMs: 25 }), /Scanner unavailable/);
});

test("freshness validates loaded VERSION, engine pin, timezone/calendar and 24h limit", () => {
  const now = Date.UTC(2026, 9, 8, 12);
  verifyLoadedDatabase(version(now), { now });
  assert.throws(() => verifyLoadedDatabase(version(now - 86_400_001), { now }));
  assert.throws(() => verifyLoadedDatabase(version(now + 600_000), { now }));
  assert.throws(() => verifyLoadedDatabase(version(now).replace("1.4.6", "1.4.5"), { now }));
  assert.throws(() => verifyLoadedDatabase("ClamAV 1.4.6/12345/Thu Feb 30 12:00:00 2026", { now }));
  assert.throws(() => verifyLoadedDatabase("PONG", { now }));
});

test("configuration has no mock or insecure secret fallback and bounds its resources", async () => {
  await assert.rejects(loadScannerConfig({}));
  await assert.rejects(loadScannerConfig({ SCANNER_TOKEN: "short" }));
  await assert.rejects(loadScannerConfig({ SCANNER_TOKEN: token, REQUEST_TIMEOUT_MS: "15000" }));
  await assert.rejects(loadScannerConfig({ SCANNER_TOKEN: token, MAX_SCAN_BYTES: "999999999" }));
  await assert.rejects(loadScannerConfig({ SCANNER_TOKEN: token, MAX_DATABASE_AGE_HOURS: "48" }));
  await assert.rejects(loadScannerConfig({ SCANNER_TOKEN: token, MAX_CONCURRENT_SCANS: "9" }));
});

test("private HTTP matches existing upload adapter using a synthetic daemon", async t => {
  const scanner = await service(t);
  assert.equal(await scanUploadedFile({ url: `${scanner.base}/scan`, token }, "application/pdf", new TextEncoder().encode("synthetic document")), "clean");
  assert.deepEqual(scanner.calls.filter(call => typeof call === "string"), ["zVERSION", "zVERSION"]);
  const infected = await service(t, { verdict: "stream: Synthetic.Test FOUND" });
  assert.equal(await scanUploadedFile({ url: `${infected.base}/scan`, token }, "application/pdf", new TextEncoder().encode("synthetic document")), "infected");
});

test("HTTP rejects missing/wrong token, browser requests, queries, CORS, MIME, encoding and declared oversize before clamd", async t => {
  const scanner = await service(t, {}, { maxBytes: 10 });
  const samples = [
    ["/scan", {}, 401], ["/scan", headers({ Authorization: `Bearer ${"x".repeat(64)}` }), 401],
    ["/scan", headers({ Origin: "https://school.example.test" }), 403], ["/scan", headers({ "Sec-Fetch-Site": "same-origin" }), 403],
    ["/scan?token=never", headers(), 404], ["/scan", headers({ "Content-Type": "multipart/form-data" }), 415],
    ["/scan", headers({ "Content-Encoding": "gzip" }), 415],
  ];
  for (const [url, requestHeaders, status] of samples) {
    const response = await fetch(scanner.base + url, { method: "POST", headers: requestHeaders, body: "x" });
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
    assert.deepEqual(await response.json(), { status: "unavailable" });
  }
  const oversized = await fetch(scanner.base + "/scan", { method: "POST", headers: headers(), body: "x".repeat(11) });
  assert.equal(oversized.status, 413);
  assert.equal(scanner.calls.length, 0);
});

test("health is private, checks engine signatures and reveals no version/secrets", async t => {
  const scanner = await service(t);
  const response = await fetch(scanner.base + "/health", { headers: headers() });
  assert.deepEqual(await response.json(), { status: "ready" });
  assert.equal((await fetch(scanner.base + "/health")).status, 401);
  const stale = await service(t, { loadedVersion: version(Date.now() - 2 * 86_400_000) });
  assert.equal((await fetch(stale.base + "/health", { headers: headers() })).status, 503);
  assert.equal(await scanUploadedFile({ url: stale.base + "/scan", token }, "application/pdf", new TextEncoder().encode("x")), "unavailable");
  assert.ok(stale.calls.every(call => call === "zVERSION"));
});

test("chunked overflow and saturation fail closed with bounded concurrency", async t => {
  const scanner = await service(t, { hang: true }, { maxBytes: 8, maxConcurrent: 1, requestTimeoutMs: 120 });
  async function* tooLarge() { yield Buffer.from("1234"); yield Buffer.from("567890"); }
  const overflow = await fetch(scanner.base + "/scan", { method: "POST", headers: headers(), body: Readable.from(tooLarge()), duplex: "half" });
  assert.equal(overflow.status, 503);
  const pending = fetch(scanner.base + "/scan", { method: "POST", headers: headers(), body: "123456" });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await fetch(scanner.base + "/scan", { method: "POST", headers: headers(), body: "123456" })).status, 503);
  await pending.catch(() => {});
});

test("deployment uses digest pins, no daemon host port, ephemeral content and no detection logging", async () => {
  const root = new URL("../services/file-scanner/", import.meta.url);
  for (const file of ["Dockerfile", "Dockerfile.clamav"]) assert.match(await readFile(new URL(file, root), "utf8"), /@sha256:[a-f0-9]{64}/);
  const compose = await readFile(new URL("compose.yaml", root), "utf8");
  assert.match(compose, /127\.0\.0\.1:8080:8080/);
  assert.doesNotMatch(compose, /3310:3310/);
  assert.match(compose, /internal: true/);
  assert.match(compose, /driver: none/);
  assert.match(compose, /\/tmp:rw,noexec,nosuid/);
  const config = await readFile(new URL("clamd.conf", root), "utf8");
  assert.match(config, /AlertExceedsMax yes/);
  assert.match(config, /AlertEncrypted yes/);
  assert.match(config, /LogFile \/dev\/null/);
});
