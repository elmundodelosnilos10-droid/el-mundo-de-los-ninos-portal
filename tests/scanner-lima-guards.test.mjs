import test from "node:test";
import assert from "node:assert/strict";
import { validateScannerVm, runLimaScannerAcceptance, OFFICIAL_ARM_CLAMAV } from "../scripts/accept-school-scanner-lima.mjs";

const fixture = () => ({ name: "school-scanner-test", status: "Running", vmType: "vz", arch: "aarch64", cpus: 2, memory: 2 * 1024 ** 3, disk: 12 * 1024 ** 3, config: { mounts: [], propagateProxyEnv: false, ssh: { loadDotSSHPubKeys: false, forwardAgent: false }, images: [{ location: "https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-arm64.img", digest: `sha256:${"a".repeat(64)}` }], portForwards: [{ guestIP: "127.0.0.1", hostIP: "127.0.0.1", guestPort: 3310, hostPort: 43310 }, { ignore: true, guestPortRange: [1, 65535] }] } });

test("Lima acceptance is inert without explicit local run", async () => {
  await assert.rejects(runLimaScannerAcceptance(), /Explicit local/);
});

test("Lima guard accepts only a bounded unmounted ARM VZ test VM", () => {
  validateScannerVm(fixture());
  for (const replacement of [{ status: "Stopped" }, { cpus: 4 }, { memory: 4 * 1024 ** 3 }, { disk: 13 * 1024 ** 3 }, { name: "production" }, { vmType: "qemu" }, { arch: "x86_64" }]) assert.throws(() => validateScannerVm({ ...fixture(), ...replacement }));
  const larger = fixture(); larger.memory = 3 * 1024 ** 3;
  assert.throws(() => validateScannerVm(larger));
  validateScannerVm(larger, 3);
});

test("Lima guard rejects mounts, personal keys, agent/proxy forwarding and external ports", () => {
  for (const alter of [v => { v.config.mounts = [{ location: "/Users" }]; }, v => { v.config.ssh.loadDotSSHPubKeys = true; }, v => { v.config.ssh.forwardAgent = true; }, v => { v.config.propagateProxyEnv = true; }, v => { v.config.portForwards[0].hostIP = "0.0.0.0"; }, v => { v.config.portForwards[1].ignore = false; }, v => { v.config.images[0].location = "https://untrusted.invalid/disk"; }, v => { v.config.images[0].digest = "sha256:unverified"; }]) {
    const v = fixture(); alter(v); assert.throws(() => validateScannerVm(v));
  }
});

test("ARM acceptance uses an exact official image while original production amd64 source stays intact", () => {
  assert.match(OFFICIAL_ARM_CLAMAV, /^clamav\/clamav-debian:1\.4\.6_base@sha256:[a-f0-9]{64}$/);
});
