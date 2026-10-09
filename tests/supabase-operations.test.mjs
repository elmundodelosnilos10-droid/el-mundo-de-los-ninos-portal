import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseDatabaseClient } from "../lib/supabase/database.ts";
import { describeSchoolServiceConfiguration, readSchoolAudit, readSchoolDatabaseStatus } from "../lib/supabase/operations.ts";

const jwt = "synthetic-operation-jwt";
const config = { url: "https://operations.example.test", publishableKey: "sb_publishable_synthetic" };
const row = { id: "audit-synthetic", actorName: "Dirección sintética", action: "create", entityType: "group", entityId: "group-synthetic", createdAt: "2026-10-08T10:00:00Z" };

test("audit feed sends user JWT to role-checked RPC and whitelists the DTO", async () => {
  let captured;
  const client = createSupabaseDatabaseClient(config, async (url, init) => {
    captured = { url: String(url), init };
    return Response.json({ items: [{ ...row, email: "private@example.test", object_key: "private/path", content: "private body" }] });
  });
  assert.deepEqual(await readSchoolAudit(client, jwt), [row]);
  assert.match(captured.url, /\/rpc\/school_audit_feed$/);
  assert.equal(captured.init.headers.Authorization, `Bearer ${jwt}`);
  assert.equal(captured.init.headers.apikey, config.publishableKey);
  assert.deepEqual(JSON.parse(captured.init.body), { p_version: 1 });
});

test("successful empty audit is distinct from failure", async () => {
  const empty = createSupabaseDatabaseClient(config, async () => Response.json({ items: [] }));
  assert.deepEqual(await readSchoolAudit(empty, jwt), []);
  const denied = createSupabaseDatabaseClient(config, async () => Response.json({ message: "internal private detail" }, { status: 403 }));
  await assert.rejects(readSchoolAudit(denied, jwt));
  const unavailable = createSupabaseDatabaseClient(config, async () => { throw new Error("private host detail"); });
  await assert.rejects(readSchoolAudit(unavailable, jwt));
});

test("audit rejects malformed or excessive upstream records", async () => {
  for (const payload of [{}, { items: null }, { items: [null] }, { items: [{ ...row, actorName: undefined }] },
    { items: [{ ...row, createdAt: "not a date" }] }, { items: Array.from({ length: 101 }, () => row) }]) {
    const client = createSupabaseDatabaseClient(config, async () => Response.json(payload));
    await assert.rejects(readSchoolAudit(client, jwt), /School audit unavailable/);
  }
});

test("system database status uses a superadmin RPC and strips future fields", async () => {
  const status = { checkedAt: "2026-10-08T10:00:00Z", activeAccounts: 4, activeGroups: 0, auditRecords: 12, latestAuditAt: null };
  const client = createSupabaseDatabaseClient(config, async (url, init) => {
    assert.match(String(url), /\/rpc\/school_system_status$/);
    assert.equal(init.headers.Authorization, `Bearer ${jwt}`);
    assert.deepEqual(JSON.parse(init.body), { p_version: 1 });
    return Response.json({ ...status, password: "should not leak" });
  });
  assert.deepEqual(await readSchoolDatabaseStatus(client, jwt), status);
});

test("system status never invents counts or timestamps when an upstream field is invalid", async () => {
  const status = { checkedAt: "2026-10-08T10:00:00Z", activeAccounts: 1, activeGroups: 0, auditRecords: 0, latestAuditAt: null };
  for (const patch of [{ checkedAt: null }, { activeAccounts: -1 }, { activeGroups: "0" }, { auditRecords: 0.5 }, { latestAuditAt: undefined }, { latestAuditAt: "wrong" }]) {
    const client = createSupabaseDatabaseClient(config, async () => Response.json({ ...status, ...patch }));
    await assert.rejects(readSchoolDatabaseStatus(client, jwt), /School database status unavailable/);
  }
});

test("configuration DTO exposes presence and clearly keeps delivery/storage/backup tests unverified", () => {
  const secret = "synthetic-server-secret-never-in-response";
  const result = describeSchoolServiceConfiguration({
    SCHOOL_AUTH_PROVIDER: "supabase", SCHOOL_DATA_PROVIDER: "supabase", SCHOOL_FILE_STORAGE_PROVIDER: "supabase",
    SUPABASE_URL: config.url, SUPABASE_PUBLISHABLE_KEY: config.publishableKey, SUPABASE_SECRET_KEY: secret,
  }, { recoveryConfigured: true, scannerConfigured: true });
  assert.equal(result.authenticationConfigured, true);
  assert.equal(result.storageConfigured, true);
  assert.equal(result.serviceChecksPerformed, false);
  assert.equal(result.backupsVerified, false);
  assert.equal(result.recordingsEnabled, false);
  assert.equal(result.timeZone, "America/Mexico_City");
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.ok(!JSON.stringify(result).includes(config.url));
  assert.ok(!JSON.stringify(result).includes(config.publishableKey));
});

test("missing or malformed storage configuration stays pending", () => {
  const base = { SCHOOL_AUTH_PROVIDER: "supabase", SCHOOL_FILE_STORAGE_PROVIDER: "supabase", SUPABASE_URL: config.url, SUPABASE_PUBLISHABLE_KEY: config.publishableKey };
  for (const patch of [{}, { SUPABASE_SECRET_KEY: "bad\nkey" }, { SUPABASE_SECRET_KEY: "present", SUPABASE_STORAGE_BUCKET: "../invalid" }, { SUPABASE_SECRET_KEY: "present", SUPABASE_URL: "https://user:secret@operations.example.test" }]) {
    assert.equal(describeSchoolServiceConfiguration({ ...base, ...patch }, { recoveryConfigured: false, scannerConfigured: false }).storageConfigured, false);
  }
});
