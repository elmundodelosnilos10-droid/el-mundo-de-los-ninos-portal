-- Run only inside BEGIN ... ROLLBACK after migrations through 20261024.
-- Synthetic Auth users have no passwords; no email or external request occurs.
insert into auth.users (id, email, invited_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at) values
('b1000000-0000-4000-8000-000000000001', 'account-super@example.test', null, '{"name":"Super sintético"}', '{}', now(), now()),
('b1000000-0000-4000-8000-000000000002', 'account-direction@example.test', null, '{"name":"Dirección sintética"}', '{}', now(), now()),
('b1000000-0000-4000-8000-000000000003', 'account-teacher@example.test', now(), '{"name":"Nombre inicial Auth"}', '{"school_invitation_receipt":{"nonce":"b9000000-0000-4000-8000-000000000001","inviter_id":"b1000000-0000-4000-8000-000000000002","email":"account-teacher@example.test"}}', now(), now()),
('b1000000-0000-4000-8000-000000000004', 'account-quarantine@example.test', now(), '{"name":"Cuarentena sintética"}', '{"school_invitation_receipt":{"nonce":"b9000000-0000-4000-8000-000000000002","inviter_id":"b1000000-0000-4000-8000-000000000002","email":"account-quarantine@example.test"}}', now(), now()),
('b1000000-0000-4000-8000-000000000005', 'account-new-direction@example.test', now(), '{"name":"Nueva dirección sintética"}', '{"school_invitation_receipt":{"nonce":"b9000000-0000-4000-8000-000000000003","inviter_id":"b1000000-0000-4000-8000-000000000001","email":"account-new-direction@example.test"}}', now(), now()),
('b1000000-0000-4000-8000-000000000006', 'account-old@example.test', now() - interval '1 day', '{"name":"Identidad previa"}', '{"school_invitation_receipt":{"nonce":"b9000000-0000-4000-8000-000000000004","inviter_id":"b1000000-0000-4000-8000-000000000002","email":"account-old@example.test"}}', now() - interval '1 day', now());
update public.profiles set active = true where id in (
  'b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002'
);
insert into public.user_roles (user_id, role) values
('b1000000-0000-4000-8000-000000000001', 'superadmin'),
('b1000000-0000-4000-8000-000000000002', 'direccion');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000002', true);
do $$
declare result jsonb;
begin
  result := public.school_provision_invited_account('b1000000-0000-4000-8000-000000000003', 'account-teacher@example.test', 'Nombre escolar editado', 'docente', 'b9000000-0000-4000-8000-000000000001');
  if result->>'id' <> 'b1000000-0000-4000-8000-000000000003' or not (result->>'active')::boolean
    or not exists (select 1 from public.teachers where user_id = 'b1000000-0000-4000-8000-000000000003' and active)
    or not exists (select 1 from public.user_roles where user_id = 'b1000000-0000-4000-8000-000000000003' and role = 'docente') then
    raise exception 'fresh invited teacher provisioning failed';
  end if;
  begin
    perform public.school_provision_invited_account('b1000000-0000-4000-8000-000000000003', 'account-teacher@example.test', 'Nombre escolar editado', 'tutor', 'b9000000-0000-4000-8000-000000000001');
    raise exception 'existing school account was provisioned again';
  exception when unique_violation then null; end;
  begin
    perform public.school_provision_invited_account('b1000000-0000-4000-8000-000000000005', 'account-new-direction@example.test', 'Dirección', 'direccion', 'b9000000-0000-4000-8000-000000000003');
    raise exception 'Direction provisioned another Direction';
  exception when insufficient_privilege then null; end;
  begin
    perform public.school_provision_invited_account('b1000000-0000-4000-8000-000000000006', 'account-old@example.test', 'Previo', 'tutor', 'b9000000-0000-4000-8000-000000000004');
    raise exception 'old Auth identity automatically received a role';
  exception when insufficient_privilege then null; end;
  begin
    perform public.school_provision_invited_account('b1000000-0000-4000-8000-000000000004', 'different@example.test', 'Incorrecto', 'tutor', 'b9000000-0000-4000-8000-000000000002');
    raise exception 'mismatched Auth email was provisioned';
  exception when insufficient_privilege then null; end;
  begin
    perform public.school_update_account('b1000000-0000-4000-8000-000000000002', p_active => false);
    raise exception 'self deactivation was allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.school_update_account('b1000000-0000-4000-8000-000000000001', p_active => false);
    raise exception 'superadmin deactivation was allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.school_update_account('b1000000-0000-4000-8000-000000000003', p_role => 'direccion');
    raise exception 'Direction assigned Direction';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.user_roles(user_id, role) values ('b1000000-0000-4000-8000-000000000004', 'superadmin');
    raise exception 'direct role write bypassed RPC';
  exception when insufficient_privilege then null; end;

  perform public.school_update_account('b1000000-0000-4000-8000-000000000003', p_role => 'tutor');
  if exists (select 1 from public.teachers where user_id = 'b1000000-0000-4000-8000-000000000003' and active)
    or not exists (select 1 from public.guardians where user_id = 'b1000000-0000-4000-8000-000000000003' and active) then
    raise exception 'typed role profile update failed';
  end if;
  perform public.school_update_account('b1000000-0000-4000-8000-000000000003', p_name => 'Nombre escolar protegido', p_expected_email => 'account-teacher@example.test');
  begin
    perform public.school_update_account('b1000000-0000-4000-8000-000000000003', p_name => 'Correo distinto', p_expected_email => 'new-email@example.test');
    raise exception 'school RPC changed Auth email';
  exception when unique_violation then null; end;
  perform public.school_update_account('b1000000-0000-4000-8000-000000000003', p_active => false);
  perform public.school_update_account('b1000000-0000-4000-8000-000000000003', p_role => 'docente');
  if exists (select 1 from public.profiles where id = 'b1000000-0000-4000-8000-000000000003' and active)
    or exists (select 1 from public.teachers where user_id = 'b1000000-0000-4000-8000-000000000003' and active) then
    raise exception 'role change accidentally reactivated disabled account';
  end if;

  perform public.school_provision_invited_account('b1000000-0000-4000-8000-000000000004', 'account-quarantine@example.test', 'Cuarentena', 'tutor', 'b9000000-0000-4000-8000-000000000002');
  result := public.school_quarantine_invited_account('b1000000-0000-4000-8000-000000000004', 'b9000000-0000-4000-8000-000000000002');
  if not (result->>'quarantined')::boolean
    or exists (select 1 from public.user_roles where user_id = 'b1000000-0000-4000-8000-000000000004')
    or exists (select 1 from public.profiles where id = 'b1000000-0000-4000-8000-000000000004' and active) then
    raise exception 'uncertain invitation quarantine failed';
  end if;
  begin
    perform public.school_quarantine_invited_account('b1000000-0000-4000-8000-000000000003', 'b9000000-0000-4000-8000-000000000001');
    raise exception 'quarantine overwrote a subsequently managed account';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;

-- Simulate an ordinary Auth metadata/password-related update. The trigger must
-- preserve both the edited school name and the disabled state.
update auth.users set raw_user_meta_data = '{"name":"Auth intenta pisar nombre"}', updated_at = now()
where id = 'b1000000-0000-4000-8000-000000000003';
do $$
begin
  if not exists (select 1 from public.profiles where id = 'b1000000-0000-4000-8000-000000000003'
    and name = 'Nombre escolar protegido' and not active) then raise exception 'Auth trigger overwrote school name or active'; end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
do $$
begin
  perform public.school_provision_invited_account('b1000000-0000-4000-8000-000000000005', 'account-new-direction@example.test', 'Dirección nueva', 'direccion', 'b9000000-0000-4000-8000-000000000003');
  begin
    perform public.school_update_account('b1000000-0000-4000-8000-000000000001', p_role => 'docente');
    raise exception 'last superadmin was lost';
  exception when insufficient_privilege then null; end;
  perform public.school_update_account('b1000000-0000-4000-8000-000000000003', p_active => true);
  if not exists (select 1 from public.profiles where id = 'b1000000-0000-4000-8000-000000000003' and active)
    or not exists (select 1 from public.teachers where user_id = 'b1000000-0000-4000-8000-000000000003' and active)
    or exists (select 1 from public.guardians where user_id = 'b1000000-0000-4000-8000-000000000003' and active) then
    raise exception 'reactivation did not match authoritative role';
  end if;
end;
$$;
reset role;
do $$
begin
  if (select count(*) from public.audit_log where entity_type = 'user' and entity_id = 'b1000000-0000-4000-8000-000000000003') <> 6 then
    raise exception 'account updates/audit were not atomic';
  end if;
  if not exists (select 1 from public.school_account_invitation_provisions where auth_user_id = 'b1000000-0000-4000-8000-000000000004' and state = 'quarantined') then
    raise exception 'invitation recovery state missing';
  end if;
end;
$$;
select 'PASS: fresh Auth UUID, protected roles, school name/state, quarantine and atomic audit' as verification;
