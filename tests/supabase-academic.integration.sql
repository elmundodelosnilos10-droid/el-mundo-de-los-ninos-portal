-- REAL PostgreSQL fixture, after migrations through 20261023000000.
-- The caller MUST wrap this entire file in BEGIN ... ROLLBACK. There are no
-- transaction-control statements here. Run as the project database owner.
-- Only synthetic Auth identities without passwords, school rows and file
-- METADATA are created. No Storage object, email, real child or account is used.

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at) values
('a1000000-0000-4000-8000-000000000001', 'academic-teacher-a@example.test', '{"name":"Docente académica sintética A"}', now(), now()),
('a1000000-0000-4000-8000-000000000002', 'academic-teacher-b@example.test', '{"name":"Docente académica sintética B"}', now(), now()),
('a1000000-0000-4000-8000-000000000003', 'academic-family-a@example.test', '{"name":"Familia académica sintética A"}', now(), now()),
('a1000000-0000-4000-8000-000000000004', 'academic-family-b@example.test', '{"name":"Familia académica sintética B"}', now(), now());
update public.profiles set active = true where id in (
  'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000004'
);
insert into public.user_roles (user_id, role) values
('a1000000-0000-4000-8000-000000000001', 'docente'),
('a1000000-0000-4000-8000-000000000002', 'docente'),
('a1000000-0000-4000-8000-000000000003', 'tutor'),
('a1000000-0000-4000-8000-000000000004', 'tutor');
insert into public.school_years (id, name, starts_on, ends_on, active)
values ('a2000000-0000-4000-8000-000000000001', 'Académico PostgreSQL sintético', '2026-08-01', '2027-07-31', true);
insert into public.groups (id, year_id, name, stage) values
('a2100000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'Académico sintético A', 'preescolar'),
('a2100000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'Académico sintético B', 'maternal');
insert into public.students (id, given_name, family_name) values
('a2200000-0000-4000-8000-000000000001', 'Alumno sintético A', 'Académico'),
('a2200000-0000-4000-8000-000000000002', 'Alumno sintético B', 'Académico');
insert into public.enrollments (id, student_id, group_id, enrolled_at) values
('a2500000-0000-4000-8000-000000000001', 'a2200000-0000-4000-8000-000000000001', 'a2100000-0000-4000-8000-000000000001', now()),
('a2500000-0000-4000-8000-000000000002', 'a2200000-0000-4000-8000-000000000002', 'a2100000-0000-4000-8000-000000000002', now());
insert into public.teachers (id, user_id) values
('a2300000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001'),
('a2300000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002');
insert into public.teacher_groups (teacher_id, group_id) values
('a2300000-0000-4000-8000-000000000001', 'a2100000-0000-4000-8000-000000000001'),
('a2300000-0000-4000-8000-000000000002', 'a2100000-0000-4000-8000-000000000002');
insert into public.guardians (id, user_id) values
('a2400000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003'),
('a2400000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000004');
insert into public.student_guardians (student_id, guardian_id, relationship) values
('a2200000-0000-4000-8000-000000000001', 'a2400000-0000-4000-8000-000000000001', 'Tutor académico sintético'),
('a2200000-0000-4000-8000-000000000002', 'a2400000-0000-4000-8000-000000000002', 'Tutor académico sintético');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
do $$
declare
  result jsonb;
  group_a uuid := 'a2100000-0000-4000-8000-000000000001';
begin
  result := public.school_publish_material_file('a3000000-0000-4000-8000-000000000001', 'a3100000-0000-4000-8000-000000000001',
    'supabase:private/material/a3100000-0000-4000-8000-000000000001', 'material-a-sintetico.pdf', 'application/pdf', 123, group_a, 'Material sintético A', 'Vocabulario');
  if (result->>'published')::boolean is distinct from true then raise exception 'material publish failed'; end if;
  perform public.school_publish_material_file('a3000000-0000-4000-8000-000000000003', 'a3100000-0000-4000-8000-000000000003',
    'supabase:private/material/a3100000-0000-4000-8000-000000000003', 'material-temporal.pdf', 'application/pdf', 123, group_a, 'Material temporal', 'Vocabulario');
  result := public.school_replace_material_file('a3000000-0000-4000-8000-000000000001',
    'supabase:private/material/a3100000-0000-4000-8000-000000000011', 'material-a-nuevo.pdf', 'application/pdf', 321);
  if result->>'oldObjectKey' <> 'supabase:private/material/a3100000-0000-4000-8000-000000000001'
    or result->>'fileId' <> 'a3100000-0000-4000-8000-000000000001' then raise exception 'replacement lost old key or stable metadata id'; end if;
  result := public.school_remove_material('a3000000-0000-4000-8000-000000000003');
  if (result->>'removed')::boolean is distinct from true then raise exception 'material removal failed'; end if;
  result := public.school_list_materials(10, 0);
  if (result->>'total')::integer <> 1 or result->'items'->0->>'fileName' <> 'material-a-nuevo.pdf' then raise exception 'library feed did not omit removed material or show replacement'; end if;
  -- This fails after file metadata insertion but before the material/audit
  -- write, proving that the RPC rolls back its earlier write atomically.
  begin
    perform public.school_publish_material_file('a3000000-0000-4000-8000-000000000001', 'a3100000-0000-4000-8000-000000000099',
      'supabase:private/material/a3100000-0000-4000-8000-000000000099', 'rollback-metadata.pdf', 'application/pdf', 123, group_a, 'Duplicate material must rollback', 'Prueba');
    raise exception 'duplicate material accepted';
  exception when unique_violation then null; end;
  if exists (select 1 from public.files where id = 'a3100000-0000-4000-8000-000000000099') then raise exception 'failed material RPC left orphan file metadata'; end if;

  perform public.school_create_task('a3200000-0000-4000-8000-000000000001', group_a, 'Tarea sintética A', 'Pronuncia y dibuja una palabra.', now() + interval '3 days');
  perform public.school_attach_task_file('a3100000-0000-4000-8000-000000000004',
    'supabase:private/material/a3100000-0000-4000-8000-000000000004', 'guia-tarea.pdf', 'application/pdf', 222, 'a3200000-0000-4000-8000-000000000001');
  perform public.school_create_calendar_event('a3400000-0000-4000-8000-000000000001', group_a, 'evento', 'Evento sintético A', 'Actividad de prueba.', now() + interval '1 day', now() + interval '1 day 1 hour');
  perform public.school_update_calendar_event('a3400000-0000-4000-8000-000000000001', 'evento', 'Evento sintético A actualizado', 'Actividad de prueba.', now() + interval '1 day', now() + interval '1 day 2 hours');
  perform public.school_create_class_session('a3500000-0000-4000-8000-000000000001', 'a3400000-0000-4000-8000-000000000003',
    group_a, null, 'Clase sintética A', now() + interval '2 days', now() + interval '2 days 1 hour', 'https://meet.google.com/aaa-bbbb-ccc');
  result := public.school_create_announcement('a3600000-0000-4000-8000-000000000001', group_a, 'Aviso sintético A', 'Trae tu actividad de prueba.', true);
  if (result->>'notified')::integer <> 1 then raise exception 'announcement notification scope failed'; end if;
  begin
    perform public.school_create_announcement('a3600000-0000-4000-8000-000000000009', null, 'Aviso global no permitido', 'Prueba de permisos.', false);
    raise exception 'teacher was allowed to publish global announcement';
  exception when insufficient_privilege then null; end;
  begin
    perform public.school_create_class_session('a3500000-0000-4000-8000-000000000009', 'a3400000-0000-4000-8000-000000000009',
      group_a, null, 'Clase inválida', now(), now() + interval '1 hour', 'https://other.example.test/meeting');
    raise exception 'non-Meet class URL accepted';
  exception when invalid_parameter_value then null; end;
  begin
    insert into public.tasks (id, group_id, title, instructions, created_by) values
      ('a3200000-0000-4000-8000-000000000009', group_a, 'Direct write denied', 'Direct write denied', auth.uid());
    raise exception 'direct task insert bypassed atomic audit';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);
do $$
declare group_b uuid := 'a2100000-0000-4000-8000-000000000002';
begin
  perform public.school_publish_material_file('a3000000-0000-4000-8000-000000000002', 'a3100000-0000-4000-8000-000000000002',
    'supabase:private/material/a3100000-0000-4000-8000-000000000002', 'material-b.pdf', 'application/pdf', 123, group_b, 'Material sintético B', 'Vocabulario');
  perform public.school_create_task('a3200000-0000-4000-8000-000000000002', group_b, 'Tarea sintética B', 'Actividad maternal de prueba.', now() + interval '3 days');
  perform public.school_create_calendar_event('a3400000-0000-4000-8000-000000000002', group_b, 'evento', 'Evento sintético B', null, now() + interval '1 day', now() + interval '1 day 1 hour');
  perform public.school_create_class_session('a3500000-0000-4000-8000-000000000002', 'a3400000-0000-4000-8000-000000000004',
    group_b, null, 'Clase sintética B', now() + interval '2 days', now() + interval '2 days 1 hour', 'https://meet.google.com/bbb-cccc-ddd');
  perform public.school_create_announcement('a3600000-0000-4000-8000-000000000002', group_b, 'Aviso sintético B', 'Actividad de prueba maternal.', false);
end $$;

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000003', true);
do $$
declare result jsonb; first_id uuid; notice_id uuid; changed integer;
begin
  result := public.school_list_materials(10, 0);
  if (result->>'total')::integer <> 1 or result->'items'->0->>'id' <> 'a3000000-0000-4000-8000-000000000001' then raise exception 'family A library scope failed'; end if;
  if exists (select 1 from public.files where id = 'a3100000-0000-4000-8000-000000000002') then raise exception 'family A read family B material metadata'; end if;
  result := public.school_list_tasks(10, 0);
  if (result->>'total')::integer <> 1 or jsonb_array_length(result->'items'->0->'files') <> 1
    or result->'items'->0->'studentStatuses'->0->>'status' <> 'pendiente' then raise exception 'task/material attachment/initial student status failed'; end if;
  result := public.school_submit_task('a3300000-0000-4000-8000-000000000001', 'a3200000-0000-4000-8000-000000000001', 'a2200000-0000-4000-8000-000000000001', 'Entrega sintética inicial');
  first_id := (result->>'id')::uuid;
  if (result->>'created')::boolean is distinct from true or result->>'status' <> 'entregada' then raise exception 'first submit failed'; end if;
  result := public.school_submit_task('a3300000-0000-4000-8000-000000000099', 'a3200000-0000-4000-8000-000000000001', 'a2200000-0000-4000-8000-000000000001', 'Entrega sintética repetida');
  if (result->>'created')::boolean is distinct from false or (result->>'id')::uuid <> first_id then raise exception 'resubmission created duplicate row'; end if;
  result := public.school_submit_task_file('a3100000-0000-4000-8000-000000000005',
    'supabase:private/submission/a3100000-0000-4000-8000-000000000005', 'evidencia-sintetica.pdf', 'application/pdf', 444,
    'a3200000-0000-4000-8000-000000000001', 'a2200000-0000-4000-8000-000000000001', 'Evidencia sin objeto de almacenamiento');
  if (result->>'submissionId')::uuid <> first_id or (result->>'created')::boolean is distinct from false then raise exception 'file submission lost stable submission identity'; end if;
  result := public.school_list_task_submissions('a3200000-0000-4000-8000-000000000001', 10, 0);
  if (result->>'total')::integer <> 1 or jsonb_array_length(result->'items'->0->'files') <> 1 then raise exception 'submission/evidence feed failed'; end if;
  begin
    perform public.school_submit_task('a3300000-0000-4000-8000-000000000098', 'a3200000-0000-4000-8000-000000000002', 'a2200000-0000-4000-8000-000000000002', 'Foreign child denied');
    raise exception 'family A submitted for family B';
  exception when no_data_found then null; end;
  begin
    perform public.school_review_submission(first_id, 'completada', 'Family cannot review', 'logrado');
    raise exception 'family reviewed its own submission';
  exception when no_data_found then null; end;
  begin
    perform public.school_publish_material_file('a3000000-0000-4000-8000-000000000009', 'a3100000-0000-4000-8000-000000000009',
      'supabase:private/material/a3100000-0000-4000-8000-000000000009', 'family-publish-denied.pdf', 'application/pdf', 123,
      'a2100000-0000-4000-8000-000000000001', 'Family cannot publish', 'Prueba');
    raise exception 'family published material';
  exception when insufficient_privilege then null; end;

  result := public.school_calendar_feed(now() - interval '1 day', now() + interval '7 days', 20);
  if (result->>'total')::integer <> 3 or exists (select 1 from jsonb_array_elements(result->'items') item where item->>'groupId' <> 'a2100000-0000-4000-8000-000000000001') then raise exception 'calendar did not isolate event, class and task due date'; end if;
  result := public.school_list_class_sessions(20);
  if jsonb_array_length(result->'items') <> 1 or result->>'timeZone' <> 'America/Mexico_City'
    or result->'items'->0->>'meetUrl' <> 'https://meet.google.com/aaa-bbbb-ccc' then raise exception 'class feed scope or Meet URL failed'; end if;
  result := public.school_list_class_options();
  if jsonb_array_length(result->'groups') <> 1 or jsonb_array_length(result->'teachers') <> 0 then raise exception 'family class options leaked teacher choices or foreign group'; end if;
  perform public.school_mark_announcement_read('a3600000-0000-4000-8000-000000000001');
  perform public.school_mark_announcement_read('a3600000-0000-4000-8000-000000000001');
  if (select count(*) from public.announcement_reads where announcement_id = 'a3600000-0000-4000-8000-000000000001') <> 1 then raise exception 'announcement receipt was not idempotent'; end if;
  result := public.school_announcement_feed(20);
  if not exists (select 1 from jsonb_array_elements(result->'items') item where item->>'id' = 'a3600000-0000-4000-8000-000000000001' and item->>'readAt' is not null)
    or exists (select 1 from jsonb_array_elements(result->'items') item where item->>'id' = 'a3600000-0000-4000-8000-000000000002') then raise exception 'announcement scope or receipt feed failed'; end if;
  select id into notice_id from public.notifications where dedupe_key = 'task:a3200000-0000-4000-8000-000000000001:a1000000-0000-4000-8000-000000000003';
  if notice_id is null then raise exception 'task notification not committed'; end if;
  update public.notifications set read_at = now() where id = notice_id;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'own notification read receipt failed'; end if;
  update public.notifications set read_at = now() where user_id = 'a1000000-0000-4000-8000-000000000004';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'family A modified family B notification'; end if;
end $$;

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000004', true);
do $$
declare result jsonb;
begin
  result := public.school_list_materials(10, 0);
  if (result->>'total')::integer <> 1 or result->'items'->0->>'id' <> 'a3000000-0000-4000-8000-000000000002' then raise exception 'family B library scope failed'; end if;
  if exists (select 1 from public.files where id in ('a3100000-0000-4000-8000-000000000001', 'a3100000-0000-4000-8000-000000000004', 'a3100000-0000-4000-8000-000000000005')) then raise exception 'family B read family A material/task/evidence file metadata'; end if;
  if exists (select 1 from public.submissions where id = 'a3300000-0000-4000-8000-000000000001') then raise exception 'family B read family A submission via RLS'; end if;
  begin
    perform public.school_list_task_submissions('a3200000-0000-4000-8000-000000000001', 10, 0);
    raise exception 'family B called foreign submission feed';
  exception when no_data_found then null; end;
  begin
    perform public.school_submit_task('a3300000-0000-4000-8000-000000000097', 'a3200000-0000-4000-8000-000000000001', 'a2200000-0000-4000-8000-000000000001', 'Foreign family denied');
    raise exception 'family B submitted for family A';
  exception when no_data_found then null; end;
  begin
    perform public.school_mark_announcement_read('a3600000-0000-4000-8000-000000000001');
    raise exception 'family B acknowledged foreign announcement';
  exception when no_data_found then null; end;
  if exists (select 1 from public.announcement_reads where announcement_id = 'a3600000-0000-4000-8000-000000000001') then raise exception 'family B read family A receipt'; end if;
  perform public.school_submit_task('a3300000-0000-4000-8000-000000000002', 'a3200000-0000-4000-8000-000000000002', 'a2200000-0000-4000-8000-000000000002', 'Entrega maternal de prueba');
  result := public.school_calendar_feed(now() - interval '1 day', now() + interval '7 days', 20);
  if (result->>'total')::integer <> 3 or exists (select 1 from jsonb_array_elements(result->'items') item where item->>'groupId' <> 'a2100000-0000-4000-8000-000000000002') then raise exception 'family B calendar scope failed'; end if;
  result := public.school_list_class_sessions(20);
  if jsonb_array_length(result->'items') <> 1 or result->'items'->0->>'id' <> 'a3500000-0000-4000-8000-000000000002' then raise exception 'family B class scope failed'; end if;
end $$;

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
do $$
declare result jsonb;
begin
  perform public.school_review_submission('a3300000-0000-4000-8000-000000000001', 'revisada', 'Primera revisión sintética', 'en_proceso');
  result := public.school_list_task_submissions('a3200000-0000-4000-8000-000000000001', 10, 0);
  if result->'items'->0->>'status' <> 'revisada' or result->'items'->0->>'evaluation' <> 'en_proceso' then raise exception 'teacher review did not persist status/evaluation'; end if;
  if exists (select 1 from public.submissions where id = 'a3300000-0000-4000-8000-000000000002') then raise exception 'teacher A read teacher B submission'; end if;
  begin
    perform public.school_review_submission('a3300000-0000-4000-8000-000000000002', 'completada', 'Foreign group denied', null);
    raise exception 'teacher A reviewed teacher B submission';
  exception when no_data_found then null; end;
  begin
    perform public.school_remove_material('a3000000-0000-4000-8000-000000000002');
    raise exception 'teacher A removed teacher B library material';
  exception when insufficient_privilege then null; end;
  begin
    perform public.school_update_calendar_event('a3400000-0000-4000-8000-000000000002', 'evento', 'Foreign update denied', null, now(), now() + interval '1 hour');
    raise exception 'teacher A updated teacher B calendar';
  exception when insufficient_privilege then null; end;
  begin
    perform public.school_delete_calendar_event('a3400000-0000-4000-8000-000000000003');
    raise exception 'calendar deleted a class outside its class workflow';
  exception when invalid_parameter_value then null; end;
  if (select count(*) from public.notifications where kind = 'entrega') <> 3 then raise exception 'initial/repeated/file submissions did not notify only assigned teacher'; end if;
end $$;

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000003', true);
do $$
declare result jsonb;
begin
  result := public.school_list_task_submissions('a3200000-0000-4000-8000-000000000001', 10, 0);
  if result->'items'->0->>'status' <> 'revisada' then raise exception 'family did not receive teacher feedback'; end if;
  if (select count(*) from public.notifications where kind = 'entrega_revisada') <> 1 then raise exception 'review notification did not commit with feedback'; end if;
  -- The submission reset happens before the duplicate file primary key fails.
  -- Its prior review must survive the failed RPC, not become entregada.
  begin
    perform public.school_submit_task_file('a3100000-0000-4000-8000-000000000005',
      'supabase:private/submission/a3100000-0000-4000-8000-000000000099', 'duplicate-evidence.pdf', 'application/pdf', 444,
      'a3200000-0000-4000-8000-000000000001', 'a2200000-0000-4000-8000-000000000001', 'Failed replacement must rollback');
    raise exception 'duplicate evidence metadata accepted';
  exception when unique_violation then null; end;
  if not exists (select 1 from public.submissions where id = 'a3300000-0000-4000-8000-000000000001' and status = 'revisada'
    and evaluation = 'en_proceso' and reviewed_by = 'a1000000-0000-4000-8000-000000000001') then raise exception 'failed evidence RPC partially reset teacher feedback'; end if;
  perform public.school_submit_task('a3300000-0000-4000-8000-000000000096', 'a3200000-0000-4000-8000-000000000001', 'a2200000-0000-4000-8000-000000000001', 'Reentrega tras retroalimentación');
  if not exists (select 1 from public.submissions where id = 'a3300000-0000-4000-8000-000000000001' and status = 'entregada'
    and evaluation is null and reviewed_by is null and reviewed_at is null and review_note is null) then raise exception 'resubmission retained stale evaluation or review status'; end if;
end $$;

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select public.school_review_submission('a3300000-0000-4000-8000-000000000001', 'completada', 'Actividad sintética completada', 'logrado');
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);
do $$
begin
  begin
    perform public.school_review_submission('a3300000-0000-4000-8000-000000000002', 'completada', 'Evaluación maternal no permitida', 'logrado');
    raise exception 'maternal stage accepted an evaluation';
  exception when invalid_parameter_value then null; end;
  if not exists (select 1 from public.submissions where id = 'a3300000-0000-4000-8000-000000000002' and status = 'entregada' and evaluation is null) then raise exception 'failed maternal review partially mutated submission'; end if;
end $$;

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000003', true);
do $$
declare result jsonb;
begin
  result := public.school_list_tasks(10, 0);
  if result->'items'->0->'studentStatuses'->0->>'status' <> 'completada' then raise exception 'family task feed did not show final completion'; end if;
  result := public.school_list_task_submissions('a3200000-0000-4000-8000-000000000001', 10, 0);
  if result->'items'->0->>'evaluation' <> 'logrado' or jsonb_array_length(result->'items'->0->'files') <> 1 then raise exception 'final feedback or evidence was lost after resubmission'; end if;
end $$;

set local role anon;
do $$
begin
  begin
    perform public.school_list_materials(10, 0);
    raise exception 'anonymous material RPC execute permitted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.school_list_tasks(10, 0);
    raise exception 'anonymous task RPC execute permitted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

do $$
begin
  if (select count(*) from public.audit_log where actor_id in (
    'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002',
    'a1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000004'
  )) <> 22 then raise exception 'academic audit transaction count mismatch'; end if;
  if (select count(*) from public.audit_log where actor_id = 'a1000000-0000-4000-8000-000000000001') <> 12
    or (select count(*) from public.audit_log where actor_id = 'a1000000-0000-4000-8000-000000000002') <> 5
    or (select count(*) from public.audit_log where actor_id = 'a1000000-0000-4000-8000-000000000003') <> 4
    or (select count(*) from public.audit_log where actor_id = 'a1000000-0000-4000-8000-000000000004') <> 1 then raise exception 'academic audit attribution did not follow JWT actor'; end if;
  if (select count(*) from public.notifications where user_id = 'a1000000-0000-4000-8000-000000000001' and kind = 'entrega') <> 4 then raise exception 'teacher A submission notice count mismatch'; end if;
  if (select count(*) from public.notifications where user_id = 'a1000000-0000-4000-8000-000000000002' and kind = 'entrega') <> 1 then raise exception 'teacher B notice scope mismatch'; end if;
  if (select count(*) from public.notifications where user_id = 'a1000000-0000-4000-8000-000000000003') <> 5 then raise exception 'family A notification transaction/dedupe mismatch'; end if;
  if (select count(*) from public.notifications where user_id = 'a1000000-0000-4000-8000-000000000004') <> 4 then raise exception 'family B notification scope mismatch'; end if;
  if not exists (select 1 from public.files where id = 'a3100000-0000-4000-8000-000000000003' and deleted_at is not null)
    or exists (select 1 from public.materials where id = 'a3000000-0000-4000-8000-000000000003') then raise exception 'library logical file deletion/history failed'; end if;
  if not exists (select 1 from public.submissions where id = 'a3300000-0000-4000-8000-000000000001' and status = 'completada' and evaluation = 'logrado') then raise exception 'final task completion failed'; end if;
  if (select count(*) from public.announcement_reads where announcement_id = 'a3600000-0000-4000-8000-000000000001') <> 1 then raise exception 'foreign or duplicated announcement receipt persisted'; end if;
  if exists (select 1 from public.class_sessions where id in ('a3500000-0000-4000-8000-000000000001', 'a3500000-0000-4000-8000-000000000002') and (recording_allowed or recording_file_id is not null)) then raise exception 'class scheduling implicitly enabled recording'; end if;
end $$;
select 'PASS: academic PostgreSQL library metadata/history, task submissions/reviews, atomic audit/notifications, calendar/Meet classes, announcement receipts and teacher/family RLS isolation' as verification;
