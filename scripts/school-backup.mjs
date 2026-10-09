import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, readdir, rm, stat, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { backupObjectPath, decryptBackupFile, deriveBackupKey, encryptBackupFile, sha256 } from "./backup-crypto.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = process.env.NODE_ENV === "test" && process.env.SCHOOL_BACKUP_TEST_WRANGLER ? process.env.SCHOOL_BACKUP_TEST_WRANGLER : path.join(root, "node_modules/wrangler/bin/wrangler.js");
const hosting = JSON.parse(await readFile(path.join(root, ".openai/hosting.json"), "utf8"));

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw Error(`Falta configurar ${name} en el entorno seguro de operación.`);
  return value;
}

function parseArgs(argv) {
  const [action, directory, ...rest] = argv;
  if (!["backup", "verify", "restore-r2", "restore-d1"].includes(action) || !directory) throw Error("Uso: node scripts/school-backup.mjs backup <directorio> | verify <directorio> | restore-r2 <directorio> --confirm-bucket <bucket> | restore-d1 <directorio> --new-database <nombre> --confirm-new-database <nombre>");
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const name = rest[i];
    const value = rest[i + 1];
    if (!value || !["--confirm-bucket", "--new-database", "--confirm-new-database"].includes(name)) throw Error(`Opción no válida: ${name ?? ""}`);
    options[name] = value;
  }
  return { action, directory: path.resolve(directory), options };
}

async function runWrangler(args, { quiet = false } = {}) {
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [wrangler, ...args], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
  if (!quiet && stdout.trim()) process.stdout.write(stdout);
  if (stderr.trim() && !quiet) process.stderr.write(stderr);
  return stdout;
}

function jsonOutput(output) {
  const start = output.indexOf("[");
  const objectStart = output.indexOf("{");
  const index = start === -1 ? objectStart : objectStart === -1 ? start : Math.min(start, objectStart);
  if (index < 0) throw Error("Wrangler no devolvió el resultado JSON esperado.");
  return JSON.parse(output.slice(index));
}

function parseResult(output) {
  const parsed = jsonOutput(output);
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

async function d1RowCounts(database) {
  const schemaOutput = await runWrangler(["d1", "execute", database, "--remote", "--json", "--command", "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"], { quiet: true });
  const schemaResult = parseResult(schemaOutput);
  if (!schemaResult.success) throw Error("No se pudo consultar el esquema de D1.");
  const names = schemaResult.results.map(row => row.name).filter(name => typeof name === "string");
  if (!names.length) throw Error("D1 no devolvió tablas para verificar.");
  const statements = names.map(name => {
    const table = `"${name.replaceAll('"', '""')}"`;
    const label = name.replaceAll("'", "''");
    return `SELECT '${label}' AS name, COUNT(*) AS row_count FROM ${table}`;
  });
  const countsOutput = await runWrangler(["d1", "execute", database, "--remote", "--json", "--command", statements.join(" UNION ALL ")], { quiet: true });
  const countsResult = parseResult(countsOutput);
  if (!countsResult.success) throw Error("No se pudieron contar las tablas de D1.");
  return Object.fromEntries(countsResult.results.map(row => [row.name, Number(row.row_count)]));
}

async function createR2Client(mode) {
  const accountId = requireEnv("SCHOOL_CF_ACCOUNT_ID");
  const bucket = requireEnv("SCHOOL_R2_BUCKET");
  const read = mode === "read";
  return {
    bucket,
    client: new S3Client({
      region: "auto",
      endpoint: process.env.SCHOOL_R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
      credentials: {
        accessKeyId: requireEnv(read ? "SCHOOL_R2_READ_ACCESS_KEY_ID" : "SCHOOL_R2_WRITE_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv(read ? "SCHOOL_R2_READ_SECRET_ACCESS_KEY" : "SCHOOL_R2_WRITE_SECRET_ACCESS_KEY"),
      },
    }),
  };
}

async function listSnapshot(client, bucket) {
  const items = [];
  let continuationToken;
  do {
    const response = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }));
    for (const item of response.Contents ?? []) if (item.Key) items.push({ key: item.Key, size: Number(item.Size ?? 0), etag: item.ETag ?? null });
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    if (response.IsTruncated && !continuationToken) throw Error("R2 indicó otra página sin devolver el cursor.");
  } while (continuationToken);
  return items.sort((a, b) => a.key.localeCompare(b.key));
}

async function writeEncrypted(directory, relativePath, bytes, key) {
  const destination = path.join(directory, relativePath);
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await writeFile(destination, encryptBackupFile(bytes, key, relativePath), { mode: 0o600, flag: "wx" });
  return relativePath;
}

async function backup(directory) {
  const bucketConfig = await createR2Client("read");
  const database = requireEnv("SCHOOL_D1_DATABASE");
  const salt = randomBytes(16);
  const key = await deriveBackupKey(requireEnv("SCHOOL_BACKUP_PASSPHRASE"), salt);
  await mkdir(directory, { recursive: false, mode: 0o700 });
  await chmod(directory, 0o700);
  const meta = { format: "mundo-ninos-secure-backup", version: 1, createdAt: new Date().toISOString(), salt: salt.toString("base64") };
  await writeFile(path.join(directory, "backup-meta.json"), JSON.stringify(meta, null, 2), { mode: 0o600, flag: "wx" });
  const sqlPath = path.join(directory, "database.sql");
  try {
    const d1Before = await d1RowCounts(database);
    await runWrangler(["d1", "export", database, "--remote", `--output=${sqlPath}`]);
    const sql = await readFile(sqlPath);
    const d1After = await d1RowCounts(database);
    if (JSON.stringify(d1Before) !== JSON.stringify(d1After)) throw Error("D1 cambió durante el respaldo. Repite en una ventana sin actividad.");
    const databaseHash = sha256(sql);
    const databaseFile = await writeEncrypted(directory, "database.sql.enc", sql, key);
    const snapshotBefore = await listSnapshot(bucketConfig.client, bucketConfig.bucket);
    const objects = [];
    for (const item of snapshotBefore) {
      const response = await bucketConfig.client.send(new GetObjectCommand({ Bucket: bucketConfig.bucket, Key: item.key }));
      if (response.ETag && item.etag && response.ETag !== item.etag) throw Error("Un archivo de R2 cambió durante el respaldo. Repite en una ventana sin actividad.");
      const bytes = Buffer.from(await response.Body.transformToByteArray());
      if (bytes.length !== item.size) throw Error("El tamaño descargado de R2 no coincide con su listado.");
      const file = backupObjectPath(item.key);
      await writeEncrypted(directory, file, bytes, key);
      objects.push({ key: item.key, file, size: bytes.length, sha256: sha256(bytes), etag: response.ETag ?? item.etag, contentType: response.ContentType ?? "application/octet-stream", cacheControl: response.CacheControl, contentDisposition: response.ContentDisposition, contentEncoding: response.ContentEncoding, contentLanguage: response.ContentLanguage, expires: response.Expires?.toISOString(), metadata: response.Metadata ?? {} });
      process.stdout.write(`Resguardado objeto ${objects.length} de R2.\n`);
    }
    const snapshotAfter = await listSnapshot(bucketConfig.client, bucketConfig.bucket);
    if (JSON.stringify(snapshotBefore) !== JSON.stringify(snapshotAfter)) throw Error("La lista de R2 cambió durante el respaldo. Repite en una ventana sin actividad.");
    const manifest = { projectId: hosting.project_id, bucket: bucketConfig.bucket, createdAt: meta.createdAt, database: { name: database, file: databaseFile, size: sql.length, sha256: databaseHash, rowCounts: d1Before }, objects };
    await writeEncrypted(directory, "manifest.enc", Buffer.from(JSON.stringify(manifest)), key);
    process.stdout.write(`Respaldo cifrado listo: ${objects.length} objetos; D1 ${Object.keys(d1Before).length} tablas. Guarda una copia fuera de este equipo.\n`);
  } finally {
    await rm(sqlPath, { force: true });
  }
}

async function readBackup(directory) {
  const meta = JSON.parse(await readFile(path.join(directory, "backup-meta.json"), "utf8"));
  if (meta.format !== "mundo-ninos-secure-backup" || meta.version !== 1) throw Error("Formato de respaldo no reconocido.");
  const key = await deriveBackupKey(requireEnv("SCHOOL_BACKUP_PASSPHRASE"), Buffer.from(meta.salt, "base64"));
  const manifestBytes = decryptBackupFile(await readFile(path.join(directory, "manifest.enc")), key, "manifest.enc");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.projectId !== hosting.project_id) throw Error("Este respaldo pertenece a otro Site; se detuvo la recuperación.");
  return { key, manifest };
}

async function verifyBackup(directory) {
  const { key, manifest } = await readBackup(directory);
  const sql = decryptBackupFile(await readFile(path.join(directory, manifest.database.file)), key, manifest.database.file);
  if (sql.length !== manifest.database.size || sha256(sql) !== manifest.database.sha256) throw Error("La verificación del respaldo D1 falló.");
  const seen = new Set();
  for (const object of manifest.objects) {
    if (seen.has(object.key) || object.file !== backupObjectPath(object.key)) throw Error("El manifiesto contiene objetos duplicados o una ruta inválida.");
    seen.add(object.key);
    const bytes = decryptBackupFile(await readFile(path.join(directory, object.file)), key, object.file);
    if (bytes.length !== object.size || sha256(bytes) !== object.sha256) throw Error(`La verificación del objeto falló: ${object.file}`);
  }
  process.stdout.write(`Respaldo íntegro: D1 (${Object.keys(manifest.database.rowCounts).length} tablas) y ${seen.size} objetos R2.\n`);
}

async function restoreR2(directory, options) {
  const bucketConfig = await createR2Client("write");
  if (options["--confirm-bucket"] !== bucketConfig.bucket) throw Error("Para restaurar, repite indicando --confirm-bucket con el nombre exacto del bucket destino.");
  const { key, manifest } = await readBackup(directory);
  const keys = new Set();
  for (let index = 0; index < manifest.objects.length; index++) {
    const object = manifest.objects[index];
    if (keys.has(object.key) || object.file !== backupObjectPath(object.key)) throw Error("El manifiesto contiene una ruta de objeto no válida.");
    keys.add(object.key);
    const encrypted = await readFile(path.join(directory, object.file));
    const bytes = decryptBackupFile(encrypted, key, object.file);
    if (bytes.length !== object.size || sha256(bytes) !== object.sha256) throw Error(`Falló la validación cifrada del objeto ${index + 1}.`);
    await bucketConfig.client.send(new PutObjectCommand({ Bucket: bucketConfig.bucket, Key: object.key, Body: bytes, ContentLength: bytes.length, ContentType: object.contentType, CacheControl: object.cacheControl, ContentDisposition: object.contentDisposition, ContentEncoding: object.contentEncoding, ContentLanguage: object.contentLanguage, Expires: object.expires ? new Date(object.expires) : undefined, Metadata: object.metadata }));
    const restored = await bucketConfig.client.send(new HeadObjectCommand({ Bucket: bucketConfig.bucket, Key: object.key }));
    if (Number(restored.ContentLength) !== object.size) throw Error(`No se verificó el objeto restaurado ${index + 1}.`);
    process.stdout.write(`Restaurado y verificado objeto ${index + 1} de ${manifest.objects.length}.\n`);
  }
  process.stdout.write("R2 restaurado. No se borraron objetos adicionales del bucket.\n");
}

async function restoreD1(directory, options) {
  const databaseName = options["--new-database"];
  if (!databaseName || options["--confirm-new-database"] !== databaseName || !/^school-recovery-[a-z0-9-]{3,48}$/.test(databaseName)) throw Error("Usa --new-database y confirma el mismo nombre, con prefijo school-recovery-, para importar solo a una base nueva.");
  const { key, manifest } = await readBackup(directory);
  const currentDatabase = requireEnv("SCHOOL_D1_DATABASE");
  if (databaseName === currentDatabase) throw Error("La recuperación no puede apuntar a la base de datos operativa.");
  const databaseListing = jsonOutput(await runWrangler(["d1", "list", "--json"], { quiet: true }));
  const listing = Array.isArray(databaseListing) ? databaseListing : databaseListing.result ?? databaseListing.results ?? databaseListing.databases ?? [];
  if (listing.some(database => database.name === databaseName)) throw Error("Esa base ya existe. El script solo importa en una base nueva y vacía.");
  const sql = decryptBackupFile(await readFile(path.join(directory, manifest.database.file)), key, manifest.database.file);
  if (sha256(sql) !== manifest.database.sha256 || sql.length !== manifest.database.size) throw Error("La verificación del respaldo D1 falló.");
  const temporarySql = path.join(directory, `.restore-${randomBytes(8).toString("hex")}.sql`);
  await writeFile(temporarySql, sql, { mode: 0o600, flag: "wx" });
  try {
    await runWrangler(["d1", "create", databaseName]);
    await runWrangler(["d1", "execute", databaseName, "--remote", `--file=${temporarySql}`, "--yes"]);
    const actualCounts = await d1RowCounts(databaseName);
    if (JSON.stringify(actualCounts) !== JSON.stringify(manifest.database.rowCounts)) throw Error("La restauración D1 terminó, pero los conteos no coinciden con el manifiesto. Conserva la base de recuperación y revisa antes de usarla.");
  } finally {
    await rm(temporarySql, { force: true });
  }
  process.stdout.write(`Base de recuperación ${databaseName} restaurada y verificada. No se cambió la conexión del Site.\n`);
}

const parsed = parseArgs(process.argv.slice(2));
if (parsed.action === "backup") {
  const existing = await stat(parsed.directory).catch(() => null);
  if (existing) {
    const contents = await readdir(parsed.directory);
    if (contents.length) throw Error("El destino del respaldo debe ser una carpeta nueva o vacía.");
    await rm(parsed.directory, { recursive: true });
  }
  await backup(parsed.directory);
} else if (parsed.action === "verify") await verifyBackup(parsed.directory);
else if (parsed.action === "restore-r2") await restoreR2(parsed.directory, parsed.options);
else await restoreD1(parsed.directory, parsed.options);
