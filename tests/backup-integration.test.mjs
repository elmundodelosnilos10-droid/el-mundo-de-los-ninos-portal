import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFile = promisify(nodeExecFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts/school-backup.mjs");

test("respalda D1 y R2, verifica el paquete y restaura en recursos de prueba", async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "school-backup-flow-"));
  const source = Buffer.from("synthetic private student file");
  const sourceKey = "private/material/synthetic-file";
  const buckets = new Map([
    ["test-school", new Map([[sourceKey, { body: source, type: "application/pdf", cache: "private, no-store", metadata: { fileid: "synthetic-id" } }]])],
    ["test-recovery", new Map([["keep/extra.txt", { body: Buffer.from("preserve me"), type: "text/plain", metadata: {} }]])],
  ]);
  const statePath = path.join(temp, "mock-state.json");
  await writeFile(statePath, JSON.stringify({ imported: false, created: [] }));
  const fakeWrangler = path.join(temp, "fake-wrangler.mjs");
  await writeFile(fakeWrangler, `
import { readFile, writeFile } from "node:fs/promises";
const args = process.argv.slice(2), statePath = process.env.SCHOOL_BACKUP_TEST_STATE;
const state = JSON.parse(await readFile(statePath, "utf8"));
const output = value => process.stdout.write(JSON.stringify(value));
if (args[0] !== "d1") throw Error("unexpected command");
if (args[1] === "export") { const file = args.find(v => v.startsWith("--output="))?.slice(9); await writeFile(file, "CREATE TABLE students (id TEXT PRIMARY KEY); INSERT INTO students VALUES ('synthetic');"); process.stdout.write("export complete"); }
else if (args[1] === "execute") {
  const command = args[args.indexOf("--command") + 1];
  const fileArg = args.find(v => v.startsWith("--file="));
  if (fileArg) { const sql = await readFile(fileArg.slice(7), "utf8"); if (!sql.includes("synthetic")) throw Error("bad restore SQL"); state.imported = true; await writeFile(statePath, JSON.stringify(state)); process.stdout.write("imported"); }
  else if (command?.includes("sqlite_master")) output([{success:true,results:[{name:"students"},{name:"files"}]}]);
  else if (command?.includes("UNION ALL")) output([{success:true,results:[{name:"students",row_count:1},{name:"files",row_count:1}]}]);
  else throw Error("unexpected D1 query");
}
else if (args[1] === "list") output([]);
else if (args[1] === "create") { state.created.push(args[2]); await writeFile(statePath, JSON.stringify(state)); process.stdout.write("created"); }
else throw Error("unexpected D1 action");
`);

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const [, bucketName, ...keyParts] = url.pathname.split("/");
    const bucket = buckets.get(bucketName);
    if (!bucket) { response.writeHead(404); response.end(); return; }
    const key = keyParts.map(part => decodeURIComponent(part)).join("/");
    if (request.method === "GET" && url.searchParams.get("list-type") === "2") {
      const contents = [...bucket].map(([name, item]) => `<Contents><Key>${name}</Key><LastModified>2026-10-07T00:00:00.000Z</LastModified><ETag>"${createHash("md5").update(item.body).digest("hex")}"</ETag><Size>${item.body.length}</Size><StorageClass>STANDARD</StorageClass></Contents>`).join("");
      response.writeHead(200, { "Content-Type": "application/xml" }); response.end(`<ListBucketResult><Name>${bucketName}</Name><Prefix></Prefix><KeyCount>${bucket.size}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`); return;
    }
    const item = bucket.get(key);
    if (request.method === "HEAD") {
      if (!item) { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { "Content-Length": item.body.length, "Content-Type": item.type, ETag: `"${createHash("md5").update(item.body).digest("hex")}"` }); response.end(); return;
    }
    if (request.method === "GET") {
      if (!item) { response.writeHead(404); response.end(); return; }
      const headers = { "Content-Length": item.body.length, "Content-Type": item.type, ETag: `"${createHash("md5").update(item.body).digest("hex")}"` };
      if (item.cache) headers["Cache-Control"] = item.cache;
      for (const [name, value] of Object.entries(item.metadata)) headers[`x-amz-meta-${name}`] = value;
      response.writeHead(200, headers); response.end(item.body); return;
    }
    if (request.method === "PUT") {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const metadata = Object.fromEntries(Object.entries(request.headers).filter(([name]) => name.startsWith("x-amz-meta-")).map(([name, value]) => [name.slice(11), String(value)]));
      bucket.set(key, { body, type: request.headers["content-type"] || "application/octet-stream", cache: request.headers["cache-control"], metadata });
      response.writeHead(200, { ETag: `"${createHash("md5").update(body).digest("hex")}"` }); response.end(); return;
    }
    response.writeHead(501); response.end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(temp, { recursive: true, force: true }); });
  const address = server.address();
  const backupDirectory = path.join(temp, "encrypted-backup");
  const env = { ...process.env, NODE_ENV: "test", SCHOOL_BACKUP_TEST_WRANGLER: fakeWrangler, SCHOOL_BACKUP_TEST_STATE: statePath, SCHOOL_CF_ACCOUNT_ID: "synthetic-account", SCHOOL_R2_ENDPOINT: `http://127.0.0.1:${address.port}`, SCHOOL_R2_BUCKET: "test-school", SCHOOL_D1_DATABASE: "synthetic-production-shadow", SCHOOL_R2_READ_ACCESS_KEY_ID: "read-key", SCHOOL_R2_READ_SECRET_ACCESS_KEY: "read-secret", SCHOOL_R2_WRITE_ACCESS_KEY_ID: "write-key", SCHOOL_R2_WRITE_SECRET_ACCESS_KEY: "write-secret", SCHOOL_BACKUP_PASSPHRASE: "local integration phrase of sufficient length" };
  const run = async (...args) => execFile(process.execPath, [script, ...args], { cwd: root, env, maxBuffer: 4 * 1024 * 1024 });

  const created = await run("backup", backupDirectory);
  assert.match(created.stdout, /Respaldo cifrado listo: 1 objetos/);
  const encryptedFiles = await readdir(backupDirectory);
  assert.deepEqual(encryptedFiles.sort(), ["backup-meta.json", "database.sql.enc", "manifest.enc", "objects"]);
  assert.equal((await readFile(path.join(backupDirectory, "database.sql.enc"))).includes(Buffer.from("CREATE TABLE")), false);
  assert.match((await run("verify", backupDirectory)).stdout, /Respaldo íntegro: D1 \(2 tablas\) y 1 objetos R2/);

  const recoveryBucket = buckets.get("test-recovery");
  const wrongConfirm = await run("restore-r2", backupDirectory, "--confirm-bucket", "production-bucket").then(() => null, error => error);
  assert.ok(wrongConfirm, "must reject a bucket name the operator did not confirm");
  env.SCHOOL_R2_BUCKET = "test-recovery";
  await run("restore-r2", backupDirectory, "--confirm-bucket", "test-recovery");
  assert.deepEqual(recoveryBucket.get(sourceKey).body, source);
  assert.equal(recoveryBucket.get(sourceKey).type, "application/pdf");
  assert.equal(recoveryBucket.get(sourceKey).cache, "private, no-store");
  assert.deepEqual(recoveryBucket.get(sourceKey).metadata, { fileid: "synthetic-id" });
  assert.equal(recoveryBucket.has("keep/extra.txt"), true);

  const restored = await run("restore-d1", backupDirectory, "--new-database", "school-recovery-synthetic", "--confirm-new-database", "school-recovery-synthetic");
  assert.match(restored.stdout, /No se cambió la conexión del Site/);
  const finalState = JSON.parse(await readFile(statePath, "utf8"));
  assert.deepEqual(finalState.created, ["school-recovery-synthetic"]);
  assert.equal(finalState.imported, true);
});
