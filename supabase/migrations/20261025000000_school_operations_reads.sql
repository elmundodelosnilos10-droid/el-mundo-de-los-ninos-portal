-- Read-only operating views. Caller JWT, current roles and table RLS apply;
-- neither RPC uses a service key or bypasses policies.
begin;
create function public.school_audit_feed(p_version integer)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare v_items jsonb;
begin
  if auth.uid() is null or not public.school_is_leader() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_version is distinct from 1 then raise exception 'invalid_version' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'actorName', r.actor_name, 'action', r.action, 'entityType', r.entity_type,
    'entityId', r.entity_id, 'createdAt', r.created_at
  ) order by r.created_at desc, r.id desc), '[]'::jsonb) into v_items
  from (
    select a.id, p.name as actor_name, a.action, a.entity_type, a.entity_id, a.created_at
    from public.audit_log a left join public.profiles p on p.id = a.actor_id
    order by a.created_at desc, a.id desc limit 100
  ) r;
  return jsonb_build_object('items', v_items);
end;
$$;

create function public.school_system_status(p_version integer)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
begin
  if auth.uid() is null or not public.school_has_role(array['superadmin']::text[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_version is distinct from 1 then raise exception 'invalid_version' using errcode = '22023'; end if;
  return jsonb_build_object(
    'checkedAt', clock_timestamp(),
    'activeAccounts', (select count(*) from public.profiles p where p.active),
    'activeGroups', (select count(*) from public.groups g where g.active),
    'auditRecords', (select count(*) from public.audit_log),
    'latestAuditAt', (select max(a.created_at) from public.audit_log a)
  );
end;
$$;
revoke all on function public.school_audit_feed(integer) from public, anon, authenticated;
revoke all on function public.school_system_status(integer) from public, anon, authenticated;
grant execute on function public.school_audit_feed(integer) to authenticated;
grant execute on function public.school_system_status(integer) to authenticated;
commit;
