import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deriveBackupKey, encryptBackupFile, sha256 } from "../scripts/backup-crypto.mjs";
import { inspectD1SchoolBackup } from "../scripts/supabase-d1-migration-preflight.mjs";

const projectId = JSON.parse(await readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8")).project_id;
const passphrase = "Synthetic-only-school-backup-2026!";

async function createBackupFixture() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "school-d1-preflight-"));
  const migrationDirectory = new URL("../drizzle/", import.meta.url);
  const migrationFiles = (await readdir(migrationDirectory)).filter(name => name.endsWith(".sql")).sort();
  const sql = (await Promise.all(migrationFiles.map(name => readFile(new URL(name, migrationDirectory), "utf8")))).join("\n");
  const db = new DatabaseSync(":memory:");
  db.exec(sql);
  db.exec("PRAGMA foreign_keys=ON;");
  const tableNames = db.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '_cf_%' order by name").all().map(row => row.name);
  const rowCounts = Object.fromEntries(tableNames.map(name => [name, Number(db.prepare(`select count(*) as count from \"${name}\"`).get().count)]));
  db.close();

  const salt = Buffer.alloc(16, 7);
  const key = await deriveBackupKey(passphrase, salt);
  const meta = { format: "mundo-ninos-secure-backup", version: 1, createdAt: "2026-10-08T00:00:00.000Z", salt: salt.toString("base64") };
  const manifest = { projectId, bucket: "synthetic-r2", createdAt: meta.createdAt, database: { name: "synthetic", file: "database.sql.enc", size: Buffer.byteLength(sql), sha256: sha256(Buffer.from(sql)), rowCounts }, objects: [] };
  await writeFile(path.join(temporary, "backup-meta.json"), JSON.stringify(meta));
  await writeFile(path.join(temporary, "database.sql.enc"), encryptBackupFile(Buffer.from(sql), key, "database.sql.enc"));
  await writeFile(path.join(temporary, "manifest.enc"), encryptBackupFile(Buffer.from(JSON.stringify(manifest)), key, "manifest.enc"));
  return { directory: temporary, sql, cleanup: () => rm(temporary, { recursive: true, force: true }) };
}

test("verifica un respaldo SQL de D1 contra el manifiesto y la migración escolar", async () => {
  const fixture = await createBackupFixture();
  try {
    const result = await inspectD1SchoolBackup({ directory: fixture.directory, passphrase, projectId });
    assert.ok(result.counts.schoolTables > 20);
    assert.equal(result.counts.accounts, 0);
    assert.equal(result.counts.objects, 0);
    assert.equal(result.counts.schoolRows, 0);
  } finally {
    await fixture.cleanup();
  }
});

test("rechaza un respaldo alterado antes de preparar filas", async () => {
  const fixture = await createBackupFixture();
  try {
    const salt = Buffer.alloc(16, 7);
    const key = await deriveBackupKey(passphrase, salt);
    await writeFile(path.join(fixture.directory, "database.sql.enc"), encryptBackupFile(Buffer.from(`${fixture.sql}\n-- alterado`), key, "database.sql.enc"));
    await assert.rejects(() => inspectD1SchoolBackup({ directory: fixture.directory, passphrase, projectId }), /no coincide con el manifiesto/);
  } finally {
    await fixture.cleanup();
  }
});

test("rechaza un respaldo de otro Site", async () => {
  const fixture = await createBackupFixture();
  try {
    await assert.rejects(() => inspectD1SchoolBackup({ directory: fixture.directory, passphrase, projectId: "otro-sitio" }), /pertenece a otro Site/);
  } finally {
    await fixture.cleanup();
  }
});

test("rechaza relaciones incompletas detectadas por SQLite", async () => {
  const fixture = await createBackupFixture();
  try {
    const sql = `${fixture.sql}\nPRAGMA foreign_keys=OFF; INSERT INTO groups (id, year_id, name, stage, active) VALUES ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','Grupo huérfano','preescolar',1);`;
    const salt = Buffer.alloc(16, 7);
    const key = await deriveBackupKey(passphrase, salt);
    const db = new DatabaseSync(":memory:");
    db.exec(sql);
    db.exec("PRAGMA foreign_keys=ON;");
    const names = db.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '_cf_%' order by name").all().map(row => row.name);
    const rowCounts = Object.fromEntries(names.map(name => [name, Number(db.prepare(`select count(*) as count from \"${name}\"`).get().count)]));
    db.close();
    const manifest = { projectId, bucket: "synthetic-r2", createdAt: "2026-10-08T00:00:00.000Z", database: { name: "synthetic", file: "database.sql.enc", size: Buffer.byteLength(sql), sha256: sha256(Buffer.from(sql)), rowCounts }, objects: [] };
    await writeFile(path.join(fixture.directory, "database.sql.enc"), encryptBackupFile(Buffer.from(sql), key, "database.sql.enc"));
    await writeFile(path.join(fixture.directory, "manifest.enc"), encryptBackupFile(Buffer.from(JSON.stringify(manifest)), key, "manifest.enc"));
    await assert.rejects(() => inspectD1SchoolBackup({ directory: fixture.directory, passphrase, projectId }), /relaciones D1 incompletas/);
  } finally {
    await fixture.cleanup();
  }
});
