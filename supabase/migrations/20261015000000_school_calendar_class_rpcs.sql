-- Agenda escolar, clases virtuales y notificaciones transaccionales.
-- Mantener D1 como fuente hasta importar y validar todos los datos relacionados.
begin;

create function public.school_notify_calendar_families(
  p_kind text,
  p_title text,
  p_href text,
  p_source_id uuid,
  p_group_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_count integer;
begin
  if p_kind is null or p_kind not in ('calendario', 'clase') or p_title is null
    or p_href is null or p_href not in ('/calendario', '/clases') or p_source_id is null then
    raise exception 'invalid_notice' using errcode = '22023';
  end if;

  if p_group_id is null then
    insert into public.notifications (id, user_id, kind, title, href, dedupe_key, created_at)
    select pg_catalog.gen_random_uuid(), recipients.user_id, p_kind, p_title, p_href,
      p_kind || ':' || p_source_id::text || ':' || recipients.user_id::text, v_now
    from (
      select distinct guardian.user_id
      from public.guardians guardian
      join public.profiles profile on profile.id = guardian.user_id and profile.active = true
      join public.user_roles role_row on role_row.user_id = guardian.user_id and role_row.role = 'tutor'
      where guardian.active = true
    ) recipients
    on conflict (dedupe_key) do nothing;
  else
    insert into public.notifications (id, user_id, kind, title, href, dedupe_key, created_at)
    select pg_catalog.gen_random_uuid(), recipients.user_id, p_kind, p_title, p_href,
      p_kind || ':' || p_source_id::text || ':' || recipients.user_id::text, v_now
    from (
      select distinct guardian.user_id
      from public.enrollments enrollment
      join public.students student on student.id = enrollment.student_id and student.active = true
      join public.student_guardians link on link.student_id = student.id and link.active = true
      join public.guardians guardian on guardian.id = link.guardian_id and guardian.active = true
      join public.profiles profile on profile.id = guardian.user_id and profile.active = true
      join public.user_roles role_row on role_row.user_id = guardian.user_id and role_row.role = 'tutor'
      where enrollment.group_id = p_group_id and enrollment.ended_at is null
    ) recipients
    on conflict (dedupe_key) do nothing;
  end if;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function public.school_calendar_feed(
  p_from timestamptz,
  p_to_exclusive timestamptz,
  p_limit integer default 500
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_items jsonb;
begin
  if not public.school_actor_active() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to_exclusive is null or p_to_exclusive <= p_from
    or p_to_exclusive > p_from + interval '95 days'
    or p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'invalid_calendar_range' using errcode = '22023';
  end if;

  with calendar_items as (
    select event.id::text as sort_id, event.starts_at,
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
    select ('task:' || task.id::text) as sort_id, task.due_at as starts_at,
      pg_catalog.jsonb_build_object(
        'id', 'task:' || task.id::text, 'groupId', task.group_id, 'groupName', group_row.name,
        'kind', 'entrega', 'title', task.title, 'description', null,
        'startsAt', task.due_at, 'endsAt', null, 'source', 'tarea'
      ) as item
    from public.tasks task
    join public.groups group_row on group_row.id = task.group_id and group_row.active = true
    where task.archived_at is null and task.due_at >= p_from and task.due_at < p_to_exclusive
      and public.school_can_access_group(task.group_id)
  )
  select pg_catalog.count(*)::integer into v_count from calendar_items;

  with calendar_items as (
    select event.id::text as sort_id, event.starts_at,
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
    select ('task:' || task.id::text) as sort_id, task.due_at as starts_at,
      pg_catalog.jsonb_build_object(
        'id', 'task:' || task.id::text, 'groupId', task.group_id, 'groupName', group_row.name,
        'kind', 'entrega', 'title', task.title, 'description', null,
        'startsAt', task.due_at, 'endsAt', null, 'source', 'tarea'
      ) as item
    from public.tasks task
    join public.groups group_row on group_row.id = task.group_id and group_row.active = true
    where task.archived_at is null and task.due_at >= p_from and task.due_at < p_to_exclusive
      and public.school_can_access_group(task.group_id)
  )
  select coalesce(pg_catalog.jsonb_agg(page.item order by page.starts_at, page.sort_id), '[]'::jsonb)
    into v_items
  from (
    select item, starts_at, sort_id from calendar_items order by starts_at, sort_id limit p_limit
  ) page;

  return pg_catalog.jsonb_build_object('items', coalesce(v_items, '[]'::jsonb), 'total', v_count, 'limited', v_count > p_limit);
end;
$$;

create function public.school_create_calendar_event(
  p_id uuid,
  p_group_id uuid,
  p_kind text,
  p_title text,
  p_description text,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := pg_catalog.now();
begin
  if v_actor is null or not public.school_actor_active()
    or not public.school_has_role(array['superadmin', 'direccion', 'docente']::text[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_id is null or p_kind is null or p_kind not in ('entrega', 'reunion', 'festival', 'suspension', 'evento', 'otro')
    or p_title is null or pg_catalog.char_length(pg_catalog.btrim(p_title)) not between 2 and 120
    or (p_description is not null and pg_catalog.char_length(pg_catalog.btrim(p_description)) > 1000)
    or p_starts_at is null or (p_ends_at is not null and p_ends_at < p_starts_at) then
    raise exception 'invalid_calendar_event' using errcode = '22023';
  end if;
  if (p_group_id is null and not public.school_is_leader())
    or (p_group_id is not null and (not public.school_is_leader_or_teacher(p_group_id)
      or not exists (select 1 from public.groups group_row where group_row.id = p_group_id and group_row.active = true))) then
    raise exception 'group_not_available' using errcode = 'P0002';
  end if;

  insert into public.calendar_events (id, group_id, kind, title, description, starts_at, ends_at, created_by)
  values (p_id, p_group_id, p_kind, pg_catalog.btrim(p_title), nullif(pg_catalog.btrim(p_description), ''), p_starts_at, p_ends_at, v_actor);
  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (pg_catalog.gen_random_uuid(), v_actor, 'create', 'calendar_event', p_id::text, v_now);
  perform public.school_notify_calendar_families('calendario', 'Nueva actividad en el calendario', '/calendario', p_id, p_group_id);

  return pg_catalog.jsonb_build_object('id', p_id, 'createdAt', v_now);
end;
$$;

create function public.school_update_calendar_event(
  p_id uuid,
  p_kind text,
  p_title text,
  p_description text,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := pg_catalog.now();
  v_group_id uuid;
  v_kind text;
begin
  if v_actor is null or not public.school_actor_active()
    or not public.school_has_role(array['superadmin', 'direccion', 'docente']::text[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_id is null or p_kind is null or p_kind not in ('entrega', 'reunion', 'festival', 'suspension', 'evento', 'otro')
    or p_title is null or pg_catalog.char_length(pg_catalog.btrim(p_title)) not between 2 and 120
    or (p_description is not null and pg_catalog.char_length(pg_catalog.btrim(p_description)) > 1000)
    or p_starts_at is null or (p_ends_at is not null and p_ends_at < p_starts_at) then
    raise exception 'invalid_calendar_event' using errcode = '22023';
  end if;

  select event.group_id, event.kind into v_group_id, v_kind
  from public.calendar_events event where event.id = p_id for update;
  if not found then raise exception 'event_not_available' using errcode = 'P0002'; end if;
  if v_kind = 'clase' then raise exception 'manage_class_in_classes' using errcode = '22023'; end if;
  if (v_group_id is null and not public.school_is_leader())
    or (v_group_id is not null and not public.school_is_leader_or_teacher(v_group_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.calendar_events set kind = p_kind, title = pg_catalog.btrim(p_title),
    description = nullif(pg_catalog.btrim(p_description), ''), starts_at = p_starts_at, ends_at = p_ends_at
  where id = p_id;
  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (pg_catalog.gen_random_uuid(), v_actor, 'update', 'calendar_event', p_id::text, v_now);
  perform public.school_notify_calendar_families('calendario', 'Se actualizó una actividad del calendario', '/calendario', p_id, v_group_id);

  return pg_catalog.jsonb_build_object('updated', true, 'updatedAt', v_now);
end;
$$;

create function public.school_delete_calendar_event(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := pg_catalog.now();
  v_group_id uuid;
  v_kind text;
begin
  if v_actor is null or not public.school_actor_active()
    or not public.school_has_role(array['superadmin', 'direccion', 'docente']::text[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_id is null then raise exception 'invalid_calendar_event' using errcode = '22023'; end if;
  select event.group_id, event.kind into v_group_id, v_kind
  from public.calendar_events event where event.id = p_id for update;
  if not found then raise exception 'event_not_available' using errcode = 'P0002'; end if;
  if v_kind = 'clase' then raise exception 'manage_class_in_classes' using errcode = '22023'; end if;
  if (v_group_id is null and not public.school_is_leader())
    or (v_group_id is not null and not public.school_is_leader_or_teacher(v_group_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  delete from public.calendar_events where id = p_id;
  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (pg_catalog.gen_random_uuid(), v_actor, 'delete', 'calendar_event', p_id::text, v_now);
  perform public.school_notify_calendar_families('calendario', 'Se canceló una actividad del calendario', '/calendario', p_id, v_group_id);

  return pg_catalog.jsonb_build_object('deleted', true, 'deletedAt', v_now);
end;
$$;

create function public.school_list_class_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_groups jsonb;
  v_teachers jsonb;
begin
  if v_actor is null or not public.school_actor_active() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object('id', group_row.id, 'name', group_row.name) order by group_row.name, group_row.id
  ), '[]'::jsonb) into v_groups
  from public.groups group_row
  where group_row.active = true and public.school_can_access_group(group_row.id);

  if public.school_has_role(array['superadmin', 'direccion']::text[]) then
    select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('id', teacher.id, 'name', profile.name, 'email', profile.email) order by profile.name, teacher.id
    ), '[]'::jsonb) into v_teachers
    from public.teachers teacher
    join public.profiles profile on profile.id = teacher.user_id and profile.active = true
    where teacher.active = true and exists (
      select 1 from public.teacher_groups assignment
      join public.groups group_row on group_row.id = assignment.group_id and group_row.active = true
      where assignment.teacher_id = teacher.id and public.school_can_access_group(group_row.id)
    );
  elsif public.school_has_role(array['docente']::text[]) then
    select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('id', teacher.id, 'name', profile.name, 'email', profile.email) order by profile.name, teacher.id
    ), '[]'::jsonb) into v_teachers
    from public.teachers teacher
    join public.profiles profile on profile.id = teacher.user_id and profile.active = true
    where teacher.user_id = v_actor and teacher.active = true;
  else
    v_teachers := '[]'::jsonb;
  end if;

  return pg_catalog.jsonb_build_object('groups', coalesce(v_groups, '[]'::jsonb), 'teachers', coalesce(v_teachers, '[]'::jsonb));
end;
$$;

create function public.school_list_class_sessions(p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
begin
  if not public.school_actor_active() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'invalid_limit' using errcode = '22023';
  end if;
  select coalesce(pg_catalog.jsonb_agg(page.item order by page.starts_at, page.class_id), '[]'::jsonb)
  into v_items
  from (
    select session.id as class_id, event.starts_at,
      pg_catalog.jsonb_build_object(
        'id', session.id, 'groupId', session.group_id, 'groupName', group_row.name,
        'teacherName', profile.name, 'title', event.title, 'startsAt', event.starts_at,
        'endsAt', event.ends_at, 'meetUrl', session.meet_url
      ) as item
    from public.class_sessions session
    join public.calendar_events event on event.id = session.event_id and event.kind = 'clase'
    join public.groups group_row on group_row.id = session.group_id and group_row.active = true
    join public.teachers teacher on teacher.id = session.teacher_id and teacher.active = true
    join public.profiles profile on profile.id = teacher.user_id and profile.active = true
    where public.school_can_access_group(session.group_id)
    order by event.starts_at, session.id
    limit p_limit
  ) page;

  return pg_catalog.jsonb_build_object('items', coalesce(v_items, '[]'::jsonb), 'timeZone', 'America/Mexico_City');
end;
$$;

create function public.school_create_class_session(
  p_id uuid,
  p_event_id uuid,
  p_group_id uuid,
  p_teacher_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_meet_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := pg_catalog.now();
  v_teacher_id uuid;
  v_teacher_count integer;
begin
  if v_actor is null or not public.school_actor_active()
    or not public.school_has_role(array['superadmin', 'direccion', 'docente']::text[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_id is null or p_event_id is null or p_group_id is null
    or p_title is null or pg_catalog.char_length(pg_catalog.btrim(p_title)) not between 2 and 120
    or p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at
    or p_meet_url is null or p_meet_url !~ '^https://meet[.]google[.]com/[[:alnum:]-]+([?][^[:space:]#]*)?$' then
    raise exception 'invalid_class_session' using errcode = '22023';
  end if;
  if not public.school_is_leader_or_teacher(p_group_id)
    or not exists (select 1 from public.groups group_row where group_row.id = p_group_id and group_row.active = true) then
    raise exception 'group_or_teacher_unavailable' using errcode = 'P0002';
  end if;
  if public.school_has_role(array['docente']::text[]) then
    select teacher.id into v_teacher_id
    from public.teachers teacher
    join public.teacher_groups assignment on assignment.teacher_id = teacher.id and assignment.group_id = p_group_id
    where teacher.user_id = v_actor and teacher.active = true;
    if v_teacher_id is null then raise exception 'forbidden' using errcode = '42501'; end if;
  elsif p_teacher_id is not null then
    v_teacher_id := p_teacher_id;
  else
    select pg_catalog.count(*)::integer into v_teacher_count
    from public.teachers teacher
    join public.teacher_groups assignment on assignment.teacher_id = teacher.id and assignment.group_id = p_group_id
    where teacher.active = true;
    if v_teacher_count = 1 then
      select teacher.id into v_teacher_id
      from public.teachers teacher
      join public.teacher_groups assignment on assignment.teacher_id = teacher.id and assignment.group_id = p_group_id
      where teacher.active = true
      limit 1;
    end if;
  end if;
  if v_teacher_id is null or not exists (
    select 1 from public.teachers teacher
    join public.teacher_groups assignment on assignment.teacher_id = teacher.id
    where teacher.id = v_teacher_id and teacher.active = true and assignment.group_id = p_group_id
  ) then
    raise exception 'teacher_not_assigned' using errcode = '22023';
  end if;

  insert into public.calendar_events (id, group_id, kind, title, starts_at, ends_at, created_by)
  values (p_event_id, p_group_id, 'clase', pg_catalog.btrim(p_title), p_starts_at, p_ends_at, v_actor);
  insert into public.class_sessions (id, event_id, group_id, teacher_id, meet_url, recording_allowed, recording_file_id)
  values (p_id, p_event_id, p_group_id, v_teacher_id, p_meet_url, false, null);
  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (pg_catalog.gen_random_uuid(), v_actor, 'schedule_meet', 'class_session', p_id::text, v_now);
  perform public.school_notify_calendar_families('clase', 'Nueva clase virtual programada', '/clases', p_id, p_group_id);

  return pg_catalog.jsonb_build_object('id', p_id, 'eventId', p_event_id, 'createdAt', v_now);
end;
$$;

-- Eventos, clases, avisos y su auditoría solo se escriben mediante estas RPC.
revoke insert, update, delete on table public.calendar_events from authenticated;
revoke insert, update, delete on table public.class_sessions from authenticated;

revoke all on function public.school_notify_calendar_families(text, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.school_calendar_feed(timestamptz, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.school_create_calendar_event(uuid, uuid, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.school_update_calendar_event(uuid, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.school_delete_calendar_event(uuid) from public, anon, authenticated;
revoke all on function public.school_list_class_options() from public, anon, authenticated;
revoke all on function public.school_list_class_sessions(integer) from public, anon, authenticated;
revoke all on function public.school_create_class_session(uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, text) from public, anon, authenticated;

grant execute on function public.school_calendar_feed(timestamptz, timestamptz, integer) to authenticated;
grant execute on function public.school_create_calendar_event(uuid, uuid, text, text, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.school_update_calendar_event(uuid, text, text, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.school_delete_calendar_event(uuid) to authenticated;
grant execute on function public.school_list_class_options() to authenticated;
grant execute on function public.school_list_class_sessions(integer) to authenticated;
grant execute on function public.school_create_class_session(uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, text) to authenticated;

commit;
