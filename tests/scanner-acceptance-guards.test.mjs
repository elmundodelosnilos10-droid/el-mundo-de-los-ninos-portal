import assert from "node:assert/strict";
import test from "node:test";
import { assertLocalDockerHost, assertLoopbackUrl, validateOfficialEicar, runScannerAcceptance, SYNTHETIC_CLEAN_PDF, OFFICIAL_EICAR_URL } from "../scripts/accept-school-scanner.mjs";

test("acceptance rejects remote Docker and scanner/prod URLs", () => {
  for (const host of ["tcp://127.0.0.1:2375", "ssh://host", "https://docker.example", "unix://relative", undefined]) assert.throws(() => assertLocalDockerHost(host), /local Docker/);
  assert.doesNotThrow(() => assertLocalDockerHost("unix:///var/run/docker.sock"));
  for (const url of ["https://production.example/scan", "http://192.168.1.1/scan", "http://user:secret@localhost/scan", "http://127.0.0.1/scan?token=x", "http://127.0.0.1/scan#x"]) assert.throws(() => assertLoopbackUrl(url), /loopback/);
  for (const host of ["127.0.0.1", "localhost", "[::1]"]) assert.equal(assertLoopbackUrl(`http://${host}:8080/scan`).protocol, "http:");
});

test("runner requires explicit local execution and never starts Docker by default", async () => {
  await assert.rejects(runScannerAcceptance(), /Explicit runLocal/);
  await assert.rejects(runScannerAcceptance({ runLocal: "true" }), /Explicit runLocal/);
});

test("existing native daemon mode requires numeric loopback and scoped owned-process controls before startup", async () => {
  for (const endpoint of [{ host: "192.168.1.1", port: 3310 }, { host: "localhost", port: 3310 }, { host: "127.0.0.1", port: 0 }, { host: "127.0.0.1", port: "3310" }]) {
    await assert.rejects(runScannerAcceptance({ runLocal: true, existingDaemon: { endpoint, stop() {}, start() {} } }), /numeric loopback/);
  }
  await assert.rejects(runScannerAcceptance({ runLocal: true, existingDaemon: { endpoint: { host: "127.0.0.1", port: 3310 } } }), /scoped stop\/start/);
});

test("acceptance clean fixture is clearly synthetic and official EICAR is exact, not an antivirus mock", () => {
  assert.match(SYNTHETIC_CLEAN_PDF.toString(), /^%PDF-/);
  assert.match(SYNTHETIC_CLEAN_PDF.toString(), /SYNTHETIC ACCEPTANCE FIXTURE: NO SCHOOL OR PERSON DATA/);
  assert.equal(OFFICIAL_EICAR_URL, "https://secure.eicar.org/eicar.com.txt");
  // Fixture identity only: this unit test does not run an antivirus.
  const standard = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
  assert.equal(validateOfficialEicar(standard), standard);
  assert.throws(() => validateOfficialEicar(Buffer.from("SYNTHETIC-INFECTED-MARKER")), /did not match/);
  assert.throws(() => validateOfficialEicar(Buffer.concat([standard, Buffer.from("\n")])), /did not match/);
});
