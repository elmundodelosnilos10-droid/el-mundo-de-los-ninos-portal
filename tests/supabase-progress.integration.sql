-- Run only inside a transaction that ends in ROLLBACK, after school migrations.
-- No password, storage object, real child, or persistent account is created.
insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at) values
('81000000-0000-4000-8000-000000000001', 'progress-teacher@example.test', '{"name":"Docente sintética"}', now(), now()),
('81000000-0000-4000-8000-000000000002', 'progress-family-a@example.test', '{"name":"Familia sintética A"}', now(), now()),
('81000000-0000-4000-8000-000000000003', 'progress-family-b@example.test', '{"name":"Familia sintética B"}', now(), now());
update public.profiles set active = true where id in (
  '81000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000003'
);
insert into public.user_roles (user_id, role) values
('81000000-0000-4000-8000-000000000001', 'docente'),
('81000000-0000-4000-8000-000000000002', 'tutor'),
('81000000-0000-4000-8000-000000000003', 'tutor');
insert into public.school_years (id, name, starts_on, ends_on, active)
values ('82000000-0000-4000-8000-000000000001', 'Progreso PostgreSQL sintético', '2026-08-01', '2027-07-31', true);
insert into public.groups (id, year_id, name, stage) values
('82000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001', 'Progreso grupo sintético A', 'preescolar'),
('82000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000001', 'Progreso grupo sintético B', 'maternal');
insert into public.students (id, given_name, family_name) values
('83000000-0000-4000-8000-000000000001', 'Alumno sintético A', 'Prueba'),
('83000000-0000-4000-8000-000000000002', 'Alumno sintético B', 'Prueba');
insert into public.enrollments (id, student_id, group_id, enrolled_at) values
('84000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000002', now()),
('84000000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000003', now());
insert into public.teachers (id, user_id) values ('84000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000001');
insert into public.teacher_groups (teacher_id, group_id) values ('84000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000002');
insert into public.guardians (id, user_id) values
('84000000-0000-4000-8000-000000000004', '81000000-0000-4000-8000-000000000002'),
('84000000-0000-4000-8000-000000000005', '81000000-0000-4000-8000-000000000003');
insert into public.student_guardians (student_id, guardian_id, relationship) values
('83000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000004', 'tutor de prueba'),
('83000000-0000-4000-8000-000000000002', '84000000-0000-4000-8000-000000000005', 'tutor de prueba');

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
do $$
declare listing jsonb;
begin
  listing := public.school_progress_students();
  if jsonb_array_length(listing->'items') <> 1 or listing->'items'->0->>'id' <> '83000000-0000-4000-8000-000000000001' then
    raise exception 'teacher progress directory leaks another group'; end if;
  perform public.school_record_observation('85000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', 'lenguaje', 'Observación compartida sintética', true);
  perform public.school_record_observation('85000000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000001', 'autonomia', 'Observación interna sintética', false);
  if (select count(*) from public.observations where student_id = '83000000-0000-4000-8000-000000000001') <> 2 then
    raise exception 'teacher observations missing'; end if;
  begin
    perform public.school_record_observation('85000000-0000-4000-8000-000000000003', '83000000-0000-4000-8000-000000000002', 'lenguaje', 'Grupo sin asignación', true);
    raise exception 'teacher wrote another group';
  exception when no_data_found then null; end;
  begin
    perform public.school_save_activity_progress('83000000-0000-4000-8000-000000000001', 'palabra-cat', 'cat', null);
    raise exception 'teacher saved family progress';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.observations (id, student_id, category, body, visible_to_family, recorded_by, recorded_at)
    values ('85000000-0000-4000-8000-000000000010', '83000000-0000-4000-8000-000000000001', 'lenguaje', 'Bypass sin auditoría', false, auth.uid(), now());
    raise exception 'direct observation bypass accepted';
  exception when insufficient_privilege then null; end;
  -- A nested transaction rollback must undo observation, notice and audit.
  begin
    perform public.school_record_observation('85000000-0000-4000-8000-000000000099', '83000000-0000-4000-8000-000000000001', 'lenguaje', 'Transacción reversible', true);
    raise exception 'rollback_probe' using errcode = 'P9001';
  exception when sqlstate 'P9001' then null; end;
  if exists (select 1 from public.observations where id = '85000000-0000-4000-8000-000000000099') then
    raise exception 'observation survived rollback'; end if;
end $$;

select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000002', true);
do $$
declare saved jsonb;
begin
  if jsonb_array_length(public.school_progress_students()->'items') <> 1 then raise exception 'family directory scope failed'; end if;
  if (select count(*) from public.observations where student_id = '83000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'internal observation leaked to family'; end if;
  if (select count(*) from public.notifications where kind = 'seguimiento') <> 1 then
    raise exception 'visible observation notification mismatch'; end if;
  saved := public.school_save_activity_progress('83000000-0000-4000-8000-000000000001', 'palabra-cat', 'cat', null);
  if not (saved->>'saved')::boolean or saved->>'completedAt' is null then raise exception 'activity result unconfirmed'; end if;
  perform public.school_save_activity_progress('83000000-0000-4000-8000-000000000001', 'palabra-cat', 'cat', null);
  if (select count(*) from public.activity_progress where student_id = '83000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'activity upsert duplicated achievement'; end if;
  perform public.school_save_activity_progress('83000000-0000-4000-8000-000000000001', 'dibuja-huerto', null, '[{"color":"#237345","points":[{"x":0,"y":0},{"x":1,"y":1}]}]'::jsonb);
  begin
    perform public.school_save_activity_progress('83000000-0000-4000-8000-000000000001', 'palabra-cat', 'dog', null);
    raise exception 'wrong answer accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.school_save_activity_progress('83000000-0000-4000-8000-000000000001', 'dibuja-huerto', null, '[{"color":"#237345","points":[{"x":2,"y":0}]}]'::jsonb);
    raise exception 'drawing outside canvas accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.school_save_activity_progress('83000000-0000-4000-8000-000000000002', 'palabra-cat', 'cat', null);
    raise exception 'family saved another child';
  exception when no_data_found then null; end;
  begin
    insert into public.activity_progress (id, student_id, activity_id, completed_at, updated_at)
    values ('85000000-0000-4000-8000-000000000010', '83000000-0000-4000-8000-000000000001', 'bypass', now(), now());
    raise exception 'direct achievement bypass accepted';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000003', true);
do $$
begin
  if exists (select 1 from public.activity_progress where student_id = '83000000-0000-4000-8000-000000000001') or
    exists (select 1 from public.observations where student_id = '83000000-0000-4000-8000-000000000001') then
    raise exception 'another family sees progress'; end if;
  begin
    perform public.school_save_activity_progress('83000000-0000-4000-8000-000000000002', 'patron-colores', 'azul', null);
    raise exception 'activity for another stage accepted';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;
do $$
begin
  if (select count(*) from public.audit_log where actor_id in ('81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002')) <> 5 then
    raise exception 'progress audit or failed-write rollback mismatch'; end if;
  if (select count(*) from public.notifications where dedupe_key like 'seguimiento:85000000-%') <> 1 then
    raise exception 'notice survived rollback or internal notice created'; end if;
end $$;
select 'PASS: authorized progress, observation visibility, family-only achievements, stage/answer/drawing validation, upsert, audit and rollback' as result;
