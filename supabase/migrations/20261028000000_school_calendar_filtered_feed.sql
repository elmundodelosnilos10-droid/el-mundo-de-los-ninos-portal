-- Filters intersect the same actor/group authorization as school_calendar_feed.
-- Keep the original RPC intact for existing callers. No records or privileges
-- for school users are created by this migration.
create function public.school_calendar_feed_filtered(
  p_from timestamptz,
  p_to_exclusive timestamptz,
  p_limit integer default 500,
  p_group_id uuid default null,
  p_general_only boolean default false,
  p_kind text default null
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.school_actor_active() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to_exclusive is null or p_to_exclusive <= p_from
    or p_to_exclusive > p_from + interval '95 days'
    or p_limit is null or p_limit < 1 or p_limit > 500
    or p_general_only is null or (p_general_only and p_group_id is not null)
    or (p_kind is not null and p_kind not in ('evento', 'reunion', 'festival', 'entrega', 'suspension', 'clase', 'otro')) then
    raise exception 'invalid_calendar_filters' using errcode = '22023';
  end if;

  with calendar_items as materialized (
    select event.id::text as sort_id, event.group_id, event.kind, event.starts_at,
      pg_catalog.jsonb_build_object(
        'id', event.id, 'groupId', event.group_id, 'groupName', group_row.name,
        'kind', event.kind, 'title', event.title, 'description', event.description,
        'startsAt', event.starts_at, 'endsAt', event.ends_at, 'source', 'evento'
      ) as item
    from public.calendar_events event
    left join public.groups group_row on group_row.id = event.group_id
    where event.starts_at >= p_from and event.starts_at < p_to_exclusive
      and (event.group_id is null and public.school_is_leader()
        or event.group_id is not null and group_row.active = true and public.school_can_access_group(event.group_id))
    union all
    select ('task:' || task.id::text) as sort_id, task.group_id, 'entrega'::text as kind, task.due_at as starts_at,
      pg_catalog.jsonb_build_object(
        'id', 'task:' || task.id::text, 'groupId', task.group_id, 'groupName', group_row.name,
        'kind', 'entrega', 'title', task.title, 'description', null,
        'startsAt', task.due_at, 'endsAt', null, 'source', 'tarea'
      ) as item
    from public.tasks task
    join public.groups group_row on group_row.id = task.group_id and group_row.active = true
    where task.archived_at is null and task.due_at >= p_from and task.due_at < p_to_exclusive
      and public.school_can_access_group(task.group_id)
  ), filtered as materialized (
    select * from calendar_items
    where (p_group_id is null or group_id = p_group_id)
      and (not p_general_only or group_id is null)
      and (p_kind is null or kind = p_kind)
  )
  select pg_catalog.jsonb_build_object(
    'items', coalesce((select pg_catalog.jsonb_agg(page.item order by page.starts_at, page.sort_id)
      from (select item, starts_at, sort_id from filtered order by starts_at, sort_id limit p_limit) page), '[]'::jsonb),
    'total', (select pg_catalog.count(*) from filtered),
    'limited', (select pg_catalog.count(*) > p_limit from filtered)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.school_calendar_feed_filtered(timestamptz, timestamptz, integer, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.school_calendar_feed_filtered(timestamptz, timestamptz, integer, uuid, boolean, text) to authenticated;
