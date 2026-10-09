-- Operaciones de asistencia para la migración gradual D1 → Supabase.
-- Todas las escrituras, auditorías y avisos de una operación se confirman juntas.
begin;

-- Se usa internamente para rechazar fechas no ISO y fechas imposibles antes de
-- comparar texto (el esquema conserva on_date como text por compatibilidad).
create function public.school_attendance_parse_date(p_value text)
returns date
language plpgsql immutable
set search_path = ''
as $$
declare
  parsed_date date;
begin
  if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'invalid_attendance_date' using errcode = '22023';
  end if;
  begin
    parsed_date := p_value::date;
  exception when others then
    raise exception 'invalid_attendance_date' using errcode = '22023';
  end;
  if pg_catalog.to_char(parsed_date, 'YYYY-MM-DD') <> p_value then
    raise exception 'invalid_attendance_date' using errcode = '22023';
  end if;
  return parsed_date;
end;
$$;

revoke all on function public.school_attendance_parse_date(text) from public, anon, authenticated;

-- New writes must retain the app's date/reason invariants even if another
-- authenticated code path is accidentally granted table DML in the future.
alter table public.attendance
  add constraint attendance_on_date_iso_check
    check (public.school_attendance_parse_date(on_date) is not null) not valid,
  add constraint attendance_note_length_check
    check (note is null or char_length(btrim(note)) <= 400) not valid,
  add constraint attendance_justified_reason_check
    check (status <> 'justificada' or char_length(btrim(coalesce(note, ''))) between 2 and 400) not valid;

alter table public.attendance_justifications
  add constraint attendance_justifications_on_date_iso_check
    check (public.school_attendance_parse_date(on_date) is not null) not valid,
  add constraint attendance_justifications_reason_length_check
    check (char_length(btrim(reason)) between 2 and 400) not valid,
  add constraint attendance_justifications_review_state_check
    check ((status = 'pendiente' and reviewed_by is null and reviewed_at is null)
      or (status in ('aceptada', 'rechazada') and reviewed_by is not null and reviewed_at is not null)) not valid;

create index attendance_on_date_group_idx on public.attendance(on_date, group_id);

-- The daily list returns the active roster to assigned staff (including
-- students not yet marked) and only recorded linked children to their tutors.
create function public.school_attendance_roster(p_group_id uuid, p_on_date text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  is_staff boolean;
  result_items jsonb;
begin
  perform public.school_attendance_parse_date(p_on_date);
  if actor_id is null or not public.school_actor_active() or p_group_id is null then
    raise exception 'attendance_group_unavailable' using errcode = 'P0002';
  end if;

  is_staff := public.school_is_leader() or public.school_is_teacher_of_group(p_group_id);
  if not is_staff and not public.school_has_role(array['tutor']::text[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not public.school_can_access_group(p_group_id) then
    raise exception 'attendance_group_unavailable' using errcode = 'P0002';
  end if;

  if is_staff then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', attendance_id,
          'studentId', student_id,
          'givenName', given_name,
          'familyName', family_name,
          'status', status,
          'note', note,
          'modifiedAt', modified_at
        ) order by family_name, given_name, student_id
      ), '[]'::jsonb
    ) into result_items
    from (
      select a.id as attendance_id, s.id as student_id, s.given_name, s.family_name,
        a.status, a.note, a.modified_at
      from public.enrollments e
      join public.students s on s.id = e.student_id and s.active = true
      left join public.attendance a on a.student_id = s.id and a.on_date = p_on_date
        and a.group_id = p_group_id
      where e.group_id = p_group_id and e.ended_at is null
    ) roster;
  else
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'studentId', s.id,
          'givenName', s.given_name,
          'familyName', s.family_name,
          'status', a.status,
          'note', a.note,
          'modifiedAt', a.modified_at
        ) order by s.family_name, s.given_name, s.id
      ), '[]'::jsonb
    ) into result_items
    from public.attendance a
    join public.students s on s.id = a.student_id and s.active = true
    where a.group_id = p_group_id and a.on_date = p_on_date
      and public.school_is_guardian_of_student(s.id);
  end if;

  return jsonb_build_object('items', result_items);
end;
$$;

-- Individual history supports either a tutor's linked child (group NULL) or
-- authorized staff looking at one specific group. The range is inclusive.
create function public.school_attendance_history(
  p_student_id uuid,
  p_group_id uuid,
  p_from text,
  p_to text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  from_date date := public.school_attendance_parse_date(p_from);
  to_date date := public.school_attendance_parse_date(p_to);
  staff_scope boolean;
  student_given_name text;
  student_family_name text;
  rows_json jsonb;
  count_present integer;
  count_late integer;
  count_absent integer;
  count_justified integer;
  total_count integer;
begin
  if actor_id is null or not public.school_actor_active() or p_student_id is null or from_date > to_date then
    raise exception 'invalid_attendance_history' using errcode = '22023';
  end if;
  if (to_date - from_date) + 1 > 366 then
    raise exception 'attendance_period_too_long' using errcode = '22023';
  end if;

  if p_group_id is null then
    if not public.school_is_guardian_of_student(p_student_id) then
      raise exception 'student_unavailable' using errcode = 'P0002';
    end if;
  else
    staff_scope := public.school_is_leader() or public.school_is_teacher_of_group(p_group_id);
    if not staff_scope then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if not public.school_is_leader() and not exists (
      select 1 from public.enrollments e
      where e.student_id = p_student_id and e.group_id = p_group_id
    ) then
      raise exception 'student_unavailable' using errcode = 'P0002';
    end if;
    if not exists (select 1 from public.students s where s.id = p_student_id) then
      raise exception 'student_unavailable' using errcode = 'P0002';
    end if;
  end if;

  select s.given_name, s.family_name into student_given_name, student_family_name
  from public.students s where s.id = p_student_id;
  if not found then
    raise exception 'student_unavailable' using errcode = 'P0002';
  end if;

  select
    count(*) filter (where a.status = 'presente')::integer,
    count(*) filter (where a.status = 'retardo')::integer,
    count(*) filter (where a.status = 'ausente')::integer,
    count(*) filter (where a.status = 'justificada')::integer,
    count(*)::integer
  into count_present, count_late, count_absent, count_justified, total_count
  from public.attendance a
  where a.student_id = p_student_id and a.on_date between p_from and p_to
    and (p_group_id is null or a.group_id = p_group_id);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'date', a.on_date,
      'studentId', s.id,
      'givenName', s.given_name,
      'familyName', s.family_name,
      'groupName', g.name,
      'status', a.status,
      'note', a.note
    ) order by a.on_date, g.name, a.id
  ), '[]'::jsonb)
  into rows_json
  from public.attendance a
  join public.students s on s.id = a.student_id
  join public.groups g on g.id = a.group_id
  where a.student_id = p_student_id and a.on_date between p_from and p_to
    and (p_group_id is null or a.group_id = p_group_id);

  return jsonb_build_object(
    'student', jsonb_build_object('id', p_student_id, 'name', student_given_name || ' ' || student_family_name),
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'counts', jsonb_build_object(
      'presente', coalesce(count_present, 0),
      'retardo', coalesce(count_late, 0),
      'ausente', coalesce(count_absent, 0),
      'justificada', coalesce(count_justified, 0)
    ),
    'total', coalesce(total_count, 0),
    'attendancePercent', case when coalesce(total_count, 0) = 0 then null
      else round(((count_present + count_late)::numeric / total_count) * 100)::integer end,
    'percentageRule', 'Presentes y retardos ÷ todos los registros del periodo; las faltas justificadas cuentan como ausencia.',
    'records', rows_json
  );
end;
$$;

-- Staff queries are scoped by group and date. Families query only one linked
-- child; the on-date parameter is optional for that read path.
create function public.school_list_attendance_justifications(
  p_group_id uuid,
  p_on_date text,
  p_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_items jsonb;
begin
  if auth.uid() is null or not public.school_actor_active() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_group_id is not null then
    if p_on_date is null then
      raise exception 'invalid_justification_filter' using errcode = '22023';
    end if;
    perform public.school_attendance_parse_date(p_on_date);
    if not (public.school_is_leader() or public.school_is_teacher_of_group(p_group_id)) then
      raise exception 'attendance_group_unavailable' using errcode = 'P0002';
    end if;
    if p_student_id is not null then
      raise exception 'invalid_justification_filter' using errcode = '22023';
    end if;

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', j.id,
        'studentId', s.id,
        'studentName', s.given_name,
        'studentFamilyName', s.family_name,
        'groupId', g.id,
        'groupName', g.name,
        'onDate', j.on_date,
        'reason', j.reason,
        'status', j.status,
        'createdAt', j.created_at,
        'reviewedAt', j.reviewed_at
      ) order by j.created_at desc, j.id
    ), '[]'::jsonb) into result_items
    from (
      select * from public.attendance_justifications
      where group_id = p_group_id and on_date = p_on_date
      order by created_at desc, id limit 100
    ) j
    join public.students s on s.id = j.student_id
    join public.groups g on g.id = j.group_id;
  elsif p_student_id is not null then
    if not public.school_is_guardian_of_student(p_student_id) then
      raise exception 'student_unavailable' using errcode = 'P0002';
    end if;
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', j.id,
        'studentId', s.id,
        'studentName', s.given_name,
        'studentFamilyName', s.family_name,
        'groupId', g.id,
        'groupName', g.name,
        'onDate', j.on_date,
        'reason', j.reason,
        'status', j.status,
        'createdAt', j.created_at,
        'reviewedAt', j.reviewed_at
      ) order by j.on_date desc, j.created_at desc, j.id
    ), '[]'::jsonb) into result_items
    from (
      select * from public.attendance_justifications
      where student_id = p_student_id
      order by on_date desc, created_at desc, id limit 100
    ) j
    join public.students s on s.id = j.student_id
    join public.groups g on g.id = j.group_id;
  else
    raise exception 'invalid_justification_filter' using errcode = '22023';
  end if;

  return jsonb_build_object('items', result_items);
end;
$$;

-- Save a full group list atomically. Students and enrollment rows are locked so
-- enrollment cannot be withdrawn halfway through the write; duplicate daily
-- rows remain prevented by the existing unique(student_id, on_date) index.
create function public.school_record_attendance(
  p_group_id uuid,
  p_on_date text,
  p_records jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  row_value jsonb;
  v_student_id uuid;
  attendance_id uuid;
  note_value text;
  current_status text;
  existed boolean;
  record_count integer;
  distinct_count integer;
  enrolled_count integer;
  student_ids uuid[];
  now_at timestamptz := pg_catalog.now();
begin
  perform public.school_attendance_parse_date(p_on_date);
  if actor_id is null or not public.school_actor_active()
    or not (public.school_is_leader() or public.school_is_teacher_of_group(p_group_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_group_id is null or not exists (
    select 1 from public.groups g where g.id = p_group_id and g.active = true
  ) then
    raise exception 'attendance_group_unavailable' using errcode = 'P0002';
  end if;
  if p_records is null or jsonb_typeof(p_records) is distinct from 'array' then
    raise exception 'invalid_attendance_records' using errcode = '22023';
  end if;
  if jsonb_array_length(p_records) not between 1 and 80 then
    raise exception 'invalid_attendance_records' using errcode = '22023';
  end if;

  record_count := jsonb_array_length(p_records);
  if exists (
    select 1 from jsonb_array_elements(p_records) as item(value)
    where case when jsonb_typeof(value) <> 'object' then true else
      not (value ? 'studentId') or not (value ? 'status')
      or (value - 'studentId' - 'status' - 'note') <> '{}'::jsonb
      or coalesce(value->>'studentId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(value->>'status', '') not in ('presente', 'ausente', 'retardo', 'justificada')
      or (value ? 'note' and jsonb_typeof(value->'note') not in ('string', 'null'))
      or char_length(btrim(coalesce(value->>'note', ''))) > 400
      or (value->>'status' = 'justificada' and char_length(btrim(coalesce(value->>'note', ''))) < 2)
    end
  ) then
    raise exception 'invalid_attendance_records' using errcode = '22023';
  end if;

  select count(distinct value->>'studentId')::integer,
    array_agg((value->>'studentId')::uuid)
  into distinct_count, student_ids
  from jsonb_array_elements(p_records) as item(value);
  if distinct_count <> record_count then
    raise exception 'duplicate_attendance_student' using errcode = '22023';
  end if;

  perform e.id
  from public.enrollments e
  join public.students s on s.id = e.student_id and s.active = true
  where e.group_id = p_group_id and e.ended_at is null
    and e.student_id = any(student_ids)
  order by e.student_id
  for update of e, s;
  get diagnostics enrolled_count = row_count;
  if enrolled_count <> record_count then
    raise exception 'student_not_enrolled_in_group' using errcode = '22023';
  end if;

  for row_value in select value from jsonb_array_elements(p_records) as item(value)
  loop
    v_student_id := (row_value->>'studentId')::uuid;
    current_status := row_value->>'status';
    note_value := nullif(btrim(row_value->>'note'), '');

    select a.id into attendance_id from public.attendance a
    where a.student_id = v_student_id and a.on_date = p_on_date
    for update;
    existed := found;
    if existed then
      update public.attendance
      set group_id = p_group_id, status = current_status, note = note_value,
        modified_by = actor_id, modified_at = now_at
      where id = attendance_id;
      insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
      values (pg_catalog.gen_random_uuid(), actor_id, 'correct_attendance', 'attendance', attendance_id::text, now_at);
    else
      attendance_id := pg_catalog.gen_random_uuid();
      insert into public.attendance (id, student_id, group_id, on_date, status, note, recorded_by)
      values (attendance_id, v_student_id, p_group_id, p_on_date, current_status, note_value, actor_id);
      insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
      values (pg_catalog.gen_random_uuid(), actor_id, 'record_attendance', 'attendance', attendance_id::text, now_at);
    end if;
  end loop;

  return jsonb_build_object('saved', record_count);
end;
$$;

-- Submit or resubmit a rejected family justification. Locking the student row
-- serializes same-child requests even when no justification row exists yet.
create function public.school_submit_attendance_justification(
  p_id uuid,
  p_student_id uuid,
  p_on_date text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  v_group_id uuid;
  active_enrollments integer;
  justification_id uuid;
  justification_status text;
  event_id uuid := pg_catalog.gen_random_uuid();
  now_at timestamptz := pg_catalog.now();
begin
  perform public.school_attendance_parse_date(p_on_date);
  if actor_id is null or not public.school_actor_active()
    or not public.school_has_role(array['tutor']::text[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_id is null or p_student_id is null or p_reason is null
    or char_length(btrim(p_reason)) not between 2 and 400 then
    raise exception 'invalid_attendance_justification' using errcode = '22023';
  end if;
  if not public.school_is_guardian_of_student(p_student_id) then
    raise exception 'student_unavailable' using errcode = 'P0002';
  end if;

  perform s.id from public.students s where s.id = p_student_id and s.active = true for update;
  if not found then
    raise exception 'student_unavailable' using errcode = 'P0002';
  end if;
  select count(*)::integer into active_enrollments
  from public.enrollments e
  where e.student_id = p_student_id and e.ended_at is null;
  if active_enrollments <> 1 then
    raise exception 'student_active_enrollment_ambiguous' using errcode = '22023';
  end if;
  select e.group_id into v_group_id from public.enrollments e
  where e.student_id = p_student_id and e.ended_at is null
  for update;

  select j.id, j.status into justification_id, justification_status
  from public.attendance_justifications j
  where j.student_id = p_student_id and j.on_date = p_on_date
  for update;
  if found then
    if justification_status <> 'rechazada' then
      raise exception 'attendance_justification_already_exists' using errcode = '23505';
    end if;
    update public.attendance_justifications
    set group_id = v_group_id, submitted_by = actor_id, reason = btrim(p_reason),
      status = 'pendiente', reviewed_by = null, reviewed_at = null, created_at = now_at
    where id = justification_id;
  else
    justification_id := p_id;
    insert into public.attendance_justifications
      (id, student_id, group_id, on_date, submitted_by, reason, status, reviewed_by, reviewed_at, created_at)
    values
      (justification_id, p_student_id, v_group_id, p_on_date, actor_id, btrim(p_reason), 'pendiente', null, null, now_at);
  end if;

  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (pg_catalog.gen_random_uuid(), actor_id, 'submit_attendance_justification', 'attendance_justification', justification_id::text, now_at);

  insert into public.notifications (id, user_id, kind, title, href, dedupe_key, created_at)
  select pg_catalog.gen_random_uuid(), recipients.user_id, 'asistencia_justificacion',
    'Nueva justificación de asistencia', '/asistencia',
    'attendance-justification:' || justification_id::text || ':pending:' || event_id::text || ':' || recipients.user_id::text,
    now_at
  from (
    select distinct t.user_id
    from public.teacher_groups tg
    join public.teachers t on t.id = tg.teacher_id and t.active = true
    join public.profiles p on p.id = t.user_id and p.active = true
    join public.user_roles r on r.user_id = t.user_id and r.role = 'docente'
    where tg.group_id = v_group_id
    union
    select r.user_id
    from public.user_roles r
    join public.profiles p on p.id = r.user_id and p.active = true
    where r.role in ('superadmin', 'direccion')
  ) recipients
  on conflict (dedupe_key) do nothing;

  return jsonb_build_object('id', justification_id, 'status', 'pendiente');
end;
$$;

-- Review is serialized by SELECT ... FOR UPDATE: exactly one staff member can
-- decide a pending request, and accepted attendance/audit/notices are atomic.
create function public.school_review_attendance_justification(
  p_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  request_student_id uuid;
  request_group_id uuid;
  request_on_date text;
  request_reason text;
  request_status text;
  attendance_id uuid;
  event_id uuid := pg_catalog.gen_random_uuid();
  now_at timestamptz := pg_catalog.now();
begin
  if actor_id is null or not public.school_actor_active()
    or not (public.school_is_leader() or public.school_has_role(array['docente']::text[])) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_id is null or p_status is null or p_status not in ('aceptada', 'rechazada') then
    raise exception 'invalid_attendance_justification_status' using errcode = '22023';
  end if;

  select j.student_id, j.group_id, j.on_date, j.reason, j.status
  into request_student_id, request_group_id, request_on_date, request_reason, request_status
  from public.attendance_justifications j where j.id = p_id for update;
  if not found then
    raise exception 'attendance_justification_unavailable' using errcode = 'P0002';
  end if;
  if not (public.school_is_leader() or public.school_is_teacher_of_group(request_group_id)) then
    raise exception 'attendance_justification_unavailable' using errcode = 'P0002';
  end if;
  if request_status <> 'pendiente' then
    raise exception 'attendance_justification_already_reviewed' using errcode = '23505';
  end if;

  update public.attendance_justifications
  set status = p_status, reviewed_by = actor_id, reviewed_at = now_at
  where id = p_id;

  if p_status = 'aceptada' then
    select a.id into attendance_id from public.attendance a
    where a.student_id = request_student_id and a.on_date = request_on_date
    for update;
    if found then
      update public.attendance
      set group_id = request_group_id, status = 'justificada', note = request_reason,
        modified_by = actor_id, modified_at = now_at
      where id = attendance_id;
    else
      attendance_id := pg_catalog.gen_random_uuid();
      insert into public.attendance (id, student_id, group_id, on_date, status, note, recorded_by, modified_by, modified_at)
      values (attendance_id, request_student_id, request_group_id, request_on_date, 'justificada', request_reason, actor_id, actor_id, now_at);
    end if;
    insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
    values (pg_catalog.gen_random_uuid(), actor_id, 'approve_attendance_justification', 'attendance_justification', p_id::text, now_at);
  else
    insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
    values (pg_catalog.gen_random_uuid(), actor_id, 'reject_attendance_justification', 'attendance_justification', p_id::text, now_at);
  end if;

  insert into public.notifications (id, user_id, kind, title, href, dedupe_key, created_at)
  select pg_catalog.gen_random_uuid(), recipients.user_id, 'asistencia_justificacion_' || p_status,
    case when p_status = 'aceptada' then 'Aceptaron tu justificación de asistencia'
      else 'Respondieron a tu justificación de asistencia' end,
    '/asistencia',
    'attendance-justification:' || p_id::text || ':' || p_status || ':' || event_id::text || ':' || recipients.user_id::text,
    now_at
  from (
    select distinct g.user_id
    from public.student_guardians sg
    join public.guardians g on g.id = sg.guardian_id and g.active = true
    join public.profiles p on p.id = g.user_id and p.active = true
    join public.user_roles r on r.user_id = g.user_id and r.role = 'tutor'
    where sg.student_id = request_student_id and sg.active = true
  ) recipients
  on conflict (dedupe_key) do nothing;

  return jsonb_build_object('status', p_status);
end;
$$;

-- Report data and audit share one transaction. p_group_id NULL means every
-- group and is reserved to school leadership. Each report is capped at 10k.
create function public.school_attendance_report(
  p_group_id uuid,
  p_from text,
  p_to text,
  p_format text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  from_date date := public.school_attendance_parse_date(p_from);
  to_date date := public.school_attendance_parse_date(p_to);
  row_count integer;
  selected_group_name text;
  report_items jsonb;
begin
  if actor_id is null or not public.school_actor_active()
    or not (public.school_is_leader() or public.school_has_role(array['docente']::text[])) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if from_date > to_date or (to_date - from_date) + 1 > 366
    or p_format is null or p_format not in ('csv', 'xlsx', 'pdf') then
    raise exception 'invalid_attendance_report' using errcode = '22023';
  end if;
  if p_group_id is null then
    if not public.school_is_leader() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    selected_group_name := 'Todos los grupos';
  else
    if not (public.school_is_leader() or public.school_is_teacher_of_group(p_group_id)) then
      raise exception 'attendance_group_unavailable' using errcode = 'P0002';
    end if;
    select g.name into selected_group_name from public.groups g
    where g.id = p_group_id and g.active = true;
    if not found then
      raise exception 'attendance_group_unavailable' using errcode = 'P0002';
    end if;
  end if;

  select count(*)::integer into row_count
  from public.attendance a
  where a.on_date between p_from and p_to
    and (p_group_id is null or a.group_id = p_group_id);
  if row_count > 10000 then
    raise exception 'attendance_report_too_large' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'date', a.on_date,
      'groupName', g.name,
      'givenName', s.given_name,
      'familyName', s.family_name,
      'status', a.status,
      'note', a.note
    ) order by a.on_date, g.name, s.family_name, s.given_name, a.id
  ), '[]'::jsonb) into report_items
  from public.attendance a
  join public.groups g on g.id = a.group_id
  join public.students s on s.id = a.student_id
  where a.on_date between p_from and p_to
    and (p_group_id is null or a.group_id = p_group_id);

  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (
    pg_catalog.gen_random_uuid(), actor_id, 'export_attendance_' || p_format,
    case when p_group_id is null then 'school' else 'group' end,
    coalesce(p_group_id::text, 'todos'), pg_catalog.now()
  );

  return jsonb_build_object('items', report_items, 'groupName', selected_group_name);
end;
$$;

-- Read-only direct table access remains under the policies below. All writes
-- go through the checked, transactional RPCs above; old permissive write
-- policies are removed so future grants cannot accidentally re-enable them.
drop policy if exists attendance_read_student on public.attendance;
drop policy if exists attendance_insert_staff on public.attendance;
drop policy if exists attendance_update_staff on public.attendance;
create policy attendance_read_authorized on public.attendance for select to authenticated
  using (
    public.school_is_leader()
    or public.school_is_teacher_of_group(group_id)
    or public.school_is_guardian_of_student(student_id)
  );
revoke insert, update, delete on table public.attendance from authenticated;

drop policy if exists attendance_justifications_read_student on public.attendance_justifications;
drop policy if exists attendance_justifications_insert_family on public.attendance_justifications;
drop policy if exists attendance_justifications_update_family on public.attendance_justifications;
drop policy if exists attendance_justifications_review_staff on public.attendance_justifications;
create policy attendance_justifications_read_authorized on public.attendance_justifications for select to authenticated
  using (
    public.school_is_leader()
    or public.school_is_teacher_of_group(group_id)
    or public.school_is_guardian_of_student(student_id)
  );
revoke insert, update, delete on table public.attendance_justifications from authenticated;

revoke all on function public.school_attendance_roster(uuid, text) from public, anon, authenticated;
revoke all on function public.school_attendance_history(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.school_list_attendance_justifications(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.school_record_attendance(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.school_submit_attendance_justification(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.school_review_attendance_justification(uuid, text) from public, anon, authenticated;
revoke all on function public.school_attendance_report(uuid, text, text, text) from public, anon, authenticated;

grant execute on function public.school_attendance_roster(uuid, text) to authenticated;
grant execute on function public.school_attendance_history(uuid, uuid, text, text) to authenticated;
grant execute on function public.school_list_attendance_justifications(uuid, text, uuid) to authenticated;
grant execute on function public.school_record_attendance(uuid, text, jsonb) to authenticated;
grant execute on function public.school_submit_attendance_justification(uuid, uuid, text, text) to authenticated;
grant execute on function public.school_review_attendance_justification(uuid, text) to authenticated;
grant execute on function public.school_attendance_report(uuid, text, text, text) to authenticated;

commit;
