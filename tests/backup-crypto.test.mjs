import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { backupObjectPath, decryptBackupFile, deriveBackupKey, encryptBackupFile, sha256 } from "../scripts/backup-crypto.mjs";

const execFile = promisify(nodeExecFile);
const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

test("el cifrado autentica datos y etiqueta del respaldo", async () => {
  const key = await deriveBackupKey("frase local sintetica suficientemente larga", randomBytes(16));
  const original = Buffer.from("archivo de prueba sin datos escolares");
  const encrypted = encryptBackupFile(original, key, "objects/test.enc");
  assert.deepEqual(decryptBackupFile(encrypted, key, "objects/test.enc"), original);
  assert.throws(() => decryptBackupFile(encrypted, key, "objects/otro.enc"));
  const changed = Buffer.from(encrypted); changed[changed.length - 1] ^= 1;
  assert.throws(() => decryptBackupFile(changed, key, "objects/test.enc"));
});

test("las rutas del respaldo no incorporan directamente claves de R2", () => {
  for (const key of ["private/material/uno", "../../outside", "estudiante/niño/archivo.pdf"]) {
    const path = backupObjectPath(key);
    assert.match(path, /^objects\/[a-f0-9]{64}\.enc$/);
    assert.equal(path.includes(".."), false);
  }
});

test("el comando verify valida un paquete cifrado y rechaza corrupción", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "school-backup-test-"));
  const passphrase = "frase de prueba local con longitud suficiente";
  const salt = randomBytes(16);
  const key = await deriveBackupKey(passphrase, salt);
  const sql = Buffer.from("CREATE TABLE students (id TEXT PRIMARY KEY); INSERT INTO students VALUES ('synthetic');");
  const object = Buffer.from("synthetic private object");
  const objectKey = "private/test/synthetic";
  const objectFile = backupObjectPath(objectKey);
  await mkdir(path.join(directory, "objects"));
  await writeFile(path.join(directory, "backup-meta.json"), JSON.stringify({ format: "mundo-ninos-secure-backup", version: 1, createdAt: new Date(0).toISOString(), salt: salt.toString("base64") }));
  await writeFile(path.join(directory, "database.sql.enc"), encryptBackupFile(sql, key, "database.sql.enc"));
  await writeFile(path.join(directory, objectFile), encryptBackupFile(object, key, objectFile));
  const manifest = { projectId: JSON.parse(await readFile(path.join(projectRoot, ".openai/hosting.json"), "utf8")).project_id, bucket: "synthetic-bucket", createdAt: new Date(0).toISOString(), database: { name: "synthetic-database", file: "database.sql.enc", size: sql.length, sha256: sha256(sql), rowCounts: { students: 1 } }, objects: [{ key: objectKey, file: objectFile, size: object.length, sha256: sha256(object), metadata: {} }] };
  await writeFile(path.join(directory, "manifest.enc"), encryptBackupFile(Buffer.from(JSON.stringify(manifest)), key, "manifest.enc"));
  try {
    const verified = await execFile(process.execPath, [path.join(projectRoot, "scripts/school-backup.mjs"), "verify", directory], { cwd: projectRoot, env: { ...process.env, SCHOOL_BACKUP_PASSPHRASE: passphrase } });
    assert.match(verified.stdout, /Respaldo íntegro/);
    const original = await readFile(path.join(directory, objectFile)); original[original.length - 1] ^= 1; await writeFile(path.join(directory, objectFile), original);
    await assert.rejects(execFile(process.execPath, [path.join(projectRoot, "scripts/school-backup.mjs"), "verify", directory], { cwd: projectRoot, env: { ...process.env, SCHOOL_BACKUP_PASSPHRASE: passphrase } }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
