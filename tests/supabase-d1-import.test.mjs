import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deriveBackupKey, encryptBackupFile, sha256 } from "../scripts/backup-crypto.mjs";
import { importD1SchoolBackup } from "../scripts/supabase-d1-import.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const projectId = JSON.parse(await readFile(path.join(root, ".openai/hosting.json"), "utf8")).project_id;
const passphrase = "Synthetic school migration phrase 2026!";
const authId = "11111111-1111-4111-8111-111111111111";

async function backupFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "school-d1-import-"));
  const migrations = new URL("../drizzle/", import.meta.url);
  const names = (await readdir(migrations)).filter(name => name.endsWith(".sql")).sort();
  const sql = (await Promise.all(names.map(name => readFile(new URL(name, migrations), "utf8")))).join("\n");
  const backupSql = sql + "\nINSERT INTO user (id,name,email,email_verified,image,created_at,updated_at) VALUES ('legacy-admin','Synthetic Admin','admin@example.test',0,NULL,1760000000,1760000000);\nINSERT INTO user_roles (user_id,role,assigned_by,assigned_at) VALUES ('legacy-admin','superadmin',NULL,1760000000);\nINSERT INTO files (id,object_key,original_name,mime_type,size_bytes,purpose,uploaded_by,group_id,student_id,created_at,deleted_at) VALUES ('22222222-2222-4222-8222-222222222222','activity/guide.txt','guide.txt','text/plain',8,'material','legacy-admin',NULL,NULL,1760000000,NULL);\n";
  const database = new DatabaseSync(":memory:");
  database.exec(sql);
  database.exec("PRAGMA foreign_keys=ON;");
  database.prepare("INSERT INTO user (id,name,email,email_verified,image,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run("legacy-admin","Synthetic Admin","admin@example.test",0,null,1760000000,1760000000);
  database.prepare("INSERT INTO user_roles (user_id,role,assigned_by,assigned_at) VALUES (?,?,?,?)").run("legacy-admin","superadmin",null,1760000000);
  database.prepare("INSERT INTO files (id,object_key,original_name,mime_type,size_bytes,purpose,uploaded_by,group_id,student_id,created_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run("22222222-2222-4222-8222-222222222222","activity/guide.txt","guide.txt","text/plain",8,"material","legacy-admin",null,null,1760000000,null);
  const tableNames = database.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '_cf_%' order by name").all().map(row => row.name);
  const rowCounts = Object.fromEntries(tableNames.map(name => [name, Number(database.prepare('select count(*) as count from "' + name + '"').get().count)]));
  database.close();
  const salt = Buffer.alloc(16, 9);
  const key = await deriveBackupKey(passphrase, salt);
  const createdAt = "2026-10-08T00:00:00.000Z";
  const meta = { format: "mundo-ninos-secure-backup", version: 1, createdAt, salt: salt.toString("base64") };
  const objectBytes = Buffer.from("guide!!!");
  const objectKey = "activity/guide.txt";
  const objectFile = "objects/" + sha256(Buffer.from(objectKey)) + ".enc";
  const manifest = { projectId, bucket: "synthetic-r2", createdAt, database: { name: "synthetic", file: "database.sql.enc", size: Buffer.byteLength(backupSql), sha256: sha256(Buffer.from(backupSql)), rowCounts }, objects: [{ key: objectKey, file: objectFile, size: objectBytes.length, sha256: sha256(objectBytes), contentType: "text/plain", metadata: {} }] };
  await writeFile(path.join(directory, "backup-meta.json"), JSON.stringify(meta));
  await writeFile(path.join(directory, "database.sql.enc"), encryptBackupFile(Buffer.from(backupSql), key, "database.sql.enc"));
  await writeFile(path.join(directory, "manifest.enc"), encryptBackupFile(Buffer.from(JSON.stringify(manifest)), key, "manifest.enc"));
  await (await import("node:fs/promises")).mkdir(path.join(directory, "objects"), { recursive: true });
  await writeFile(path.join(directory, objectFile), encryptBackupFile(objectBytes, key, objectFile));
  return { directory, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

function response(status, body, headers = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  return {
    status, headers: new Headers(headers),
    async json() { return body; },
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  };
}

function fakeClient({ seeded = {}, authUsers = [{ id: authId, email: "admin@example.test", email_confirmed_at: null }], failUploadAfter = false } = {}) {
  const schemaPath = path.join(root, "supabase/migrations/20261008000000_school_schema.sql");
  const schemaTables = [];
  const sql = readFileSync(schemaPath, "utf8");
  for (const [, name, body] of sql.matchAll(/create\s+table\s+public\.([a-z_]+)\s*\(([\s\S]*?)\n\);/gi)) {
    const columns = [];
    let primaryKey = [];
    for (const line of body.split("\n")) {
      const column = line.match(/^\s*([a-z_][a-z0-9_]*)\s+[a-z]/i);
      if (column && !["constraint", "primary", "unique", "check", "foreign"].includes(column[1].toLowerCase())) {
        columns.push(column[1]);
        if (/\bprimary\s+key\b/i.test(line)) primaryKey = [column[1]];
      }
      const key = line.match(/^\s*primary\s+key\s*\(([^)]+)\)/i);
      if (key) primaryKey = key[1].split(",").map(value => value.trim());
    }
    schemaTables.push({ name, columns, primaryKey });
  }
  const rows = Object.fromEntries(schemaTables.map(table => [table.name, [...(seeded[table.name] ?? [])]]));
  const calls = [];
  const objects = new Map();
  return {
    rows, calls, objects,
    async request(endpoint, options = {}) {
      const method = options.method ?? "GET";
      calls.push({ endpoint, method });
      if (endpoint === "/rest/v1/") {
        return response(200, {
          paths: Object.fromEntries(schemaTables.map(table => ["/" + table.name, {}])),
          definitions: Object.fromEntries(schemaTables.map(table => [table.name, { properties: Object.fromEntries(table.columns.map(column => [column, {}])) }])),
        });
      }
      if (endpoint.startsWith("/auth/v1/admin/users")) {
        return response(200, { users: authUsers });
      }
      if (endpoint.startsWith("/storage/v1/object/list/school-files")) return response(200, []);
      const objectMatch = endpoint.match(/^\/storage\/v1\/object\/school-files\/(.+)$/);
      if (objectMatch) {
        const key = decodeURIComponent(objectMatch[1]);
        if (method === "POST") {
          objects.set(key, Buffer.from(options.body));
          if (failUploadAfter) throw new Error("synthetic response loss");
          return response(200, {});
        }
        if (method === "GET") return objects.has(key) ? response(200, objects.get(key)) : response(404, {});
        if (method === "DELETE") { objects.delete(key); return response(204, {}); }
      }
      const match = endpoint.match(/^\/rest\/v1\/([a-z_]+)(?:\?(.*))?$/);
      if (match) {
        const [, name, query = ""] = match;
        const table = schemaTables.find(item => item.name === name);
        if (!table) return response(404, {});
        const list = rows[name];
        if (method === "POST") {
          for (const incoming of JSON.parse(options.body)) {
            const index = list.findIndex(existing => table.primaryKey.every(key => existing[key] === incoming[key]));
            if (index < 0) list.push(incoming); else list[index] = incoming;
          }
          return response(201, {});
        }
        if (method === "DELETE") {
          const remaining = list.filter(existing => !query.split("&").every(part => {
            const [key, value] = part.split("=");
            return decodeURIComponent(value ?? "").slice(3) === String(existing[decodeURIComponent(key)]);
          }));
          list.splice(0, list.length, ...remaining);
          return response(204, {});
        }
        if (query.includes("limit=1")) return response(206, list.slice(0, 1), { "content-range": "0-0/" + list.length });
        const params = new URLSearchParams(query);
        return response(200, list.slice(Number(params.get("offset") ?? 0), Number(params.get("offset") ?? 0) + Number(params.get("limit") ?? 500)));
      }
      return response(404, {});
    },
  };
}

test("el importador no escribe sin la confirmación --apply", async () => {
  let calls = 0;
  const client = { request: async () => { calls++; throw new Error("no debe llamar al servicio"); } };
  await assert.rejects(
    importD1SchoolBackup({ directory: "/tmp/no-existe", passphrase: "x", client }),
    /requiere --apply/,
  );
  assert.equal(calls, 0);
});

test("no inicia la migración cuando falta una identidad escolar de Supabase Auth", async () => {
  const backup = await backupFixture();
  const client = fakeClient({ authUsers: [] });
  try {
    await assert.rejects(() => importD1SchoolBackup({
      directory: backup.directory, passphrase, client,
      env: { SUPABASE_URL: "https://school-project.supabase.co", SUPABASE_SECRET_KEY: "server-secret" },
      confirmProjectRef: "school-project", confirmApply: true,
    }), /falta una identidad Supabase/);
    assert.equal(client.calls.some(call => call.method === "POST"), false);
  } finally { await backup.cleanup(); }
});

test("no mezcla datos escolares si una tabla destino ya contiene registros", async () => {
  const backup = await backupFixture();
  const client = fakeClient({ seeded: { profiles: [{ id: authId, name: "Synthetic Admin", email: "admin@example.test", email_verified: false, active: true, image: null, created_at: "2026-10-08T00:00:00.000Z", updated_at: "2026-10-08T00:00:00.000Z" }], user_roles: [{ user_id: authId, role: "superadmin" }] } });
  try {
    await assert.rejects(() => importD1SchoolBackup({
      directory: backup.directory, passphrase, client,
      env: { SUPABASE_URL: "https://school-project.supabase.co", SUPABASE_SECRET_KEY: "server-secret" },
      confirmProjectRef: "school-project", confirmApply: true,
    }), /ya tiene datos/);
    assert.equal(client.calls.some(call => call.method === "POST"), false);
  } finally { await backup.cleanup(); }
});

test("el importador exige confirmar el ref exacto antes de leer el respaldo", async () => {
  let calls = 0;
  const client = { request: async () => { calls++; throw new Error("no debe llamar al servicio"); } };
  await assert.rejects(
    importD1SchoolBackup({
      directory: "/tmp/no-existe",
      passphrase: "x".repeat(24),
      client,
      env: { SUPABASE_URL: "https://school-project.supabase.co", SUPABASE_SECRET_KEY: "server-secret" },
      confirmProjectRef: "otro-proyecto",
      confirmApply: true,
    }),
    /ref exacto/,
  );
  assert.equal(calls, 0);
});

test("el importador no acepta la clave publishable como clave administrativa", async () => {
  const client = { request: async () => { throw new Error("no debe llamar al servicio"); } };
  await assert.rejects(
    importD1SchoolBackup({
      directory: "/tmp/no-existe",
      passphrase: "x".repeat(24),
      client,
      env: {
        SUPABASE_URL: "https://school-project.supabase.co",
        SUPABASE_SECRET_KEY: "same-key",
        SUPABASE_PUBLISHABLE_KEY: "same-key",
      },
      confirmProjectRef: "school-project",
      confirmApply: true,
    }),
    /no puede ser la clave publishable/,
  );
});

test("migra filas sintéticas, vincula Auth y conserva el rol al verificar todo el destino", async () => {
  const backup = await backupFixture();
  const client = fakeClient({ seeded: { profiles: [{ id: authId, name: "Synthetic Admin", email: "admin@example.test", email_verified: false, active: true, image: null, created_at: "2026-10-08T00:00:00.000Z", updated_at: "2026-10-08T00:00:00.000Z" }] } });
  try {
    const result = await importD1SchoolBackup({
      ...backup, directory: backup.directory, passphrase, client,
      env: { SUPABASE_URL: "https://school-project.supabase.co", SUPABASE_SECRET_KEY: "server-secret" },
      confirmProjectRef: "school-project", confirmApply: true,
    });
    assert.equal(result.accounts, 1);
    assert.equal(result.objects, 1);
    assert.equal(client.rows.user_roles.length, 1);
    assert.equal(client.rows.user_roles[0].user_id, authId);
    assert.equal(client.rows.profiles[0].id, authId);
    assert.equal(client.rows.profiles[0].email_verified, false);
    assert.equal(client.rows.files[0].object_key, "supabase:activity/guide.txt");
    assert.equal(client.objects.get("activity/guide.txt").toString(), "guide!!!");
  } finally {
    await backup.cleanup();
  }
});

test("revierte filas y archivos si una carga responde con error después de escribirse", async () => {
  const backup = await backupFixture();
  const originalProfile = { id: authId, name: "Synthetic Admin", email: "admin@example.test", email_verified: false, active: true, image: null, created_at: "2026-10-08T00:00:00.000Z", updated_at: "2026-10-08T00:00:00.000Z" };
  const client = fakeClient({ seeded: { profiles: [originalProfile] }, failUploadAfter: true });
  try {
    await assert.rejects(() => importD1SchoolBackup({
      directory: backup.directory, passphrase, client,
      env: { SUPABASE_URL: "https://school-project.supabase.co", SUPABASE_SECRET_KEY: "server-secret" },
      confirmProjectRef: "school-project", confirmApply: true,
    }), /Se revirtieron los registros y archivos/);
    assert.deepEqual(client.rows.profiles, [originalProfile]);
    assert.equal(client.rows.user_roles.length, 0);
    assert.equal(client.rows.files.length, 0);
    assert.equal(client.objects.size, 0);
  } finally { await backup.cleanup(); }
});
