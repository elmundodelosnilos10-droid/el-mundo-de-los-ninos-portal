/** Restricted local row recovery. Managed schema/roles/functions are installed separately.
 * No CLI, connections on import, network providers, or automatic replay/cleanup.
 * Sequence RESTART is transactional and conservative; is_called was not captured.
 */
import postgres from 'postgres';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { decryptBackupFile, deriveBackupKey } from './backup-crypto.mjs';
import { loadSchoolBackupTables, stableStringify } from './supabase-school-backup.mjs';
import { parseSnapshotCsv, SQL_SNAPSHOT_AUTH_CATALOG, SQL_SNAPSHOT_MAX_BYTES, validateSqlSnapshot, verifySqlSnapshot } from './supabase-school-sql-snapshot.mjs';

const namePattern = /^[a-z_][a-z0-9_]*$/;
const stackPattern = /^[a-f0-9]{64}$/;
const authorizedSql = new WeakSet();
const preservedStackIds = [
  '5c72773b1c0e8d61f4a753957fb44b41e62fcd74a28e9f8dae2e76d295f606fe',
  'f2bd8563efba25e7d7846cceacb670b5ab8238cfb82aab83989d0c8942e6ddea',
  '43be37093685ac0f8f641bc73286491e6c787473e4509c3c50707e0382dec0b5',
  'b3d3e0092368d7ea407ad49b91cfbe896748c0bb8720d634a53609637cf896b6',
];
class RestoreError extends Error {
  constructor(code) { super('La recuperación local no cumplió una condición de seguridad o integridad.'); this.code = code; }
}
const fail = code => { throw new RestoreError(code); };
const identifier = name => { if (typeof name !== 'string' || !namePattern.test(name)) fail('invalid_identifier'); return `"${name}"`; };
const relation = (schema, table) => `${identifier(schema)}.${identifier(table)}`;
const equal = (left, right) => stableStringify(left) === stableStringify(right);
function sqlLocalOptions(sql) {
  if (!sql || typeof sql.begin !== 'function' || typeof sql.unsafe !== 'function') fail('invalid_sql_adapter');
  const options = sql.options;
  const hosts = typeof options?.host === 'string' ? [options.host] : options?.host;
  const ports = Array.isArray(options?.port) ? options.port : [options?.port];
  if (ports.length !== 1 || !Array.isArray(hosts) || hosts.length !== 1 || !['127.0.0.1', '::1'].includes(hosts[0]) || !namePattern.test(options.user ?? options.username ?? '') || options.database !== 'postgres' || !Number.isInteger(Number(ports[0])) || Number(ports[0]) < 1 || Number(ports[0]) > 65535 || options.ssl) fail('local_database_required');
}
async function privateBytes(file, limit) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) fail('private_path_required');
  let handle;
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600 || stat.size < 1 || stat.size > limit) fail('private_file_required');
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const actual = await handle.stat();
    if (actual.ino !== stat.ino || actual.dev !== stat.dev || actual.size !== stat.size) fail('private_file_changed');
    const bytes = await handle.readFile();
    if (bytes.length !== stat.size) fail('private_file_changed');
    return bytes;
  } catch { fail('private_file_unreadable'); }
  finally { await handle?.close(); }
}

export function validateSnapshotNativeTarget({ receipt, state, expectedStackId, projectDirectory, excludedStackIds = [] }) {
  if (!stackPattern.test(expectedStackId ?? '') || [...preservedStackIds,...excludedStackIds].includes(expectedStackId) || receipt?.id !== expectedStackId || state?.runtime !== 'native' || state?.identity?.projectRoot !== projectDirectory || typeof projectDirectory !== 'string' || !(/^\/(?:private\/)?tmp\/school-isolated-runtime-[^/]+\/[^/]+$/.test(projectDirectory) || /^\/(?:private\/)?tmp\/school-auth-schema-compat-20261009\/project$/.test(projectDirectory))) fail('native_target_identity_failed');
  let database; let api;
  try { database = new URL(receipt.env.DB_URL); api = new URL(receipt.endpoints['rest.http'].url); } catch { fail('native_target_endpoints_failed'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !['127.0.0.1', '[::1]'].includes(database.hostname) || !database.port || database.username !== 'postgres' || database.pathname !== '/postgres' || !database.password || database.search || database.hash || api.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(api.hostname) || !api.port || api.username || api.password || api.search || api.hash || api.pathname !== '/') fail('native_target_endpoints_failed');
  for (const key of ['auth.http', 'storage.http']) {
    let url; try { url = new URL(receipt.endpoints[key].url); } catch { fail('native_target_endpoints_failed'); }
    if (url.origin !== api.origin || url.username || url.password || url.search || url.hash) fail('native_target_endpoints_failed');
  }
  const pgmeta = state.instances?.filter(instance => instance.creation?.service === 'pgmeta');
  if (!Array.isArray(pgmeta) || pgmeta.length !== 1) fail('native_superuser_configuration_required');
  let owner;
  try { owner = new URL(pgmeta[0].creation.config.databaseUrl); } catch { fail('native_superuser_configuration_required'); }
  if (!['postgres:', 'postgresql:'].includes(owner.protocol) || owner.hostname !== database.hostname || owner.port !== database.port || owner.pathname !== '/postgres' || !namePattern.test(owner.username) || !owner.password || owner.search || owner.hash) fail('native_superuser_configuration_required');
  return { host: database.hostname.replace(/^\[|\]$/g, ''), port: Number(database.port), username: owner.username, password: decodeURIComponent(owner.password) };
}

/** Explicit private receipt and official state file establish ownership before connecting. */
export async function openSchoolSnapshotLocalDatabase({ receiptFile, stateFile, expectedStackId, projectDirectory, excludedStackIds = [] }) {
  let receipt; let state;
  try {
    const receiptStat = await lstat(receiptFile);
    if (Date.now() - receiptStat.mtimeMs > 15 * 60_000 || receiptStat.mtimeMs > Date.now() + 1000) fail('fresh_native_receipt_required');
    if (path.basename(path.dirname(stateFile)) !== expectedStackId || path.basename(stateFile) !== 'state.json') fail('official_state_path_required');
    const actualProject = await realpath(projectDirectory);
    receipt = JSON.parse((await privateBytes(receiptFile, 65536)).toString('utf8'));
    state = JSON.parse((await privateBytes(stateFile, 65536)).toString('utf8'));
    const connection = validateSnapshotNativeTarget({ receipt, state, expectedStackId, projectDirectory: actualProject, excludedStackIds });
    const sql = postgres({ ...connection, database: 'postgres', ssl: false, max: 1, connect_timeout: 5, onnotice: () => {} });
    sqlLocalOptions(sql); authorizedSql.add(sql); return sql;
  } catch (error) { if (error instanceof RestoreError) throw error; fail('native_target_configuration_failed'); }
}

/** Archive integrity is verified first; decrypted data remains in RAM only. Caller wipes raw bytes. */
export async function readSchoolSqlSnapshotArchive({ directory, passphraseFile }) {
  await verifySqlSnapshot({ directory, passphraseFile });
  const phraseBytes = await privateBytes(passphraseFile, 4096);
  let key; let plain;
  try {
    const phrase = new TextDecoder('utf-8', { fatal: true }).decode(phraseBytes).replace(/\r?\n$/, '');
    const meta = JSON.parse((await privateBytes(path.join(directory, 'backup-meta.json'), 4096)).toString('utf8'));
    key = await deriveBackupKey(phrase, Buffer.from(meta.salt, 'base64'));
    plain = decryptBackupFile(await privateBytes(path.join(directory, 'snapshot.csv.enc'), SQL_SNAPSHOT_MAX_BYTES + 28), key, 'school-sql-snapshot-encrypted:1:snapshot.csv.enc');
    const rawSnapshotJson = parseSnapshotCsv(plain);
    validateSqlSnapshot(rawSnapshotJson, await loadSchoolBackupTables());
    return { snapshot: JSON.parse(rawSnapshotJson.toString('utf8')), rawSnapshotJson };
  } catch { fail('snapshot_archive_read_failed'); }
  finally { key?.fill(0); plain?.fill(0); phraseBytes.fill(0); }
}

function snapshotInput(snapshot, rawSnapshotJsonText, tables) {
  let raw;
  try {
    if (rawSnapshotJsonText !== undefined) raw = Buffer.isBuffer(rawSnapshotJsonText) ? rawSnapshotJsonText.toString('utf8') : rawSnapshotJsonText;
    else if (typeof snapshot === 'string' || Buffer.isBuffer(snapshot)) raw = snapshot.toString();
    else {
      for (const sequence of snapshot.sequences ?? []) for (const value of Object.values(sequence)) if (typeof value === 'number' && !Number.isSafeInteger(value)) fail('raw_sequence_precision_required');
      raw = JSON.stringify(snapshot);
    }
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > SQL_SNAPSHOT_MAX_BYTES) fail('invalid_snapshot_input');
    const summary = validateSqlSnapshot(Buffer.from(raw), tables);
    const parsed = JSON.parse(raw);
    if (rawSnapshotJsonText !== undefined && snapshot && !equal(parsed, snapshot)) fail('snapshot_raw_mismatch');
    if (summary.authUsers !== 1 || summary.students !== 0 || summary.objects !== 0 || parsed.auth_rows.schema_migrations.length !== 82) fail('current_school_snapshot_scope_required');
    return { raw, parsed, summary };
  } catch (error) { if (error instanceof RestoreError) throw error; fail('snapshot_validation_failed'); }
}
export function conservativeSequenceRestart({ lastValue, increment, minValue, maxValue, maximumId }) {
  for (const value of [lastValue, increment, minValue, maxValue, maximumId]) if (typeof value !== 'string' || !/^-?\d+$/.test(value)) fail('invalid_sequence_numeric_text');
  const high = BigInt(lastValue), step = BigInt(increment), min = BigInt(minValue), max = BigInt(maxValue), observed = BigInt(maximumId);
  if (step <= 0n || high < observed || high < min || high > max || high + step > max) fail('sequence_highwater_invalid');
  return (high + step).toString();
}

async function rowsFromSource(tx, rows) {
  return tx.unsafe('SELECT value AS raw_row, value::jsonb::text AS row_text FROM jsonb_array_elements_text($1::text::jsonb) ORDER BY row_text', [JSON.stringify(rows)]);
}
async function targetRows(tx, schema, name) {
  return tx.unsafe(`SELECT row_to_json(t)::jsonb::text AS row_text FROM ${relation(schema, name)} t ORDER BY row_text`);
}
async function sourceMetadata(tx, raw, field) {
  return tx.unsafe(`SELECT value::text AS row_text FROM jsonb_array_elements(COALESCE(NULLIF($1::text::jsonb->'${field}', 'null'::jsonb),'[]'::jsonb)) ORDER BY row_text`, [raw]);
}
const textRows = rows => rows.map(row => row.row_text);

// Exact v1 shapes, deliberately matching the capture generator. No definitions are executed.
const metadataQueries = Object.freeze({
  constraints: "SELECT jsonb_build_object('schema',n.nspname,'table',cl.relname,'name',c.conname,'kind',c.contype,'definition',pg_get_constraintdef(c.oid))::text AS row_text FROM pg_constraint c JOIN pg_class cl ON cl.oid=c.conrelid JOIN pg_namespace n ON n.oid=cl.relnamespace WHERE n.nspname='public' ORDER BY row_text",
  indexes: "SELECT to_jsonb(i)::text AS row_text FROM pg_indexes i WHERE schemaname='public' ORDER BY row_text",
  triggers: "SELECT jsonb_build_object('schema',n.nspname,'table',cl.relname,'name',t.tgname,'definition',pg_get_triggerdef(t.oid))::text AS row_text FROM pg_trigger t JOIN pg_class cl ON cl.oid=t.tgrelid JOIN pg_namespace n ON n.oid=cl.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY row_text",
  functions: "SELECT jsonb_build_object('name',p.proname,'definition',pg_get_functiondef(p.oid))::text AS row_text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' ORDER BY row_text",
  policies: "SELECT to_jsonb(p)::text AS row_text FROM pg_policies p WHERE schemaname='public' ORDER BY row_text",
  table_acl: "SELECT jsonb_build_object('schema',n.nspname,'table',cl.relname,'owner',pg_get_userbyid(cl.relowner),'acl',ARRAY(SELECT item::text FROM unnest(COALESCE(cl.relacl,acldefault('r',cl.relowner))) item ORDER BY item::text),'rls',cl.relrowsecurity,'force_rls',cl.relforcerowsecurity)::text AS row_text FROM pg_class cl JOIN pg_namespace n ON n.oid=cl.relnamespace WHERE n.nspname='public' AND cl.relkind='r' ORDER BY row_text",
  enums: "SELECT jsonb_build_object('schema',n.nspname,'type',t.typname,'sort_order',e.enumsortorder,'label',e.enumlabel)::text AS row_text FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' ORDER BY row_text",
});
const scopeKey = field => ['indexes','policies'].includes(field) ? 'schemaname' : 'schema';
function validatePublicMetadataCoverage(parsed, tables) {
  const publicRows = {};
  for (const field of Object.keys(metadataQueries)) {
    const captured = parsed[field];
    if (field !== 'enums' && (!Array.isArray(captured) || captured.length === 0)) fail(`metadata_capture_missing_${field}`);
    publicRows[field] = (captured ?? []).filter(row => field === 'functions' || row[scopeKey(field)] === 'public');
    if (field !== 'enums' && publicRows[field].length === 0) fail(`metadata_public_missing_${field}`);
  }
  const tableNames = tables.map(table=>table.name).sort();
  if (!equal(publicRows.table_acl.map(row=>row.table).sort(),tableNames) || publicRows.table_acl.some(row=>typeof row.owner !== 'string' || !row.owner || (row.acl !== null && typeof row.acl !== 'string') || typeof row.rls !== 'boolean' || typeof row.force_rls !== 'boolean')) fail('metadata_table_acl_coverage');
  for (const table of tables) {
    if (!publicRows.constraints.some(row=>row.table === table.name && row.kind === 'p' && typeof row.definition === 'string' && row.definition)) fail('metadata_primary_key_coverage');
    if (!publicRows.indexes.some(row=>row.tablename === table.name && typeof row.indexdef === 'string' && row.indexdef)) fail('metadata_index_coverage');
  }
  if (publicRows.functions.some(row=>typeof row.name !== 'string' || !namePattern.test(row.name) || typeof row.definition !== 'string' || !row.definition)) fail('metadata_function_definition_missing');
  return publicRows;
}
async function scopedSourceMetadata(tx,raw,field,scope) {
  if (field === 'table_acl' && scope === 'public') {
    // ACL item order is immaterial. NULL is the PostgreSQL owner/default ACL, not no privileges.
    return tx.unsafe("SELECT (value || jsonb_build_object('acl',ARRAY(SELECT item::text FROM unnest(COALESCE((value->>'acl')::aclitem[],acldefault('r',r.oid))) item ORDER BY item::text)))::text AS row_text FROM jsonb_array_elements($1::text::jsonb->'table_acl') value LEFT JOIN pg_roles r ON r.rolname=value->>'owner' WHERE value->>'schema'='public' ORDER BY row_text",[raw]);
  }
  const condition = field === 'functions' ? '' : ` WHERE value->>'${scopeKey(field)}'='${scope}'`;
  return tx.unsafe(`SELECT value::text AS row_text FROM jsonb_array_elements(COALESCE(NULLIF($1::text::jsonb->'${field}','null'::jsonb),'[]'::jsonb))${condition} ORDER BY row_text`,[raw]);
}
async function capturedMetadataParity(tx,input,tables) {
  const sourcePublic = validatePublicMetadataCoverage(input.parsed,tables);
  const components = {};
  for (const [field,query] of Object.entries(metadataQueries)) {
    const expected = await scopedSourceMetadata(tx,input.raw,field,'public');
    const target = await tx.unsafe(query);
    if (!equal(textRows(expected),textRows(target))) fail(`metadata_public_mismatch_${field}`);
    components[field] = { count:expected.length, parity:'matching', sourceCapture: input.parsed[field] === null ? 'declared_null_empty' : sourcePublic[field].length === 0 ? 'declared_empty_public_scope' : 'present' };
  }
  // Managed Storage differences are reported separately, never "fixed" by broadening permissions.
  const managedStorage = {};
  for (const field of ['triggers','policies','table_acl']) {
    const expected = await scopedSourceMetadata(tx,input.raw,field,'storage');
    let query = metadataQueries[field].replace(/'public'/g,"'storage'");
    if (field === 'table_acl') query = "SELECT jsonb_build_object('schema',n.nspname,'table',cl.relname,'owner',pg_get_userbyid(cl.relowner),'acl',cl.relacl::text,'rls',cl.relrowsecurity,'force_rls',cl.relforcerowsecurity)::text AS row_text FROM pg_class cl JOIN pg_namespace n ON n.oid=cl.relnamespace WHERE n.nspname='storage' AND cl.relkind='r' ORDER BY row_text";
    const target = await tx.unsafe(query);
    managedStorage[field] = {sourceCount:expected.length,targetCount:target.length,parity: input.parsed[field] === null ? 'not_captured' : equal(textRows(expected),textRows(target)) ? 'matching' : 'different'};
  }
  return { scope:'public-captured-v1', components, publicCapturedMetadataVerified:true, managedStorage:{scope:'captured-definitions-policies-table-acl-only',components:managedStorage,permissionChangesPerformed:false,managedServiceEquivalenceVerified:false}, uncaptured:['function_acl','event_trigger_registrations','trigger_enabled_state','managed_service_configuration'], managedAuthMetadataVerified:false, realtimeServiceMetadataVerified:false };
}

/** Read-only preflight also accepts an already occupied preserved local recovery target.
 * It never imports data, executes captured DDL, advances sequences, or expands grants.
 */
export async function preflightSchoolSnapshotMetadata({snapshot,rawSnapshotJsonText,sql,tables}) {
  sqlLocalOptions(sql);
  if (!authorizedSql.has(sql)) fail('official_native_target_authorization_required');
  const input = snapshotInput(snapshot,rawSnapshotJsonText,tables);
  try {
    return await sql.begin(async tx=>{
      await tx.unsafe('SET TRANSACTION READ ONLY');
      await tx.unsafe('SET LOCAL search_path = public');
      await tx.unsafe("SET LOCAL statement_timeout = '60s'");
      return capturedMetadataParity(tx,input,tables);
    });
  } catch(error) {
    const failure = error instanceof RestoreError ? error : new RestoreError('metadata_preflight_failed');
    failure.phase = 'captured_metadata_preflight';
    if (!(error instanceof RestoreError) && typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)) failure.sqlState = error.code;
    throw failure;
  }
}

/** Only a database returned by openSchoolSnapshotLocalDatabase is accepted.
 * Any failure rolls back inserts and sequence RESTART; schemas and grants are never created here.
 */
export async function restoreSchoolSnapshotRows({ snapshot, rawSnapshotJsonText, sql, tables }) {
  sqlLocalOptions(sql);
  if (!authorizedSql.has(sql)) fail('official_native_target_authorization_required');
  const input = snapshotInput(snapshot, rawSnapshotJsonText, tables);
  let phase = 'transaction_start';
  try {
    return await sql.begin(async tx => {
      phase = 'owner_permission';
      const [ownerRole] = await tx.unsafe('SELECT r.rolsuper FROM pg_roles r WHERE r.rolname=current_user');
      if (ownerRole?.rolsuper !== true) fail('native_superuser_required');
      phase = 'transaction_settings';
      await tx.unsafe("SET LOCAL search_path = public");
      await tx.unsafe("SET LOCAL TIME ZONE 'UTC'");
      await tx.unsafe("SET LOCAL lock_timeout = '5s'");
      await tx.unsafe("SET LOCAL statement_timeout = '60s'");
      await tx.unsafe("SET LOCAL idle_in_transaction_session_timeout = '60s'");
      const names = [['public', tables.map(table => table.name)], ['auth', SQL_SNAPSHOT_AUTH_CATALOG]];
      const expectedRelations = names.flatMap(([schema, list]) => list.map(name => `${schema}.${name}`)).sort();
      phase = 'target_catalog';
      const catalog = await tx.unsafe("SELECT n.nspname||'.'||c.relname AS relation_name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth') AND c.relkind IN ('r','p') ORDER BY relation_name");
      if (!equal(catalog.map(row => row.relation_name).sort(), expectedRelations)) fail('target_catalog_mismatch');
      await tx.unsafe(`LOCK TABLE ${names.flatMap(([schema, list]) => list.map(name => relation(schema, name))).join(',')} IN ACCESS EXCLUSIVE MODE`);
      phase = 'target_columns';
      const sourceColumns = await sourceMetadata(tx, input.raw, 'columns');
      const targetColumns = await tx.unsafe("SELECT to_jsonb(c)::text AS row_text FROM information_schema.columns c WHERE c.table_schema IN ('public','auth') ORDER BY row_text");
      if (!equal(textRows(sourceColumns), textRows(targetColumns))) fail('target_columns_mismatch');
      const generated = await tx.unsafe("SELECT table_schema,table_name,column_name FROM information_schema.columns WHERE table_schema IN ('public','auth') AND (is_generated='ALWAYS' OR identity_generation='ALWAYS')");
      const unsafeTriggers = await tx.unsafe("SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth') AND NOT t.tgisinternal AND t.tgenabled IN ('A','R') LIMIT 1");
      if (unsafeTriggers.length) fail('replica_or_always_trigger_not_supported');
      phase = 'captured_metadata_preflight';
      const metadataParity = await capturedMetadataParity(tx,input,tables);
      phase = 'target_storage';
      const [objectCount] = await tx.unsafe("SELECT count(*)::text AS object_count FROM storage.objects WHERE bucket_id='school-files'");
      const buckets = await tx.unsafe("SELECT id,name,public FROM storage.buckets WHERE id='school-files'");
      if (objectCount?.object_count !== '0' || buckets.length !== 1 || buckets[0].name !== 'school-files' || buckets[0].public !== false) fail('target_storage_not_empty_private');
      phase = 'target_existing_rows';
      const pending = [];
      for (const [schema, list] of names) for (const name of list) {
        const source = await rowsFromSource(tx, input.parsed[`${schema}_rows`][name]);
        const current = await targetRows(tx, schema, name);
        if (schema === 'auth' && name === 'schema_migrations') {
          if (source.length !== 82 || !equal(textRows(current), textRows(source))) fail('auth_schema_migrations_mismatch');
          continue;
        }
        if (schema === 'auth' && current.length) fail('target_auth_not_empty');
        const sourceMap = new Map(source.map(row => [row.row_text, row.raw_row]));
        if (sourceMap.size !== source.length || current.some(row => !sourceMap.has(row.row_text))) fail('target_rows_not_exact_source_subset');
        for (const row of current) sourceMap.delete(row.row_text);
        const excluded = new Set(generated.filter(column => column.table_schema === schema && column.table_name === name).map(column => column.column_name));
        const columns = input.parsed.columns.filter(column => column.table_schema === schema && column.table_name === name).sort((a,b) => a.ordinal_position-b.ordinal_position).map(column => column.column_name).filter(column => !excluded.has(column));
        if (!columns.length && sourceMap.size) fail('no_insertable_columns');
        pending.push({ schema, name, columns, rows: [...sourceMap.values()] });
      }
      // Disables origin Auth/profile and FK triggers only within this transaction.
      phase = 'row_insertion';
      await tx.unsafe("SET LOCAL session_replication_role = 'replica'");
      for (const table of pending) for (const row of table.rows) {
        const columns = table.columns.map(identifier).join(',');
        await tx.unsafe(`INSERT INTO ${relation(table.schema, table.name)} (${columns}) SELECT ${table.columns.map(column => `r.${identifier(column)}`).join(',')} FROM jsonb_populate_record(NULL::${relation(table.schema, table.name)}, $1::text::jsonb) r`, [row]);
      }
      phase = 'foreign_key_catalog';
      const fks = await tx.unsafe("SELECT c.conname,c.confmatchtype AS conmatchtype,n.nspname AS child_schema,t.relname AS child_table,pn.nspname AS parent_schema,pt.relname AS parent_table,ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord) AS child_columns,ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum ORDER BY k.ord) AS parent_columns FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_class pt ON pt.oid=c.confrelid JOIN pg_namespace pn ON pn.oid=pt.relnamespace WHERE c.contype='f' AND n.nspname IN ('public','auth') ORDER BY n.nspname,t.relname,c.conname");
      phase = 'foreign_key_validation';
      for (const fk of fks) {
        if (!['s','f'].includes(fk.conmatchtype) || !Array.isArray(fk.child_columns) || fk.child_columns.length === 0 || fk.child_columns.length !== fk.parent_columns?.length) fail('unsupported_foreign_key');
        const nulls = fk.child_columns.map(column => `c.${identifier(column)} IS NULL`);
        const nonnulls = fk.child_columns.map(column => `c.${identifier(column)} IS NOT NULL`);
        const join = fk.child_columns.map((column,index) => `p.${identifier(fk.parent_columns[index])}=c.${identifier(column)}`).join(' AND ');
        const orphan = `((${nonnulls.join(' AND ')}) AND NOT EXISTS (SELECT 1 FROM ${relation(fk.parent_schema,fk.parent_table)} p WHERE ${join}))`;
        const mixed = fk.conmatchtype === 'f' ? `((${nulls.join(' OR ')}) AND (${nonnulls.join(' OR ')})) OR ` : '';
        const invalid = await tx.unsafe(`SELECT 1 FROM ${relation(fk.child_schema,fk.child_table)} c WHERE ${mixed}${orphan} LIMIT 1`);
        if (invalid.length) fail('foreign_key_validation_failed');
      }
      phase = 'sequence_catalog';
      const sequenceRows = await tx.unsafe("SELECT s.schemaname,s.sequencename,s.data_type,s.start_value::text,s.min_value::text,s.max_value::text,s.increment_by::text,s.cycle,s.cache_size::text,s.last_value::text FROM jsonb_to_recordset(COALESCE(NULLIF($1::text::jsonb->'sequences','null'::jsonb),'[]'::jsonb)) AS s(schemaname text,sequencename text,data_type text,start_value numeric,min_value numeric,max_value numeric,increment_by numeric,cycle boolean,cache_size numeric,last_value numeric) ORDER BY s.schemaname,s.sequencename", [input.raw]);
      const targetSequences = await tx.unsafe("SELECT schemaname,sequencename,data_type,start_value::text,min_value::text,max_value::text,increment_by::text,cycle,cache_size::text,last_value::text FROM pg_sequences WHERE schemaname IN ('public','auth') ORDER BY schemaname,sequencename");
      if (sequenceRows.length !== targetSequences.length) fail('target_sequences_mismatch');
      phase = 'sequence_restore';
      let advancedSequences = 0;
      for (let index = 0; index < sequenceRows.length; index += 1) {
        const source = sequenceRows[index], target = targetSequences[index];
        const properties = ['schemaname','sequencename','data_type','start_value','min_value','max_value','increment_by','cycle','cache_size'];
        if (!['public','auth'].includes(source.schemaname) || !equal(properties.map(key=>source[key]),properties.map(key=>target[key])) || source.cycle !== false || !['smallint','integer','bigint'].includes(source.data_type)) fail('target_sequences_mismatch');
        const seq = relation(source.schemaname,source.sequencename);
        if (target.last_value !== null) fail('target_sequence_already_used');
        const uses = await tx.unsafe("SELECT DISTINCT n.nspname AS table_schema,c.relname AS table_name,a.attname AS column_name FROM pg_class s JOIN pg_namespace sn ON sn.oid=s.relnamespace JOIN pg_depend d ON d.refobjid=s.oid AND d.refclassid='pg_class'::regclass AND d.classid='pg_attrdef'::regclass JOIN pg_attrdef ad ON ad.oid=d.objid JOIN pg_class c ON c.oid=ad.adrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=ad.adnum WHERE sn.nspname=$1 AND s.relname=$2 ORDER BY table_schema,table_name,column_name", [source.schemaname,source.sequencename]);
        if ((source.last_value !== null && !uses.length) || uses.some(use=>!['public','auth'].includes(use.table_schema))) fail('sequence_usage_not_verified');
        let maximum = BigInt(source.min_value);
        for (const use of uses) {
          const [row] = await tx.unsafe(`SELECT MAX(${identifier(use.column_name)})::numeric::text AS maximum_id FROM ${relation(use.table_schema,use.table_name)}`);
          if (row.maximum_id !== null) {
            if (source.last_value === null) fail('uninitialized_sequence_has_restored_rows');
            if (typeof row.maximum_id !== 'string' || !/^-?\d+$/.test(row.maximum_id)) fail('invalid_sequence_numeric_text');
            if (BigInt(row.maximum_id) > maximum) maximum = BigInt(row.maximum_id);
          }
        }
        if (source.last_value === null) continue;
        const restart = conservativeSequenceRestart({lastValue:source.last_value,increment:source.increment_by,minValue:source.min_value,maxValue:source.max_value,maximumId:maximum.toString()});
        await tx.unsafe(`ALTER SEQUENCE ${seq} RESTART WITH ${restart}`);
        const [verified] = await tx.unsafe(`SELECT last_value::text,is_called FROM ${seq}`);
        if (verified.last_value !== restart || verified.is_called !== false) fail('sequence_restart_not_verified');
        advancedSequences += 1;
      }
      phase = 'restored_row_verification';
      await tx.unsafe("SET LOCAL session_replication_role = 'origin'");
      for (const [schema,list] of names) for (const name of list) {
        const expected = await rowsFromSource(tx,input.parsed[`${schema}_rows`][name]);
        if (!equal(textRows(await targetRows(tx,schema,name)),textRows(expected))) fail('restored_rows_mismatch');
      }
      phase = 'transaction_commit';
      return { status:'ROWS_VERIFIED', metadataParity, publicTables:33, authTables:27, authUsers:1, students:0, objects:0, insertedRows:pending.reduce((sum,table)=>sum+table.rows.length,0), transactionCommitted:true, sequenceCount:sequenceRows.length, advancedSequences, exactIsCalledRestored:false, conservativeSequenceAdvance:advancedSequences>0, loginVerified:false, restoreAcceptanceComplete:false };
    });
  } catch (error) {
    const failure = error instanceof RestoreError ? error : new RestoreError('restore_transaction_failed');
    failure.phase = phase;
    if (!(error instanceof RestoreError) && typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)) failure.sqlState = error.code;
    throw failure;
  }
}
