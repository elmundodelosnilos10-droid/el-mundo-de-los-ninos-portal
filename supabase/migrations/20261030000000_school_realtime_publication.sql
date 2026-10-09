-- NOT APPLIED: review and explicitly authorize publication changes first.
-- Exclusive school publication only. Existing JWT SELECT/RLS policies remain the authority.
-- INSERT/UPDATE only: DELETE RLS is unsafe even for independent subscribers.
-- No tables, roles, grants, policies or replica identity changes are created.
begin;
do $$
declare
  table_name text;
  expected_policy text;
  expected_helper text;
  policy_expression text;
  relation_oid oid;
  publication_oid oid;
  authenticated_oid oid;
  anon_oid oid;
begin
  select oid into publication_oid from pg_catalog.pg_publication
  where pubname = 'supabase_realtime' and not puballtables;
  if publication_oid is null then
    raise exception 'school_realtime_publication_not_ready' using errcode = '55000';
  end if;
  -- Never change flags of a publication shared with unrelated tables/schemas.
  if exists (select 1 from pg_catalog.pg_publication_namespace where pnpubid = publication_oid)
    or exists (
      select 1 from pg_catalog.pg_publication_tables p where p.pubname = 'supabase_realtime'
        and (p.schemaname <> 'public' or p.tablename not in ('notifications', 'messages', 'communication_settings'))
    ) then
    raise exception 'school_realtime_publication_must_be_exclusive' using errcode = '55000';
  end if;
  select oid into authenticated_oid from pg_catalog.pg_roles where rolname = 'authenticated';
  select oid into anon_oid from pg_catalog.pg_roles where rolname = 'anon';
  if authenticated_oid is null or anon_oid is null then
    raise exception 'school_realtime_roles_not_ready' using errcode = '55000';
  end if;
  foreach table_name in array array['notifications', 'messages', 'communication_settings'] loop
    select c.oid into relation_oid
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = table_name and c.relkind = 'r'
      and c.relrowsecurity and c.relforcerowsecurity;
    if relation_oid is null
      or not pg_catalog.has_table_privilege('authenticated', relation_oid, 'SELECT')
      or pg_catalog.has_any_column_privilege('anon', relation_oid, 'SELECT') then
      raise exception 'school_realtime_table_security_not_ready' using errcode = '55000';
    end if;
    expected_policy := case table_name
      when 'notifications' then 'notifications_read_own'
      when 'messages' then 'messages_read_member'
      else 'communication_settings_read_authenticated' end;
    expected_helper := case table_name
      when 'messages' then 'school_is_conversation_member(conversation_id)'
      else 'school_actor_active()' end;
    if not exists (
      select 1 from pg_catalog.pg_policy p
      where p.polrelid = relation_oid and p.polname = expected_policy and p.polcmd = 'r'
        and p.polpermissive and authenticated_oid = any(p.polroles)
        and pg_catalog.strpos(pg_catalog.pg_get_expr(p.polqual, p.polrelid), expected_helper) > 0
        and (table_name <> 'notifications' or (
          pg_catalog.strpos(pg_catalog.pg_get_expr(p.polqual, p.polrelid), 'user_id') > 0
          and pg_catalog.strpos(pg_catalog.pg_get_expr(p.polqual, p.polrelid), 'auth.uid()') > 0))
    ) or exists (
      select 1 from pg_catalog.pg_policy p
      where p.polrelid = relation_oid and p.polpermissive and p.polcmd in ('r', '*')
        and (0 = any(p.polroles) or anon_oid = any(p.polroles) or (
          authenticated_oid = any(p.polroles) and p.polname <> expected_policy
          and not (table_name = 'communication_settings'
            and p.polname = 'communication_settings_manage_leadership' and p.polcmd = '*'
            and pg_catalog.regexp_replace(pg_catalog.replace(pg_catalog.pg_get_expr(p.polqual,p.polrelid), 'public.', ''), '[[:space:]]', '', 'g') = 'school_is_leader()')
        ))
    ) then
      raise exception 'school_realtime_read_policy_not_ready' using errcode = '55000';
    end if;
    -- Compare the known read expression, rather than accepting e.g. helper OR true.
    select pg_catalog.regexp_replace(pg_catalog.replace(pg_catalog.pg_get_expr(p.polqual,p.polrelid), 'public.', ''), '[[:space:]]', '', 'g')
      into policy_expression from pg_catalog.pg_policy p
      where p.polrelid = relation_oid and p.polname = expected_policy;
    if (table_name = 'notifications' and policy_expression not in (
      '((user_id=(SELECTauth.uid()ASuid))ANDschool_actor_active())',
      '((user_id=(SELECTauth.uid()))ANDschool_actor_active())'
    )) or (table_name <> 'notifications' and policy_expression <> expected_helper) then
      raise exception 'school_realtime_read_expression_not_ready' using errcode = '55000';
    end if;
  end loop;
  -- All prerequisites were checked before any mutation. Keep insert/update only.
  if exists (select 1 from pg_catalog.pg_publication where oid = publication_oid
      and (not pubinsert or not pubupdate or pubdelete or pubtruncate)) then
    alter publication supabase_realtime set (publish = 'insert, update');
  end if;
  foreach table_name in array array['notifications', 'messages', 'communication_settings'] loop
    if not exists (
      select 1 from pg_catalog.pg_publication_tables p
      where p.pubname = 'supabase_realtime' and p.schemaname = 'public' and p.tablename = table_name
    ) then
      execute pg_catalog.format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;
commit;
