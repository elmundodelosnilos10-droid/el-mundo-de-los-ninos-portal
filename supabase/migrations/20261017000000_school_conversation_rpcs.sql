-- Chat privado entre docentes y familias.
-- Aplicar después de las migraciones de esquema, RLS y almacenamiento.
-- El proveedor activo continúa siendo D1 hasta configurar Supabase.
begin;

create function public.school_conversation_contacts()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_items jsonb;
begin
  if not public.school_actor_active()
    or not public.school_has_role(array['docente', 'tutor']::text[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select coalesce(pg_catalog.jsonb_agg(contact.item order by contact.student_name, contact.teacher_name, contact.guardian_name), '[]'::jsonb)
  into v_items
  from (
    select distinct
      student.given_name as student_name,
      teacher_profile.name as teacher_name,
      guardian_profile.name as guardian_name,
      pg_catalog.jsonb_build_object(
        'studentId', student.id,
        'studentName', student.given_name,
        'teacherId', teacher.id,
        'teacherName', teacher_profile.name,
        'guardianId', case when public.school_has_role(array['docente']::text[]) then guardian.id else null end,
        'guardianName', case when public.school_has_role(array['docente']::text[]) then guardian_profile.name else null end
      ) as item
    from public.students student
    join public.enrollments enrollment on enrollment.student_id = student.id and enrollment.ended_at is null
    join public.groups group_row on group_row.id = enrollment.group_id and group_row.active = true
    join public.teacher_groups teacher_group on teacher_group.group_id = group_row.id
    join public.teachers teacher on teacher.id = teacher_group.teacher_id and teacher.active = true
    join public.profiles teacher_profile on teacher_profile.id = teacher.user_id and teacher_profile.active = true
    join public.student_guardians student_guardian on student_guardian.student_id = student.id and student_guardian.active = true
    join public.guardians guardian on guardian.id = student_guardian.guardian_id and guardian.active = true
    join public.profiles guardian_profile on guardian_profile.id = guardian.user_id and guardian_profile.active = true
    where student.active = true
      and (
        (public.school_has_role(array['docente']::text[]) and teacher.user_id = (select auth.uid()))
        or (public.school_has_role(array['tutor']::text[]) and guardian.user_id = (select auth.uid()))
      )
  ) contact;

  return pg_catalog.jsonb_build_object('items', coalesce(v_items, '[]'::jsonb));
end;
$$;

create function public.school_conversation_feed()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_items jsonb;
begin
  if not public.school_actor_active()
    or not public.school_has_role(array['docente', 'tutor']::text[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select coalesce(pg_catalog.jsonb_agg(feed.item order by feed.created_at, feed.id), '[]'::jsonb)
  into v_items
  from (
    select conversation.id, conversation.created_at,
      pg_catalog.jsonb_build_object(
        'id', conversation.id,
        'studentId', student.id,
        'studentName', student.given_name,
        'studentFamilyName', student.family_name,
        'teacherName', case when teacher.user_id = (select auth.uid()) then null else teacher_profile.name end,
        'guardianName', case when guardian.user_id = (select auth.uid()) then null else guardian_profile.name end,
        'createdAt', conversation.created_at,
        'unreadCount', (
          select pg_catalog.count(*)::integer
          from public.messages message
          where message.conversation_id = conversation.id
            and message.author_id <> (select auth.uid()) and message.read_at is null
        )
      ) as item
    from public.conversations conversation
    join public.students student on student.id = conversation.student_id and student.active = true
    join public.teachers teacher on teacher.id = conversation.teacher_id and teacher.active = true
    join public.profiles teacher_profile on teacher_profile.id = teacher.user_id and teacher_profile.active = true
    join public.guardians guardian on guardian.id = conversation.guardian_id and guardian.active = true
    join public.profiles guardian_profile on guardian_profile.id = guardian.user_id and guardian_profile.active = true
    where public.school_is_conversation_member(conversation.id)
  ) feed;

  return pg_catalog.jsonb_build_object('items', coalesce(v_items, '[]'::jsonb));
end;
$$;

create function public.school_open_conversation(
  p_id uuid,
  p_student_id uuid,
  p_teacher_id uuid,
  p_guardian_id uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_guardian_id uuid := p_guardian_id;
  v_conversation_id uuid;
  v_inserted integer;
  v_now timestamptz := pg_catalog.now();
begin
  if v_actor is null or not public.school_actor_active()
    or not public.school_has_role(array['docente', 'tutor']::text[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_id is null or p_student_id is null or p_teacher_id is null then
    raise exception 'invalid_conversation' using errcode = '22023';
  end if;

  if public.school_has_role(array['tutor']::text[]) then
    select guardian.id into v_guardian_id
    from public.guardians guardian
    join public.student_guardians link on link.guardian_id = guardian.id and link.student_id = p_student_id and link.active = true
    join public.students student on student.id = link.student_id and student.active = true
    where guardian.user_id = v_actor and guardian.active = true
    limit 1;
    if v_guardian_id is null or (p_guardian_id is not null and p_guardian_id <> v_guardian_id) then
      raise exception 'conversation_not_available' using errcode = 'P0002';
    end if;
  elsif v_guardian_id is null or not exists (
    select 1
    from public.guardians guardian
    join public.student_guardians link on link.guardian_id = guardian.id and link.student_id = p_student_id and link.active = true
    where guardian.id = v_guardian_id and guardian.active = true
  ) then
    raise exception 'conversation_not_available' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.students student
    join public.enrollments enrollment on enrollment.student_id = student.id and enrollment.ended_at is null
    join public.groups group_row on group_row.id = enrollment.group_id and group_row.active = true
    join public.teacher_groups teacher_group on teacher_group.group_id = group_row.id and teacher_group.teacher_id = p_teacher_id
    join public.teachers teacher on teacher.id = teacher_group.teacher_id and teacher.active = true
    where student.id = p_student_id and student.active = true
      and (public.school_has_role(array['tutor']::text[]) or teacher.user_id = v_actor)
  ) then
    raise exception 'conversation_not_available' using errcode = 'P0002';
  end if;

  insert into public.conversations (id, student_id, teacher_id, guardian_id, created_at)
  values (p_id, p_student_id, p_teacher_id, v_guardian_id, v_now)
  on conflict (student_id, teacher_id, guardian_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then
    v_conversation_id := p_id;
    insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
    values (pg_catalog.gen_random_uuid(), v_actor, 'open', 'conversation', v_conversation_id::text, v_now);
  else
    select conversation.id into v_conversation_id
    from public.conversations conversation
    where conversation.student_id = p_student_id and conversation.teacher_id = p_teacher_id
      and conversation.guardian_id = v_guardian_id;
  end if;

  return pg_catalog.jsonb_build_object('id', v_conversation_id, 'created', v_inserted = 1);
end;
$$;

create function public.school_message_page(
  p_conversation_id uuid,
  p_before_sent_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_items jsonb;
  v_has_older boolean;
begin
  if not public.school_actor_active() or not public.school_is_conversation_member(p_conversation_id) then
    raise exception 'conversation_not_available' using errcode = 'P0002';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50
    or ((p_before_sent_at is null) <> (p_before_id is null)) then
    raise exception 'invalid_message_cursor' using errcode = '22023';
  end if;

  with page as materialized (
    select message.id, message.body, message.sent_at, message.author_id, message.read_at,
      author.name as author_name, file.id as file_id, file.original_name as file_name
    from public.messages message
    join public.profiles author on author.id = message.author_id
    left join public.files file on file.id = message.file_id and file.deleted_at is null
    where message.conversation_id = p_conversation_id
      and (p_before_sent_at is null or message.sent_at < p_before_sent_at
        or (message.sent_at = p_before_sent_at and message.id < p_before_id))
    order by message.sent_at desc, message.id desc
    limit p_limit + 1
  ), visible as (
    select * from page order by sent_at desc, id desc limit p_limit
  )
  select
    coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', visible.id,
      'body', visible.body,
      'sentAt', visible.sent_at,
      'authorId', visible.author_id,
      'authorName', visible.author_name,
      'readAt', visible.read_at,
      'isMine', visible.author_id = (select auth.uid()),
      'order', pg_catalog.to_char(visible.sent_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || visible.id::text,
      'file', case when visible.file_id is not null and visible.file_name is not null
        then pg_catalog.jsonb_build_object('id', visible.file_id, 'name', visible.file_name, 'url', '/api/files/' || visible.file_id::text)
        else null end
    ) order by visible.sent_at, visible.id), '[]'::jsonb),
    (select pg_catalog.count(*) > p_limit from page)
  into v_items, v_has_older
  from visible;

  return pg_catalog.jsonb_build_object('items', coalesce(v_items, '[]'::jsonb), 'hasOlder', coalesce(v_has_older, false));
end;
$$;

create function public.school_send_message(
  p_id uuid,
  p_conversation_id uuid,
  p_body text,
  p_file_id uuid default null,
  p_object_key text default null,
  p_original_name text default null,
  p_mime_type text default null,
  p_size_bytes integer default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_student_id uuid;
  v_recipient_id uuid;
  v_now timestamptz := pg_catalog.now();
begin
  if v_actor is null or not public.school_actor_active()
    or not public.school_has_role(array['docente', 'tutor']::text[])
    or not public.school_is_conversation_member(p_conversation_id) then
    raise exception 'conversation_not_available' using errcode = 'P0002';
  end if;
  if p_id is null or p_body is null or pg_catalog.char_length(p_body) > 3000
    or (pg_catalog.char_length(pg_catalog.btrim(p_body)) = 0 and p_file_id is null) then
    raise exception 'invalid_message' using errcode = '22023';
  end if;

  select conversation.student_id,
    case when guardian.user_id = v_actor then teacher.user_id else guardian.user_id end
  into v_student_id, v_recipient_id
  from public.conversations conversation
  join public.teachers teacher on teacher.id = conversation.teacher_id and teacher.active = true
  join public.guardians guardian on guardian.id = conversation.guardian_id and guardian.active = true
  join public.students student on student.id = conversation.student_id and student.active = true
  where conversation.id = p_conversation_id;
  if v_student_id is null or v_recipient_id is null then
    raise exception 'conversation_not_available' using errcode = 'P0002';
  end if;

  if p_file_id is null then
    if p_object_key is not null or p_original_name is not null or p_mime_type is not null or p_size_bytes is not null then
      raise exception 'invalid_message_file' using errcode = '22023';
    end if;
  else
    if p_object_key is null or p_original_name is null or p_mime_type is null or p_size_bytes is null
      or pg_catalog.char_length(pg_catalog.btrim(p_original_name)) not between 1 and 160
      or p_size_bytes not between 1 and 10485760
      or p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
      or p_object_key !~ '^supabase:private/message/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89a-fA-F][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
      raise exception 'invalid_message_file' using errcode = '22023';
    end if;
    insert into public.files (id, object_key, original_name, mime_type, size_bytes, purpose, uploaded_by, group_id, student_id, created_at)
    values (p_file_id, p_object_key, pg_catalog.btrim(p_original_name), p_mime_type, p_size_bytes, 'message', v_actor, null, v_student_id, v_now);
  end if;

  insert into public.messages (id, conversation_id, author_id, body, file_id, sent_at)
  values (p_id, p_conversation_id, v_actor, pg_catalog.btrim(p_body), p_file_id, v_now);
  insert into public.notifications (id, user_id, kind, title, href, dedupe_key, created_at)
  values (pg_catalog.gen_random_uuid(), v_recipient_id, 'mensaje', 'Tienes un mensaje nuevo', '/comunicacion', 'message:' || p_id::text, v_now)
  on conflict (dedupe_key) do nothing;
  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (pg_catalog.gen_random_uuid(), v_actor, case when p_file_id is null then 'send_message' else 'send_message_attachment' end, 'conversation', p_conversation_id::text, v_now);

  return pg_catalog.jsonb_build_object('id', p_id, 'sentAt', v_now);
end;
$$;

create function public.school_mark_conversation_read(
  p_conversation_id uuid,
  p_through_sent_at timestamptz,
  p_through_id uuid
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_read_at timestamptz := pg_catalog.now();
begin
  if v_actor is null or not public.school_actor_active()
    or not public.school_has_role(array['docente', 'tutor']::text[])
    or not public.school_is_conversation_member(p_conversation_id) then
    raise exception 'conversation_not_available' using errcode = 'P0002';
  end if;
  if p_through_sent_at is null or p_through_id is null or not exists (
    select 1 from public.messages message
    where message.id = p_through_id and message.conversation_id = p_conversation_id
      and message.sent_at = p_through_sent_at
  ) then
    raise exception 'invalid_message_cursor' using errcode = '22023';
  end if;

  update public.messages message set read_at = v_read_at
  where message.conversation_id = p_conversation_id and message.author_id <> v_actor and message.read_at is null
    and (message.sent_at < p_through_sent_at or (message.sent_at = p_through_sent_at and message.id <= p_through_id));
  return pg_catalog.jsonb_build_object('readAt', v_read_at);
end;
$$;

revoke all on function public.school_conversation_contacts() from public, anon, authenticated;
revoke all on function public.school_conversation_feed() from public, anon, authenticated;
revoke all on function public.school_open_conversation(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.school_message_page(uuid, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.school_send_message(uuid, uuid, text, uuid, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.school_mark_conversation_read(uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.school_conversation_contacts() to authenticated;
grant execute on function public.school_conversation_feed() to authenticated;
grant execute on function public.school_open_conversation(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.school_message_page(uuid, timestamptz, uuid, integer) to authenticated;
grant execute on function public.school_send_message(uuid, uuid, text, uuid, text, text, text, integer) to authenticated;
grant execute on function public.school_mark_conversation_read(uuid, timestamptz, uuid) to authenticated;

-- Chat writes now pass through RPCs so a message, notification, and audit row
-- commit together; message read receipts are likewise applied server-side.
revoke insert on table public.conversations from authenticated;
revoke insert, update on table public.messages from authenticated;
revoke update (read_at) on table public.messages from authenticated;
revoke insert, update, delete on table public.files from authenticated;

commit;
