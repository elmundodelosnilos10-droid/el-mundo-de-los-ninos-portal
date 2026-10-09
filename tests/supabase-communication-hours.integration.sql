-- Run only inside BEGIN ... ROLLBACK after migrations through 20261018.
-- Uses two synthetic identities without passwords; does not persist fixtures.
insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at) values
('a1000000-0000-4000-8000-000000000001', 'hours-direction@example.test', '{"name":"Dirección sintética"}', now(), now()),
('a1000000-0000-4000-8000-000000000002', 'hours-family@example.test', '{"name":"Familia sintética"}', now(), now());
update public.profiles set active = true where id in (
  'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002'
);
insert into public.user_roles (user_id, role) values
('a1000000-0000-4000-8000-000000000001', 'direccion'),
('a1000000-0000-4000-8000-000000000002', 'tutor');

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
do $$
declare result public.communication_settings; audits bigint;
begin
  result := public.school_update_communication_settings(true, array[1], '08:00', '17:00');
  if result.updated_by <> 'a1000000-0000-4000-8000-000000000001'::uuid
    or result.enabled <> true or result.weekdays <> '1' then raise exception 'settings actor or values failed'; end if;
  if public.school_communication_hours_open('2026-10-12T13:59:59Z') then raise exception 'before start was allowed'; end if;
  if not public.school_communication_hours_open('2026-10-12T14:00:00Z') then raise exception 'inclusive start failed'; end if;
  if not public.school_communication_hours_open('2026-10-12T22:59:59Z') then raise exception 'inside hours failed'; end if;
  if public.school_communication_hours_open('2026-10-12T23:00:00Z') then raise exception 'exclusive end failed'; end if;
  if public.school_communication_hours_open('2026-10-13T14:00:00Z') then raise exception 'wrong weekday was allowed'; end if;
  if public.school_communication_hours_open(null) then raise exception 'null instant was allowed'; end if;
  select count(*) into audits from public.audit_log where actor_id = 'a1000000-0000-4000-8000-000000000001'
    and action = 'update_communication_hours';
  if audits <> 1 then raise exception 'settings update audit failed'; end if;
  begin
    perform public.school_update_communication_settings(true, array[1,1], '08:00', '17:00');
    raise exception 'duplicate weekdays accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.school_update_communication_settings(true, array[]::integer[], '08:00', '17:00');
    raise exception 'enabled empty weekdays accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.school_update_communication_settings(true, array[1], '17:00', '08:00');
    raise exception 'inverted hours accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.school_update_communication_settings(true, array[[1,2],[3,4]], '08:00', '17:00');
    raise exception 'multidimensional weekdays accepted';
  exception when invalid_parameter_value then null; end;
  select count(*) into audits from public.audit_log where actor_id = 'a1000000-0000-4000-8000-000000000001'
    and action = 'update_communication_hours';
  if audits <> 1 then raise exception 'invalid update changed audit'; end if;
end;
$$;

-- Owner-level corruption fixture verifies the trigger's fail-closed behavior.
update public.communication_settings set enabled = true, weekdays = '9' where id = 'school';
do $$
begin
  if public.school_communication_hours_open('2026-10-12T14:00:00Z') then raise exception 'corrupt weekdays opened hours'; end if;
  begin
    insert into public.messages (id, conversation_id, author_id, body, sent_at) values
    ('a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Mensaje ficticio que debe rechazarse antes de FK', now());
    raise exception 'trigger allowed a participant outside hours';
  exception when insufficient_privilege then null; end;
end;
$$;
update public.communication_settings set enabled = false, weekdays = '', start_time = '08:00', end_time = '17:00' where id = 'school';
do $$
begin
  if not public.school_communication_hours_open('2026-10-12T23:00:00Z') then raise exception 'disabled valid schedule was not open'; end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);
do $$
begin
  begin
    perform public.school_update_communication_settings(false, array[]::integer[], '08:00', '17:00');
    raise exception 'family changed settings';
  exception when insufficient_privilege then null; end;
  begin
    update public.communication_settings set enabled = true where id = 'school';
    raise exception 'direct write bypassed audited RPC';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;

-- A trusted owner without JWT can import history: ordinary FK validation still
-- applies, so this intentionally nonexistent conversation fails with its FK.
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
update public.communication_settings set enabled = true, weekdays = '9' where id = 'school';
do $$
begin
  begin
    insert into public.messages (id, conversation_id, author_id, body, sent_at) values
    ('a2000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Importación sintética', now());
    raise exception 'nonexistent conversation unexpectedly inserted';
  exception when foreign_key_violation then null; end;
end;
$$;

select 'PASS: communication hours, audited leadership RPC, trigger and timezone boundaries' as verification;
