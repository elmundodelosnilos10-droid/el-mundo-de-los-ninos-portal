import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectD1SchoolBackup } from "./supabase-d1-migration-preflight.mjs";
import { transformD1SchoolRows, parseSupabaseMigrationSchema } from "./supabase-d1-row-transform.mjs";
import { createSupabaseClient } from "./supabase-school-backup.mjs";
import { deriveBackupKey, decryptBackupFile, sha256 } from "./backup-crypto.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(root, "supabase/migrations/20261008000000_school_schema.sql");
const storagePrefix = "supabase:";
const batchSize = 100;

function stop(message) { throw new Error("Importación D1 → Supabase detenida: " + message); }

function configFor(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) stop("faltan SUPABASE_URL o SUPABASE_SECRET_KEY en el entorno local seguro.");
  let url;
  try { url = new URL(env.SUPABASE_URL); } catch { stop("SUPABASE_URL no es válida."); }
  if (url.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(url.hostname)) stop("SUPABASE_URL debe usar HTTPS.");
  if (env.SUPABASE_PUBLISHABLE_KEY === env.SUPABASE_SECRET_KEY) stop("la clave Secret no puede ser la clave publishable.");
  return { url: url.origin, ref: url.hostname.split(".")[0] };
}

function storagePath(key) {
  const raw = key.replace(/^supabase:/, "");
  if (!raw || raw.startsWith("/") || raw.split("/").some(part => !part || part === "." || part === "..")) stop("el respaldo contiene una ruta de archivo inválida.");
  return "/storage/v1/object/school-files/" + raw.split("/").map(encodeURIComponent).join("/");
}

function exactCount(response, table) {
  const text = response.headers.get("content-range")?.match(/\/(\d+)$/)?.[1];
  if (text == null) stop("no se pudo verificar public." + table + ".");
  return Number(text);
}

async function listAuthUsers(client) {
  const users = [];
  for (let page = 1; page <= 100; page++) {
    const response = await client.request("/auth/v1/admin/users?page=" + page + "&per_page=1000");
    const value = await response.json().catch(() => null);
    const items = Array.isArray(value) ? value : value?.users;
    if (!Array.isArray(items)) stop("Supabase Auth no devolvió una lista válida.");
    users.push(...items.map(({ id, email, email_confirmed_at }) => ({ id, email, email_confirmed_at })));
    if (items.length < 1000) return users;
  }
  stop("el listado de Auth excedió el límite de páginas.");
}

async function verifySchema(client, definitions) {
  const response = await client.request("/rest/v1/");
  const schema = await response.json().catch(() => null);
  if (!schema?.paths || !schema?.definitions) stop("no se pudo verificar el esquema PostgREST.");
  for (const table of definitions) {
    const columns = Object.keys(schema.definitions[table.name]?.properties ?? {}).sort();
    if (!schema.paths["/" + table.name] || JSON.stringify(columns) !== JSON.stringify([...table.columns].sort())) stop("el esquema de public." + table.name + " no coincide.");
  }
}

function stable(value) {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stable(value[key])).join(",") + "}";
  return JSON.stringify(value);
}

async function readAllRows(client, table) {
  const rows = [];
  const order = table.primaryKey.map(key => key + ".asc").join(",");
  for (let offset = 0; ; offset += 500) {
    const query = new URLSearchParams({ select: "*", order, limit: "500", offset: String(offset) });
    const response = await client.request("/rest/v1/" + table.name + "?" + query);
    const page = await response.json().catch(() => null);
    if (!Array.isArray(page)) stop("no se pudo verificar el contenido de public." + table.name + ".");
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}

async function verifyEmptyTarget(client, definitions, profiles) {
  const profileIds = new Set(profiles.map(row => row.id));
  let oldProfiles = [];
  for (const table of definitions) {
    const response = await client.request("/rest/v1/" + table.name + "?select=" + table.primaryKey[0] + "&limit=1", { headers: { Prefer: "count=exact" } });
    const count = exactCount(response, table.name);
    if (table.name === "profiles") {
      const existing = await client.request("/rest/v1/profiles?select=*");
      oldProfiles = await existing.json().catch(() => null);
      if (!Array.isArray(oldProfiles) || oldProfiles.some(row => !profileIds.has(row.id))) stop("hay perfiles de destino que no pertenecen a las identidades del respaldo.");
    } else if (count !== 0) stop("public." + table.name + " ya tiene datos; no se sobrescribieron ni mezclaron.");
  }
  const bucket = await client.request("/storage/v1/object/list/school-files", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ prefix: "", limit: 1, offset: 0, sortBy: { column: "name", order: "asc" } }),
  });
  const objects = await bucket.json().catch(() => null);
  if (!Array.isArray(objects) || objects.length) stop("no se pudo verificar que school-files esté vacío.");
  return oldProfiles;
}

async function readArchivedObject(directory, object, key) {
  const rel = object.file;
  if (typeof rel !== "string" || path.isAbsolute(rel) || rel.split(/[\\/]/).some(part => !part || part === "." || part === "..")) stop("el manifiesto tiene una ruta inválida.");
  const file = path.resolve(directory, rel);
  if (!file.startsWith(path.resolve(directory) + path.sep)) stop("el manifiesto apunta fuera del respaldo.");
  const bytes = decryptBackupFile(await readFile(file), key, rel);
  if (bytes.length !== object.size || sha256(bytes) !== object.sha256) stop("un archivo no coincide con su hash del respaldo.");
  return bytes;
}

async function rollback(client, inserted, uploaded, oldProfiles) {
  const failed = [];
  for (const key of [...uploaded].reverse()) {
    try { await client.request(storagePath(key), { method: "DELETE", expected: [200, 204, 404] }); } catch { failed.push("storage"); }
  }
  for (const item of [...inserted].reverse()) for (const row of [...item.rows].reverse()) {
    const query = item.table.primaryKey.map(k => encodeURIComponent(k) + "=eq." + encodeURIComponent(String(row[k]))).join("&");
    try {
      if (item.table.name === "profiles") {
        const prior = oldProfiles.find(value => value.id === row.id);
        if (prior) await client.request("/rest/v1/profiles", { method: "POST", headers: { "content-type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([prior]), expected: [201, 204] });
        else await client.request("/rest/v1/profiles?" + query, { method: "DELETE", headers: { Prefer: "return=minimal" }, expected: [200, 204] });
      } else await client.request("/rest/v1/" + item.table.name + "?" + query, { method: "DELETE", headers: { Prefer: "return=minimal" }, expected: [200, 204] });
    } catch { failed.push(item.table.name); }
  }
  return failed;
}

export async function importD1SchoolBackup({ directory, passphrase, client, confirmProjectRef, env = process.env, confirmApply = false }) {
  if (!confirmApply) stop("el modo de escritura requiere --apply.");
  const config = configFor(env);
  if (!confirmProjectRef || confirmProjectRef !== config.ref) stop("confirma con --confirm-project-ref el ref exacto de SUPABASE_URL.");
  const backup = await inspectD1SchoolBackup({ directory, passphrase });
  const definitions = parseSupabaseMigrationSchema(await readFile(schemaPath, "utf8"));
  const identities = await listAuthUsers(client);
  const transformed = transformD1SchoolRows(backup.rowsByTable, identities, definitions);
  const authById = new Map(identities.map(user => [user.id, user]));
  for (const profile of transformed.rowsByTable.profiles ?? []) profile.email_verified = Boolean(authById.get(profile.id)?.email_confirmed_at);
  const objectKeys = new Set(backup.manifest.objects.map(object => object.key));
  for (const file of transformed.rowsByTable.files ?? []) {
    const key = file.object_key.replace(/^supabase:/, "");
    if (!objectKeys.has(key)) stop("public.files referencia un archivo ausente del respaldo.");
    file.object_key = storagePrefix + key;
  }
  await verifySchema(client, definitions);
  const oldProfiles = await verifyEmptyTarget(client, definitions, transformed.rowsByTable.profiles ?? []);
  const inserted = [];
  const uploaded = [];
  try {
    for (const table of definitions) {
      const rows = transformed.rowsByTable[table.name] ?? [];
      for (let offset = 0; offset < rows.length; offset += batchSize) {
        const batch = rows.slice(offset, offset + batchSize);
        inserted.push({ table, rows: batch });
        await client.request("/rest/v1/" + table.name, {
          method: "POST", headers: { "content-type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(batch), expected: [201, 204],
        });
      }
    }
    const meta = JSON.parse(await readFile(path.join(directory, "backup-meta.json"), "utf8"));
    const key = await deriveBackupKey(passphrase, Buffer.from(meta.salt, "base64"));
    for (const object of backup.manifest.objects) {
      const bytes = await readArchivedObject(directory, object, key);
      const objectKey = storagePrefix + object.key;
      uploaded.push(objectKey);
      await client.request(storagePath(objectKey), {
        method: "POST", headers: { "content-type": object.contentType ?? "application/octet-stream", "x-upsert": "false", "x-metadata": JSON.stringify(object.metadata ?? {}) },
        body: bytes, expected: [200],
      });
      const stored = await client.request(storagePath(objectKey));
      const storedBytes = Buffer.from(await stored.arrayBuffer());
      if (storedBytes.length !== object.size || sha256(storedBytes) !== object.sha256) stop("la verificación posterior de un archivo no coincide con el respaldo.");
    }
    for (const table of definitions) {
      const actual = await readAllRows(client, table);
      const expected = transformed.rowsByTable[table.name] ?? [];
      const sort = rows => rows.sort((a, b) => table.primaryKey.map(key => String(a[key] ?? "").localeCompare(String(b[key] ?? ""))).find(value => value !== 0) ?? 0);
      if (stable(sort(actual)) !== stable(sort(expected))) stop("la verificación posterior de public." + table.name + " no coincide con el respaldo.");
    }
  } catch (error) {
    const failures = await rollback(client, inserted, uploaded, oldProfiles);
    throw Error((error instanceof Error ? error.message : "falló la importación.") + (failures.length ? " La limpieza quedó incompleta; revisa el destino antes de reintentar." : " Se revirtieron los registros y archivos de esta ejecución."));
  }
  return { tables: definitions.length, rows: Object.values(transformed.rowsByTable).reduce((n, rows) => n + rows.length, 0), accounts: transformed.identityMap.size, objects: backup.counts.objects, projectRef: config.ref };
}

function parseArgs(argv) {
  const [action, directory, ...flags] = argv;
  if (action !== "import" || !directory) stop("uso: supabase:d1-import -- import <respaldo-d1> [--apply --confirm-project-ref <ref>].");
  const i = flags.indexOf("--confirm-project-ref");
  return { directory: path.resolve(directory), apply: flags.includes("--apply"), ref: i < 0 ? undefined : flags[i + 1] };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const passphrase = process.env.SCHOOL_BACKUP_PASSPHRASE;
  if (!passphrase) stop("falta SCHOOL_BACKUP_PASSPHRASE en el entorno local seguro.");
  const client = createSupabaseClient({ url: process.env.SUPABASE_URL, secret: process.env.SUPABASE_SECRET_KEY });
  if (!args.apply) {
    const snapshot = await inspectD1SchoolBackup({ directory: args.directory, passphrase });
    const identities = await listAuthUsers(client);
    const definitions = parseSupabaseMigrationSchema(await readFile(schemaPath, "utf8"));
    const transformed = transformD1SchoolRows(snapshot.rowsByTable, identities, definitions);
    await verifySchema(client, definitions);
    await verifyEmptyTarget(client, definitions, transformed.rowsByTable.profiles ?? []);
    process.stdout.write("Preflight sin escritura: " + snapshot.counts.accounts + " cuentas, " + snapshot.counts.schoolRows + " filas, " + snapshot.counts.objects + " archivos; " + transformed.identityMap.size + " identidades vinculadas.\n");
    process.stdout.write("Esquema correcto y tablas/bucket destino vacíos; la escritura requiere --apply y --confirm-project-ref.\n");
    return;
  }
  const result = await importD1SchoolBackup({ directory: args.directory, passphrase, client, confirmProjectRef: args.ref, confirmApply: true });
  process.stdout.write("Importación verificada: " + result.rows + " filas y " + result.objects + " archivos en " + result.projectRef + ".\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write((error instanceof Error ? error.message : "operación fallida.") + "\n"); process.exitCode = 1; });
}
