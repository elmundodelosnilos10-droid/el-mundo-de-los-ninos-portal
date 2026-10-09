-- PostgreSQL integration fixture. The operator MUST wrap this whole file in
-- BEGIN ... ROLLBACK after migrations 08 through 23. Never run standalone.
-- Synthetic Auth profiles only: no passwords, real children or storage objects.
-- SAVEPOINT rejects standalone execution before the first fixture mutation.
savepoint enrollment_attendance_fixture;
insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at) values
('71000000-0000-4000-8000-000000000001', 'attendance-leader@example.test', '{"name":"Dirección sintética"}', now(), now()),
('71000000-0000-4000-8000-000000000002', 'attendance-teacher@example.test', '{"name":"Docente sintética"}', now(), now()),
('71000000-0000-4000-8000-000000000003', 'attendance-family-a@example.test', '{"name":"Familia sintética A"}', now(), now()),
('71000000-0000-4000-8000-000000000004', 'attendance-family-b@example.test', '{"name":"Familia sintética B"}', now(), now());
update public.profiles set active = true where id in (
 '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002',
 '71000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000004'
);
insert into public.user_roles (user_id, role) values
('71000000-0000-4000-8000-000000000001', 'superadmin'),
('71000000-0000-4000-8000-000000000002', 'docente'),
('71000000-0000-4000-8000-000000000003', 'tutor'),
('71000000-0000-4000-8000-000000000004', 'tutor');
insert into public.teachers (id,user_id) values ('74000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000002');
insert into public.guardians (id,user_id) values
('74000000-0000-4000-8000-000000000004','71000000-0000-4000-8000-000000000003'),
('74000000-0000-4000-8000-000000000005','71000000-0000-4000-8000-000000000004');

set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
do $$
declare result jsonb;
begin
  perform public.school_create_year('72000000-0000-4000-8000-000000000001','Asistencia ciclo sintético','2026-08-01','2027-07-31');
  perform public.school_create_group('72000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001','Asistencia grupo A','preescolar');
  perform public.school_create_group('72000000-0000-4000-8000-000000000003','72000000-0000-4000-8000-000000000001','Asistencia grupo B','maternal');
  result := public.school_create_student('73000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','Alumno sintético A','Prueba','2021-02-02','72000000-0000-4000-8000-000000000002');
  if result->>'id'  is distinct from  '73000000-0000-4000-8000-000000000001' then raise exception 'create student DTO failed'; end if;
  perform public.school_create_student('73000000-0000-4000-8000-000000000002','74000000-0000-4000-8000-000000000002','Alumno sintético B','Prueba',null,'72000000-0000-4000-8000-000000000003');
  result := public.school_assign_teacher_to_group('72000000-0000-4000-8000-000000000002','74000000-0000-4000-8000-000000000003');
  if (result->>'assigned')::boolean is distinct from true or (result->>'alreadyAssigned')::boolean is distinct from false then raise exception 'teacher assignment failed'; end if;
  result := public.school_assign_teacher_to_group('72000000-0000-4000-8000-000000000002','74000000-0000-4000-8000-000000000003');
  if (result->>'alreadyAssigned')::boolean is distinct from true then raise exception 'teacher assignment not idempotent'; end if;
  perform public.school_link_guardian('73000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000004','Tutor sintético',false);
  perform public.school_link_guardian('73000000-0000-4000-8000-000000000002','74000000-0000-4000-8000-000000000005','Tutor sintético',false);
  begin
    perform public.school_link_guardian('73000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000004','Tutor sintético',false);
    raise exception 'duplicate guardian link accepted';
  exception when unique_violation then null; end;
end $$;

select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
do $$
declare result jsonb; malformed jsonb;
begin
  result := public.school_attendance_roster('72000000-0000-4000-8000-000000000002','2026-10-07');
  if jsonb_array_length(result->'items')  is distinct from  1 or result->'items'->0->>'studentId'  is distinct from  '73000000-0000-4000-8000-000000000001' or
    result->'items'->0->>'status' is not null then raise exception 'empty authorized roster failed'; end if;
  result := public.school_record_attendance('72000000-0000-4000-8000-000000000002','2026-10-07','[{"studentId":"73000000-0000-4000-8000-000000000001","status":"presente"}]');
  if (result->>'saved')::integer  is distinct from  1 then raise exception 'daily save unconfirmed'; end if;
  perform public.school_record_attendance('72000000-0000-4000-8000-000000000002','2026-10-08','[{"studentId":"73000000-0000-4000-8000-000000000001","status":"ausente","note":"Pendiente de justificación"}]');
  for malformed in select value from jsonb_array_elements('[
    [], true, [null], [{}],
    [{"studentId":"73000000-0000-4000-8000-000000000001"}],
    [{"studentId":"73000000-0000-4000-8000-000000000001","status":"presente","unexpected":true}],
    [{"studentId":"73000000-0000-4000-8000-000000000001","status":"inventado"}],
    [{"studentId":null,"status":"presente"}],
    [{"studentId":"73000000-0000-4000-8000-000000000001","status":null}],
    [{"studentId":"73000000-0000-4000-8000-000000000001","status":"presente","note":true}],
    [{"studentId":"73000000-0000-4000-8000-000000000001","status":"justificada"}],
    [{"studentId":"73000000-0000-4000-8000-000000000001","status":"presente"},{"studentId":"73000000-0000-4000-8000-000000000001","status":"ausente"}],
    [{"studentId":"73000000-0000-4000-8000-000000000002","status":"presente"}]
  ]'::jsonb) loop
    begin
      perform public.school_record_attendance('72000000-0000-4000-8000-000000000002','2026-10-09',malformed);
      raise exception 'malformed or out-of-group attendance accepted: %',malformed;
    exception when invalid_parameter_value then null; end;
  end loop;
  begin
    perform public.school_record_attendance('72000000-0000-4000-8000-000000000003','2026-10-07','[{"studentId":"73000000-0000-4000-8000-000000000002","status":"presente"}]');
    raise exception 'teacher wrote unassigned group';
  exception when insufficient_privilege then null; end;
  begin
    perform public.school_attendance_roster('72000000-0000-4000-8000-000000000003','2026-10-07');
    raise exception 'teacher read unassigned roster';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.attendance (id,student_id,group_id,on_date,status,recorded_by)
    values ('76000000-0000-4000-8000-000000000099','73000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000002','2026-10-09','presente',auth.uid());
    raise exception 'direct attendance write bypass accepted';
  exception when insufficient_privilege then null; end;
  -- Nested transaction rollback also undoes generated attendance and audit.
  begin
    perform public.school_record_attendance('72000000-0000-4000-8000-000000000002','2026-10-09','[{"studentId":"73000000-0000-4000-8000-000000000001","status":"presente"}]');
    raise exception 'rollback_probe' using errcode = 'P9001';
  exception when sqlstate 'P9001' then null; end;
  if exists(select 1 from public.attendance where student_id='73000000-0000-4000-8000-000000000001' and on_date='2026-10-09') then
    raise exception 'rolled-back daily attendance persisted'; end if;
end $$;

select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
do $$
declare original_id uuid; original_recorder uuid;
begin
  select id,recorded_by into original_id,original_recorder from public.attendance
  where student_id='73000000-0000-4000-8000-000000000001' and on_date='2026-10-07';
  perform public.school_record_attendance('72000000-0000-4000-8000-000000000002','2026-10-07','[{"studentId":"73000000-0000-4000-8000-000000000001","status":"retardo","note":"Corrección sintética"}]');
  if not exists(select 1 from public.attendance where id=original_id and recorded_by=original_recorder and
    modified_by=auth.uid() and modified_at is not null and status='retardo') then
    raise exception 'correction replaced original recorder or lacked edit metadata'; end if;
  if (select count(*) from public.attendance where student_id='73000000-0000-4000-8000-000000000001' and on_date='2026-10-07') is distinct from 1 then
    raise exception 'correction duplicated daily row'; end if;
  perform public.school_record_attendance('72000000-0000-4000-8000-000000000003','2026-10-07','[{"studentId":"73000000-0000-4000-8000-000000000002","status":"presente"}]');
end $$;

select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000003',true);
do $$
declare result jsonb;
begin
  result := public.school_attendance_roster('72000000-0000-4000-8000-000000000002','2026-10-07');
  if jsonb_array_length(result->'items') is distinct from 1 or result->'items'->0->>'status' is distinct from 'retardo' then raise exception 'family daily view failed'; end if;
  result := public.school_attendance_history('73000000-0000-4000-8000-000000000001',null,'2026-10-07','2026-10-08');
  if (result->>'total')::integer is distinct from 2 or (result->>'attendancePercent')::integer is distinct from 50 then raise exception 'family history summary failed'; end if;
  begin
    perform public.school_attendance_history('73000000-0000-4000-8000-000000000002',null,'2026-10-07','2026-10-08');
    raise exception 'family read another child history';
  exception when no_data_found then null; end;
  begin
    perform public.school_record_attendance('72000000-0000-4000-8000-000000000002','2026-10-07','[{"studentId":"73000000-0000-4000-8000-000000000001","status":"presente"}]');
    raise exception 'family recorded attendance';
  exception when insufficient_privilege then null; end;
  result := public.school_submit_attendance_justification('75000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','2026-10-08','Motivo familiar sintético');
  if result->>'status' is distinct from 'pendiente' or result->>'id' is distinct from '75000000-0000-4000-8000-000000000001' then raise exception 'justification submit failed'; end if;
  begin
    perform public.school_submit_attendance_justification('75000000-0000-4000-8000-000000000002','73000000-0000-4000-8000-000000000001','2026-10-08','Duplicado sintético');
    raise exception 'duplicate pending justification accepted';
  exception when unique_violation then null; end;
end $$;

select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000004',true);
do $$
begin
  if exists(select 1 from public.attendance where student_id='73000000-0000-4000-8000-000000000001') or
    exists(select 1 from public.attendance_justifications where student_id='73000000-0000-4000-8000-000000000001') then
    raise exception 'family B read child A attendance or justification'; end if;
  begin
    perform public.school_attendance_roster('72000000-0000-4000-8000-000000000002','2026-10-07');
    raise exception 'family B read group A roster';
  exception when no_data_found then null; end;
  begin
    perform public.school_submit_attendance_justification('75000000-0000-4000-8000-000000000003','73000000-0000-4000-8000-000000000001','2026-10-08','Alumno ajeno');
    raise exception 'family B justified child A';
  exception when no_data_found then null; end;
  begin
    perform public.school_update_student('73000000-0000-4000-8000-000000000001','Cambio no autorizado','Prueba',null,false);
    raise exception 'family edited student';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
do $$
declare result jsonb; format_name text;
begin
  result := public.school_list_attendance_justifications('72000000-0000-4000-8000-000000000002','2026-10-08',null);
  if jsonb_array_length(result->'items') is distinct from 1 or result->'items'->0->>'status' is distinct from 'pendiente' then raise exception 'staff justification list failed'; end if;
  result := public.school_review_attendance_justification('75000000-0000-4000-8000-000000000001','aceptada');
  if result->>'status' is distinct from 'aceptada' then raise exception 'justification review failed'; end if;
  if not exists(select 1 from public.attendance where student_id='73000000-0000-4000-8000-000000000001' and
    on_date='2026-10-08' and status='justificada' and note='Motivo familiar sintético' and recorded_by=auth.uid()) then
    raise exception 'accepted justification did not preserve/update daily attendance'; end if;
  begin
    perform public.school_review_attendance_justification('75000000-0000-4000-8000-000000000001','rechazada');
    raise exception 'reviewed justification was mutable';
  exception when unique_violation then null; end;
  result := public.school_attendance_history('73000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000002','2026-10-07','2026-10-08');
  if (result->'counts'->>'retardo')::integer is distinct from 1 or (result->'counts'->>'justificada')::integer is distinct from 1 or
    (result->>'attendancePercent')::integer is distinct from 50 then raise exception 'staff justified history summary failed'; end if;
  foreach format_name in array array['csv','xlsx','pdf'] loop
    result := public.school_attendance_report('72000000-0000-4000-8000-000000000002','2026-10-07','2026-10-08',format_name);
    if jsonb_array_length(result->'items') is distinct from 2 or result->>'groupName' is distinct from 'Asistencia grupo A' then raise exception 'scoped report data failed'; end if;
  end loop;
  begin
    perform public.school_attendance_report(null,'2026-10-07','2026-10-08','csv');
    raise exception 'teacher exported all groups';
  exception when insufficient_privilege then null; end;
  begin
    perform public.school_attendance_report('72000000-0000-4000-8000-000000000003','2026-10-07','2026-10-08','csv');
    raise exception 'teacher exported another group';
  exception when no_data_found then null; end;
end $$;

select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000003',true);
do $$
declare result jsonb;
begin
  result := public.school_list_attendance_justifications(null,null,'73000000-0000-4000-8000-000000000001');
  if result->'items'->0->>'status' is distinct from 'aceptada' then raise exception 'family review state missing'; end if;
  if (select count(*) from public.notifications where kind='asistencia_justificacion_aceptada' and
    dedupe_key like 'attendance-justification:75000000-0000-4000-8000-000000000001:%') is distinct from 1 then raise exception 'family review notification missing'; end if;
end $$;

select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
do $$
declare result jsonb;
begin
  result := public.school_attendance_report(null,'2026-10-07','2026-10-08','csv');
  if not exists(select 1 from jsonb_array_elements(result->'items') as item(value) where item.value->>'groupName'='Asistencia grupo A') or
    not exists(select 1 from jsonb_array_elements(result->'items') as item(value) where item.value->>'groupName'='Asistencia grupo B') then
    raise exception 'leadership all-group report omitted fixture groups'; end if;
  perform public.school_update_student('73000000-0000-4000-8000-000000000001','Alumno actualizado A','Prueba',null,false);
  if (select birth_date from public.students where id='73000000-0000-4000-8000-000000000001') is distinct from '2021-02-02' then raise exception 'omitted birth date was replaced'; end if;
  perform public.school_update_student('73000000-0000-4000-8000-000000000001','Alumno actualizado A','Prueba',null,true);
  if (select birth_date from public.students where id='73000000-0000-4000-8000-000000000001') is not null then raise exception 'explicit birth date removal failed'; end if;
  perform public.school_set_student_active('73000000-0000-4000-8000-000000000001',false,null,null);
  if (select active from public.students where id='73000000-0000-4000-8000-000000000001') or
    exists(select 1 from public.enrollments where student_id='73000000-0000-4000-8000-000000000001' and ended_at is null) then
    raise exception 'deactivation did not close active enrollment'; end if;
  if (select count(*) from public.attendance where student_id='73000000-0000-4000-8000-000000000001') is distinct from 2 then raise exception 'deactivation erased historical attendance'; end if;
  begin
    perform public.school_set_student_active('73000000-0000-4000-8000-000000000001',true,null,null);
    raise exception 'reactivation without group accepted';
  exception when invalid_parameter_value then null; end;
  begin
    update public.students set given_name='Direct edit' where id='73000000-0000-4000-8000-000000000001';
    raise exception 'direct student update bypass accepted';
  exception when insufficient_privilege then null; end;
  begin
    update public.audit_log set action='Tampered' where entity_id='73000000-0000-4000-8000-000000000001';
    raise exception 'audit history mutable';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000003',true);
do $$
begin
  begin
    perform public.school_attendance_history('73000000-0000-4000-8000-000000000001',null,'2026-10-07','2026-10-08');
    raise exception 'inactive student remained available to family';
  exception when no_data_found then null; end;
end $$;

select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
do $$
begin
  perform public.school_set_student_active('73000000-0000-4000-8000-000000000001',true,'72000000-0000-4000-8000-000000000002','74000000-0000-4000-8000-000000000010');
  if (select count(*) from public.enrollments where student_id='73000000-0000-4000-8000-000000000001') is distinct from 2 or
    (select count(*) from public.enrollments where student_id='73000000-0000-4000-8000-000000000001' and ended_at is null) is distinct from 1 then
    raise exception 'reactivation failed to preserve enrollment history'; end if;
  begin
    perform public.school_set_student_active('73000000-0000-4000-8000-000000000001',true,'72000000-0000-4000-8000-000000000002','74000000-0000-4000-8000-000000000011');
    raise exception 'duplicate reactivation accepted';
  exception when unique_violation then null; end;
end $$;

select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000003',true);
do $$
declare result jsonb;
begin
  result := public.school_attendance_history('73000000-0000-4000-8000-000000000001',null,'2026-10-07','2026-10-08');
  if (result->>'total')::integer is distinct from 2 then raise exception 'reactivation lost historical family access'; end if;
end $$;
reset role;
do $$
begin
  if (select count(*) from public.audit_log where actor_id in (
    '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002',
    '71000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000004')) is distinct from 22 then
    raise exception 'audit counts do not match authorized writes/exports or rejected writes survived'; end if;
  if (select count(*) from public.notifications where user_id in (
    '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002') and
    kind='asistencia_justificacion' and dedupe_key like 'attendance-justification:75000000-0000-4000-8000-000000000001:%') is distinct from 2 then
    raise exception 'assigned teacher/leadership pending notices missing'; end if;
  if exists(select 1 from public.notifications where user_id='71000000-0000-4000-8000-000000000004' and
    dedupe_key like 'attendance-justification:75000000-0000-4000-8000-000000000001:%') then
    raise exception 'justification notification leaked to other family'; end if;
end $$;
select 'PASS: enrollment RPCs, scoped attendance/history/justifications/report data, malformed writes, immutable provenance/audit, isolation, notifications, rollback, student edits and logical withdrawal/reactivation' as result;
release savepoint enrollment_attendance_fixture;
