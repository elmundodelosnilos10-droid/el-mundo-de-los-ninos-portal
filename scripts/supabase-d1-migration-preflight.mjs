import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decryptBackupFile, deriveBackupKey, sha256 } from "./backup-crypto.mjs";
import { parseSchoolSchema } from "./supabase-school-backup.mjs";
import { transformD1SchoolRows } from "./supabase-d1-row-transform.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hosting = JSON.parse(await readFile(path.join(root, ".openai/hosting.json"), "utf8"));
const schoolSchemaPath = path.join(root, "supabase/migrations/20261008000000_school_schema.sql");
const EXPECTED_FORMAT = "mundo-ninos-secure-backup";

function fail(message) {
  throw new Error(`Preflight D1 → Supabase detenido: ${message}`);
}

function safeFile(directory, relativePath) {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).some(part => !part || part === "." || part === "..")) {
    fail("el respaldo contiene una ruta de archivo no válida.");
  }
  const file = path.resolve(directory, relativePath);
  if (!file.startsWith(`${path.resolve(directory)}${path.sep}`)) fail("el respaldo apunta fuera de su carpeta.");
  return file;
}

async function decryptFile(directory, relativePath, key) {
  try {
    return decryptBackupFile(await readFile(safeFile(directory, relativePath)), key, relativePath);
  } catch {
    fail("un archivo cifrado no se pudo verificar.");
  }
}

function parseObjectRows(database) {
  const rows = database.prepare("select object_key from files order by object_key").all();
  const keys = new Set(rows.map(row => row.object_key));
  if (keys.size !== rows.length) fail("hay rutas de archivo repetidas en D1.");
  return keys;
}

export async function inspectD1SchoolBackup({ directory, passphrase, projectId = hosting.project_id, schemaSql } = {}) {
  if (typeof passphrase !== "string" || passphrase.length < 20) fail("configura la frase de respaldo de 20 caracteres o más.");
  let meta;
  try { meta = JSON.parse(await readFile(path.join(directory, "backup-meta.json"), "utf8")); }
  catch { fail("no se encontró metadata de un respaldo D1 válido."); }
  if (meta?.format !== EXPECTED_FORMAT || meta.version !== 1 || typeof meta.salt !== "string") fail("el formato del respaldo D1 no es compatible.");

  const salt = Buffer.from(meta.salt, "base64");
  if (salt.length !== 16) fail("la metadata del respaldo no es válida.");
  const key = await deriveBackupKey(passphrase, salt);
  const manifestBytes = await decryptFile(directory, "manifest.enc", key);
  let manifest;
  try { manifest = JSON.parse(manifestBytes.toString("utf8")); }
  catch { fail("el manifiesto cifrado no es JSON válido."); }
  if (manifest?.projectId !== projectId) fail("el respaldo pertenece a otro Site.");
  if (!manifest.database || manifest.database.file !== "database.sql.enc" || !Number.isSafeInteger(manifest.database.size) || !/^[a-f0-9]{64}$/.test(manifest.database.sha256 ?? "")) fail("el manifiesto D1 no es válido.");
  const sql = await decryptFile(directory, manifest.database.file, key);
  if (sql.length !== manifest.database.size || sha256(sql) !== manifest.database.sha256) fail("la exportación SQL no coincide con el manifiesto.");

  const database = new DatabaseSync(":memory:");
  try {
    database.exec(sql.toString("utf8"));
    database.exec("PRAGMA foreign_keys=ON;");
    const names = database.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '_cf_%' order by name").all().map(row => row.name);
    const actualCounts = Object.fromEntries(names.map(name => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) fail("D1 devolvió un nombre de tabla inesperado.");
      return [name, Number(database.prepare(`select count(*) as count from "${name}"`).get().count)];
    }));
    if (JSON.stringify(actualCounts) !== JSON.stringify(manifest.database.rowCounts)) fail("los conteos del SQL no coinciden con el manifiesto.");
    if (!names.includes("user") || !names.includes("files")) fail("el respaldo no contiene las tablas escolares esperadas.");
    const foreignKeyErrors = database.prepare("pragma foreign_key_check").all();
    if (foreignKeyErrors.length) fail("el respaldo tiene relaciones D1 incompletas.");

    const tableDefinitions = parseSchoolSchema(schemaSql ?? await readFile(schoolSchemaPath, "utf8"));
    const definitionsByName = new Map(tableDefinitions.map(table => [table.name, table]));
    for (const table of tableDefinitions) {
      if (table.name === "profiles") continue;
      if (!names.includes(table.name)) fail(`falta public.${table.name} en el respaldo D1.`);
      const sourceColumns = database.prepare(`pragma table_info("${table.name}")`).all().map(row => row.name).sort();
      if (JSON.stringify(sourceColumns) !== JSON.stringify([...table.columns].sort())) fail(`las columnas de ${table.name} no coinciden con el esquema Supabase.`);
    }

    const objectKeys = new Set();
    let objectCount = 0;
    if (!Array.isArray(manifest.objects)) fail("el manifiesto de archivos no es válido.");
    for (const object of manifest.objects) {
      if (!object || typeof object.key !== "string" || typeof object.file !== "string" || object.file !== `objects/${sha256(Buffer.from(object.key)).slice(0, 64)}.enc` || !Number.isSafeInteger(object.size) || object.size < 0 || !/^[a-f0-9]{64}$/.test(object.sha256 ?? "") || objectKeys.has(object.key)) fail("la lista R2 del manifiesto contiene una entrada inválida.");
      const bytes = await decryptFile(directory, object.file, key);
      if (bytes.length !== object.size || sha256(bytes) !== object.sha256) fail("un objeto R2 no coincide con su manifiesto.");
      objectKeys.add(object.key);
      objectCount++;
    }
    const referencedObjects = parseObjectRows(database);
    for (const objectKey of referencedObjects) if (!objectKeys.has(objectKey)) fail("un registro escolar referencia un archivo ausente en R2.");

    const rowsByTable = {};
    for (const table of tableDefinitions) {
      if (table.name === "profiles") continue;
      rowsByTable[table.name] = database.prepare(`select * from "${table.name}"`).all();
    }
    rowsByTable.user = database.prepare("select * from user order by id").all();
    return {
      manifest,
      tableDefinitions,
      rowsByTable,
      counts: {
        sourceTables: names.length,
        schoolTables: tableDefinitions.length,
        schoolRows: Object.entries(actualCounts).filter(([name]) => definitionsByName.has(name)).reduce((total, [, count]) => total + count, 0),
        accounts: rowsByTable.user.length,
        objects: objectCount,
      },
    };
  } finally {
    database.close();
  }
}

export async function buildD1SupabaseDryRun({ backupOptions, supabaseUsers }) {
  const snapshot = await inspectD1SchoolBackup(backupOptions);
  const transformed = transformD1SchoolRows(snapshot.rowsByTable, supabaseUsers, snapshot.tableDefinitions);
  const rows = Object.values(transformed.rowsByTable).reduce((count, tableRows) => count + tableRows.length, 0);
  return { ...snapshot.counts, targetRows: rows, mappedAccounts: transformed.identityMap.size };
}

function parseArgs(argv) {
  const [action, directory] = argv;
  if (action !== "preflight" || !directory || argv.length !== 2) fail("uso: npm run supabase:d1-preflight -- <carpeta-del-respaldo-d1>.");
  return { action, directory: path.resolve(directory) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const passphrase = process.env.SCHOOL_BACKUP_PASSPHRASE;
  if (!passphrase) fail("falta SCHOOL_BACKUP_PASSPHRASE en el entorno local seguro.");
  const snapshot = await inspectD1SchoolBackup({ directory: args.directory, passphrase });
  process.stdout.write(`Respaldo D1 verificado: ${snapshot.counts.accounts} cuentas, ${snapshot.counts.schoolRows} filas escolares y ${snapshot.counts.objects} archivos.\n`);
  process.stdout.write("La conversión a Postgres requiere que cada cuenta ya exista en Supabase Auth; la carga aún no se ejecutó.\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : "Operación fallida."}\n`);
    process.exitCode = 1;
  });
}
