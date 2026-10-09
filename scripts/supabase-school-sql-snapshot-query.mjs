import { pathToFileURL } from 'node:url';
import { loadSchoolBackupTables } from './supabase-school-backup.mjs';
import { SQL_SNAPSHOT_AUTH_CATALOG, SQL_SNAPSHOT_PROJECT_REF } from './supabase-school-sql-snapshot.mjs';

const identifier = /^[a-z_][a-z0-9_]*$/;
function rowCollections(schema, names) {
  if (!identifier.test(schema) || names.some(name => !identifier.test(name)) || new Set(names).size !== names.length) {
    throw Error('El catálogo de la consulta no es válido.');
  }
  return names.map(name => `    '${name}', (select coalesce(array_agg(row_to_json(t)::text order by row_to_json(t)::text), array[]::text[]) from ${schema}.${name} t)`).join(',\n');
}

/** Prints only SQL source. Execution and the resulting sensitive CSV are separate,
 * explicitly authorized operator steps; this module never connects to a database. */
export async function buildSchoolSqlSnapshotQuery() {
  const tables = await loadSchoolBackupTables();
  if (tables.length !== 33 || SQL_SNAPSHOT_AUTH_CATALOG.length !== 27 || !/^[a-z0-9]+$/.test(SQL_SNAPSHOT_PROJECT_REF)) {
    throw Error('El catálogo escolar requiere revisión antes de generar SQL.');
  }
  return `select jsonb_build_object(
  'format', 'school-sql-snapshot',
  'version', 1,
  'project_ref', '${SQL_SNAPSHOT_PROJECT_REF}',
  'captured_at', statement_timestamp(),
  'postgres_version', current_setting('server_version'),
  'public_catalog', (select jsonb_agg(tablename order by tablename) from pg_tables where schemaname = 'public'),
  'auth_catalog', (select jsonb_agg(tablename order by tablename) from pg_tables where schemaname = 'auth'),
  'public_rows', jsonb_build_object(
${rowCollections('public', tables.map(table => table.name))}
  ),
  'auth_rows', jsonb_build_object(
${rowCollections('auth', [...SQL_SNAPSHOT_AUTH_CATALOG])}
  ),
  'columns', (select jsonb_agg(to_jsonb(c) order by table_schema, table_name, ordinal_position) from information_schema.columns c where table_schema in ('public', 'auth')),
  'constraints', (select jsonb_agg(jsonb_build_object('schema', n.nspname, 'table', cl.relname, 'name', c.conname, 'kind', c.contype, 'definition', pg_get_constraintdef(c.oid)) order by n.nspname, cl.relname, c.conname) from pg_constraint c join pg_class cl on cl.oid = c.conrelid join pg_namespace n on n.oid = cl.relnamespace where n.nspname in ('public', 'auth')),
  'indexes', (select jsonb_agg(to_jsonb(i) order by schemaname, tablename, indexname) from pg_indexes i where schemaname in ('public', 'auth')),
  'triggers', (select jsonb_agg(jsonb_build_object('schema', n.nspname, 'table', cl.relname, 'name', t.tgname, 'definition', pg_get_triggerdef(t.oid)) order by n.nspname, cl.relname, t.tgname) from pg_trigger t join pg_class cl on cl.oid = t.tgrelid join pg_namespace n on n.oid = cl.relnamespace where n.nspname in ('public', 'auth', 'storage') and not t.tgisinternal),
  'functions', (select jsonb_agg(jsonb_build_object('name', p.proname, 'definition', pg_get_functiondef(p.oid)) order by p.proname, p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'),
  'policies', (select jsonb_agg(to_jsonb(p) order by schemaname, tablename, policyname) from pg_policies p where schemaname in ('public', 'auth', 'storage', 'realtime')),
  'table_acl', (select jsonb_agg(jsonb_build_object('schema', n.nspname, 'table', cl.relname, 'owner', pg_get_userbyid(cl.relowner), 'acl', cl.relacl::text, 'rls', cl.relrowsecurity, 'force_rls', cl.relforcerowsecurity) order by n.nspname, cl.relname) from pg_class cl join pg_namespace n on n.oid = cl.relnamespace where n.nspname in ('public', 'auth', 'storage') and cl.relkind = 'r'),
  'enums', (select jsonb_agg(jsonb_build_object('schema', n.nspname, 'type', t.typname, 'sort_order', e.enumsortorder, 'label', e.enumlabel) order by n.nspname, t.typname, e.enumsortorder) from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace where n.nspname in ('public', 'auth')),
  'sequences', (select jsonb_agg(to_jsonb(s) order by schemaname, sequencename) from pg_sequences s where schemaname in ('public', 'auth')),
  'migration_history', (select coalesce(jsonb_agg(to_jsonb(m) order by version), '[]'::jsonb) from supabase_migrations.schema_migrations m),
  'storage_buckets', (select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb) from storage.buckets b where id = 'school-files'),
  'school_file_object_count', (select count(*) from storage.objects where bucket_id = 'school-files'),
  'students_count', (select count(*) from public.students)
)::text as snapshot;\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) throw Error();
    process.stdout.write(await buildSchoolSqlSnapshotQuery());
  } catch {
    process.stderr.write('No se pudo generar la consulta pública de respaldo; no se ejecutó SQL.\n');
    process.exitCode = 1;
  }
}
