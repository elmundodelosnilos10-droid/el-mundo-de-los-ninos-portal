import test from "node:test";
import assert from "node:assert/strict";
import { createLocalScannerIntegrationHook, scannerLocalNextEnvironment } from "../scripts/school-scanner-local-hook.mjs";
const options = () => ({ scanner: { url: "http://127.0.0.1:33001/scan", token: "T".repeat(43), syntheticCleanBytes: Buffer.from("SYNTHETIC ONLY") }, appOrigin: "http://127.0.0.1:33002", supabaseOrigin: "http://127.0.0.1:33003", credentials: { anonKey: "synthetic-local-anon", serviceRoleKey: "synthetic-local-service" }, baseEnvironment: { PATH: "/ordinary/runtime", HOME: "/existing/home", UNRELATED_SECRET: "must-not-copy", SCHOOL_FILE_SCAN_LOCAL_MOCK: "true", SUPABASE_URL: "https://production.invalid", SUPABASE_SECRET_KEY: "must-not-copy" } });

test("scanner local Next environment uses literal loopback, real scanner and explicit whitelist", () => {
  const env = scannerLocalNextEnvironment(options());
  assert.equal(env.SCHOOL_FILE_SCAN_LOCAL_MOCK, "false");
  assert.equal(env.SCHOOL_LOCAL_SUPABASE_HTTP, "isolated-test");
  assert.equal(env.NODE_ENV, "development");
  assert.equal(env.SCHOOL_FILE_SCAN_URL, "http://127.0.0.1:33001/scan");
  assert.equal(env.SUPABASE_URL, "http://127.0.0.1:33003");
  assert.equal(env.SUPABASE_SECRET_KEY, "synthetic-local-service");
  assert.equal(env.UNRELATED_SECRET, undefined);
  assert.equal(env.HOME, "/existing/home");
  assert.match(env.BETTER_AUTH_SECRET, /^[A-Za-z0-9_-]{43}$/);
});

test("scanner local hook rejects production runtimes and nonliteral or ambiguous endpoints", () => {
  for (const mutate of [v => { v.baseEnvironment.VERCEL = "1"; }, v => { v.baseEnvironment.NODE_ENV = "production"; }, v => { v.scanner.url = "https://scanner.invalid/scan"; }, v => { v.scanner.url = "http://localhost:33001/scan"; }, v => { v.scanner.url += "?token=bad"; }, v => { v.appOrigin = "https://production.invalid"; }, v => { v.supabaseOrigin = v.appOrigin; }, v => { v.scanner.token = "short"; }, v => { v.credentials.serviceRoleKey = v.credentials.anonKey; }]) {
    const v = options(); mutate(v); assert.throws(() => scannerLocalNextEnvironment(v));
  }
});

test("hook awaits authoritative empty preflight and run before forgetting in-memory credentials", async () => {
  const input = options(); const order = []; let saved;
  const hook = createLocalScannerIntegrationHook({ ...input,
    verifyEmpty: async () => { order.push("empty"); },
    run: async ({ nextEnvironment, syntheticCleanBytes }) => { saved = nextEnvironment; assert.equal(nextEnvironment.SCHOOL_FILE_SCAN_TOKEN, input.scanner.token); assert.equal(syntheticCleanBytes.toString(), "SYNTHETIC ONLY"); await Promise.resolve(); order.push("run"); },
  });
  await hook(input.scanner); order.push("finished");
  assert.deepEqual(order, ["empty", "run", "finished"]);
  for (const key of ["SCHOOL_FILE_SCAN_TOKEN", "SUPABASE_SECRET_KEY", "SUPABASE_PUBLISHABLE_KEY", "BETTER_AUTH_SECRET"]) assert.equal(saved[key], undefined);
});

test("failed empty preflight performs no callback and unknown failures never reveal credentials", async () => {
  let called = false; const input = options();
  assert.throws(() => createLocalScannerIntegrationHook({ ...input, run: async () => {} }), /preflight/);
  const hook = createLocalScannerIntegrationHook({ ...input, verifyEmpty: async () => { throw new Error("private Auth response synthetic-local-service"); }, run: async () => { called = true; } });
  await assert.rejects(hook(input.scanner), error => { assert.equal(error.message, "Local scanner integration failed; inspect only sanitized local HTTP evidence."); assert.doesNotMatch(error.message, /private Auth|synthetic-local-service/); return true; });
  assert.equal(called, false);
});
