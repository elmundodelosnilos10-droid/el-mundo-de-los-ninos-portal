-- Read-only account pagination shared by the server page and API. No Auth users
-- or school permissions are created or changed by this migration.
begin;

create or replace function public.school_account_feed(
  p_query text default '', p_role text default null, p_status text default null,
  p_limit integer default 10, p_offset integer default 0
)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_query text := pg_catalog.btrim(coalesce(p_query, ''));
  v_result jsonb;
begin
  if (select auth.uid()) is null or not public.school_is_leader() then
    raise exception 'School leadership access required' using errcode = '42501';
  end if;
  if pg_catalog.length(v_query) > 100 or p_limit is null or p_limit < 1 or p_limit > 50
     or p_offset is null or p_offset < 0 or p_offset > 4999950
     or (p_role is not null and p_role not in ('superadmin', 'direccion', 'docente', 'tutor', 'alumno'))
     or (p_status is not null and p_status not in ('activas', 'desactivadas')) then
    raise exception 'Invalid account filters or pagination' using errcode = '22023';
  end if;

  with filtered as (
    select p.id, p.name, p.email, r.role, p.active
    from public.profiles p
    join public.user_roles r on r.user_id = p.id
    where (v_query = '' or pg_catalog.strpos(pg_catalog.lower(p.name), pg_catalog.lower(v_query)) > 0
                          or pg_catalog.strpos(pg_catalog.lower(p.email), pg_catalog.lower(v_query)) > 0)
      and (p_role is null or r.role = p_role)
      and (p_status is null or p.active = (p_status = 'activas'))
  ), page as (
    select * from filtered order by name, id, role limit p_limit offset p_offset
  )
  select pg_catalog.jsonb_build_object(
    'items', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(page) order by name, id, role), '[]'::jsonb) from page),
    'total', (select pg_catalog.count(*) from filtered)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.school_account_feed(text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.school_account_feed(text, text, text, integer, integer) to authenticated;
commit;
