/** Synthetic acceptance only. Uses an already provisioned, unmounted local Lima VM. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { readFile, open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runScannerAcceptance } from "./accept-school-scanner.mjs";

export const OFFICIAL_ARM_CLAMAV = "clamav/clamav-debian:1.4.6_base@sha256:1b9f632fd2756d647ea76721c190f1a8821f3f1dc099b6b671e265d4346fcec4";
const VM = "school-scanner-test";
const CONFIG_FILES = ["clamd.conf", "freshclam.conf", "clamav-entrypoint.sh"];
const repo = fileURLToPath(new URL("../", import.meta.url));

export function validateScannerVm(vm, maximumMemoryGiB = 2) {
  assert.ok([2, 3].includes(maximumMemoryGiB), "Only an explicitly approved 2 or 3 GiB memory ceiling is allowed.");
  assert.equal(vm.name, VM);
  assert.equal(vm.status, "Running");
  assert.equal(vm.vmType, "vz");
  assert.equal(vm.arch, "aarch64");
  assert.ok(vm.cpus <= 2 && vm.cpus >= 1);
  assert.ok(vm.memory <= maximumMemoryGiB * 1024 ** 3 && vm.memory > 0);
  assert.ok(vm.disk <= 12 * 1024 ** 3 && vm.disk > 0);
  assert.deepEqual(vm.config.mounts ?? [], [], "Acceptance refuses all host mounts.");
  assert.equal(vm.config.ssh.loadDotSSHPubKeys, false);
  assert.equal(vm.config.ssh.forwardAgent, false);
  assert.equal(vm.config.propagateProxyEnv, false);
  const ports = vm.config.portForwards;
  assert.equal(ports.length, 2);
  assert.equal(ports[0].guestIP, "127.0.0.1");
  assert.equal(ports[0].hostIP, "127.0.0.1");
  assert.equal(ports[0].guestPort, 3310);
  assert.equal(ports[0].hostPort, 43310);
  if (ports[0].guestPortRange) assert.deepEqual(ports[0].guestPortRange, [3310, 3310]);
  if (ports[0].hostPortRange) assert.deepEqual(ports[0].hostPortRange, [43310, 43310]);
  assert.equal(ports[1].ignore, true);
  assert.deepEqual(ports[1].guestPortRange, [1, 65535]);
  assert.ok(vm.config.images?.length > 0, "A verified official guest image is required.");
  for (const image of vm.config.images) {
    assert.equal(new URL(image.location).hostname, "cloud-images.ubuntu.com");
    assert.ok(image.location.startsWith("https://"));
    assert.match(image.digest, /^sha256:[a-f0-9]{64}$/);
  }
}

export async function scopedTemporaryPath(value) {
  const resolved = await realpath(value);
  assert.ok(resolved.startsWith("/private/tmp/school-") || resolved.startsWith("/tmp/school-"), "Acceptance paths must stay in a dedicated school task directory under /tmp.");
  return resolved;
}

/** No provisioning, production endpoints, host credentials, or daemon outside this owned VM. */
export async function runLimaScannerAcceptance({ runLocal = false, limaBin, limaHome, evidencePath, maximumMemoryGiB = 2, progress = () => {}, onReady } = {}) {
  assert.equal(runLocal, true, "Explicit local acceptance is required.");
  limaBin = await scopedTemporaryPath(limaBin);
  limaHome = await scopedTemporaryPath(limaHome);
  assert.equal(path.basename(limaBin), "limactl");
  const evidenceParent = await scopedTemporaryPath(path.dirname(evidencePath));
  evidencePath = path.join(evidenceParent, path.basename(evidencePath));
  // Lima requires the existing HOME even for list. Preserve it; SSH identity is
  // scoped to LIMA_HOME and the guard refuses personal keys, agents and mounts.
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, LIMA_HOME: limaHome, XDG_CACHE_HOME: path.join(limaHome, "acceptance-cache") };
  const command = (args, timeoutMs = 120_000) => new Promise((resolve, reject) => {
    const child = spawn(limaBin, ["--tty=false", ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; let size = 0; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.stdout.on("data", chunk => { size += chunk.length; if (size <= 1024 * 1024) output += chunk.toString(); });
    child.stderr.on("data", () => {});
    child.on("error", () => { clearTimeout(timer); reject(new Error("Scoped local Lima operation could not start.")); });
    child.on("close", code => { clearTimeout(timer); if (code !== 0 || timedOut || size > 1024 * 1024) reject(new Error(`Scoped local Lima operation failed (${timedOut ? "timeout" : code}).`)); else resolve(output.trim()); });
  });
  const shell = (args, timeoutMs) => command(["shell", "--workdir=/tmp", VM, ...args], timeoutMs);
  const vm = JSON.parse(await command(["list", VM, "--json"]));
  validateScannerVm(vm, maximumMemoryGiB);
  const container = `school-scan-acceptance-${randomBytes(6).toString("hex")}`;
  const guestDir = `/tmp/${container}`;
  const volume = `${container}-signatures`;
  // Reserve unique private evidence before the first VM/Docker mutation.
  const evidence = await open(evidencePath, "wx", 0o600);
  let volumeCreated = false;
  let containerCreated = false;
  let guestDirCreated = false;
  const hashes = {};
  try {
    await shell(["mkdir", "-m", "700", guestDir]);
    guestDirCreated = true;
    for (const file of CONFIG_FILES) {
      const source = path.join(repo, "services/file-scanner", file);
      hashes[file] = createHash("sha256").update(await readFile(source)).digest("hex");
      await command(["copy", "--backend=scp", source, `${VM}:${guestDir}/${file}`]);
    }
    await shell(["chmod", "644", ...CONFIG_FILES.map(file => `${guestDir}/${file}`)]);
    progress("Pulling the exact official ClamAV 1.4.6 ARM image into the isolated VM.");
    await shell(["sudo", "docker", "pull", "--platform=linux/arm64", OFFICIAL_ARM_CLAMAV], 10 * 60_000);
    const imageId = await shell(["sudo", "docker", "image", "inspect", "--format", "{{.Id}}", OFFICIAL_ARM_CLAMAV]);
    await shell(["sudo", "docker", "volume", "create", volume]);
    volumeCreated = true;
    await shell(["sudo", "docker", "run", "-d", "--name", container, "--platform=linux/arm64", "--restart=no", "--read-only", "--cap-drop=ALL", "--cap-add=CHOWN", "--cap-add=SETUID", "--cap-add=SETGID", "--cap-add=DAC_OVERRIDE", "--security-opt=no-new-privileges:true", "--pids-limit=64", `--memory=${Math.floor(maximumMemoryGiB * 1024 - 300)}m`, `--memory-swap=${Math.floor(maximumMemoryGiB * 1024 - 300)}m`, "--cpus=2", "--log-driver=none", "--publish=127.0.0.1:3310:3310", "--tmpfs=/run:rw,noexec,nosuid,size=16m", "--tmpfs=/tmp:rw,noexec,nosuid,size=256m", "--mount", `type=volume,source=${volume},target=/var/lib/clamav`, "--mount", `type=bind,source=${guestDir}/clamd.conf,target=/etc/clamav/clamd.conf,readonly`, "--mount", `type=bind,source=${guestDir}/freshclam.conf,target=/etc/clamav/freshclam.conf,readonly`, "--mount", `type=bind,source=${guestDir}/clamav-entrypoint.sh,target=/school-entrypoint.sh,readonly`, "--entrypoint=/bin/sh", OFFICIAL_ARM_CLAMAV, "/school-entrypoint.sh"]);
    containerCreated = true;
    const result = await runScannerAcceptance({ runLocal: true, progress, onReady, existingDaemon: { endpoint: { host: "127.0.0.1", port: 43310 }, stop: () => shell(["sudo", "docker", "stop", "--time=10", container]), start: () => shell(["sudo", "docker", "start", container]) } });
    const report = { ...result, observedAt: new Date().toISOString(), vm: { name: VM, memory: vm.memory, cpus: vm.cpus, disk: vm.disk, hostMounts: false }, officialImage: OFFICIAL_ARM_CLAMAV, imageId, configSha256: hashes };
    await evidence.writeFile(`${JSON.stringify(report, null, 2)}\n`);
    return report;
  } catch (error) {
    let state = null;
    if (containerCreated) {
      try { state = JSON.parse(await shell(["sudo", "docker", "inspect", "--format", "{{json .State}}", container])); } catch { /* No token or content diagnostics. */ }
    }
    await evidence.writeFile(`${JSON.stringify({ status: "not_passed", observedAt: new Date().toISOString(), syntheticFixturesOnly: true, productionEnabled: false, officialImage: OFFICIAL_ARM_CLAMAV, configSha256: hashes, daemonState: state ? { running: state.Running, oomKilled: state.OOMKilled, exitCode: state.ExitCode } : null, reason: error.message }, null, 2)}\n`);
    throw error;
  } finally {
    try {
      if (containerCreated) await shell(["sudo", "docker", "rm", "--force", container]);
      if (volumeCreated) await shell(["sudo", "docker", "volume", "rm", volume]);
      if (guestDirCreated) {
        // Only known files and the owned directory, never recursive deletion.
        await shell(["rm", "-f", ...CONFIG_FILES.map(file => `${guestDir}/${file}`)]);
        await shell(["rmdir", guestDir]);
      }
    } finally { await evidence.close(); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [run, limaBin, limaHome, evidencePath] = process.argv.slice(2);
  if (run !== "--run" || !limaBin || !limaHome || !evidencePath || process.argv.length !== 6) process.stdout.write("Usage: node --experimental-strip-types scripts/accept-school-scanner-lima.mjs --run /tmp/school-.../limactl /tmp/school-.../lima-home /tmp/school-.../evidence.json\nRequires already running isolated school-scanner-test VZ ARM VM,2CPU/2GiB/12GiB, no mounts, Docker from official Ubuntu repos, exclusive loopback3310->43310.\n");
  else {
    try { const result = await runLimaScannerAcceptance({ runLocal: true, limaBin, limaHome, evidencePath, progress: message => process.stdout.write(`${message}\n`) }); process.stdout.write(`${JSON.stringify({ status: result.status, checks: result.checks, version: result.version })}\n`); }
    catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
  }
}
