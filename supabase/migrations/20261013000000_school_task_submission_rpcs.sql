-- Tareas, entregas y archivos asociados: mutaciones/consultas atómicas con
-- autorización derivada del usuario Auth y de las relaciones escolares.
-- Migración local; pendiente de autorización para aplicar en el proyecto.
begin;

create function public.school_create_task(
  p_id uuid,
  p_group_id uuid,
  p_title text,
  p_instructions text,
  p_due_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := pg_catalog.now();
  v_title text;
  v_instructions text;
  v_recipients integer;
begin
  if v_actor is null or not public.school_actor_active() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_id is null or p_group_id is null or p_title is null or p_instructions is null
    or pg_catalog.char_length(pg_catalog.btrim(p_title)) not between 2 and 120
    or pg_catalog.char_length(pg_catalog.btrim(p_instructions)) not between 2 and 3000
    or (p_due_at is not null and (p_due_at < v_now - interval '5 years' or p_due_at > v_now + interval '5 years')) then
    raise exception 'invalid_task' using errcode = '22023';
  end if;
  if not public.school_is_leader_or_teacher(p_group_id)
    or not exists (
      select 1 from public.groups g
      join public.school_years y on y.id = g.year_id and y.active = true
      where g.id = p_group_id and g.active = true
    ) then
    raise exception 'group_not_available' using errcode = 'P0002';
  end if;

  select pg_catalog.count(distinct g.user_id)::integer into v_recipients
  from public.enrollments e
  join public.students s on s.id = e.student_id and s.active = true
  join public.student_guardians sg on sg.student_id = s.id and sg.active = true
  join public.guardians g on g.id = sg.guardian_id and g.active = true
  join public.profiles p on p.id = g.user_id and p.active = true
  join public.user_roles r on r.user_id = g.user_id and r.role = 'tutor'
  where e.group_id = p_group_id and e.ended_at is null;
  if v_recipients > 500 then
    raise exception 'notification_recipient_limit' using errcode = '22023';
  end if;

  v_title := pg_catalog.btrim(p_title);
  v_instructions := pg_catalog.btrim(p_instructions);
  insert into public.tasks (id, group_id, title, instructions, due_at, created_by, created_at, archived_at)
  values (p_id, p_group_id, v_title, v_instructions, p_due_at, v_actor, v_now, null);

  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (pg_catalog.gen_random_uuid(), v_actor, 'create', 'task', p_id::text, v_now);

  insert into public.notifications (id, user_id, kind, title, href, dedupe_key, created_at)
  select pg_catalog.gen_random_uuid(), recipients.user_id, 'tarea', 'Nueva tarea publicada', '/tareas',
    'task:' || p_id::text || ':' || recipients.user_id::text, v_now
  from (
    select distinct g.user_id
    from public.enrollments e
    join public.students s on s.id = e.student_id and s.active = true
    join public.student_guardians sg on sg.student_id = s.id and sg.active = true
    join public.guardians g on g.id = sg.guardian_id and g.active = true
    join public.profiles p on p.id = g.user_id and p.active = true
    join public.user_roles r on r.user_id = g.user_id and r.role = 'tutor'
    where e.group_id = p_group_id and e.ended_at is null
  ) recipients
  on conflict (dedupe_key) do nothing;

  return pg_catalog.jsonb_build_object('id', p_id, 'createdAt', v_now);
end;
$$;

create function public.school_submit_task(
  p_id uuid,
  p_task_id uuid,
  p_student_id uuid,
  p_note text default null
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
  v_submission_id uuid;
  v_created boolean := false;
begin
  if v_actor is null or not public.school_actor_active()
    or not public.school_has_role(array['tutor']::text[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_id is null or p_task_id is null or p_student_id is null
    or (p_note is not null and pg_catalog.char_length(pg_catalog.btrim(p_note)) > 1000) then
    raise exception 'invalid_submission' using errcode = '22023';
  end if;

  select t.group_id into v_group_id
  from public.tasks t
  join public.groups g on g.id = t.group_id and g.active = true
  join public.school_years y on y.id = g.year_id and y.active = true
  where t.id = p_task_id and t.archived_at is null;
  if v_group_id is null then
    raise exception 'task_not_available' using errcode = 'P0002';
  end if;
  if not exists (
    select 1
    from public.guardians g
    join public.student_guardians sg on sg.guardian_id = g.id and sg.active = true
    join public.students s on s.id = sg.student_id and s.active = true
    join public.enrollments e on e.student_id = s.id and e.ended_at is null
    where g.user_id = v_actor and g.active = true and sg.student_id = p_student_id
      and e.group_id = v_group_id
  ) then
    raise exception 'task_not_available' using errcode = 'P0002';
  end if;

  -- Serialize only submissions for this task/student pair so first submit and
  -- concurrent re-submissions cannot create duplicate rows or false statuses.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_task_id::text || ':' || p_student_id::text, 0)
  );
  select s.id into v_submission_id
  from public.submissions s
  where s.task_id = p_task_id and s.student_id = p_student_id
  for update;

  if v_submission_id is null then
    insert into public.submissions (
      id, task_id, student_id, submitted_by, status, note, evaluation,
      reviewed_by, review_note, submitted_at, reviewed_at
    ) values (
      p_id, p_task_id, p_student_id, v_actor, 'entregada', nullif(pg_catalog.btrim(p_note), ''), null,
      null, null, v_now, null
    ) returning id into v_submission_id;
    v_created := true;
  else
    update public.submissions set
      submitted_by = v_actor,
      status = 'entregada',
      note = nullif(pg_catalog.btrim(p_note), ''),
      evaluation = null,
      reviewed_by = null,
      review_note = null,
      submitted_at = v_now,
      reviewed_at = null
    where id = v_submission_id;
  end if;

  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (pg_catalog.gen_random_uuid(), v_actor, 'submit', 'task', p_task_id::text, v_now);

  insert into public.notifications (id, user_id, kind, title, href, dedupe_key, created_at)
  select pg_catalog.gen_random_uuid(), recipients.user_id, 'entrega', 'Nueva entrega para revisar', '/tareas',
    'submission:' || p_task_id::text || ':' || p_student_id::text || ':' || recipients.user_id::text || ':' || pg_catalog.gen_random_uuid()::text, v_now
  from (
    select distinct t.id as user_id
    from public.teacher_groups tg
    join public.teachers teacher on teacher.id = tg.teacher_id and teacher.active = true
    join public.profiles t on t.id = teacher.user_id and t.active = true
    join public.user_roles r on r.user_id = t.id and r.role = 'docente'
    where tg.group_id = v_group_id
  ) recipients
  on conflict (dedupe_key) do nothing;

  return pg_catalog.jsonb_build_object(
    'id', v_submission_id, 'submittedAt', v_now, 'status', 'entregada', 'created', v_created
  );
end;
$$;

create function public.school_review_submission(
  p_submission_id uuid,
  p_status text,
  p_review_note text default null,
  p_evaluation text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := pg_catalog.now();
  v_student_id uuid;
  v_group_id uuid;
  v_stage text;
begin
  if v_actor is null or not public.school_actor_active() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_submission_id is null or p_status is null or p_status not in ('revisada', 'completada')
    or (p_review_note is not null and pg_catalog.char_length(pg_catalog.btrim(p_review_note)) > 1000)
    or (p_evaluation is not null and p_evaluation not in ('logrado', 'en_proceso', 'con_acompanamiento')) then
    raise exception 'invalid_review' using errcode = '22023';
  end if;

  select s.student_id, t.group_id, g.stage into v_student_id, v_group_id, v_stage
  from public.submissions s
  join public.tasks t on t.id = s.task_id
  join public.groups g on g.id = t.group_id
  where s.id = p_submission_id
  for update of s;
  if v_student_id is null or not public.school_is_leader_or_teacher(v_group_id) then
    raise exception 'submission_not_available' using errcode = 'P0002';
  end if;
  if p_evaluation is not null and v_stage in ('lactantes', 'maternal') then
    raise exception 'evaluation_not_allowed_for_stage' using errcode = '22023';
  end if;

  update public.submissions set
    status = p_status,
    review_note = nullif(pg_catalog.btrim(p_review_note), ''),
    evaluation = p_evaluation,
    reviewed_by = v_actor,
    reviewed_at = v_now
  where id = p_submission_id;

  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (pg_catalog.gen_random_uuid(), v_actor, 'review', 'submission', p_submission_id::text, v_now);

  insert into public.notifications (id, user_id, kind, title, href, dedupe_key, created_at)
  select pg_catalog.gen_random_uuid(), recipients.user_id, 'entrega_revisada', 'Revisaron una actividad', '/tareas',
    'review:' || p_submission_id::text || ':' || pg_catalog.to_char(v_now, 'YYYYMMDDHH24MISSMS') || ':' || recipients.user_id::text,
    v_now
  from (
    select distinct g.user_id
    from public.student_guardians sg
    join public.guardians g on g.id = sg.guardian_id and g.active = true
    join public.profiles p on p.id = g.user_id and p.active = true
    join public.user_roles r on r.user_id = g.user_id and r.role = 'tutor'
    where sg.student_id = v_student_id and sg.active = true
  ) recipients
  on conflict (dedupe_key) do nothing;

  return pg_catalog.jsonb_build_object('reviewed', true, 'reviewedAt', v_now);
end;
$$;

create function public.school_list_tasks(
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_total integer;
  v_items jsonb;
begin
  if v_actor is null or not public.school_actor_active()
    or not public.school_has_role(array['superadmin', 'direccion', 'docente', 'tutor']::text[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 or p_offset is null or p_offset < 0 or p_offset > 100000 then
    raise exception 'invalid_page' using errcode = '22023';
  end if;

  select pg_catalog.count(*)::integer into v_total
  from public.tasks t
  join public.groups g on g.id = t.group_id and g.active = true
  where t.archived_at is null and public.school_can_access_group(t.group_id);

  select coalesce(pg_catalog.jsonb_agg(page.item order by page.due_at nulls last, page.created_at desc, page.id), '[]'::jsonb)
  into v_items
  from (
    select
      t.id,
      t.due_at,
      t.created_at,
      pg_catalog.jsonb_build_object(
        'id', t.id,
        'groupId', t.group_id,
        'groupName', g.name,
        'stage', g.stage,
        'title', t.title,
        'instructions', t.instructions,
        'dueAt', t.due_at,
        'createdAt', t.created_at,
        'createdBy', t.created_by,
        'files', (
          select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id', file_rows.id, 'name', file_rows.original_name, 'url', '/api/files/' || file_rows.id::text
          ) order by file_rows.created_at, file_rows.id), '[]'::jsonb)
          from (
            select f.id, f.original_name, f.created_at
            from public.task_files tf
            join public.files f on f.id = tf.file_id
            where tf.task_id = t.id and f.group_id = t.group_id and f.purpose = 'material' and f.deleted_at is null
            order by f.created_at, f.id
            limit 20
          ) file_rows
        ),
        'studentStatuses', case when public.school_has_role(array['tutor']::text[]) then (
          select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'studentId', child.id,
            'status', coalesce(submission.status, case when t.due_at is not null and t.due_at < pg_catalog.now() then 'vencida' else 'pendiente' end)
          ) order by child.id), '[]'::jsonb)
          from (
            select distinct s.id
            from public.student_guardians sg
            join public.guardians guardian on guardian.id = sg.guardian_id and guardian.active = true
            join public.profiles profile on profile.id = guardian.user_id and profile.active = true
            join public.user_roles role_row on role_row.user_id = guardian.user_id and role_row.role = 'tutor'
            join public.students s on s.id = sg.student_id and s.active = true
            join public.enrollments e on e.student_id = s.id and e.ended_at is null and e.group_id = t.group_id
            where guardian.user_id = v_actor and sg.active = true
            order by s.id
            limit 100
          ) child
          left join public.submissions submission on submission.task_id = t.id and submission.student_id = child.id
        ) else '[]'::jsonb end
      ) as item
    from public.tasks t
    join public.groups g on g.id = t.group_id and g.active = true
    where t.archived_at is null and public.school_can_access_group(t.group_id)
    order by t.due_at nulls last, t.created_at desc, t.id
    limit p_limit offset p_offset
  ) page;

  return pg_catalog.jsonb_build_object('items', coalesce(v_items, '[]'::jsonb), 'total', v_total);
end;
$$;

create function public.school_list_task_submissions(
  p_task_id uuid,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_group_id uuid;
  v_total integer;
  v_items jsonb;
begin
  if v_actor is null or not public.school_actor_active()
    or not public.school_has_role(array['superadmin', 'direccion', 'docente', 'tutor']::text[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_task_id is null or p_limit is null or p_limit < 1 or p_limit > 200
    or p_offset is null or p_offset < 0 or p_offset > 100000 then
    raise exception 'invalid_page' using errcode = '22023';
  end if;
  select t.group_id into v_group_id
  from public.tasks t
  join public.groups g on g.id = t.group_id
  where t.id = p_task_id;
  if v_group_id is null then
    raise exception 'task_not_available' using errcode = 'P0002';
  end if;
  if not public.school_is_leader_or_teacher(v_group_id) then
    if not exists (
      select 1
      from public.guardians guardian
      join public.student_guardians sg on sg.guardian_id = guardian.id and sg.active = true
      join public.students student on student.id = sg.student_id and student.active = true
      join public.enrollments e on e.student_id = student.id and e.group_id = v_group_id and e.ended_at is null
      where guardian.user_id = v_actor and guardian.active = true
    ) then
      raise exception 'task_not_available' using errcode = 'P0002';
    end if;
  end if;

  select pg_catalog.count(*)::integer into v_total
  from public.submissions s
  where s.task_id = p_task_id and (
    public.school_is_leader_or_teacher(v_group_id)
    or (public.school_is_guardian_of_student(s.student_id)
      and public.school_student_in_group(s.student_id, v_group_id))
  );

  select coalesce(pg_catalog.jsonb_agg(page.item order by page.submitted_at, page.id), '[]'::jsonb)
  into v_items
  from (
    select
      s.id,
      s.submitted_at,
      pg_catalog.jsonb_build_object(
        'id', s.id,
        'studentId', s.student_id,
        'studentName', student.given_name,
        'studentFamilyName', student.family_name,
        'status', s.status,
        'note', s.note,
        'reviewNote', s.review_note,
        'evaluation', s.evaluation,
        'submittedAt', s.submitted_at,
        'reviewedAt', s.reviewed_at,
        'files', (
          select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id', file_rows.id, 'name', file_rows.original_name, 'url', '/api/files/' || file_rows.id::text
          ) order by file_rows.created_at, file_rows.id), '[]'::jsonb)
          from (
            select f.id, f.original_name, f.created_at
            from public.submission_files sf
            join public.files f on f.id = sf.file_id
            where sf.submission_id = s.id and f.student_id = s.student_id
              and f.group_id = v_group_id and f.purpose = 'submission' and f.deleted_at is null
            order by f.created_at, f.id
            limit 20
          ) file_rows
        )
      ) as item
    from public.submissions s
    join public.students student on student.id = s.student_id
    where s.task_id = p_task_id and (
      public.school_is_leader_or_teacher(v_group_id)
      or (public.school_is_guardian_of_student(s.student_id)
        and public.school_student_in_group(s.student_id, v_group_id))
    )
    order by s.submitted_at, s.id
    limit p_limit offset p_offset
  ) page;

  return pg_catalog.jsonb_build_object('items', coalesce(v_items, '[]'::jsonb), 'total', v_total);
end;
$$;

-- A family relationship alone does not grant access to old evidence after
-- the student's enrollment in that task group has ended.
drop policy submissions_read_student on public.submissions;
create policy submissions_read_student on public.submissions for select to authenticated
  using (
    public.school_is_leader()
    or exists (
      select 1 from public.tasks t
      where t.id = submissions.task_id and public.school_is_teacher_of_group(t.group_id)
    )
    or (
      public.school_is_guardian_of_student(student_id)
      and exists (
        select 1 from public.tasks t
        where t.id = submissions.task_id and public.school_student_in_group(student_id, t.group_id)
      )
    )
  );

drop policy submission_files_read_student on public.submission_files;
create policy submission_files_read_student on public.submission_files for select to authenticated
  using (exists (
    select 1 from public.submissions s
    join public.tasks t on t.id = s.task_id
    where s.id = submission_files.submission_id and (
      public.school_is_leader()
      or public.school_is_teacher_of_group(t.group_id)
      or (public.school_is_guardian_of_student(s.student_id)
        and public.school_student_in_group(s.student_id, t.group_id))
    )
  ));

drop policy files_read_authorized on public.files;
create policy files_read_authorized on public.files for select to authenticated
  using (
    public.school_is_leader()
    or (
      purpose = 'submission' and student_id is not null and group_id is not null
      and (
        public.school_is_teacher_of_group(group_id)
        or (public.school_is_guardian_of_student(student_id)
          and public.school_student_in_group(student_id, group_id))
      )
    )
    or (
      purpose <> 'submission' and (
        (student_id is not null and public.school_can_access_student(student_id))
        or (student_id is null and group_id is not null and public.school_can_access_group(group_id))
      )
    )
  );

create function public.school_attach_task_file(
  p_file_id uuid,
  p_object_key text,
  p_original_name text,
  p_mime_type text,
  p_size_bytes integer,
  p_task_id uuid
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
begin
  if v_actor is null or not public.school_actor_active() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_file_id is null or p_task_id is null or p_object_key is null or p_original_name is null
    or p_mime_type is null or p_size_bytes is null or pg_catalog.char_length(pg_catalog.btrim(p_original_name)) not between 1 and 160
    or p_size_bytes < 1 or p_size_bytes > 26214400
    or p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'audio/mpeg', 'audio/ogg', 'audio/wav')
    or p_object_key !~ '^supabase:private/material/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89a-fA-F][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
    raise exception 'invalid_file' using errcode = '22023';
  end if;
  select t.group_id into v_group_id
  from public.tasks t
  join public.groups g on g.id = t.group_id and g.active = true
  join public.school_years y on y.id = g.year_id and y.active = true
  where t.id = p_task_id and t.archived_at is null;
  if v_group_id is null or not public.school_is_leader_or_teacher(v_group_id) then
    raise exception 'task_not_available' using errcode = 'P0002';
  end if;

  insert into public.files (id, object_key, original_name, mime_type, size_bytes, purpose, uploaded_by, group_id, student_id, created_at, deleted_at)
  values (p_file_id, p_object_key, pg_catalog.btrim(p_original_name), p_mime_type, p_size_bytes, 'material', v_actor, v_group_id, null, v_now, null);
  insert into public.task_files (task_id, file_id) values (p_task_id, p_file_id);
  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (pg_catalog.gen_random_uuid(), v_actor, 'attach_task_material', 'task', p_task_id::text, v_now);
  return pg_catalog.jsonb_build_object('attached', true, 'fileId', p_file_id, 'taskId', p_task_id);
end;
$$;

create function public.school_submit_task_file(
  p_file_id uuid,
  p_object_key text,
  p_original_name text,
  p_mime_type text,
  p_size_bytes integer,
  p_task_id uuid,
  p_student_id uuid,
  p_note text default null
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
  v_submission_id uuid;
  v_created boolean := false;
begin
  if v_actor is null or not public.school_actor_active()
    or not public.school_has_role(array['tutor']::text[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_file_id is null or p_task_id is null or p_student_id is null or p_object_key is null
    or p_original_name is null or p_mime_type is null or p_size_bytes is null
    or pg_catalog.char_length(pg_catalog.btrim(p_original_name)) not between 1 and 160
    or p_size_bytes < 1 or p_size_bytes > 26214400
    or p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'audio/mpeg', 'audio/ogg', 'audio/wav')
    or p_object_key !~ '^supabase:private/submission/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89a-fA-F][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    or (p_note is not null and pg_catalog.char_length(pg_catalog.btrim(p_note)) > 1000) then
    raise exception 'invalid_submission_file' using errcode = '22023';
  end if;

  select t.group_id into v_group_id
  from public.tasks t
  join public.groups g on g.id = t.group_id and g.active = true
  join public.school_years y on y.id = g.year_id and y.active = true
  where t.id = p_task_id and t.archived_at is null;
  if v_group_id is null or not exists (
    select 1
    from public.guardians guardian
    join public.student_guardians sg on sg.guardian_id = guardian.id and sg.active = true
    join public.students student on student.id = sg.student_id and student.active = true
    join public.enrollments e on e.student_id = student.id and e.group_id = v_group_id and e.ended_at is null
    where guardian.user_id = v_actor and guardian.active = true and sg.student_id = p_student_id
  ) then
    raise exception 'task_not_available' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_task_id::text || ':' || p_student_id::text, 0)
  );
  select s.id into v_submission_id
  from public.submissions s
  where s.task_id = p_task_id and s.student_id = p_student_id
  for update;

  if v_submission_id is null then
    v_submission_id := pg_catalog.gen_random_uuid();
    insert into public.submissions (
      id, task_id, student_id, submitted_by, status, note, evaluation,
      reviewed_by, review_note, submitted_at, reviewed_at
    ) values (
      v_submission_id, p_task_id, p_student_id, v_actor, 'entregada', nullif(pg_catalog.btrim(p_note), ''), null,
      null, null, v_now, null
    );
    v_created := true;
  else
    update public.submissions set
      submitted_by = v_actor,
      status = 'entregada',
      note = nullif(pg_catalog.btrim(p_note), ''),
      evaluation = null,
      reviewed_by = null,
      review_note = null,
      submitted_at = v_now,
      reviewed_at = null
    where id = v_submission_id;
  end if;

  insert into public.files (id, object_key, original_name, mime_type, size_bytes, purpose, uploaded_by, group_id, student_id, created_at, deleted_at)
  values (p_file_id, p_object_key, pg_catalog.btrim(p_original_name), p_mime_type, p_size_bytes, 'submission', v_actor, v_group_id, p_student_id, v_now, null);
  insert into public.submission_files (submission_id, file_id) values (v_submission_id, p_file_id);

  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (pg_catalog.gen_random_uuid(), v_actor, 'upload_evidence', 'submission', v_submission_id::text, v_now);

  insert into public.notifications (id, user_id, kind, title, href, dedupe_key, created_at)
  select pg_catalog.gen_random_uuid(), recipients.user_id, 'entrega', 'Nueva entrega para revisar', '/tareas',
    'submission:' || p_task_id::text || ':' || p_student_id::text || ':' || recipients.user_id::text || ':' || p_file_id::text, v_now
  from (
    select distinct profile.id as user_id
    from public.teacher_groups tg
    join public.teachers teacher on teacher.id = tg.teacher_id and teacher.active = true
    join public.profiles profile on profile.id = teacher.user_id and profile.active = true
    join public.user_roles role_row on role_row.user_id = profile.id and role_row.role = 'docente'
    where tg.group_id = v_group_id
  ) recipients
  on conflict (dedupe_key) do nothing;

  return pg_catalog.jsonb_build_object(
    'submissionId', v_submission_id, 'fileId', p_file_id, 'submittedAt', v_now,
    'status', 'entregada', 'created', v_created
  );
end;
$$;

-- Los clientes deben pasar por las RPC para que el control de permisos,
-- auditoría, relaciones y avisos permanezca en una sola transacción.
revoke insert, update, delete on table public.tasks from authenticated;
revoke insert, update, delete on table public.task_files from authenticated;
revoke insert, update, delete on table public.submissions from authenticated;
revoke insert, update, delete on table public.submission_files from authenticated;
revoke insert, update, delete on table public.files from authenticated;

revoke all on function public.school_create_task(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.school_submit_task(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.school_review_submission(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.school_list_tasks(integer, integer) from public, anon, authenticated;
revoke all on function public.school_list_task_submissions(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.school_attach_task_file(uuid, text, text, text, integer, uuid) from public, anon, authenticated;
revoke all on function public.school_submit_task_file(uuid, text, text, text, integer, uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.school_create_task(uuid, uuid, text, text, timestamptz) to authenticated;
grant execute on function public.school_submit_task(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.school_review_submission(uuid, text, text, text) to authenticated;
grant execute on function public.school_list_tasks(integer, integer) to authenticated;
grant execute on function public.school_list_task_submissions(uuid, integer, integer) to authenticated;
grant execute on function public.school_attach_task_file(uuid, text, text, text, integer, uuid) to authenticated;
grant execute on function public.school_submit_task_file(uuid, text, text, text, integer, uuid, uuid, text) to authenticated;

commit;
