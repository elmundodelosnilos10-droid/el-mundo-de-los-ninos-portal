-- Catalog assertions after migration30, inside operator-managed BEGIN/ROLLBACK.
-- No data writes, real users, tokens, publication creation or external requests.
do $$
declare table_name text; relation_oid oid;
begin
  foreach table_name in array array['notifications','messages','communication_settings'] loop
    if (select count(*) from pg_catalog.pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=table_name) <> 1 then
      raise exception 'school realtime table missing from publication';
    end if;
    select c.oid into relation_oid from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=table_name and c.relrowsecurity and c.relforcerowsecurity;
    if relation_oid is null or not pg_catalog.has_table_privilege('authenticated',relation_oid,'SELECT')
      or pg_catalog.has_any_column_privilege('anon',relation_oid,'SELECT') then
      raise exception 'school realtime table security changed';
    end if;
  end loop;
  if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime' and (puballtables or not pubinsert or not pubupdate or pubdelete or pubtruncate)) then
    raise exception 'school realtime publication options invalid';
  end if;
  if exists(select 1 from pg_catalog.pg_publication_namespace n join pg_catalog.pg_publication p on p.oid=n.pnpubid where p.pubname='supabase_realtime')
    or exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and (schemaname <> 'public' or tablename not in ('notifications','messages','communication_settings'))) then
    raise exception 'school realtime publication not exclusive';
  end if;
end;
$$;
