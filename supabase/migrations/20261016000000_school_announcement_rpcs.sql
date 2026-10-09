-- Comunicados escolares persistentes y recibos de lectura.
-- D1 permanece como proveedor activo hasta importar y verificar los datos.
begin;

create function public.school_notify_announcement_families(
  p_announcement_id uuid,
  p_group_id uuid,
  p_important boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_title text;
  v_count integer;
begin
  if p_announcement_id is null or p_important is null then
    raise exception 'invalid_announcement_notice' using errcode = '22023';
  end if;
  v_title := case when p_important then 'Comunicado importante' else 'Nuevo comunicado escolar' end;

  if p_group_id is null then
    insert into public.notifications (id, user_id, kind, title, href, dedupe_key, created_at)
    select pg_catalog.gen_random_uuid(), recipients.user_id, 'comunicado', v_title, '/comunicados',
      'announcement:' || p_announcement_id::text || ':' || recipients.user_id::text, v_now
    from (
      select distinct guardian.user_id
      from public.enrollments enrollment
      join public.students student on student.id = enrollment.student_id and student.active = true
      join public.groups group_row on group_row.id = enrollment.group_id and group_row.active = true
      join public.student_guardians link on link.student_id = student.id and link.active = true
      join public.guardians guardian on guardian.id = link.guardian_id and guardian.active = true
      join public.profiles profile on profile.id = guardian.user_id and profile.active = true
      join public.user_roles role_row on role_row.user_id = guardian.user_id and role_row.role = 'tutor'
      where enrollment.ended_at is null
    ) recipients
    on conflict (dedupe_key) do nothing;
  else
    insert into public.notifications (id, user_id, kind, title, href, dedupe_key, created_at)
    select pg_catalog.gen_random_uuid(), recipients.user_id, 'comunicado', v_title, '/comunicados',
      'announcement:' || p_announcement_id::text || ':' || recipients.user_id::text, v_now
    from (
      select distinct guardian.user_id
      from public.enrollments enrollment
      join public.students student on student.id = enrollment.student_id and student.active = true
      join public.groups group_row on group_row.id = enrollment.group_id and group_row.active = true
      join public.student_guardians link on link.student_id = student.id and link.active = true
      join public.guardians guardian on guardian.id = link.guardian_id and guardian.active = true
      join public.profiles profile on profile.id = guardian.user_id and profile.active = true
      join public.user_roles role_row on role_row.user_id = guardian.user_id and role_row.role = 'tutor'
      where enrollment.ended_at is null and enrollment.group_id = p_group_id
    ) recipients
    on conflict (dedupe_key) do nothing;
  end if;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function public.school_announcement_feed(p_limit integer default 200)
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
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'invalid_announcement_limit' using errcode = '22023';
  end if;

  select coalesce(pg_catalog.jsonb_agg(page.item order by page.published_at, page.id), '[]'::jsonb)
  into v_items
  from (
    select announcement.id, announcement.published_at,
      pg_catalog.jsonb_build_object(
        'id', announcement.id,
        'groupId', announcement.group_id,
        'title', announcement.title,
        'body', announcement.body,
        'important', announcement.important,
        'publishedBy', announcement.published_by,
        'publishedAt', announcement.published_at,
        'readAt', receipt.read_at
      ) as item
    from public.announcements announcement
    left join public.announcement_reads receipt
      on receipt.announcement_id = announcement.id and receipt.user_id = auth.uid()
    left join public.groups group_row on group_row.id = announcement.group_id
    where announcement.group_id is null
      or (group_row.active = true and public.school_can_access_group(announcement.group_id))
    order by announcement.published_at desc, announcement.id desc
    limit p_limit
  ) page;

  return pg_catalog.jsonb_build_object('items', coalesce(v_items, '[]'::jsonb));
end;
$$;

create function public.school_create_announcement(
  p_id uuid,
  p_group_id uuid,
  p_title text,
  p_body text,
  p_important boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := pg_catalog.now();
  v_notified integer;
begin
  if v_actor is null or not public.school_actor_active()
    or not public.school_has_role(array['superadmin', 'direccion', 'docente']::text[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_id is null or p_title is null or pg_catalog.char_length(pg_catalog.btrim(p_title)) not between 2 and 120
    or p_body is null or pg_catalog.char_length(pg_catalog.btrim(p_body)) not between 2 and 3000
    or p_important is null then
    raise exception 'invalid_announcement' using errcode = '22023';
  end if;
  if p_group_id is null then
    if not public.school_is_leader() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  elsif not public.school_is_leader_or_teacher(p_group_id)
    or not exists (select 1 from public.groups group_row where group_row.id = p_group_id and group_row.active = true) then
    raise exception 'group_not_available' using errcode = 'P0002';
  end if;

  insert into public.announcements (id, group_id, title, body, important, published_by, published_at)
  values (p_id, p_group_id, pg_catalog.btrim(p_title), pg_catalog.btrim(p_body), p_important, v_actor, v_now);
  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (pg_catalog.gen_random_uuid(), v_actor, 'publish', 'announcement', p_id::text, v_now);
  v_notified := public.school_notify_announcement_families(p_id, p_group_id, p_important);

  return pg_catalog.jsonb_build_object('id', p_id, 'notified', v_notified, 'publishedAt', v_now);
end;
$$;

create function public.school_mark_announcement_read(p_announcement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_group_id uuid;
begin
  if v_actor is null or not public.school_actor_active() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_announcement_id is null then
    raise exception 'invalid_announcement' using errcode = '22023';
  end if;
  select announcement.group_id into v_group_id
  from public.announcements announcement
  left join public.groups group_row on group_row.id = announcement.group_id
  where announcement.id = p_announcement_id
    and (announcement.group_id is null or (group_row.active = true and public.school_can_access_group(announcement.group_id)));
  if not found then
    raise exception 'announcement_not_available' using errcode = 'P0002';
  end if;

  insert into public.announcement_reads (announcement_id, user_id, read_at)
  values (p_announcement_id, v_actor, pg_catalog.now())
  on conflict (announcement_id, user_id) do nothing;
  return pg_catalog.jsonb_build_object('read', true);
end;
$$;

revoke all on function public.school_notify_announcement_families(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.school_announcement_feed(integer) from public, anon, authenticated;
revoke all on function public.school_create_announcement(uuid, uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.school_mark_announcement_read(uuid) from public, anon, authenticated;
grant execute on function public.school_announcement_feed(integer) to authenticated;
grant execute on function public.school_create_announcement(uuid, uuid, text, text, boolean) to authenticated;
grant execute on function public.school_mark_announcement_read(uuid) to authenticated;

commit;
