// Builds operator-reviewed SQL only. Does not connect to any database.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const securitySnapshot = `select coalesce(jsonb_agg(jsonb_build_object(
  'relation', c.oid, 'rls', c.relrowsecurity, 'forced', c.relforcerowsecurity,
  'identity', c.relreplident, 'acl', c.relacl,
  'policies', (select coalesce(jsonb_agg(to_jsonb(p) order by p.oid), '[]'::jsonb)
    from pg_catalog.pg_policy p where p.polrelid=c.oid)
) order by c.oid), '[]'::jsonb)
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('notifications','messages','communication_settings')`;

export function buildRealtimePublicationRollbackSql() {
  const source = fs.readFileSync(new URL("../supabase/migrations/20261030000000_school_realtime_publication.sql", import.meta.url), "utf8");
  if ((source.match(/^begin;$/gmi) ?? []).length !== 1 || (source.match(/^commit;$/gmi) ?? []).length !== 1) throw Error("Unexpected migration transaction structure");
  const body = source.replace(/^begin;$/gmi, "").replace(/^commit;$/gmi, "");
  const assertions = fs.readFileSync(new URL("./supabase-realtime-publication.integration.sql", import.meta.url), "utf8");
  return `-- Operator-controlled, catalog-only dry run. No network performed by generator.
-- This includes the migration twice to prove idempotence, followed by ROLLBACK.
begin;
select set_config('test.realtime.security_before', (${securitySnapshot})::text, true);
select set_config('test.realtime.tables_before', (
  select coalesce(jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename) order by schemaname,tablename),'[]'::jsonb)
  from pg_catalog.pg_publication_tables where pubname='supabase_realtime'
)::text,true);
select set_config('test.realtime.options_before', (
  select to_jsonb(p)::text from pg_catalog.pg_publication p where pubname='supabase_realtime'
),true);
${body}
${body}
${assertions}
do $fixture$
declare before_tables jsonb := current_setting('test.realtime.tables_before')::jsonb;
  expected_tables jsonb; actual_tables jsonb; actual_security jsonb;
begin
  select jsonb_agg(value order by value->>'schema',value->>'table') into expected_tables from (
    select value from jsonb_array_elements(before_tables)
    union
    select jsonb_build_object('schema','public','table',name)
    from unnest(array['notifications','messages','communication_settings']) name
  ) expected;
  select coalesce(jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename) order by schemaname,tablename),'[]'::jsonb)
    into actual_tables from pg_catalog.pg_publication_tables where pubname='supabase_realtime';
  if actual_tables is distinct from expected_tables then raise exception 'publication changed beyond three expected tables'; end if;
  if (select to_jsonb(p) from pg_catalog.pg_publication p where pubname='supabase_realtime')
    is distinct from (current_setting('test.realtime.options_before')::jsonb ||
      '{"pubinsert":true,"pubupdate":true,"pubdelete":false,"pubtruncate":false}'::jsonb) then
    raise exception 'publication options changed beyond safe insert/update flags';
  end if;
  select snapshot into actual_security from (${securitySnapshot}) as checked(snapshot);
  if actual_security is distinct from current_setting('test.realtime.security_before')::jsonb then
    raise exception 'table security, grants, policies or replica identity changed';
  end if;
end;
$fixture$;
rollback;
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.stdout.write(buildRealtimePublicationRollbackSql());
