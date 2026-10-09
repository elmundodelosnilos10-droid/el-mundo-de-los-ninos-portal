/** Explicit local acceptance only: real ClamAV, synthetic document, official EICAR. */
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import http from "node:http";
import { createScannerServer } from "../services/file-scanner/server.mjs";
import { clamdCommand, verifyLoadedDatabase } from "../services/file-scanner/clamd.mjs";
import { scanUploadedFile } from "../lib/file-scanner.ts";

const repo = fileURLToPath(new URL("../", import.meta.url));
export const OFFICIAL_EICAR_URL = "https://secure.eicar.org/eicar.com.txt";
export const SYNTHETIC_CLEAN_PDF = Buffer.from("%PDF-1.4\n% SYNTHETIC ACCEPTANCE FIXTURE: NO SCHOOL OR PERSON DATA\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "ascii");
const MAX_BYTES = 20 * 1024 * 1024;

export function assertLoopbackUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error("Acceptance requires a plain loopback HTTP endpoint.");
  return url;
}
export function assertLocalDockerHost(host) {
  if (typeof host !== "string" || !host.startsWith("unix:///") || host.includes("\n")) throw new Error("Acceptance refuses non-local Docker endpoints. Run inside the isolated Linux VM.");
}
export function validateOfficialEicar(bytes) {
  // Standard 68-byte test file fingerprint, not an actual malware payload.
  if (bytes.length !== 68 || createHash("md5").update(bytes).digest("hex") !== "44d88612fea8a8f36de82e1278abb02f") throw new Error("Official EICAR response did not match the standard test fixture.");
  return bytes;
}
function localEnvironment() {
  for (const key of ["SUPABASE_URL", "APP_ORIGIN", "BETTER_AUTH_URL", "SCHOOL_FILE_SCAN_URL"]) {
    if (process.env[key]) assertLoopbackUrl(process.env[key]);
  }
  if (process.env.DOCKER_HOST) assertLocalDockerHost(process.env.DOCKER_HOST);
  const environment = {};
  for (const key of ["PATH", "HOME", "DOCKER_CONFIG", "DOCKER_CONTEXT", "DOCKER_HOST", "TMPDIR"]) if (process.env[key]) environment[key] = process.env[key];
  return environment;
}
async function command(args, environment, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { cwd: repo, env: environment, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; let total = 0; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.stdout.on("data", chunk => { total += chunk.length; if (total < 1024 * 1024) output += chunk.toString(); });
    // Build errors/SDK diagnostics are never echoed; they may carry local configuration.
    child.stderr.on("data", () => {});
    child.on("error", () => { clearTimeout(timer); reject(new Error("Docker/Compose is unavailable in the isolated VM.")); });
    child.on("close", code => { clearTimeout(timer); if (code !== 0 || timedOut) reject(new Error(`Local Docker operation failed (${timedOut ? "timeout" : code}).`)); else resolve(output); });
  });
}
async function vacantPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function startHttp(config) {
  const server = createScannerServer(config);
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
async function closeHttp(server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
async function verdict(base, token, bytes, extra = {}) {
  assertLoopbackUrl(base);
  const response = await fetch(`${base}/scan`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/pdf", ...extra }, body: bytes, redirect: "error", signal: AbortSignal.timeout(15_000) });
  const payload = await response.json();
  assert.deepEqual(Object.keys(payload), ["status"]);
  return { code: response.status, status: payload.status };
}
async function health(base, token) {
  assertLoopbackUrl(base);
  const response = await fetch(`${base}/health`, { headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(5000) });
  return response.ok && (await response.json()).status === "ready";
}
async function declaredLimitVerdict(base, token) {
  assertLoopbackUrl(base);
  // Headers alone exercise the real rejection before receiving a >20 MiB body.
  return new Promise((resolve, reject) => {
    const request = http.request(`${base}/scan`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/pdf", "Content-Length": String(MAX_BYTES + 1) } }, response => {
      let body = ""; response.on("data", chunk => { body += chunk; });
      response.on("end", () => { try { resolve({ code: response.statusCode, status: JSON.parse(body).status }); } catch { reject(new Error("Local scanner response was malformed.")); } });
    });
    request.on("error", () => reject(new Error("Local declared-limit request failed.")));
    request.setTimeout(5000, () => request.destroy()); request.end();
  });
}
async function waitReady(base, token, progress) {
  const end = Date.now() + 15 * 60_000; let nextProgress = 0;
  while (Date.now() < end) {
    if (await health(base, token).catch(() => false)) return;
    if (Date.now() >= nextProgress) { progress("Waiting for real ClamAV and official signatures (maximum 15 minutes)."); nextProgress = Date.now() + 30_000; }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw new Error("Real ClamAV readiness/signatures were not confirmed within 15 minutes.");
}
async function officialEicar() {
  const response = await fetch(OFFICIAL_EICAR_URL, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok || !response.body) throw new Error("Official EICAR download unavailable; acceptance cannot claim malware detection.");
  const chunks = []; let total = 0;
  for await (const chunk of response.body) { total += chunk.length; if (total > 256) throw new Error("Unexpected official EICAR download size."); chunks.push(Buffer.from(chunk)); }
  return validateOfficialEicar(Buffer.concat(chunks));
}

/**
 * onReady is a trusted local harness seam: ephemeral URL/token stay in memory,
 * callback runs after acceptance and is awaited before cleanup. Do not log them.
 * This runner itself does not access Supabase, its records, or its credentials.
 */
export async function runScannerAcceptance({ runLocal = false, existingDaemon, onReady, progress = () => {} } = {}) {
  if (runLocal !== true) throw new Error("Explicit runLocal=true / --run is required for isolated Docker acceptance.");
  const environment = localEnvironment();
  const token = randomBytes(32).toString("base64url");
  let folder = null; let compose = null; let project = null; let endpoint;
  if (existingDaemon) {
    const { host, port } = existingDaemon.endpoint ?? {};
    if (!["127.0.0.1", "::1"].includes(host) || !Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Existing daemon must use numeric loopback and an explicit port.");
    if (typeof existingDaemon.stop !== "function" || typeof existingDaemon.start !== "function") throw new Error("Existing daemon acceptance requires scoped stop/start controls for its owned test process.");
    endpoint = { host, port };
  } else {
    const context = JSON.parse(await command(["context", "inspect"], environment));
    assertLocalDockerHost(context?.[0]?.Endpoints?.docker?.Host);
    await command(["compose", "version"], environment);
    folder = await mkdtemp(path.join(tmpdir(), "school-scanner-acceptance-"));
    project = `school-scanner-acceptance-${randomBytes(6).toString("hex")}`;
    const secretFile = path.join(folder, "unused-compose-secret");
    await writeFile(secretFile, token, { mode: 0o600 });
    environment.SCANNER_TOKEN_PATH = secretFile;
    const port = await vacantPort(); endpoint = { host: "127.0.0.1", port };
    const override = path.join(folder, "loopback.override.json");
    await writeFile(override, JSON.stringify({ services: { clamav: { ports: [`127.0.0.1:${port}:3310`], restart: "no" } } }), { mode: 0o600 });
    const composeArgs = ["compose", "--project-name", project, "-f", path.join(repo, "services/file-scanner/compose.yaml"), "-f", override];
    compose = (args, timeout) => command([...composeArgs, ...args], environment, timeout);
  }
  const servers = [];
  let started = false;
  const checks = [];
  try {
    if (compose) {
      await compose(["config", "--quiet"]);
      progress("Building only the repository's pinned official ClamAV image in an isolated Compose project.");
      started = true;
      await compose(["up", "-d", "--build", "clamav"], 10 * 60_000);
    }
    const config = { token, endpoint, engineVersion: "1.4.6", maxBytes: MAX_BYTES, requestTimeoutMs: 12_000, maxConcurrent: 2, maxDatabaseAgeMs: 86_400_000 };
    const live = await startHttp(config); servers.push(live.server);
    await waitReady(live.url, token, progress);
    const version = await clamdCommand(config.endpoint, "VERSION");
    verifyLoadedDatabase(version, config); checks.push("real_engine_and_official_loaded_signatures_under_24h");
    const adapter = { url: `${live.url}/scan`, token, applicationUrl: live.url, localTestMode: false };
    assert.equal(await scanUploadedFile(adapter, "application/pdf", SYNTHETIC_CLEAN_PDF), "clean"); checks.push("synthetic_clean_document_real_scan");
    const eicar = await officialEicar();
    assert.equal(await scanUploadedFile(adapter, "application/octet-stream", eicar), "infected"); checks.push("official_eicar_real_detection");
    assert.deepEqual(await verdict(live.url, randomBytes(32).toString("base64url"), SYNTHETIC_CLEAN_PDF), { code: 401, status: "unavailable" }); checks.push("wrong_token_denied");
    assert.deepEqual(await verdict(live.url, token, SYNTHETIC_CLEAN_PDF, { Origin: "https://browser.invalid" }), { code: 403, status: "unavailable" }); checks.push("browser_origin_denied");
    assert.deepEqual(await verdict(live.url, token, Buffer.from("short")), { code: 413, status: "unavailable" }); checks.push("unscannable_tiny_input_denied");
    assert.deepEqual(await declaredLimitVerdict(live.url, token), { code: 413, status: "unavailable" }); checks.push("real_http_declared_20mib_limit_denied");
    const bounded = await startHttp({ ...config, maxBytes: 128 }); servers.push(bounded.server);
    const chunked = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(512).fill(65)); controller.close(); } });
    const limitResponse = await fetch(`${bounded.url}/scan`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/pdf" }, body: chunked, duplex: "half", redirect: "error", signal: AbortSignal.timeout(15_000) });
    assert.equal(limitResponse.status, 503); assert.deepEqual(await limitResponse.json(), { status: "unavailable" }); checks.push("injected_small_stream_limit_real_daemon_denied_without_declared_size");
    const stale = await startHttp({ ...config, maxDatabaseAgeMs: 1 }); servers.push(stale.server);
    assert.equal(await health(stale.url, token), false);
    assert.equal(await scanUploadedFile({ ...adapter, url: `${stale.url}/scan` }, "application/pdf", SYNTHETIC_CLEAN_PDF), "unavailable");
    checks.push("restrictive_age_policy_fault_against_real_loaded_signatures_denied");
    const mismatch = await startHttp({ ...config, engineVersion: "0.0.0" }); servers.push(mismatch.server);
    assert.equal(await scanUploadedFile({ ...adapter, url: `${mismatch.url}/scan` }, "application/pdf", SYNTHETIC_CLEAN_PDF), "unavailable"); checks.push("engine_version_mismatch_fault_denied");
    if (existingDaemon) await existingDaemon.stop(); else await compose(["stop", "clamav"]);
    assert.equal(await health(live.url, token), false);
    assert.equal(await scanUploadedFile(adapter, "application/pdf", SYNTHETIC_CLEAN_PDF), "unavailable"); checks.push("stopped_real_daemon_denied");
    if (existingDaemon) await existingDaemon.start(); else await compose(["start", "clamav"]);
    await waitReady(live.url, token, progress);
    assert.equal(await scanUploadedFile(adapter, "application/pdf", SYNTHETIC_CLEAN_PDF), "clean"); checks.push("real_daemon_recovery_clean");
    if (onReady) await onReady({ url: adapter.url, token, applicationUrl: live.url, syntheticCleanBytes: Buffer.from(SYNTHETIC_CLEAN_PDF) });
    return { status: "passed", scope: "local_real_antivirus_only", syntheticFixturesOnly: true, checks, version, signatureExpiryCase: "injected_1ms_age_policy_real_database_not_historical_expired_database", productionEnabled: false };
  } finally {
    let cleanupFailed = false;
    for (const server of servers) await closeHttp(server).catch(() => { cleanupFailed = true; });
    if (started && compose) await compose(["down", "--volumes", "--remove-orphans"], 60_000).catch(() => { cleanupFailed = true; });
    if (folder) await rm(folder, { recursive: true, force: true });
    if (cleanupFailed) throw new Error(`Local cleanup failed. Inspect only Compose project ${project}; do not alter other projects.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== "--run") {
    process.stdout.write("Usage: node --experimental-strip-types scripts/accept-school-scanner.mjs --run\nRequires Node22.13+, local Unix Docker + Compose in an isolated Linux VM, 4 GiB for ClamAV, and official Docker/FreshClam/EICAR network access. No Supabase or production configuration is used.\n");
  } else {
    try { process.stdout.write(`${JSON.stringify(await runScannerAcceptance({ runLocal: true, progress: value => process.stdout.write(`${value}\n`) }))}\n`); }
    catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
  }
}
