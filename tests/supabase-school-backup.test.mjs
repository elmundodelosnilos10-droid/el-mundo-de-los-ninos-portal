import test from "node:test";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  createBackup,
  createSupabaseClient,
  loadSchoolBackupTables,
  parseBackupArgs,
  parseSchoolSchema,
  restoreBackup,
  schemaFingerprint,
  stableStringify,
  storageObjectPath,
  verifyBackup,
} from "../scripts/supabase-school-backup.mjs";
import { decryptBackupFile, deriveBackupKey } from "../scripts/backup-crypto.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = await readFile(path.join(root, "supabase/migrations/20261008000000_school_schema.sql"), "utf8");
const tables = parseSchoolSchema(migration);
const passphrase = "synthetic school backup phrase";

function response(status, body, headers = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  return {
    status,
    headers: new Headers(headers),
    async json() { return JSON.parse(bytes.toString("utf8")); },
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  };
}

function fakeClient({ rows = {}, objects = {}, authUsers = [], schema = tables, failOn = null, failAfter = null } = {}) {
  const calls = [];
  let uploaded = new Map();
  const request = async (endpoint, options = {}) => {
    const method = options.method ?? "GET";
    calls.push({ endpoint, method, headers: options.headers, body: options.body });
    if (failOn?.(endpoint, method)) throw Error("synthetic remote failure");
    if (endpoint === "/rest/v1/") {
      return response(200, {
        paths: Object.fromEntries(schema.map(table => [`/${table.name}`, {}])),
        definitions: Object.fromEntries(schema.map(table => [table.name, { properties: Object.fromEntries(table.columns.map(column => [column, {}])) }])),
      });
    }
    if (endpoint.startsWith("/auth/v1/admin/users")) return response(200, { users: authUsers });
    if (endpoint.startsWith("/storage/v1/object/list/school-files")) {
      const prefix = JSON.parse(options.body).prefix;
      const children = new Map();
      for (const [key, value] of Object.entries(objects)) {
        if (!key.startsWith(prefix)) continue;
        const remainder = key.slice(prefix.length);
        const slash = remainder.indexOf("/");
        const name = slash < 0 ? remainder : remainder.slice(0, slash);
        if (name && !children.has(name)) children.set(name, slash < 0 ? value : null);
      }
      const result = [...children].map(([name, value]) => ({ name, id: value?.bytes ? "object-id" : null, metadata: value?.bytes ? { mimetype: value.contentType, size: value.bytes.length } : null }));
      return response(200, result);
    }
    const objectMatch = endpoint.match(/^\/storage\/v1\/object\/(?:authenticated\/)?school-files\/(.+)$/);
    if (objectMatch) {
      const key = decodeURIComponent(objectMatch[1].split("/").join("%2F")).replaceAll("%2F", "/");
      if (method === "GET") {
        const object = objects[key] ?? uploaded.get(key);
        if (!object) return response(404, {});
        return response(200, object.bytes, { "content-type": object.contentType ?? "application/octet-stream" });
      }
      if (method === "POST") {
        if (objects[key] || uploaded.has(key)) return response(409, {});
        uploaded.set(key, { bytes: Buffer.from(options.body), contentType: options.headers["content-type"] });
        if (failAfter?.(endpoint, method)) throw Error("synthetic lost upload response");
        return response(200, {});
      }
      if (method === "DELETE") { uploaded.delete(key); return response(200, {}); }
    }
    const tableMatch = endpoint.match(/^\/rest\/v1\/([a-z_]+)(?:\?(.*))?$/);
    if (tableMatch) {
      const [, tableName, query = ""] = tableMatch;
      const table = schema.find(item => item.name === tableName);
      if (!table) return response(404, {});
      const data = rows[tableName] ?? [];
      if (method === "GET" && query.includes("limit=1")) {
        return response(206, data.slice(0, 1), { "content-range": `0-0/${data.length}` });
      }
      if (method === "GET") {
        const params = new URLSearchParams(query);
        const offset = Number(params.get("offset") ?? 0);
        const limit = Number(params.get("limit") ?? 500);
        return response(200, data.slice(offset, offset + limit));
      }
      if (method === "POST") {
        for (const incoming of JSON.parse(options.body)) {
          const index = data.findIndex(existing => table.primaryKey.every(key => existing[key] === incoming[key]));
          if (index < 0) data.push(incoming);
          else data[index] = incoming;
        }
        rows[tableName] = data;
        if (failAfter?.(endpoint, method)) throw Error("synthetic lost database response");
        return response(201, {});
      }
      if (method === "DELETE") {
        const filters = new URLSearchParams(query);
        const keys = [...filters].map(([key, value]) => [key, value.slice(3)]);
        rows[tableName] = data.filter(row => !keys.every(([key, value]) => String(row[key]) === decodeURIComponent(value)));
        return response(204, "");
      }
    }
    return response(404, {});
  };
  return { request, calls, uploaded, rows };
}

test("migrations produce a deterministic contract covering all public school tables", () => {
  assert.equal(tables.length, 32);
  assert.ok(tables.some(table => table.name === "profiles"));
  assert.ok(tables.some(table => table.name === "activity_progress"));
  assert.ok(tables.every(table => table.primaryKey.length > 0));
  assert.equal(schemaFingerprint(tables), schemaFingerprint(parseSchoolSchema(migration)));
  assert.equal(stableStringify({ z: 1, a: 2 }), '{"a":2,"z":1}');
});

test("backup catalog includes private invitation recovery state without changing the baseline D1 schema", async () => {
  const current = await loadSchoolBackupTables();
  const legacy = await loadSchoolBackupTables({ legacySchoolSchema: true });
  assert.equal(current.length, 33);
  assert.deepEqual(legacy, tables);
  assert.deepEqual(current.slice(0, 32), tables);
  assert.deepEqual(current[32], { name: "school_account_invitation_provisions", columns: ["auth_user_id", "invitation_nonce", "inviter_id", "provisioned_at", "state"], primaryKey: ["auth_user_id"] });
  assert.notEqual(schemaFingerprint(current), schemaFingerprint(legacy));
  assert.ok(!tables.some(table => table.name === "school_account_invitation_provisions"));
});

test("legacy schema verification requires explicit opt-in and cannot create or restore incomplete backups", () => {
  assert.equal(parseBackupArgs(["verify", "/synthetic", "--legacy-school-schema"]).legacySchoolSchema, true);
  assert.equal(parseBackupArgs(["backup", "/synthetic"]).legacySchoolSchema, false);
  assert.throws(() => parseBackupArgs(["backup", "/synthetic", "--legacy-school-schema"]));
  assert.throws(() => parseBackupArgs(["restore", "/synthetic", "--confirm-restore", "--legacy-school-schema"]));
});

test("encrypted backup preserves all invitation states and restores private state after profiles", async t => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "supabase-account-backup-"));
  const directory = path.join(parent, "backup");
  t.after(() => rm(parent, { recursive: true, force: true }));
  const schema = await loadSchoolBackupTables();
  const profileRows = ["1", "2", "3"].map(id => Object.fromEntries(schema[0].columns.map(column => [column, column === "id" ? id : column === "email" ? `${id}@example.invalid` : column === "active" || column === "email_verified" ? false : "synthetic"])));
  const privateRows = ["provisioned", "managed", "quarantined"].map((state, index) => ({ auth_user_id: String(index + 1), invitation_nonce: `receipt-${index + 1}`, inviter_id: "1", provisioned_at: "2026-10-08T00:00:00Z", state }));
  const source = fakeClient({ schema, rows: { profiles: profileRows, school_account_invitation_provisions: privateRows } });
  const result = await createBackup({ directory, client: source, tables: schema, passphrase });
  assert.equal(result.tables, 33);
  await verifyBackup({ directory, passphrase, tables: schema });
  await assert.rejects(verifyBackup({ directory, passphrase, tables }), /otra versión del esquema/);
  const target = fakeClient({ schema, rows: {}, authUsers: profileRows.map(row => ({ id: row.id, email: row.email })) });
  await restoreBackup({ directory, client: target, tables: schema, passphrase, confirmRestore: true });
  assert.deepEqual(target.rows.school_account_invitation_provisions, privateRows);
  const writes = target.calls.filter(call => call.method === "POST" && call.endpoint.startsWith("/rest/v1/"));
  assert.ok(writes.findIndex(call => call.endpoint === "/rest/v1/profiles") < writes.findIndex(call => call.endpoint === "/rest/v1/school_account_invitation_provisions"));
});

test("backup archives encrypted rows and every private Storage object, then verifies counts and hashes", async t => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "supabase-school-backup-"));
  const directory = path.join(parent, "backup");
  t.after(() => rm(parent, { recursive: true, force: true }));
  const smallTables = [
    { name: "school_years", columns: ["id", "name"], primaryKey: ["id"] },
    { name: "students", columns: ["id", "given_name"], primaryKey: ["id"] },
  ];
  const rows = { school_years: [{ id: "year-1", name: "2026" }], students: [{ id: "student-1", given_name: "Demo" }] };
  const objectBytes = Buffer.from("synthetic private document");
  const client = fakeClient({ rows, objects: { "materials/guide.txt": { bytes: objectBytes, contentType: "text/plain" } }, schema: smallTables });
  const result = await createBackup({ directory, client, tables: smallTables, passphrase, now: new Date("2026-10-08T00:00:00.000Z") });
  assert.deepEqual(result, { tables: 2, rows: 2, objects: 1 });
  const integrity = await verifyBackup({ directory, passphrase, tables: smallTables });
  assert.deepEqual(integrity, result);
  const files = await readdir(directory);
  assert.ok(files.includes("manifest.enc"));
  const encrypted = await readFile(path.join(directory, storageObjectPath("materials/guide.txt")));
  assert.equal(encrypted.includes(objectBytes), false);
  assert.ok(client.calls.filter(call => call.endpoint.startsWith("/rest/v1/") && call.method === "GET").length >= 4, "backup rereads each table to detect concurrent changes");
});

test("verify rejects a wrong passphrase and encrypted-file tampering", async t => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "supabase-school-backup-integrity-"));
  const directory = path.join(parent, "backup");
  t.after(() => rm(parent, { recursive: true, force: true }));
  const smallTables = [{ name: "school_years", columns: ["id", "name"], primaryKey: ["id"] }];
  await createBackup({ directory, client: fakeClient({ rows: { school_years: [{ id: "one", name: "2026" }] }, schema: smallTables }), tables: smallTables, passphrase });
  await assert.rejects(verifyBackup({ directory, passphrase: "another synthetic phrase".padEnd(24, "x"), tables: smallTables }));
  const key = await deriveBackupKey(passphrase, Buffer.from(JSON.parse(await readFile(path.join(directory, "backup-meta.json"), "utf8")).salt, "base64"));
  const encryptedPath = path.join(directory, "tables/school_years.json.enc");
  const encrypted = await readFile(encryptedPath);
  const plain = decryptBackupFile(encrypted, key, "tables/school_years.json.enc");
  assert.match(plain.toString(), /2026/);
  encrypted[encrypted.length - 1] ^= 1;
  const { writeFile } = await import("node:fs/promises");
  await writeFile(encryptedPath, encrypted);
  await assert.rejects(verifyBackup({ directory, passphrase, tables: smallTables }));
});

test("restore requires an explicit confirmation before any remote request", async t => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "supabase-school-backup-confirm-"));
  const directory = path.join(parent, "backup");
  t.after(() => rm(parent, { recursive: true, force: true }));
  const smallTables = [{ name: "school_years", columns: ["id", "name"], primaryKey: ["id"] }];
  await createBackup({ directory, client: fakeClient({ schema: smallTables }), tables: smallTables, passphrase });
  const client = fakeClient({ schema: smallTables });
  await assert.rejects(restoreBackup({ directory, client, tables: smallTables, passphrase }), /--confirm-restore/);
  assert.equal(client.calls.length, 0);
});

test("restore fails closed on schema mismatch, nonempty table, or missing Auth identity", async t => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "supabase-school-backup-restore-"));
  const directory = path.join(parent, "backup");
  t.after(() => rm(parent, { recursive: true, force: true }));
  const smallTables = [
    { name: "profiles", columns: ["id", "name", "email"], primaryKey: ["id"] },
    { name: "school_years", columns: ["id", "name"], primaryKey: ["id"] },
  ];
  const archivedRows = {
    profiles: [{ id: "auth-uuid", name: "Demo User", email: "demo@example.invalid" }],
    school_years: [{ id: "year-1", name: "2026" }],
  };
  await createBackup({ directory, client: fakeClient({ rows: structuredClone(archivedRows), schema: smallTables }), tables: smallTables, passphrase });

  const wrongSchema = fakeClient({ schema: [{ ...smallTables[0], columns: ["id", "name", "email", "extra"] }, smallTables[1]] });
  await assert.rejects(restoreBackup({ directory, client: wrongSchema, tables: smallTables, passphrase, confirmRestore: true }), /columnas|esquema/);

  const nonempty = fakeClient({ rows: { ...structuredClone(archivedRows), school_years: [{ id: "existing", name: "existing" }] }, schema: smallTables, authUsers: [{ id: "auth-uuid", email: "demo@example.invalid" }] });
  await assert.rejects(restoreBackup({ directory, client: nonempty, tables: smallTables, passphrase, confirmRestore: true }), /ya contiene datos/);

  const missingAuth = fakeClient({ rows: structuredClone(archivedRows), schema: smallTables, authUsers: [] });
  await assert.rejects(restoreBackup({ directory, client: missingAuth, tables: smallTables, passphrase, confirmRestore: true }), /Faltan identidades Auth/);
  assert.equal(missingAuth.calls.some(call => call.method === "POST"), false);
});

test("restore compensates successful table writes when a later remote write errors", async t => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "supabase-school-backup-compensate-"));
  const directory = path.join(parent, "backup");
  t.after(() => rm(parent, { recursive: true, force: true }));
  const smallTables = [
    { name: "school_years", columns: ["id", "name"], primaryKey: ["id"] },
    { name: "students", columns: ["id", "given_name"], primaryKey: ["id"] },
  ];
  const archivedRows = { school_years: [{ id: "year-1", name: "2026" }], students: [{ id: "student-1", given_name: "Demo" }] };
  await createBackup({ directory, client: fakeClient({ rows: structuredClone(archivedRows), schema: smallTables }), tables: smallTables, passphrase });
  const client = fakeClient({ schema: smallTables, failOn: endpoint => endpoint === "/rest/v1/students" });
  await assert.rejects(restoreBackup({ directory, client, tables: smallTables, passphrase, confirmRestore: true }), /limpieza|revirtieron/);
  assert.ok(client.calls.some(call => call.method === "DELETE" && call.endpoint.startsWith("/rest/v1/school_years?")));
  assert.equal(client.calls.some(call => call.method === "POST" && call.endpoint === "/rest/v1/students"), true);
  assert.deepEqual(client.rows, { school_years: [], students: [] });
});

test("restore compensates a table batch that committed before its HTTP error", async t => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "supabase-school-backup-unknown-write-"));
  const directory = path.join(parent, "backup");
  t.after(() => rm(parent, { recursive: true, force: true }));
  const smallTables = [{ name: "school_years", columns: ["id", "name"], primaryKey: ["id"] }];
  const archived = { school_years: [{ id: "year-1", name: "2026" }] };
  await createBackup({ directory, client: fakeClient({ rows: structuredClone(archived), schema: smallTables }), tables: smallTables, passphrase });
  const destination = fakeClient({ schema: smallTables, failAfter: endpoint => endpoint === "/rest/v1/school_years" });
  await assert.rejects(restoreBackup({ directory, client: destination, tables: smallTables, passphrase, confirmRestore: true }), /revirtieron/);
  assert.deepEqual(destination.rows.school_years, []);
  assert.ok(destination.calls.some(call => call.method === "DELETE" && call.endpoint.startsWith("/rest/v1/school_years?")));
});

test("restore removes an uploaded object whose successful write returned an error", async t => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "supabase-school-backup-unknown-upload-"));
  const directory = path.join(parent, "backup");
  t.after(() => rm(parent, { recursive: true, force: true }));
  const smallTables = [{ name: "school_years", columns: ["id", "name"], primaryKey: ["id"] }];
  const file = Buffer.from("synthetic guide");
  await createBackup({ directory, client: fakeClient({ schema: smallTables, objects: { "guide.txt": { bytes: file, contentType: "text/plain" } } }), tables: smallTables, passphrase });
  const destination = fakeClient({ schema: smallTables, failAfter: (endpoint, method) => method === "POST" && endpoint === "/storage/v1/object/school-files/guide.txt" });
  await assert.rejects(restoreBackup({ directory, client: destination, tables: smallTables, passphrase, confirmRestore: true }), /revirtieron/);
  assert.equal(destination.uploaded.size, 0);
  assert.ok(destination.calls.some(call => call.method === "DELETE" && call.endpoint.endsWith("/guide.txt")));
});

test("restore writes and verifies school rows and private Storage bytes", async t => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "supabase-school-backup-restore-ok-"));
  const directory = path.join(parent, "backup");
  t.after(() => rm(parent, { recursive: true, force: true }));
  const smallTables = [{ name: "school_years", columns: ["id", "name"], primaryKey: ["id"] }];
  const sourceRows = { school_years: [{ id: "year-1", name: "2026" }] };
  const sourceFile = Buffer.from("private synthetic guide");
  await createBackup({
    directory,
    client: fakeClient({ rows: structuredClone(sourceRows), objects: { "materials/guide.txt": { bytes: sourceFile, contentType: "text/plain" } }, schema: smallTables }),
    tables: smallTables,
    passphrase,
  });
  const destination = fakeClient({ schema: smallTables });
  const result = await restoreBackup({ directory, client: destination, tables: smallTables, passphrase, confirmRestore: true });
  assert.deepEqual({ tables: result.tables, rows: result.rows, objects: result.objects }, { tables: 1, rows: 1, objects: 1 });
  assert.equal(destination.uploaded.get("materials/guide.txt").bytes.toString(), sourceFile.toString());
  assert.ok(destination.calls.some(call => call.endpoint === "/rest/v1/school_years" && call.method === "POST"));
  assert.equal(result.limitation.includes("identidades Auth no se recrean"), true);
});

test("restore requires matching Auth UUID and email, then restores profile fields", async t => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "supabase-school-backup-auth-"));
  const directory = path.join(parent, "backup");
  t.after(() => rm(parent, { recursive: true, force: true }));
  const smallTables = [
    { name: "profiles", columns: ["id", "name", "email"], primaryKey: ["id"] },
    { name: "school_years", columns: ["id", "name"], primaryKey: ["id"] },
  ];
  const archived = { profiles: [{ id: "auth-1", name: "Directora", email: "school@example.invalid" }], school_years: [] };
  await createBackup({ directory, client: fakeClient({ rows: structuredClone(archived), schema: smallTables }), tables: smallTables, passphrase });
  const wrongEmail = fakeClient({ rows: { profiles: [{ id: "auth-1", name: "Directora", email: "old@example.invalid" }] }, authUsers: [{ id: "auth-1", email: "old@example.invalid" }], schema: smallTables });
  await assert.rejects(restoreBackup({ directory, client: wrongEmail, tables: smallTables, passphrase, confirmRestore: true }), /correo.*no coincide/);
  assert.equal(wrongEmail.calls.some(call => call.method === "POST"), false);

  const target = fakeClient({ rows: { profiles: [{ id: "auth-1", name: "Current name", email: "school@example.invalid" }] }, authUsers: [{ id: "auth-1", email: "school@example.invalid" }], schema: smallTables });
  const result = await restoreBackup({ directory, client: target, tables: smallTables, passphrase, confirmRestore: true });
  assert.equal(result.rows, 1);
  assert.deepEqual(target.rows.profiles, archived.profiles);
});

test("service credential stays in request headers and remote errors never echo it", async () => {
  const secret = "synthetic-secret-key";
  const client = createSupabaseClient({ url: "https://school.invalid", secret, fetchImpl: async (_url, init) => {
    assert.equal(init.headers.apikey, secret);
    assert.equal(init.headers.Authorization, `Bearer ${secret}`);
    return response(401, { message: secret });
  } });
  await assert.rejects(client.request("/rest/v1/students"), error => {
    assert.equal(error.message.includes(secret), false);
    return /HTTP 401/.test(error.message);
  });
});

test("current Supabase sb_secret key is sent as apikey without a JWT bearer header", async () => {
  const secret = "sb_secret_synthetic-server-key";
  const client = createSupabaseClient({ url: "https://school.invalid", secret, fetchImpl: async (_url, init) => {
    assert.equal(init.headers.apikey, secret);
    assert.equal(init.headers.Authorization, undefined);
    return response(200, {});
  } });
  await client.request("/rest/v1/students");
});


test("backup client forbids redirects carrying its server key and bounds request time", async () => {
  const client = createSupabaseClient({ url: "https://school.invalid", secret: "sb_secret_synthetic", timeoutMs: 2000,
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, "error");
      assert.ok(options.signal instanceof AbortSignal);
      return response(200, []);
    } });
  await client.request("/rest/v1/profiles");
  assert.throws(() => createSupabaseClient({ url: "https://school.invalid", secret: "synthetic", timeoutMs: 0 }), /tiempo/);
});

test("redirect/provider rejection never echoes secret or upstream body", async () => {
  const secret = "sb_secret_only_for_synthetic_test";
  const client = createSupabaseClient({ url: "https://school.invalid", secret,
    fetchImpl: async () => { throw Error("redirect tried to leak " + secret); } });
  await assert.rejects(client.request("/rest/v1/profiles"), error => {
    assert.equal(error.message.includes(secret), false);
    assert.match(error.message, /No se pudo conectar/);
    return true;
  });
});


test("offline verify CLI needs archive key but no Supabase server credentials", async t => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "school-offline-backup-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const directory = path.join(parent, "archive");
  const current = await loadSchoolBackupTables();
  await createBackup({ directory, client: fakeClient({ schema: current }), tables: current, passphrase });
  const childEnv = { ...process.env, SCHOOL_BACKUP_PASSPHRASE: passphrase };
  delete childEnv.SUPABASE_URL; delete childEnv.SUPABASE_SECRET_KEY;
  const result = spawnSync(process.execPath, [path.join(root, "scripts/supabase-school-backup.mjs"), "verify", directory], {
    env: childEnv, encoding: "utf8", timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /íntegro: 0 filas en 33 tablas/);
});
