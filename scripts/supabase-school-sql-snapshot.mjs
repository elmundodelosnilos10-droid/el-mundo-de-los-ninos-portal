import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decryptBackupFile, deriveBackupKey, encryptBackupFile, sha256 } from './backup-crypto.mjs';
import { loadSchoolBackupTables, schemaFingerprint, stableStringify } from './supabase-school-backup.mjs';

export const SQL_SNAPSHOT_PROJECT_REF = 'gzojyxrxamydrqcxljdg';
export const SQL_SNAPSHOT_MAX_BYTES = 8 * 1024 * 1024;
// Observed and approved school Auth catalog, 2026-10-09. Catalog changes require review.
export const SQL_SNAPSHOT_AUTH_CATALOG = Object.freeze([
  'audit_log_entries', 'custom_oauth_providers', 'flow_state', 'identities', 'instances',
  'mfa_amr_claims', 'mfa_challenges', 'mfa_factors', 'mfa_recovery_code_sets', 'mfa_recovery_codes',
  'oauth_authorizations', 'oauth_client_states', 'oauth_clients', 'oauth_consents', 'one_time_tokens',
  'refresh_tokens', 'saml_providers', 'saml_relay_states', 'schema_migrations', 'scim_tokens', 'scim_users',
  'sessions', 'sso_domains', 'sso_providers', 'users', 'webauthn_challenges', 'webauthn_credentials',
]);
const archiveFormat = 'school-sql-snapshot-encrypted';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const identifier = /^[a-z_][a-z0-9_]*$/;
const fail = () => { throw Error('El snapshot no cumple el contrato escolar; no se archivó.'); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameKeys = (value, keys) => object(value) && stableStringify(Object.keys(value).sort()) === stableStringify([...keys].sort());
const equalNames = (a, b) => stableStringify([...a].sort()) === stableStringify([...b].sort());

// Only one RFC4180 record under one column. Quoted embedded CR/LF and quotes are preserved.
export function parseSnapshotCsv(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > SQL_SNAPSHOT_MAX_BYTES) fail();
  let input;
  try { input = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail(); }
  if (input.charCodeAt(0) === 0xfeff) input = input.slice(1);
  const records = [];
  let index = 0;
  while (index < input.length) {
    const record = [];
    for (;;) {
      let cell = '';
      if (input[index] === '"') {
        index += 1;
        let closed = false;
        while (index < input.length) {
          if (input[index] === '"') {
            if (input[index + 1] === '"') { cell += '"'; index += 2; }
            else { index += 1; closed = true; break; }
          } else { cell += input[index++]; }
        }
        if (!closed) fail();
      } else {
        while (index < input.length && ![',', '\r', '\n'].includes(input[index])) {
          if (input[index] === '"') fail();
          cell += input[index++];
        }
      }
      record.push(cell);
      if (record.length > 1) fail();
      if (input[index] === ',') { index += 1; continue; }
      if (input[index] === '\r') { if (input[index + 1] !== '\n') fail(); index += 2; }
      else if (input[index] === '\n') index += 1;
      else if (index !== input.length) fail();
      break;
    }
    records.push(record);
    if (records.length > 2) fail();
  }
  if (records.length !== 2 || records[0][0] !== 'snapshot' || !records[1][0]) fail();
  return Buffer.from(records[1][0], 'utf8');
}

export function validateSqlSnapshot(jsonBytes, tables) {
  let snapshot;
  try { snapshot = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes)); } catch { fail(); }
  if (!object(snapshot) || snapshot.format !== 'school-sql-snapshot' || snapshot.version !== 1 || snapshot.project_ref !== SQL_SNAPSHOT_PROJECT_REF) fail();
  if (typeof snapshot.captured_at !== 'string' || !/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d(?::?\d\d)?)$/.test(snapshot.captured_at) || !Number.isFinite(Date.parse(snapshot.captured_at))) fail();
  if (typeof snapshot.postgres_version !== 'string' || !snapshot.postgres_version.trim()) fail();
  const publicNames = tables.map(table => table.name);
  if (tables.length !== 33 || !Array.isArray(snapshot.public_catalog) || !equalNames(snapshot.public_catalog, publicNames)) fail();
  const authNames = snapshot.auth_catalog;
  if (!Array.isArray(authNames) || !equalNames(authNames, SQL_SNAPSHOT_AUTH_CATALOG) || new Set(authNames).size !== authNames.length || authNames.some(name => typeof name !== 'string' || !identifier.test(name)) || !['users', 'identities', 'schema_migrations'].every(name => authNames.includes(name))) fail();
  if (!sameKeys(snapshot.public_rows, publicNames) || !sameKeys(snapshot.auth_rows, authNames)) fail();
  if (!Array.isArray(snapshot.columns) || snapshot.columns.length === 0) fail();
  const columns = new Map();
  for (const column of snapshot.columns) {
    if (!object(column) || !['public', 'auth'].includes(column.table_schema) || typeof column.table_name !== 'string' || typeof column.column_name !== 'string' || !identifier.test(column.column_name) || !Number.isInteger(column.ordinal_position) || column.ordinal_position < 1) fail();
    const names = column.table_schema === 'public' ? publicNames : authNames;
    if (!names.includes(column.table_name)) fail();
    const key = `${column.table_schema}.${column.table_name}`;
    const items = columns.get(key) ?? [];
    if (items.some(item => item.column_name === column.column_name || item.ordinal_position === column.ordinal_position)) fail();
    items.push(column); columns.set(key, items);
  }
  const counts = { public: {}, auth: {} };
  const parsedAuth = {};
  for (const [schema, names] of [['public', publicNames], ['auth', authNames]]) {
    for (const name of names) {
      const declared = columns.get(`${schema}.${name}`);
      if (!declared?.length) fail();
      declared.sort((a, b) => a.ordinal_position - b.ordinal_position);
      // Dropped columns leave legitimate ordinal gaps; names must still match exactly.
      const columnNames = declared.map(column => column.column_name);
      if (schema === 'public' && !equalNames(columnNames, tables.find(table => table.name === name).columns)) fail();
      const rows = snapshot[`${schema}_rows`][name];
      if (!Array.isArray(rows)) fail();
      const seen = new Set();
      const parsed = [];
      for (const text of rows) {
        if (typeof text !== 'string' || text.length === 0 || seen.has(text)) fail();
        seen.add(text);
        let row;
        try { row = JSON.parse(text); } catch { fail(); }
        if (!sameKeys(row, columnNames)) fail();
        if (schema === 'public') {
          const table = tables.find(table => table.name === name);
          const primary = stableStringify(table.primaryKey.map(key => row[key]));
          if (table.primaryKey.some(key => row[key] === null || row[key] === undefined) || seen.has(`pk:${primary}`)) fail();
          seen.add(`pk:${primary}`);
        }
        parsed.push(row);
      }
      counts[schema][name] = rows.length;
      if (schema === 'auth' && ['users', 'identities'].includes(name)) parsedAuth[name] = parsed;
    }
  }
  // Current school export deliberately excludes student records and stored files.
  if (snapshot.students_count !== 0 || counts.public.students !== 0 || snapshot.school_file_object_count !== 0 || counts.public.files !== 0) fail();
  if (!Array.isArray(snapshot.storage_buckets) || snapshot.storage_buckets.length !== 1) fail();
  const bucket = snapshot.storage_buckets[0];
  if (!object(bucket) || bucket.id !== 'school-files' || bucket.name !== 'school-files' || bucket.public !== false) fail();
  const userIds = new Set();
  for (const user of parsedAuth.users) {
    if (typeof user.id !== 'string' || !uuid.test(user.id) || userIds.has(user.id) || typeof user.encrypted_password !== 'string' || (user.encrypted_password !== '' && !/^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/.test(user.encrypted_password))) fail();
    userIds.add(user.id);
  }
  const identityIds = new Set();
  for (const identity of parsedAuth.identities) {
    if (typeof identity.id !== 'string' || !uuid.test(identity.id) || identityIds.has(identity.id) || typeof identity.user_id !== 'string' || !userIds.has(identity.user_id) || typeof identity.provider !== 'string' || !identity.provider || typeof identity.provider_id !== 'string' || !identity.provider_id) fail();
    identityIds.add(identity.id);
  }
  // These arrays are part of the encrypted snapshot, including managed Auth metadata.
  for (const field of ['constraints', 'indexes', 'triggers', 'functions', 'policies', 'table_acl', 'migration_history', 'enums', 'sequences']) {
    if (!(field in snapshot) || (snapshot[field] !== null && (!Array.isArray(snapshot[field]) || snapshot[field].some(item => !object(item))))) fail();
  }
  return { publicTables: publicNames.length, authTables: authNames.length, publicRows: Object.values(counts.public).reduce((a, b) => a + b, 0), authRows: Object.values(counts.auth).reduce((a, b) => a + b, 0), authUsers: counts.auth.users, authIdentities: counts.auth.identities, students: 0, objects: 0, tableCounts: counts, schemaSha256: schemaFingerprint(tables) };
}

async function privateRead(file, maxBytes) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw Error('Usa rutas absolutas privadas.');
  let handle;
  try {
    const before = await lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o777) !== 0o600 || before.uid !== process.getuid() || before.size < 1 || before.size > maxBytes) throw Error();
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const actual = await handle.stat();
    if (actual.ino !== before.ino || actual.dev !== before.dev || actual.size !== before.size) throw Error();
    const bytes = await handle.readFile();
    if (bytes.length !== before.size) throw Error();
    return bytes;
  } catch { throw Error('No se pudo leer el archivo privado autorizado.'); }
  finally { await handle?.close(); }
}

async function phraseFromFile(file) {
  const bytes = await privateRead(file, 4096);
  try {
    const phrase = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r?\n$/, '');
    if (phrase.length < 20 || phrase.includes('\n') || phrase.includes('\r')) throw Error();
    return phrase;
  } catch { throw Error('La frase privada de respaldo no es válida.'); }
  finally { bytes.fill(0); }
}

export async function archiveSqlSnapshot({ csvFile, directory, passphraseFile }) {
  if (!path.isAbsolute(directory) || path.resolve(directory) === path.resolve(csvFile) || path.resolve(csvFile) === path.resolve(passphraseFile)) throw Error('Las rutas de operación deben ser distintas y absolutas.');
  const source = await privateRead(csvFile, SQL_SNAPSHOT_MAX_BYTES);
  const jsonBytes = parseSnapshotCsv(source);
  const tables = await loadSchoolBackupTables();
  const counts = validateSqlSnapshot(jsonBytes, tables);
  const phrase = await phraseFromFile(passphraseFile);
  const salt = randomBytes(16);
  const key = await deriveBackupKey(phrase, salt);
  try {
    await mkdir(directory, { mode: 0o700, recursive: false });
    await chmod(directory, 0o700);
    const actualDirectory = await realpath(directory);
    const phrasePath = await realpath(passphraseFile);
    const csvPath = await realpath(csvFile);
    if ([phrasePath, csvPath].some(file => file.startsWith(`${actualDirectory}${path.sep}`))) throw Error('La frase y el CSV deben quedar fuera del archivo cifrado.');
    const manifest = { format: archiveFormat, version: 1, projectRef: SQL_SNAPSHOT_PROJECT_REF, captureMethod: 'operator-sql-editor-single-mvcc-select', restored: false, cliDump: false, csvSha256: sha256(source), jsonSha256: sha256(jsonBytes), csvBytes: source.length, jsonBytes: jsonBytes.length, ...counts };
    const meta = { format: archiveFormat, version: 1, cipher: 'aes-256-gcm', kdf: 'scrypt-N32768-r8-p1', salt: salt.toString('base64') };
    await writeFile(path.join(directory, 'backup-meta.json'), JSON.stringify(meta), { mode: 0o600, flag: 'wx' });
    await writeFile(path.join(directory, 'snapshot.csv.enc'), encryptBackupFile(source, key, `${archiveFormat}:1:snapshot.csv.enc`), { mode: 0o600, flag: 'wx' });
    await writeFile(path.join(directory, 'manifest.enc'), encryptBackupFile(Buffer.from(JSON.stringify(manifest)), key, `${archiveFormat}:1:manifest.enc`), { mode: 0o600, flag: 'wx' });
    const verified = await verifySqlSnapshot({ directory, passphraseFile, expectedCsvFile: csvFile });
    return verified;
  } finally { key.fill(0); source.fill(0); jsonBytes.fill(0); }
}

export async function verifySqlSnapshot({ directory, passphraseFile, expectedCsvFile }) {
  if (!path.isAbsolute(directory) || !path.isAbsolute(passphraseFile)) throw Error('Usa rutas absolutas privadas.');
  let key; let plain; let manifestBytes; let jsonBytes;
  try {
    const archive = await lstat(directory);
    if (!archive.isDirectory() || archive.isSymbolicLink() || archive.uid !== process.getuid() || (archive.mode & 0o777) !== 0o700) throw Error();
    const actualDirectory = await realpath(directory);
    const phrasePath = await realpath(passphraseFile);
    if (phrasePath.startsWith(`${actualDirectory}${path.sep}`)) throw Error();
    const meta = JSON.parse((await privateRead(path.join(directory, 'backup-meta.json'), 4096)).toString('utf8'));
    if (meta.format !== archiveFormat || meta.version !== 1 || meta.cipher !== 'aes-256-gcm' || meta.kdf !== 'scrypt-N32768-r8-p1' || typeof meta.salt !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(meta.salt)) throw Error();
    key = await deriveBackupKey(await phraseFromFile(passphraseFile), Buffer.from(meta.salt, 'base64'));
    plain = decryptBackupFile(await privateRead(path.join(directory, 'snapshot.csv.enc'), SQL_SNAPSHOT_MAX_BYTES + 28), key, `${archiveFormat}:1:snapshot.csv.enc`);
    manifestBytes = decryptBackupFile(await privateRead(path.join(directory, 'manifest.enc'), 65536), key, `${archiveFormat}:1:manifest.enc`);
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    jsonBytes = parseSnapshotCsv(plain);
    const counts = validateSqlSnapshot(jsonBytes, await loadSchoolBackupTables());
    const expected = { format: archiveFormat, version: 1, projectRef: SQL_SNAPSHOT_PROJECT_REF, captureMethod: 'operator-sql-editor-single-mvcc-select', restored: false, cliDump: false, csvSha256: sha256(plain), jsonSha256: sha256(jsonBytes), csvBytes: plain.length, jsonBytes: jsonBytes.length, ...counts };
    if (stableStringify(manifest) !== stableStringify(expected)) throw Error();
    if (expectedCsvFile) {
      const original = await privateRead(expectedCsvFile, SQL_SNAPSHOT_MAX_BYTES);
      try { if (!plain.equals(original)) throw Error(); } finally { original.fill(0); }
    }
    // Counts only; no row data, names, hashes or credentials leave this API.
    const summary = { ...counts };
    delete summary.tableCounts; delete summary.schemaSha256;
    return { ...summary, encrypted: true, offlineVerified: true, sourceByteExactCompared: Boolean(expectedCsvFile), restored: false, cliDump: false };
  } catch { throw Error('No se verificó la integridad del snapshot cifrado.'); }
  finally { key?.fill(0); plain?.fill(0); manifestBytes?.fill(0); jsonBytes?.fill(0); }
}

export function parseSqlSnapshotArgs(args) {
  if (args.length === 4 && args[0] === 'archive') return { mode: 'archive', csvFile: args[1], directory: args[2], passphraseFile: args[3] };
  if ((args.length === 3 || args.length === 4) && args[0] === 'verify') return { mode: 'verify', directory: args[1], passphraseFile: args[2], expectedCsvFile: args[3] };
  throw Error('Uso: archive CSV_ABSOLUTO DIRECTORIO_NUEVO FRASE_PRIVADA | verify DIRECTORIO FRASE_PRIVADA [CSV_ORIGINAL]');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseSqlSnapshotArgs(process.argv.slice(2));
    const result = args.mode === 'archive' ? await archiveSqlSnapshot(args) : await verifySqlSnapshot(args);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch { process.stderr.write('La operación offline no terminó; conserva los archivos para revisión privada.\n'); process.exitCode = 1; }
}
