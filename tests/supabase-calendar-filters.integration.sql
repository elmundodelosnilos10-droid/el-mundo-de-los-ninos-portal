-- REAL PostgreSQL fixture after migration 20261028000000.
-- Operator must wrap this file in BEGIN ... ROLLBACK as database owner.
-- Synthetic identities have no password; no email, Storage or real pupil data.
insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at) values
('c1000000-0000-4000-8000-000000000001', 'calendar-teacher-a@example.test', '{"name":"Docente calendario sintético A"}', now(), now()),
('c1000000-0000-4000-8000-000000000002', 'calendar-teacher-b@example.test', '{"name":"Docente calendario sintético B"}', now(), now()),
('c1000000-0000-4000-8000-000000000003', 'calendar-family-a@example.test', '{"name":"Familia calendario sintético A"}', now(), now()),
('c1000000-0000-4000-8000-000000000004', 'calendar-family-b@example.test', '{"name":"Familia calendario sintético B"}', now(), now()),
('c1000000-0000-4000-8000-000000000005', 'calendar-leader@example.test', '{"name":"Dirección calendario sintético"}', now(), now());
update public.profiles set active = true where id in (
  'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002',
  'c1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000005');
insert into public.user_roles (user_id, role) values
('c1000000-0000-4000-8000-000000000001', 'docente'), ('c1000000-0000-4000-8000-000000000002', 'docente'),
('c1000000-0000-4000-8000-000000000003', 'tutor'), ('c1000000-0000-4000-8000-000000000004', 'tutor'),
('c1000000-0000-4000-8000-000000000005', 'direccion');
insert into public.school_years (id, name, starts_on, ends_on, active)
values ('c2000000-0000-4000-8000-000000000001', 'Calendario PostgreSQL sintético', '2026-08-01', '2027-07-31', true);
insert into public.groups (id, year_id, name, stage) values
('c2100000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'Calendario sintético A', 'preescolar'),
('c2100000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001', 'Calendario sintético B', 'maternal');
insert into public.students (id, given_name, family_name) values
('c2200000-0000-4000-8000-000000000001', 'Alumno sintético A', 'Calendario'),
('c2200000-0000-4000-8000-000000000002', 'Alumno sintético B', 'Calendario');
insert into public.enrollments (id, student_id, group_id, enrolled_at) values
('c2500000-0000-4000-8000-000000000001', 'c2200000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', now()),
('c2500000-0000-4000-8000-000000000002', 'c2200000-0000-4000-8000-000000000002', 'c2100000-0000-4000-8000-000000000002', now());
insert into public.teachers (id, user_id) values
('c2300000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001'),
('c2300000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002');
insert into public.teacher_groups (teacher_id, group_id) values
('c2300000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001'),
('c2300000-0000-4000-8000-000000000002', 'c2100000-0000-4000-8000-000000000002');
insert into public.guardians (id, user_id) values
('c2400000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000003'),
('c2400000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000004');
insert into public.student_guardians (student_id, guardian_id, relationship) values
('c2200000-0000-4000-8000-000000000001', 'c2400000-0000-4000-8000-000000000001', 'Tutor sintético'),
('c2200000-0000-4000-8000-000000000002', 'c2400000-0000-4000-8000-000000000002', 'Tutor sintético');

-- More than one page, followed by a rare kind: filtering after LIMIT would miss it.
insert into public.calendar_events (id, group_id, kind, title, starts_at, created_by)
select ('c3400000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
 'c2100000-0000-4000-8000-000000000001', 'evento', 'Evento sintético ' || i,
 now() + interval '1 hour', 'c1000000-0000-4000-8000-000000000001' from generate_series(1, 501) i;
insert into public.calendar_events (id, group_id, kind, title, starts_at, created_by) values
('c3400000-0000-4000-8000-000000000502', 'c2100000-0000-4000-8000-000000000001', 'festival', 'Festival sintético después de la página', now() + interval '1 day', 'c1000000-0000-4000-8000-000000000001'),
('c3400000-0000-4000-8000-000000000503', 'c2100000-0000-4000-8000-000000000001', 'clase', 'Clase sintética', now() + interval '1 day 1 hour', 'c1000000-0000-4000-8000-000000000001'),
('c3400000-0000-4000-8000-000000000504', 'c2100000-0000-4000-8000-000000000002', 'festival', 'Festival sintético B', now() + interval '1 day', 'c1000000-0000-4000-8000-000000000002'),
('c3400000-0000-4000-8000-000000000505', null, 'festival', 'Festival general sintético', now() + interval '1 day', 'c1000000-0000-4000-8000-000000000005');
insert into public.tasks (id, group_id, title, instructions, due_at, created_by, created_at) values
('c3200000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 'Entrega sintética', 'Sin evidencias ni datos reales.', now() + interval '1 day 2 hours', 'c1000000-0000-4000-8000-000000000001', now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true);
do $$
declare result jsonb; group_a uuid := 'c2100000-0000-4000-8000-000000000001';
begin
 result := public.school_calendar_feed_filtered(now(), now() + interval '2 days', 500, group_a, false, null);
 if (result->>'total')::integer <> 504 or jsonb_array_length(result->'items') <> 500 or (result->>'limited')::boolean is distinct from true then raise exception 'calendar limit/total failed'; end if;
 result := public.school_calendar_feed_filtered(now(), now() + interval '2 days', 500, group_a, false, 'festival');
 if (result->>'total')::integer <> 1 or result->'items'->0->>'id' <> 'c3400000-0000-4000-8000-000000000502' or (result->>'limited')::boolean is distinct from false then raise exception 'filter was applied after limit'; end if;
 result := public.school_calendar_feed_filtered(now(), now() + interval '2 days', 500, group_a, false, 'entrega');
 if (result->>'total')::integer <> 1 or result->'items'->0->>'source' <> 'tarea' then raise exception 'task deadline missing in delivery filter'; end if;
 result := public.school_calendar_feed_filtered(now(), now() + interval '2 days', 500, group_a, false, 'clase');
 if (result->>'total')::integer <> 1 then raise exception 'class filter failed'; end if;
 result := public.school_calendar_feed_filtered(now(), now() + interval '2 days', 500, 'c2100000-0000-4000-8000-000000000002', false, 'festival');
 if (result->>'total')::integer <> 0 then raise exception 'teacher read another group through filter'; end if;
 begin perform public.school_calendar_feed_filtered(now(), now() + interval '2 days', 500, group_a, true, null); raise exception 'contradictory group/general accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.school_calendar_feed_filtered(now(), now() + interval '2 days', 500, group_a, false, 'invalid'); raise exception 'invalid kind accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.school_calendar_feed_filtered(now(), now() + interval '2 days', 501, group_a, false, null); raise exception 'oversized limit accepted'; exception when invalid_parameter_value then null; end;
end $$;

select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000003', true);
do $$
declare result jsonb;
begin
 result := public.school_calendar_feed_filtered(now(), now() + interval '2 days', 500, 'c2100000-0000-4000-8000-000000000001', false, 'festival');
 if (result->>'total')::integer <> 1 then raise exception 'family A own filter failed'; end if;
 result := public.school_calendar_feed_filtered(now(), now() + interval '2 days', 500, 'c2100000-0000-4000-8000-000000000002', false, null);
 if (result->>'total')::integer <> 0 or jsonb_array_length(result->'items') <> 0 then raise exception 'family A read group B'; end if;
 result := public.school_calendar_feed_filtered(now(), now() + interval '2 days', 500, null, true, null);
 if (result->>'total')::integer <> 0 then raise exception 'general filter expanded family permissions'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000004', true);
do $$
declare result jsonb;
begin
 result := public.school_calendar_feed_filtered(now(), now() + interval '2 days', 500, 'c2100000-0000-4000-8000-000000000002', false, 'festival');
 if (result->>'total')::integer <> 1 or result->'items'->0->>'id' <> 'c3400000-0000-4000-8000-000000000504' then raise exception 'family B own filter failed'; end if;
 result := public.school_calendar_feed_filtered(now(), now() + interval '2 days', 500, 'c2100000-0000-4000-8000-000000000001', false, null);
 if (result->>'total')::integer <> 0 then raise exception 'family B read group A'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000005', true);
do $$
declare result jsonb;
begin
 result := public.school_calendar_feed_filtered(now(), now() + interval '2 days', 500, null, true, 'festival');
 if not exists (select 1 from jsonb_array_elements(result->'items') item where item->>'id' = 'c3400000-0000-4000-8000-000000000505') then raise exception 'leader general filter missing own event'; end if;
 if exists (select 1 from jsonb_array_elements(result->'items') item where item->>'groupId' is not null) then raise exception 'general filter includes group-specific items'; end if;
end $$;

reset role;
update public.profiles set active = false where id = 'c1000000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000003', true);
do $$ begin
 begin perform public.school_calendar_feed_filtered(now(), now() + interval '2 days'); raise exception 'inactive actor accepted'; exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$ begin
 begin perform public.school_calendar_feed_filtered(now(), now() + interval '2 days'); raise exception 'anon execute allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Caller must ROLLBACK every synthetic row above.
