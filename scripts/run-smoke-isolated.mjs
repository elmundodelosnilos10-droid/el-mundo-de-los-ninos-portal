import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSmokeEnvironment } from "./smoke-environment.mjs";

// Tests only: never read .dev.vars or use the school's credentials/resources.
const root = fileURLToPath(new URL("../", import.meta.url));
const scratch = await mkdtemp(path.join(tmpdir(), "school-smoke-"));
const state = path.join(scratch, "state");
const compiledSnapshot = path.join(scratch, "dist");
const config = path.join(compiledSnapshot, "server/wrangler.json");
const wrangler = path.join(root, "node_modules/wrangler/bin/wrangler.js");
const setupToken = randomBytes(32).toString("hex");
const authSecret = randomBytes(32).toString("hex");
const testEnvironment = createSmokeEnvironment(scratch);
let worker;
let workerOutput = "";
let lastSmokeRequest = "ninguna solicitud";
let interruption;
let failed = false;
const children = new Set();
const childCompletions = new WeakMap();

function isRunning(child) {
  return Boolean(child?.pid) && child.exitCode === null && child.signalCode === null;
}
function trackChild(child) {
  children.add(child);
  const completion = new Promise(resolve => child.once("close", (code, signal) => {
    children.delete(child);
    resolve({ code, signal });
  }));
  childCompletions.set(child, completion);
  return completion;
}
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.once(signal, () => {
    interruption = { signal, code };
    process.stderr.write(`Harness interrumpido por ${signal}; última ruta: ${lastSmokeRequest}.\n`);
    for (const child of children) if (isRunning(child)) child.kill("SIGTERM");
  });
}
function requireNotInterrupted() {
  if (interruption) throw new Error(`Harness interrumpido por ${interruption.signal}; última ruta: ${lastSmokeRequest}.`);
}
async function stopChild(child) {
  if (!isRunning(child)) {
    await childCompletions.get(child);
    return;
  }
  child.kill("SIGTERM");
  let timer;
  try {
    await Promise.race([
      childCompletions.get(child),
      new Promise(resolve => { timer = setTimeout(resolve, 5000); }),
    ]);
  } finally { clearTimeout(timer); }
  if (isRunning(child)) {
    child.kill("SIGKILL");
    await childCompletions.get(child);
  }
}

async function reservePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
}

function sanitized(text) {
  return text.replaceAll(setupToken, "[synthetic token]").replaceAll(authSecret, "[synthetic secret]");
}

async function run(args, { live = false, environment = testEnvironment, smoke = false } = {}) {
  requireNotInterrupted();
  const stdio = live ? ["inherit", "inherit", "inherit"] : ["ignore", "pipe", "pipe"];
  if (smoke) stdio.push("ipc");
  const child = spawn(process.execPath, args, { cwd: root, env: environment, stdio });
  const completion = trackChild(child);
  let output = "";
  if (!live) {
    const collect = bytes => { output = (output + bytes.toString()).slice(-30_000); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
  }
  child.on("error", error => { output += error.message; });
  if (smoke) child.on("message", message => {
    if (message?.type === "smoke-request" && typeof message.method === "string" && typeof message.path === "string") {
      lastSmokeRequest = `${message.method} ${message.path}`;
    }
  });
  const { code, signal } = await completion;
  requireNotInterrupted();
  if (code !== 0 || signal) {
    throw new Error(`Local test command failed (exit=${code ?? "none"}; signal=${signal ?? "none"}).${smoke ? ` Última ruta: ${lastSmokeRequest}.` : ""}\n${sanitized(output)}`);
  }
}

try {
  requireNotInterrupted();
  // Wrangler reads chunks during requests. Freeze the existing compiled output
  // so a later build cannot remove or replace files beneath the test Worker.
  // Application env files never belong in this test snapshot.
  await cp(path.join(root, "dist"), compiledSnapshot, {
    recursive: true,
    filter: source => {
      const name = path.basename(source);
      return !name.startsWith(".dev.vars") && !name.startsWith(".env");
    },
  });
  requireNotInterrupted();
  const port = await reservePort();
  const base = `http://127.0.0.1:${port}`;
  const envFile = path.join(scratch, "test.env");
  await writeFile(envFile, [
    `BETTER_AUTH_SECRET=${authSecret}`,
    `SCHOOL_SETUP_TOKEN=${setupToken}`,
    `BETTER_AUTH_URL=${base}`,
    "SCHOOL_AUTH_PROVIDER=d1",
    "SCHOOL_DATA_PROVIDER=d1",
    "SCHOOL_FILE_STORAGE_PROVIDER=r2",
    "SCHOOL_FILE_SCAN_LOCAL_MOCK=true",
    "",
  ].join("\n"), { mode: 0o600 });

  const migrations = (await readdir(path.join(root, "drizzle"))).filter(name => name.endsWith(".sql")).sort();
  for (const migration of migrations) {
    await run([wrangler, "d1", "execute", "DB", "--local", "--config", config, "--persist-to", state, "--file", path.join(root, "drizzle", migration)]);
  }
  process.stdout.write(`Prepared ${migrations.length} migrations in a disposable local D1 database.\n`);

  requireNotInterrupted();
  worker = spawn(process.execPath, ["--import", path.join(root, "scripts/sites-env.mjs"), wrangler, "dev", "--config", config,
    "--env-file", envFile, "--local", "--persist-to", state, "--ip", "127.0.0.1", "--inspector-port", "0", "--port", String(port)], {
    cwd: root, env: testEnvironment, stdio: ["ignore", "pipe", "pipe"],
  });
  const collectWorker = bytes => { workerOutput = (workerOutput + bytes.toString()).slice(-30_000); };
  worker.stdout.on("data", collectWorker);
  worker.stderr.on("data", collectWorker);
  worker.on("error", error => { workerOutput += error.message; });
  trackChild(worker);

  const readyDeadline = Date.now() + 45_000;
  let ready = false;
  while (Date.now() < readyDeadline && isRunning(worker) && !interruption) {
    try {
      const response = await fetch(`${base}/ingresar`, { signal: AbortSignal.timeout(1500), redirect: "manual" });
      if (response.status === 200) { ready = true; break; }
    } catch { /* Wait until the dedicated Worker is listening. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  requireNotInterrupted();
  if (!ready) throw new Error(`The disposable local Worker did not become ready (exit=${worker.exitCode ?? "none"}; signal=${worker.signalCode ?? "none"}).\n${sanitized(workerOutput)}`);
  await run([path.join(root, "tests/smoke.mjs")], { live: true, smoke: true, environment: { ...testEnvironment, SCHOOL_SETUP_TOKEN: setupToken, SCHOOL_TEST_BASE: base } });
} catch (error) {
  failed = true;
  process.stderr.write(`${sanitized(error instanceof Error ? error.message : String(error))}\n`);
  process.exitCode = interruption?.code ?? 1;
} finally {
  await Promise.all([...children].map(stopChild));
  // Wrangler flushes request/error logs during shutdown. Include those final
  // messages in failure diagnostics instead of truncating before child close.
  if (failed && workerOutput) process.stderr.write(sanitized(workerOutput.slice(-30_000)) + "\n");
  await rm(scratch, { recursive: true, force: true });
}
