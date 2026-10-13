-- Synthetic PostgreSQL only, after SQL24/32/33. Never execute in production.
-- Owns BEGIN/ROLLBACK; no provider, mail or real account is touched.
begin;
insert into auth.users (id, email, invited_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
select id::uuid, email, now(), jsonb_build_object('name', 'Cuenta sintética reemisión'),
  case when role is null then '{}'::jsonb else jsonb_build_object('school_invitation_receipt', jsonb_build_object(
    'nonce', nonce, 'inviter_id', 'd3300000-0000-4000-8000-000000000001', 'email', email, 'delivery', 'internal', 'role', role)) end,
  now(), now()
from (values
  ('d3300000-0000-4000-8000-000000000001', 'reissue-leader@example.test', null::text, null::text),
  ('d3300000-0000-4000-8000-000000000002', 'reissue-teacher@example.test', 'docente', 'd3310000-0000-4000-8000-000000000002'),
  ('d3300000-0000-4000-8000-000000000003', 'reissue-tutor@example.test', 'tutor', 'd3310000-0000-4000-8000-000000000003'),
  ('d3300000-0000-4000-8000-000000000004', 'reissue-admin-guard@example.test', null::text, null::text)
) x(id,email,role,nonce);
update public.profiles set active = true where id in ('d3300000-0000-4000-8000-000000000001', 'd3300000-0000-4000-8000-000000000004');
insert into public.user_roles(user_id,role) values
('d3300000-0000-4000-8000-000000000001','direccion'), ('d3300000-0000-4000-8000-000000000004','superadmin');
select set_config('request.jwt.claim.sub','d3300000-0000-4000-8000-000000000001',true);
select public.school_provision_invited_account('d3300000-0000-4000-8000-000000000002','reissue-teacher@example.test','Maestra sintética','docente','d3310000-0000-4000-8000-000000000002');
select public.school_provision_invited_account('d3300000-0000-4000-8000-000000000003','reissue-tutor@example.test','Familia sintética','tutor','d3310000-0000-4000-8000-000000000003');

do $$ declare v_result jsonb; begin
  v_result := public.school_begin_internal_activation_reissue('d3300000-0000-4000-8000-000000000002','d3320000-0000-4000-8000-000000000002');
  if v_result->>'reserved' <> 'true' or v_result->>'previousNonce' <> 'd3310000-0000-4000-8000-000000000002' then raise exception 'reservation failed'; end if;
  if public.school_begin_internal_activation_reissue('d3300000-0000-4000-8000-000000000002','d3330000-0000-4000-8000-000000000002') <> '{"reserved":false}'::jsonb then raise exception 'second reservation accepted'; end if;
  if public.school_finish_internal_activation_reissue('d3300000-0000-4000-8000-000000000002','d3320000-0000-4000-8000-000000000002') <> '{"finished":false}'::jsonb then raise exception 'unstamped receipt finalized'; end if;
end; $$;
select set_config('request.jwt.claim.sub','d3300000-0000-4000-8000-000000000002',true);
do $$ begin
  if public.school_claim_internal_activation('d3310000-0000-4000-8000-000000000002') <> '{"claimed":false}'::jsonb
    or public.school_claim_internal_activation('d3320000-0000-4000-8000-000000000002') <> '{"claimed":false}'::jsonb then raise exception 'claim accepted while reissuing'; end if;
  begin perform public.school_begin_internal_activation_reissue('d3300000-0000-4000-8000-000000000003','d3320000-0000-4000-8000-000000000003'); raise exception 'teacher gained reissue access'; exception when insufficient_privilege then null; end;
end; $$;
update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{school_invitation_receipt,nonce}','"d3320000-0000-4000-8000-000000000002"') where id='d3300000-0000-4000-8000-000000000002';
select set_config('request.jwt.claim.sub','d3300000-0000-4000-8000-000000000004',true);
do $$ begin
  if public.school_finish_internal_activation_reissue('d3300000-0000-4000-8000-000000000002','d3320000-0000-4000-8000-000000000002') <> '{"finished":false}'::jsonb then raise exception 'other leader finalized reservation'; end if;
end; $$;
select set_config('request.jwt.claim.sub','d3300000-0000-4000-8000-000000000001',true);
do $$ declare v_result jsonb; begin
  v_result := public.school_finish_internal_activation_reissue('d3300000-0000-4000-8000-000000000002','d3320000-0000-4000-8000-000000000002');
  if v_result->>'finished' <> 'true' or v_result->>'id' <> 'd3300000-0000-4000-8000-000000000002' then raise exception 'finalization failed'; end if;
  if public.school_finish_internal_activation_reissue('d3300000-0000-4000-8000-000000000002','d3320000-0000-4000-8000-000000000002') <> '{"finished":false}'::jsonb then raise exception 'finalization replay accepted'; end if;
end; $$;

-- Each refusal uses a rollback subtransaction, preserving the exact pending row.
do $$ declare v_case text; v_result jsonb; begin
  foreach v_case in array array['confirmed','signed_in','password','completed','delivery','managed','quarantined','future','inactive','superadmin'] loop
    begin
      case v_case
        when 'confirmed' then update auth.users set email_confirmed_at=now() where id='d3300000-0000-4000-8000-000000000003';
        when 'signed_in' then update auth.users set last_sign_in_at=now() where id='d3300000-0000-4000-8000-000000000003';
        when 'password' then update auth.users set encrypted_password='synthetic-not-a-real-password-hash' where id='d3300000-0000-4000-8000-000000000003';
        when 'completed' then update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{school_activation_completed_nonce}','"d3310000-0000-4000-8000-000000000003"') where id='d3300000-0000-4000-8000-000000000003';
        when 'delivery' then update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{school_invitation_receipt,delivery}','"email"') where id='d3300000-0000-4000-8000-000000000003';
        when 'managed' then update public.school_account_invitation_provisions set state='managed' where auth_user_id='d3300000-0000-4000-8000-000000000003';
        when 'quarantined' then update public.school_account_invitation_provisions set state='quarantined' where auth_user_id='d3300000-0000-4000-8000-000000000003';
        when 'future' then update public.school_account_invitation_provisions set provisioned_at=clock_timestamp()+interval '1 minute' where auth_user_id='d3300000-0000-4000-8000-000000000003';
        when 'inactive' then update public.profiles set active=false where id='d3300000-0000-4000-8000-000000000003';
        else update public.user_roles set role='superadmin' where user_id='d3300000-0000-4000-8000-000000000003';
      end case;
      v_result := public.school_begin_internal_activation_reissue('d3300000-0000-4000-8000-000000000003','d3320000-0000-4000-8000-000000000003');
      if v_result <> '{"reserved":false}'::jsonb then raise exception 'begin refusal failed: %',v_case; end if;
      raise exception using errcode='ZX001', message='rollback synthetic refusal';
    exception when sqlstate 'ZX001' then null; end;
  end loop;
end; $$;
select public.school_begin_internal_activation_reissue('d3300000-0000-4000-8000-000000000003','d3320000-0000-4000-8000-000000000003');
update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{school_invitation_receipt,nonce}','"d3320000-0000-4000-8000-000000000003"') where id='d3300000-0000-4000-8000-000000000003';
do $$ declare v_case text; v_result jsonb; begin
  foreach v_case in array array['confirmed','signed_in','password','completed','role','managed','expiry','inactive'] loop
    begin
      case v_case
        when 'confirmed' then update auth.users set email_confirmed_at=now() where id='d3300000-0000-4000-8000-000000000003';
        when 'signed_in' then update auth.users set last_sign_in_at=now() where id='d3300000-0000-4000-8000-000000000003';
        when 'password' then update auth.users set encrypted_password='synthetic-not-a-real-password-hash' where id='d3300000-0000-4000-8000-000000000003';
        when 'completed' then update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{school_activation_completed_nonce}','"d3320000-0000-4000-8000-000000000003"') where id='d3300000-0000-4000-8000-000000000003';
        when 'role' then update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{school_invitation_receipt,role}','"docente"') where id='d3300000-0000-4000-8000-000000000003';
        when 'managed' then perform public.school_update_account('d3300000-0000-4000-8000-000000000003',null,null,'Nombre sintético cambiado','reissue-tutor@example.test');
        when 'expiry' then update public.school_account_invitation_provisions set provisioned_at=clock_timestamp()-interval '5 minutes' where auth_user_id='d3300000-0000-4000-8000-000000000003';
        else update public.profiles set active=false where id='d3300000-0000-4000-8000-000000000003';
      end case;
      v_result := public.school_finish_internal_activation_reissue('d3300000-0000-4000-8000-000000000003','d3320000-0000-4000-8000-000000000003');
      if v_result <> '{"finished":false}'::jsonb then raise exception 'finish refusal failed: %',v_case; end if;
      raise exception using errcode='ZX001', message='rollback synthetic refusal';
    exception when sqlstate 'ZX001' then null; end;
  end loop;
end; $$;
set local role anon;
do $$ begin
  begin perform public.school_begin_internal_activation_reissue('d3300000-0000-4000-8000-000000000003','d3330000-0000-4000-8000-000000000003'); raise exception 'anon granted begin'; exception when insufficient_privilege then null; end;
  begin perform public.school_finish_internal_activation_reissue('d3300000-0000-4000-8000-000000000003','d3320000-0000-4000-8000-000000000003'); raise exception 'anon granted finish'; exception when insufficient_privilege then null; end;
end; $$;
reset role;
rollback;
