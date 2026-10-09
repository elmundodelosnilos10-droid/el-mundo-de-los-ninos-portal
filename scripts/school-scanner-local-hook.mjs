/** In-memory bridge only. Never imports school env files or writes credentials. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { loopbackOrigin } from "./supabase-school-http-local-support.mjs";

export function scannerLocalNextEnvironment({ scanner, appOrigin, supabaseOrigin, credentials, baseEnvironment = process.env }) {
  appOrigin = loopbackOrigin(appOrigin, "Local application");
  supabaseOrigin = loopbackOrigin(supabaseOrigin, "Local Supabase");
  assert.notEqual(appOrigin, supabaseOrigin);
  assert.equal(baseEnvironment.VERCEL, undefined, "Local acceptance refuses a Vercel runtime.");
  assert.notEqual(baseEnvironment.NODE_ENV, "production", "Local acceptance refuses production mode.");
  assert.ok(scanner && typeof scanner.url === "string");
  const scanUrl = new URL(scanner.url);
  assert.equal(loopbackOrigin(scanUrl.origin, "Local scanner"), scanUrl.origin);
  assert.equal(scanUrl.pathname, "/scan");
  assert.equal(scanUrl.search, "");
  assert.equal(scanUrl.hash, "");
  assert.equal(scanUrl.username, "");
  assert.equal(scanUrl.password, "");
  assert.match(scanner.token, /^[A-Za-z0-9_-]{43,128}$/);
  assert.ok(credentials && typeof credentials.anonKey === "string" && credentials.anonKey && typeof credentials.serviceRoleKey === "string" && credentials.serviceRoleKey && credentials.anonKey !== credentials.serviceRoleKey);
  assert.ok(!/[\r\n]/.test(credentials.anonKey + credentials.serviceRoleKey));
  const runtime = {};
  // Preserve ordinary runtime values unchanged; never spread process.env.
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG"]) if (baseEnvironment[key]) runtime[key] = baseEnvironment[key];
  return {
    ...runtime,
    NODE_ENV: "development",
    NEXT_TELEMETRY_DISABLED: "1",
    SCHOOL_LOCAL_SUPABASE_HTTP: "isolated-test",
    APP_ORIGIN: appOrigin,
    BETTER_AUTH_URL: appOrigin,
    BETTER_AUTH_SECRET: randomBytes(32).toString("base64url"),
    SCHOOL_AUTH_PROVIDER: "supabase",
    SCHOOL_DATA_PROVIDER: "supabase",
    SCHOOL_FILE_STORAGE_PROVIDER: "supabase",
    SCHOOL_REALTIME_PROVIDER: "disabled",
    SUPABASE_URL: supabaseOrigin,
    SUPABASE_PUBLISHABLE_KEY: credentials.anonKey,
    SUPABASE_SECRET_KEY: credentials.serviceRoleKey,
    SUPABASE_STORAGE_BUCKET: "school-files",
    SCHOOL_FILE_SCAN_URL: scanUrl.href,
    SCHOOL_FILE_SCAN_TOKEN: scanner.token,
    SCHOOL_FILE_SCAN_LOCAL_MOCK: "false",
  };
}

/**
 * Pass the returned function as runLimaScannerAcceptance({onReady}). verifyEmpty
 * must perform the authoritative empty local Auth/DB/Storage preflight. run owns
 * a temporary Next child: await its HTTP fixture and terminate it in finally.
 * No URL/token may be written to logs, env files or serialized evidence.
 */
export function createLocalScannerIntegrationHook({ appOrigin, supabaseOrigin, credentials, baseEnvironment, verifyEmpty, run }) {
  assert.equal(typeof verifyEmpty, "function", "An authoritative empty local stack preflight is required.");
  assert.equal(typeof run, "function", "An awaited isolated Next/HTTP integration callback is required.");
  return async scanner => {
    const nextEnvironment = scannerLocalNextEnvironment({ scanner, appOrigin, supabaseOrigin, credentials, baseEnvironment });
    try {
      await verifyEmpty({ supabaseOrigin: nextEnvironment.SUPABASE_URL, credentials });
      await run({ nextEnvironment, syntheticCleanBytes: Buffer.from(scanner.syntheticCleanBytes) });
    } catch {
      // Callback failures can contain Auth SDK/request diagnostics. Never pass
      // unknown messages into the scanner evidence or CLI output.
      throw new Error("Local scanner integration failed; inspect only sanitized local HTTP evidence.");
    } finally {
      delete nextEnvironment.SCHOOL_FILE_SCAN_TOKEN;
      delete nextEnvironment.SUPABASE_SECRET_KEY;
      delete nextEnvironment.SUPABASE_PUBLISHABLE_KEY;
      delete nextEnvironment.BETTER_AUTH_SECRET;
    }
  };
}
