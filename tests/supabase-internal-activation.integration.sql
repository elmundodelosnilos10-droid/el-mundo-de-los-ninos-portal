-- Local/synthetic PostgreSQL only, after SQL24 and SQL32. Never run in production.
-- This fixture owns BEGIN/ROLLBACK. No password, email or external call occurs.
begin;

insert into auth.users (id, email, invited_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at) values
('d3200000-0000-4000-8000-000000000001', 'activation-leader@example.test', null, '{"name":"Dirección sintética activación"}', '{}', now(), now()),
('d3200000-0000-4000-8000-000000000002', 'activation-teacher@example.test', now(), '{"name":"Docente sintética activación"}', '{"school_invitation_receipt":{"nonce":"d3210000-0000-4000-8000-000000000002","inviter_id":"d3200000-0000-4000-8000-000000000001","email":"activation-teacher@example.test","delivery":"internal","role":"docente"}}', now(), now()),
('d3200000-0000-4000-8000-000000000003', 'activation-tutor@example.test', now(), '{"name":"Familia sintética activación"}', '{"school_invitation_receipt":{"nonce":"d3210000-0000-4000-8000-000000000003","inviter_id":"d3200000-0000-4000-8000-000000000001","email":"activation-tutor@example.test","delivery":"internal","role":"tutor"}}', now(), now()),
('d3200000-0000-4000-8000-000000000004', 'activation-refusal@example.test', now(), '{"name":"Rechazos sintéticos activación"}', '{"school_invitation_receipt":{"nonce":"d3210000-0000-4000-8000-000000000004","inviter_id":"d3200000-0000-4000-8000-000000000001","email":"activation-refusal@example.test","delivery":"internal","role":"tutor"}}', now(), now()),
('d3200000-0000-4000-8000-000000000005', 'activation-guard@example.test', null, '{"name":"Guarda sintética de administración"}', '{}', now(), now());
-- Preserve the last-superadmin guard while temporarily testing a forbidden
-- superadmin candidate. Both synthetic roles disappear with this rollback.
update public.profiles set active = true where id in ('d3200000-0000-4000-8000-000000000001', 'd3200000-0000-4000-8000-000000000005');
insert into public.user_roles (user_id, role) values
('d3200000-0000-4000-8000-000000000001', 'direccion'),
('d3200000-0000-4000-8000-000000000005', 'superadmin');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd3200000-0000-4000-8000-000000000001', true);
do $$
begin
  if public.school_internal_activation_ready() <> '{"ready":true,"version":32}'::jsonb then
    raise exception 'active leader SQL32 readiness failed'; end if;
  perform public.school_provision_invited_account('d3200000-0000-4000-8000-000000000002', 'activation-teacher@example.test', 'Docente sintética', 'docente', 'd3210000-0000-4000-8000-000000000002');
  perform public.school_provision_invited_account('d3200000-0000-4000-8000-000000000003', 'activation-tutor@example.test', 'Familia sintética', 'tutor', 'd3210000-0000-4000-8000-000000000003');
  perform public.school_provision_invited_account('d3200000-0000-4000-8000-000000000004', 'activation-refusal@example.test', 'Rechazos sintéticos', 'tutor', 'd3210000-0000-4000-8000-000000000004');
end;
$$;

select set_config('request.jwt.claim.sub', 'd3200000-0000-4000-8000-000000000002', true);
do $$
begin
  if public.school_claim_internal_activation('d3210000-0000-4000-8000-000000000002') <> '{"claimed":true}'::jsonb then
    raise exception 'fresh teacher activation was not claimed'; end if;
  if public.school_claim_internal_activation('d3210000-0000-4000-8000-000000000002') <> '{"claimed":false}'::jsonb then
    raise exception 'teacher activation was claimed twice'; end if;
  begin
    perform public.school_internal_activation_ready();
    raise exception 'teacher gained leader readiness access';
  exception when insufficient_privilege then null; end;
end;
$$;
select set_config('request.jwt.claim.sub', 'd3200000-0000-4000-8000-000000000003', true);
do $$
begin
  if public.school_claim_internal_activation('d3210000-0000-4000-8000-000000000003') <> '{"claimed":true}'::jsonb
    or public.school_claim_internal_activation('d3210000-0000-4000-8000-000000000003') <> '{"claimed":false}'::jsonb then
    raise exception 'tutor claim/replay contract failed'; end if;
end;
$$;

-- Exercise refusals against one still-provisioned, otherwise valid own account.
select set_config('request.jwt.claim.sub', 'd3200000-0000-4000-8000-000000000004', true);
do $$
begin
  if public.school_claim_internal_activation(null) <> '{"claimed":false}'::jsonb
    or public.school_claim_internal_activation('d3210000-0000-4000-8000-000000000002') <> '{"claimed":false}'::jsonb then
    raise exception 'null/wrong/another-account nonce was accepted'; end if;
  begin
    perform public.school_internal_activation_ready();
    raise exception 'tutor gained leader readiness access';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.school_account_invitation_provisions;
    raise exception 'private provision table became readable';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;

update public.school_account_invitation_provisions set provisioned_at = clock_timestamp() - interval '30 minutes'
where auth_user_id = 'd3200000-0000-4000-8000-000000000004';
set local role authenticated;
do $$ begin
  if public.school_claim_internal_activation('d3210000-0000-4000-8000-000000000004') <> '{"claimed":false}'::jsonb then
    raise exception 'activation accepted exact/elapsed 30-minute expiry'; end if;
end; $$;
reset role;
update public.school_account_invitation_provisions set provisioned_at = clock_timestamp() + interval '1 minute'
where auth_user_id = 'd3200000-0000-4000-8000-000000000004';
set local role authenticated;
do $$ begin
  if public.school_claim_internal_activation('d3210000-0000-4000-8000-000000000004') <> '{"claimed":false}'::jsonb then
    raise exception 'future provision timestamp was accepted'; end if;
end; $$;
reset role;
update public.school_account_invitation_provisions set provisioned_at = clock_timestamp()
where auth_user_id = 'd3200000-0000-4000-8000-000000000004';

-- Change only the synthetic receipt. Auth's profile sync must preserve its active state.
do $$
declare v_field text; v_replacement jsonb; v_result jsonb; v_original jsonb;
begin
  select raw_app_meta_data into v_original from auth.users where id = 'd3200000-0000-4000-8000-000000000004';
  foreach v_field in array array['nonce', 'email', 'delivery', 'role', 'inviter_id'] loop
    v_replacement := case v_field
      when 'nonce' then '"d3210000-0000-4000-8000-000000000002"'::jsonb
      when 'email' then '"someone-else@example.test"'::jsonb
      when 'delivery' then '"email"'::jsonb
      when 'role' then '"docente"'::jsonb
      else '"d3200000-0000-4000-8000-000000000002"'::jsonb end;
    update auth.users set raw_app_meta_data = jsonb_set(v_original, array['school_invitation_receipt', v_field], v_replacement)
    where id = 'd3200000-0000-4000-8000-000000000004';
    -- ACL is checked separately below. This owner-run loop keeps mutations and
    -- restoration in one transaction while the function still derives auth.uid().
    v_result := public.school_claim_internal_activation('d3210000-0000-4000-8000-000000000004');
    if v_result <> '{"claimed":false}'::jsonb then raise exception 'receipt mismatch accepted: %', v_field; end if;
  end loop;
  update auth.users set raw_app_meta_data = jsonb_set(v_original, '{school_activation_completed_nonce}', '"d3210000-0000-4000-8000-000000000004"')
  where id = 'd3200000-0000-4000-8000-000000000004';
  if public.school_claim_internal_activation('d3210000-0000-4000-8000-000000000004') <> '{"claimed":false}'::jsonb then
    raise exception 'completed activation marker was accepted'; end if;
  update auth.users set raw_app_meta_data = v_original where id = 'd3200000-0000-4000-8000-000000000004';
end;
$$;

update public.profiles set email = 'mismatch@example.test' where id = 'd3200000-0000-4000-8000-000000000004';
set local role authenticated;
do $$ begin
  if public.school_claim_internal_activation('d3210000-0000-4000-8000-000000000004') <> '{"claimed":false}'::jsonb then
    raise exception 'profile/Auth email mismatch accepted'; end if;
end; $$;
reset role;
update public.profiles set email = 'activation-refusal@example.test', active = false where id = 'd3200000-0000-4000-8000-000000000004';
set local role authenticated;
do $$ begin
  if public.school_claim_internal_activation('d3210000-0000-4000-8000-000000000004') <> '{"claimed":false}'::jsonb then
    raise exception 'inactive own account claimed activation'; end if;
end; $$;
reset role;
update public.profiles set active = true where id = 'd3200000-0000-4000-8000-000000000004';
update public.guardians set active = false where user_id = 'd3200000-0000-4000-8000-000000000004';
set local role authenticated;
do $$ begin
  if public.school_claim_internal_activation('d3210000-0000-4000-8000-000000000004') <> '{"claimed":false}'::jsonb then
    raise exception 'inactive typed guardian claimed activation'; end if;
end; $$;
reset role;
update public.guardians set active = true where user_id = 'd3200000-0000-4000-8000-000000000004';

insert into public.user_roles (user_id, role, assigned_by) values
('d3200000-0000-4000-8000-000000000004', 'docente', 'd3200000-0000-4000-8000-000000000001');
set local role authenticated;
do $$ begin
  if public.school_claim_internal_activation('d3210000-0000-4000-8000-000000000004') <> '{"claimed":false}'::jsonb then
    raise exception 'multiple-role activation was accepted'; end if;
end; $$;
reset role;
delete from public.user_roles where user_id = 'd3200000-0000-4000-8000-000000000004' and role = 'docente';
update public.user_roles set role = 'superadmin' where user_id = 'd3200000-0000-4000-8000-000000000004' and role = 'tutor';
set local role authenticated;
do $$ begin
  if public.school_claim_internal_activation('d3210000-0000-4000-8000-000000000004') <> '{"claimed":false}'::jsonb then
    raise exception 'superadmin activation was accepted'; end if;
end; $$;
reset role;
update public.user_roles set role = 'tutor' where user_id = 'd3200000-0000-4000-8000-000000000004' and role = 'superadmin';

do $$
declare v_state text;
begin
  foreach v_state in array array['quarantined', 'managed'] loop
    update public.school_account_invitation_provisions set state = v_state where auth_user_id = 'd3200000-0000-4000-8000-000000000004';
    if public.school_claim_internal_activation('d3210000-0000-4000-8000-000000000004') <> '{"claimed":false}'::jsonb then
      raise exception 'non-provisioned activation state accepted: %', v_state; end if;
  end loop;
  update public.school_account_invitation_provisions set state = 'provisioned' where auth_user_id = 'd3200000-0000-4000-8000-000000000004';
end;
$$;

-- The valid candidate remains unconsumed after every negative case.
set local role authenticated;
do $$ begin
  if public.school_claim_internal_activation('d3210000-0000-4000-8000-000000000004') <> '{"claimed":true}'::jsonb
    or public.school_claim_internal_activation('d3210000-0000-4000-8000-000000000004') <> '{"claimed":false}'::jsonb then
    raise exception 'negative checks consumed a valid invitation or replay succeeded'; end if;
end; $$;

set local role anon;
do $$ begin
  begin
    perform public.school_claim_internal_activation('d3210000-0000-4000-8000-000000000004');
    raise exception 'anon executed activation claim';
  exception when insufficient_privilege then null; end;
  begin
    perform public.school_internal_activation_ready();
    raise exception 'anon executed readiness';
  exception when insufficient_privilege then null; end;
end; $$;
reset role;

update public.profiles set active = false where id = 'd3200000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd3200000-0000-4000-8000-000000000001', true);
do $$ begin
  begin
    perform public.school_internal_activation_ready();
    raise exception 'inactive leader executed readiness';
  exception when insufficient_privilege then null; end;
end; $$;
select set_config('request.jwt.claim.sub', '', true);
do $$ begin
  begin
    perform public.school_claim_internal_activation('d3210000-0000-4000-8000-000000000004');
    raise exception 'authenticated role without an identity claimed activation';
  exception when insufficient_privilege then null; end;
  begin
    perform public.school_internal_activation_ready();
    raise exception 'authenticated role without an identity executed readiness';
  exception when insufficient_privilege then null; end;
end; $$;
reset role;

do $$ begin
  if (select count(*) from public.school_account_invitation_provisions where auth_user_id in (
    'd3200000-0000-4000-8000-000000000002', 'd3200000-0000-4000-8000-000000000003', 'd3200000-0000-4000-8000-000000000004') and state = 'managed') <> 3 then
    raise exception 'one-use activation state did not persist inside the transaction'; end if;
  if (select count(*) from public.audit_log where action = 'claim_internal_activation' and actor_id in (
    'd3200000-0000-4000-8000-000000000002', 'd3200000-0000-4000-8000-000000000003', 'd3200000-0000-4000-8000-000000000004')) <> 3 then
    raise exception 'successful claims were not audited exactly once'; end if;
end; $$;
select 'PASS: SQL32 own one-use claim, replay, expiry, receipt, roles, state and authenticated ACL' as verification;
rollback;
