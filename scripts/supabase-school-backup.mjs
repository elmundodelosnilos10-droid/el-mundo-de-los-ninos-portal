import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decryptBackupFile, deriveBackupKey, encryptBackupFile, sha256 } from "./backup-crypto.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaFile = path.join(root, "supabase/migrations/20261008000000_school_schema.sql");
// Backup-only catalog additions: these have no equivalent D1 import source.
const backupSchemaFiles = [path.join(root, "supabase/migrations/20261024000000_school_accounts_rpcs.sql")];
const format = "mundo-ninos-supabase-backup";
const pageSize = 500;

export function parseSchoolSchema(sql) {
  const tables = [];
  const blocks = sql.matchAll(/create\s+table\s+public\.([a-z_]+)\s*\(([\s\S]*?)\n\);/gi);
  for (const [, name, body] of blocks) {
    const columns = [];
    let primaryKey = [];
    for (const line of body.split("\n")) {
      const tablePrimary = line.match(/^\s*primary\s+key\s*\(([^)]+)\)/i);
      if (tablePrimary) primaryKey = tablePrimary[1].split(",").map(value => value.trim());
      const column = line.match(/^\s*([a-z_][a-z0-9_]*)\s+[a-z]/i);
      if (column && !["constraint", "primary", "unique", "check", "foreign"].includes(column[1].toLowerCase())) {
        columns.push(column[1]);
        if (/\bprimary\s+key\b/i.test(line)) primaryKey = [column[1]];
      }
    }
    if (!columns.length || !primaryKey.length || primaryKey.some(key => !columns.includes(key))) throw Error(`No se pudo leer la clave primaria de ${name}.`);
    tables.push({ name, columns, primaryKey });
  }
  if (!tables.length) throw Error("La migración escolar no declara tablas públicas reconocibles.");
  return tables;
}

export async function loadSchoolBackupTables({ legacySchoolSchema = false } = {}) {
  const baseline = parseSchoolSchema(await readFile(schemaFile, "utf8"));
  if (legacySchoolSchema) return baseline;
  const tables = [...baseline];
  const names = new Set(tables.map(table => table.name));
  for (const file of backupSchemaFiles) {
    for (const table of parseSchoolSchema(await readFile(file, "utf8"))) {
      if (names.has(table.name)) throw Error(`El catálogo de respaldo repite public.${table.name}.`);
      names.add(table.name);
      // Added tables follow their preexisting Auth/profile FK dependencies.
      tables.push(table);
    }
  }
  return tables;
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function schemaFingerprint(tables) {
  return sha256(Buffer.from(stableStringify(tables.map(({ name, columns, primaryKey }) => ({ name, columns, primaryKey })))));
}

function safePath(name) {
  if (typeof name !== "string" || !name || name.startsWith("/") || name.split("/").some(part => !part || part === "." || part === "..")) {
    throw Error("Supabase devolvió una ruta de archivo no válida.");
  }
  return name;
}

export function storageObjectPath(name) {
  return `objects/${sha256(name)}.enc`;
}

function canonicalRows(rows, table) {
  return [...rows].sort((left, right) => {
    for (const key of table.primaryKey) {
      const a = String(left[key] ?? "");
      const b = String(right[key] ?? "");
      if (a !== b) return a.localeCompare(b);
    }
    return stableStringify(left).localeCompare(stableStringify(right));
  });
}

function requireServerConfig(env) {
  const url = env.SUPABASE_URL;
  const secret = env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw Error("Configura SUPABASE_URL y SUPABASE_SECRET_KEY en el entorno seguro de operación.");
  let parsed;
  try { parsed = new URL(url); } catch { throw Error("SUPABASE_URL no es válida."); }
  if (parsed.protocol !== "https:" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") throw Error("SUPABASE_URL debe usar HTTPS salvo en pruebas locales.");
  if (env.SUPABASE_PUBLISHABLE_KEY && env.SUPABASE_PUBLISHABLE_KEY === secret) throw Error("La clave Secret debe ser distinta de la clave publishable.");
  return { base: parsed.origin, secret };
}

export function createSupabaseClient({ url, secret, fetchImpl = fetch, timeoutMs = 40_000 }) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw Error("El tiempo máximo de operación Supabase no es válido.");
  const base = new URL(url).origin;
  async function request(endpoint, { method = "GET", headers = {}, body, expected = [200] } = {}) {
    let response;
    try {
      response = await fetchImpl(`${base}${endpoint}`, {
        method,
        headers: {
          apikey: secret,
          ...(/^sb_secret_/.test(secret) ? {} : { Authorization: `Bearer ${secret}` }),
          ...headers,
        },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw Error(`No se pudo conectar con Supabase (${method} ${endpoint.split("?")[0]}).`);
    }
    if (!expected.includes(response.status)) {
      // Response bodies are deliberately not included: a proxy or provider error can echo request details.
      throw Error(`Supabase rechazó ${method} ${endpoint.split("?")[0]} (HTTP ${response.status}).`);
    }
    return response;
  }
  return { request };
}

async function readRows(client, table) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const order = table.primaryKey.map(key => `${key}.asc`).join(",");
    const params = new URLSearchParams({ select: "*", order, limit: String(pageSize), offset: String(offset) });
    const response = await client.request(`/rest/v1/${table.name}?${params}`);
    let page;
    try { page = await response.json(); } catch { throw Error(`Respuesta inválida al leer public.${table.name}.`); }
    if (!Array.isArray(page) || page.some(row => !row || typeof row !== "object" || table.columns.some(column => !(column in row)))) {
      throw Error(`El esquema de public.${table.name} no coincide con la migración del respaldo.`);
    }
    rows.push(...page);
    if (page.length < pageSize) return canonicalRows(rows, table);
  }
}

function describeSchema(openApi, tables) {
  if (!openApi || typeof openApi !== "object" || !openApi.paths || !openApi.definitions) throw Error("Supabase no expuso el esquema PostgREST verificable; se detuvo la operación.");
  const actual = [];
  for (const table of tables) {
    const pathKey = `/${table.name}`;
    if (!openApi.paths[pathKey] || !openApi.definitions[table.name]?.properties) throw Error(`Falta public.${table.name} en el esquema remoto.`);
    const columns = Object.keys(openApi.definitions[table.name].properties).sort();
    const expected = [...table.columns].sort();
    if (stableStringify(columns) !== stableStringify(expected)) throw Error(`Las columnas de public.${table.name} no coinciden con la migración local.`);
    actual.push({ name: table.name, columns: table.columns, primaryKey: table.primaryKey });
  }
  return schemaFingerprint(actual);
}

async function getRemoteSchema(client, tables) {
  const response = await client.request("/rest/v1/");
  let document;
  try { document = await response.json(); } catch { throw Error("Supabase devolvió un esquema OpenAPI inválido."); }
  return describeSchema(document, tables);
}

function decodeObjectPath(bucket, name) {
  return `/storage/v1/object/${bucket}/${name.split("/").map(encodeURIComponent).join("/")}`;
}

async function listStorageFolder(client, prefix = "") {
  const found = [];
  for (let offset = 0; ; offset += pageSize) {
    const response = await client.request(`/storage/v1/object/list/school-files`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prefix, limit: pageSize, offset, sortBy: { column: "name", order: "asc" } }),
    });
    let entries;
    try { entries = await response.json(); } catch { throw Error("Supabase Storage devolvió una lista inválida."); }
    if (!Array.isArray(entries)) throw Error("Supabase Storage no devolvió una lista de archivos.");
    for (const entry of entries) {
      if (typeof entry?.name !== "string" || !entry.name || entry.name.includes("/")) throw Error("Supabase Storage devolvió una entrada no válida.");
      if (entry.id != null || (entry.metadata && typeof entry.metadata === "object")) {
        const key = safePath(`${prefix}${entry.name}`);
        found.push({ key, metadata: entry.metadata ?? {}, createdAt: entry.created_at ?? null, updatedAt: entry.updated_at ?? null });
      } else {
        found.push(...await listStorageFolder(client, `${prefix}${entry.name}/`));
      }
    }
    if (entries.length < pageSize) break;
  }
  return found.sort((a, b) => a.key.localeCompare(b.key));
}

async function downloadObjects(client) {
  const before = await listStorageFolder(client);
  const objects = [];
  for (const item of before) {
    const response = await client.request(decodeObjectPath("school-files", item.key));
    const bytes = Buffer.from(await response.arrayBuffer());
    objects.push({
      key: item.key,
      size: bytes.length,
      sha256: sha256(bytes),
      file: storageObjectPath(item.key),
      contentType: response.headers.get("content-type") ?? item.metadata.mimetype ?? "application/octet-stream",
      cacheControl: response.headers.get("cache-control") ?? null,
      metadata: item.metadata,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      bytes,
    });
  }
  const after = await listStorageFolder(client);
  if (stableStringify(before) !== stableStringify(after)) throw Error("La lista de Storage cambió durante el respaldo. Repite cuando no haya actividad.");
  return objects;
}

async function writeEncrypted(directory, relative, bytes, key) {
  const file = path.join(directory, relative);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, encryptBackupFile(bytes, key, relative), { mode: 0o600, flag: "wx" });
}

export async function createBackup({ directory, client, tables, passphrase, now = new Date() }) {
  const salt = randomBytes(16);
  const key = await deriveBackupKey(passphrase, salt);
  await mkdir(directory, { recursive: false, mode: 0o700 });
  await chmod(directory, 0o700);
  const meta = { format, version: 1, createdAt: now.toISOString(), salt: salt.toString("base64") };
  await writeFile(path.join(directory, "backup-meta.json"), JSON.stringify(meta, null, 2), { mode: 0o600, flag: "wx" });
  const schemaHash = await getRemoteSchema(client, tables);
  if (schemaHash !== schemaFingerprint(tables)) throw Error("La firma del esquema remoto no coincide con la migración local.");
  const firstRows = {};
  for (const table of tables) firstRows[table.name] = await readRows(client, table);
  const firstObjects = await downloadObjects(client);
  const tableManifest = {};
  for (const table of tables) {
    const rows = firstRows[table.name];
    const bytes = Buffer.from(stableStringify(rows));
    const file = `tables/${table.name}.json.enc`;
    await writeEncrypted(directory, file, bytes, key);
    tableManifest[table.name] = { file, count: rows.length, sha256: sha256(bytes) };
  }
  const objects = [];
  for (const object of firstObjects) {
    await writeEncrypted(directory, object.file, object.bytes, key);
    const { key: storageKey, size, sha256: hash, file, contentType, cacheControl, metadata, createdAt, updatedAt } = object;
    objects.push({ key: storageKey, size, sha256: hash, file, contentType, cacheControl, metadata, createdAt, updatedAt });
  }
  // Read every table again and compare full canonical checksums; count-only checks can miss in-place edits.
  for (const table of tables) {
    const second = await readRows(client, table);
    if (stableStringify(second) !== stableStringify(firstRows[table.name])) throw Error(`public.${table.name} cambió durante el respaldo.`);
  }
  const secondObjects = await downloadObjects(client);
  const digestList = entries => entries.map(({ key, size, sha256: hash }) => ({ key, size, sha256: hash })).sort((a, b) => a.key.localeCompare(b.key));
  if (stableStringify(digestList(firstObjects)) !== stableStringify(digestList(secondObjects))) throw Error("El contenido de Storage cambió durante el respaldo.");
  const manifest = { format, version: 1, createdAt: meta.createdAt, schemaHash, tables: tableManifest, objects };
  await writeEncrypted(directory, "manifest.enc", Buffer.from(stableStringify(manifest)), key);
  return { tables: tables.length, rows: Object.values(tableManifest).reduce((sum, table) => sum + table.count, 0), objects: objects.length };
}

async function readBackup(directory, passphrase, tables) {
  const meta = JSON.parse(await readFile(path.join(directory, "backup-meta.json"), "utf8"));
  if (meta.format !== format || meta.version !== 1 || typeof meta.salt !== "string") throw Error("Formato de respaldo Supabase no reconocido.");
  const key = await deriveBackupKey(passphrase, Buffer.from(meta.salt, "base64"));
  const manifestBytes = decryptBackupFile(await readFile(path.join(directory, "manifest.enc")), key, "manifest.enc");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.format !== format || manifest.version !== 1 || manifest.schemaHash !== schemaFingerprint(tables)) throw Error("El respaldo corresponde a otra versión del esquema escolar.");
  if (stableStringify(Object.keys(manifest.tables ?? {}).sort()) !== stableStringify(tables.map(table => table.name).sort())) throw Error("El manifiesto no contiene todas las tablas escolares esperadas.");
  for (const table of tables) {
    const entry = manifest.tables[table.name];
    if (entry.file !== `tables/${table.name}.json.enc` || !Number.isSafeInteger(entry.count) || entry.count < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw Error(`El manifiesto de public.${table.name} no es válido.`);
    }
  }
  if (!Array.isArray(manifest.objects)) throw Error("El manifiesto de Storage no tiene el formato esperado.");
  return { key, manifest };
}

export async function verifyBackup({ directory, passphrase, tables }) {
  const { key, manifest } = await readBackup(directory, passphrase, tables);
  let rows = 0;
  for (const table of tables) {
    const entry = manifest.tables[table.name];
    const bytes = decryptBackupFile(await readFile(path.join(directory, entry.file)), key, entry.file);
    const parsed = JSON.parse(bytes.toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== entry.count || sha256(bytes) !== entry.sha256) throw Error(`Integridad fallida para public.${table.name}.`);
    rows += parsed.length;
  }
  const seen = new Set();
  for (const object of manifest.objects ?? []) {
    safePath(object.key);
    if (seen.has(object.key) || object.file !== storageObjectPath(object.key)) throw Error("El manifiesto contiene rutas duplicadas o no válidas.");
    seen.add(object.key);
    const bytes = decryptBackupFile(await readFile(path.join(directory, object.file)), key, object.file);
    if (bytes.length !== object.size || sha256(bytes) !== object.sha256) throw Error(`Integridad fallida para un objeto de Storage (${object.file}).`);
  }
  return { tables: tables.length, rows, objects: seen.size };
}

async function readTableArchive(directory, key, manifest, table) {
  const entry = manifest.tables[table.name];
  const bytes = decryptBackupFile(await readFile(path.join(directory, entry.file)), key, entry.file);
  if (sha256(bytes) !== entry.sha256) throw Error(`Integridad fallida para public.${table.name}.`);
  const rows = JSON.parse(bytes.toString("utf8"));
  if (!Array.isArray(rows) || rows.length !== entry.count || rows.some(row => table.columns.some(column => !(column in row)))) throw Error(`El contenido de public.${table.name} no coincide con el esquema.`);
  return rows;
}

async function countTable(client, table) {
  const response = await client.request(`/rest/v1/${table.name}?select=${table.primaryKey[0]}&limit=1`, { headers: { Prefer: "count=exact" } });
  const range = response.headers.get("content-range");
  const count = range?.match(/\/(\d+)$/)?.[1];
  if (count == null) throw Error(`No se pudo verificar si public.${table.name} está vacía.`);
  return Number(count);
}

async function verifyAuthIdentities(client, profiles) {
  const wanted = new Set(profiles.map(profile => profile.id));
  if (!wanted.size) return new Map();
  const found = new Map();
  for (let page = 1; ; page++) {
    const response = await client.request(`/auth/v1/admin/users?page=${page}&per_page=1000`);
    let payload;
    try { payload = await response.json(); } catch { throw Error("No se pudo comprobar las identidades de Supabase Auth."); }
    const users = Array.isArray(payload) ? payload : payload.users;
    if (!Array.isArray(users)) throw Error("Supabase Auth devolvió un listado de identidades inválido.");
    for (const user of users) if (wanted.has(user.id)) found.set(user.id, user);
    if (users.length < 1000) break;
  }
  if (found.size !== wanted.size) throw Error("Faltan identidades Auth con los UUID del respaldo. No se restauró ningún dato.");
  for (const profile of profiles) {
    if (found.get(profile.id)?.email !== profile.email) throw Error("El correo de una identidad Auth no coincide con el respaldo. No se restauró ningún dato.");
  }
  return found;
}

function postgrestFilter(value) {
  return `eq.${encodeURIComponent(String(value))}`;
}

async function compensate(client, inserted, uploaded, priorProfiles) {
  const failures = [];
  for (const object of [...uploaded].reverse()) {
    try {
      await client.request(decodeObjectPath("school-files", object), { method: "DELETE", expected: [200, 204, 404] });
    } catch { failures.push("storage object"); }
  }
  for (const entry of [...inserted].reverse()) {
    for (const row of [...entry.rows].reverse()) {
      try {
        const query = entry.table.primaryKey.map(key => `${encodeURIComponent(key)}=${postgrestFilter(row[key])}`).join("&");
        if (entry.table.name === "profiles") {
          const previous = priorProfiles.get(row.id);
          if (previous) {
            await client.request("/rest/v1/profiles", { method: "POST", headers: { "content-type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([previous]), expected: [201, 204] });
          } else {
            await client.request(`/rest/v1/profiles?${query}`, { method: "DELETE", headers: { Prefer: "return=minimal" }, expected: [200, 204] });
          }
        } else {
          await client.request(`/rest/v1/${entry.table.name}?${query}`, { method: "DELETE", headers: { Prefer: "return=minimal" }, expected: [200, 204] });
        }
      } catch { failures.push(`public.${entry.table.name}`); }
    }
  }
  return failures;
}

export async function restoreBackup({ directory, client, tables, passphrase, confirmRestore = false }) {
  if (!confirmRestore) throw Error("La restauración requiere --confirm-restore.");
  const { key, manifest } = await readBackup(directory, passphrase, tables);
  const remoteHash = await getRemoteSchema(client, tables);
  if (remoteHash !== manifest.schemaHash) throw Error("El esquema del proyecto destino no coincide con el del respaldo.");
  const rowsByTable = {};
  for (const table of tables) rowsByTable[table.name] = await readTableArchive(directory, key, manifest, table);
  const objectKeys = new Set();
  const verifiedObjects = [];
  for (const object of manifest.objects) {
    safePath(object.key);
    if (objectKeys.has(object.key) || object.file !== storageObjectPath(object.key)) throw Error("El manifiesto contiene rutas duplicadas o no válidas.");
    objectKeys.add(object.key);
    const bytes = decryptBackupFile(await readFile(path.join(directory, object.file)), key, object.file);
    if (bytes.length !== object.size || sha256(bytes) !== object.sha256) throw Error("La integridad de un objeto falló antes de conectar con el destino.");
    verifiedObjects.push({ ...object, bytes });
  }
  await verifyAuthIdentities(client, rowsByTable.profiles ?? []);
  // Existing Auth accounts trigger profile rows. Allow only exact IDs included in the backup;
  // every other public table must be empty to avoid accidental merging or overwriting.
  let priorProfiles = new Map();
  for (const table of tables) {
    const count = await countTable(client, table);
    if (table.name === "profiles") {
      const archivedIds = new Set((rowsByTable.profiles ?? []).map(row => row.id));
      const existing = await readRows(client, table);
      if (existing.some(row => !archivedIds.has(row.id))) throw Error("El destino tiene perfiles fuera del respaldo. No se restauró ningún dato.");
      priorProfiles = new Map(existing.map(row => [row.id, row]));
    } else if (count !== 0) throw Error(`public.${table.name} ya contiene datos. La restauración solo admite tablas vacías.`);
  }
  const existingObjects = await listStorageFolder(client);
  const archivedKeys = new Set(verifiedObjects.map(item => item.key));
  if (existingObjects.some(item => archivedKeys.has(item.key))) throw Error("El bucket destino contiene rutas del respaldo. No se sobrescribió ningún objeto.");

  const inserted = [];
  const uploaded = [];
  try {
    // Migration declaration order follows FK dependencies, so parent rows are inserted first.
    for (const table of tables) {
      const rows = rowsByTable[table.name];
      if (!rows.length) continue;
      for (let offset = 0; offset < rows.length; offset += 100) {
        const batch = rows.slice(offset, offset + 100);
        // A network error can hide a committed Postgres transaction. Track before sending so
        // compensation also probes the keys from a request with an unknown outcome.
        inserted.push({ table, rows: batch });
        await client.request(`/rest/v1/${table.name}`, {
          method: "POST",
          headers: { "content-type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(batch),
          expected: [201, 204],
        });
      }
    }
    for (const object of verifiedObjects) {
      const { bytes } = object;
      // Uploads can succeed remotely even if the response is lost; cleanup must probe this key.
      uploaded.push(object.key);
      await client.request(decodeObjectPath("school-files", object.key), {
        method: "POST",
        headers: {
          "content-type": object.contentType ?? "application/octet-stream",
          "cache-control": object.cacheControl ?? "max-age=3600",
          "x-upsert": "false",
          "x-metadata": JSON.stringify(object.metadata ?? {}),
        },
        body: bytes,
        expected: [200],
      });
    }
    for (const table of tables) {
      const restored = await readRows(client, table);
      if (stableStringify(restored) !== stableStringify(rowsByTable[table.name])) throw Error(`La verificación posterior falló para public.${table.name}.`);
    }
    for (const object of verifiedObjects) {
      const response = await client.request(decodeObjectPath("school-files", object.key));
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length !== object.size || sha256(bytes) !== object.sha256) throw Error("La verificación posterior falló para un objeto de Storage.");
    }
  } catch (error) {
    const failures = await compensate(client, inserted, uploaded, priorProfiles);
    const cleanup = failures.length ? " La limpieza automática quedó incompleta; revisa el destino antes de reintentar." : " Se revirtieron los registros y archivos de esta ejecución.";
    throw Error(`${error instanceof Error ? error.message : "Falló la restauración."}${cleanup}`);
  }
  return { tables: tables.length, rows: Object.values(rowsByTable).reduce((sum, rows) => sum + rows.length, 0), objects: manifest.objects.length,
    limitation: "Las identidades Auth no se recrean: deben existir previamente con sus UUID originales. Storage conserva contenido, ruta y metadatos enviados por el cliente; Supabase asigna nuevos IDs y fechas de objeto." };
}

export function parseBackupArgs(argv) {
  const [action, directory, ...flags] = argv;
  if (!["backup", "verify", "restore"].includes(action) || !directory) throw Error("Uso: node scripts/supabase-school-backup.mjs backup|verify|restore <directorio> [--confirm-restore] [--legacy-school-schema solo verify]");
  if (flags.some(flag => !["--confirm-restore", "--legacy-school-schema"].includes(flag))
    || new Set(flags).size !== flags.length
    || (flags.includes("--confirm-restore") && action !== "restore")
    || (flags.includes("--legacy-school-schema") && action !== "verify")) throw Error("Opción no válida: el esquema anterior solo admite verificación explícita.");
  return { action, directory: path.resolve(directory), confirmRestore: flags.includes("--confirm-restore"), legacySchoolSchema: flags.includes("--legacy-school-schema") };
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseBackupArgs(argv);
  const tables = await loadSchoolBackupTables({ legacySchoolSchema: args.legacySchoolSchema });
  const passphrase = env.SCHOOL_BACKUP_PASSPHRASE;
  if (!passphrase) throw Error("Falta configurar SCHOOL_BACKUP_PASSPHRASE en el entorno seguro de operación.");
  if (args.action === "verify") {
    const result = await verifyBackup({ directory: args.directory, passphrase, tables });
    const scope = args.legacySchoolSchema ? " Esquema histórico de 32 tablas: no acredita respaldo del estado nuevo de provisión de cuentas." : "";
    process.stdout.write(`Respaldo Supabase íntegro: ${result.rows} filas en ${result.tables} tablas y ${result.objects} objetos.${scope}\n`);
    return;
  }
  const { base, secret } = requireServerConfig(env);
  const client = createSupabaseClient({ url: base, secret });
  if (args.action === "backup") {
    const existing = await readdir(args.directory).catch(() => null);
    if (existing?.length) throw Error("El destino del respaldo debe ser una carpeta nueva o vacía.");
    if (existing) await rm(args.directory, { recursive: true });
    const result = await createBackup({ directory: args.directory, client, tables, passphrase });
    process.stdout.write(`Respaldo Supabase cifrado listo: ${result.rows} filas en ${result.tables} tablas y ${result.objects} objetos.\n`);
  } else {
    const result = await restoreBackup({ directory: args.directory, client, tables, passphrase, confirmRestore: args.confirmRestore });
    process.stdout.write(`Restauración Supabase verificada: ${result.rows} filas en ${result.tables} tablas y ${result.objects} objetos. ${result.limitation}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : "Operación fallida."}\n`);
    process.exitCode = 1;
  });
}
