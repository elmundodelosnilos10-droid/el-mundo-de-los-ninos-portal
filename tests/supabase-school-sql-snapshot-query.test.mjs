import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildSchoolSqlSnapshotQuery } from '../scripts/supabase-school-sql-snapshot-query.mjs';
import { loadSchoolBackupTables } from '../scripts/supabase-school-backup.mjs';
import { SQL_SNAPSHOT_AUTH_CATALOG, SQL_SNAPSHOT_PROJECT_REF } from '../scripts/supabase-school-sql-snapshot.mjs';

const query = await buildSchoolSqlSnapshotQuery();
const sourceUrl = new URL('../scripts/supabase-school-sql-snapshot-query.mjs', import.meta.url);
const metadata = key => query.split('\n').find(line => line.startsWith(`  '${key}',`));
const unquoted = query.replace(/'(?:[^']|'')*'/g, "''");

test('one balanced SELECT statement only, with no mutation or executable side effects', async () => {
  assert.match(query, /^select jsonb_build_object\(/);
  assert.match(query, /\)::text as snapshot;\n$/);
  assert.equal((unquoted.match(/;/g) ?? []).length, 1);
  assert.doesNotMatch(unquoted, /\b(?:insert|update|delete|truncate|create|alter|drop|grant|revoke|copy|call|execute|do|begin|commit|rollback|set|reset)\b/i);
  let depth = 0, topLevelSelects = 0;
  for (const token of unquoted.matchAll(/\(|\)|\bselect\b/gi)) {
    if (token[0] === '(') depth++;
    else if (token[0] === ')') depth--;
    else if (depth === 0) topLevelSelects++;
    assert.ok(depth >= 0);
  }
  assert.equal(depth, 0);
  assert.equal(topLevelSelects, 1);
  const source = await readFile(sourceUrl, 'utf8');
  assert.doesNotMatch(source, /\b(?:fetch|spawn|exec|readFile|open|createSupabaseClient|postgres)\s*\(/);
  assert.doesNotMatch(source, /process\.env|\.csv|SUPABASE_SECRET_KEY|SUPABASE_ACCESS_TOKEN/);
});

test('exact catalog33 plus Auth27 row readers preserve every whole row as ordered JSON text', async () => {
  const publicNames = (await loadSchoolBackupTables()).map(table => table.name);
  const readers = [...query.matchAll(/    '([a-z_]+)', \(select coalesce\(array_agg\(row_to_json\(t\)::text order by row_to_json\(t\)::text\), array\[\]::text\[\]\) from (public|auth)\.([a-z_]+) t\)/g)];
  assert.equal(readers.length, 60);
  for (const schema of ['public', 'auth']) {
    const actual = readers.filter(reader => reader[2] === schema);
    assert.ok(actual.every(reader => reader[1] === reader[3]));
    assert.deepEqual(actual.map(reader => reader[3]).sort(), [...(schema === 'public' ? publicNames : SQL_SNAPSHOT_AUTH_CATALOG)].sort());
  }
  assert.match(metadata('public_catalog'), /jsonb_agg\(tablename order by tablename\).*pg_tables.*schemaname = 'public'/);
  assert.match(metadata('auth_catalog'), /jsonb_agg\(tablename order by tablename\).*pg_tables.*schemaname = 'auth'/);
  assert.doesNotMatch(query, /jsonb_agg\(to_jsonb\(t\)|array_agg\(row_to_json\(t\) order/);
});

test('snapshot envelope and information_schema columns match the offline validator contract', () => {
  const keys = [...query.matchAll(/^  '([a-z_]+)',/gm)].map(match => match[1]);
  assert.deepEqual(keys, ['format','version','project_ref','captured_at','postgres_version','public_catalog','auth_catalog','public_rows','auth_rows','columns','constraints','indexes','triggers','functions','policies','table_acl','enums','sequences','migration_history','storage_buckets','school_file_object_count','students_count']);
  assert.match(metadata('format'), /'school-sql-snapshot'/);
  assert.match(metadata('version'), /, 1,/);
  assert.ok(metadata('project_ref').includes(`'${SQL_SNAPSHOT_PROJECT_REF}'`));
  assert.match(metadata('captured_at'), /statement_timestamp\(\)/);
  assert.match(metadata('postgres_version'), /current_setting\('server_version'\)/);
  assert.match(metadata('columns'), /jsonb_agg\(to_jsonb\(c\) order by table_schema, table_name, ordinal_position\).*information_schema\.columns c.*table_schema in \('public', 'auth'\)/);
});

test('metadata definitions retain original subfields, scopes, ordering and null empty collections', () => {
  assert.match(metadata('constraints'), /'schema', n\.nspname, 'table', cl\.relname, 'name', c\.conname, 'kind', c\.contype, 'definition', pg_get_constraintdef\(c\.oid\)/);
  assert.match(metadata('constraints'), /n\.nspname in \('public', 'auth'\)/);
  assert.match(metadata('indexes'), /to_jsonb\(i\).*pg_indexes i.*schemaname in \('public', 'auth'\)/);
  assert.match(metadata('triggers'), /'definition', pg_get_triggerdef\(t\.oid\).*n\.nspname in \('public', 'auth', 'storage'\) and not t\.tgisinternal/);
  assert.match(metadata('functions'), /'name', p\.proname, 'definition', pg_get_functiondef\(p\.oid\)\) order by p\.proname, p\.oid.*n\.nspname = 'public' and p\.prokind = 'f'/);
  assert.match(metadata('policies'), /to_jsonb\(p\).*pg_policies p.*schemaname in \('public', 'auth', 'storage', 'realtime'\)/);
  assert.match(metadata('table_acl'), /'owner', pg_get_userbyid\(cl\.relowner\), 'acl', cl\.relacl::text, 'rls', cl\.relrowsecurity, 'force_rls', cl\.relforcerowsecurity/);
  assert.match(metadata('table_acl'), /n\.nspname in \('public', 'auth', 'storage'\) and cl\.relkind = 'r'/);
  assert.match(metadata('enums'), /'type', t\.typname, 'sort_order', e\.enumsortorder, 'label', e\.enumlabel.*n\.nspname in \('public', 'auth'\)/);
  assert.match(metadata('sequences'), /to_jsonb\(s\).*pg_sequences s.*schemaname in \('public', 'auth'\)/);
  for (const key of ['columns','constraints','indexes','triggers','functions','policies','table_acl','enums','sequences']) assert.doesNotMatch(metadata(key), /coalesce/);
});

test('migration and private school bucket inventories alone coalesce metadata arrays, counts are real', () => {
  assert.match(metadata('migration_history'), /coalesce\(jsonb_agg\(to_jsonb\(m\) order by version\), '\[\]'::jsonb\).*supabase_migrations\.schema_migrations m/);
  assert.match(metadata('storage_buckets'), /coalesce\(jsonb_agg\(to_jsonb\(b\)\), '\[\]'::jsonb\).*storage\.buckets b where id = 'school-files'/);
  assert.match(metadata('school_file_object_count'), /count\(\*\) from storage\.objects where bucket_id = 'school-files'/);
  assert.match(metadata('students_count'), /count\(\*\) from public\.students/);
  assert.doesNotMatch(query, /pg_read_file|dblink|http_|storage\.objects.*jsonb_agg|encrypted_password.*=/);
});

test('CLI emits exactly deterministic public SQL without reading credentials and rejects extra arguments', () => {
  const env = {PATH: process.env.PATH, SUPABASE_SECRET_KEY:'SYNTHETIC-NOT-READ', SUPABASE_URL:'https://synthetic.invalid'};
  const child = spawnSync(process.execPath, [fileURLToPath(sourceUrl)], {env,encoding:'utf8'});
  assert.equal(child.status, 0);
  assert.equal(child.stdout, query);
  assert.equal(child.stderr, '');
  assert.doesNotMatch(child.stdout, /SYNTHETIC-NOT-READ|synthetic\.invalid|\$2a\$/);
  const rejected = spawnSync(process.execPath, [fileURLToPath(sourceUrl), '--execute'], {env,encoding:'utf8'});
  assert.equal(rejected.status, 1);
  assert.equal(rejected.stdout, '');
  assert.match(rejected.stderr, /no se ejecutó SQL/);
});
