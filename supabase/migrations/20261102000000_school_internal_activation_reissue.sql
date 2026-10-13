-- SQL33: reissue only an unverified, school-owned internal invitation.
-- Pending deployment. No identity, password, role or school record is created.
begin;

alter table public.school_account_invitation_provisions
  drop constraint school_account_invitation_provisions_state_check;
alter table public.school_account_invitation_provisions
  add constraint school_account_invitation_provisions_state_check
  check (state in ('provisioned', 'quarantined', 'managed', 'reissuing'));

create function public.school_begin_internal_activation_reissue(p_auth_user_id uuid, p_replacement_nonce uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_auth auth.users;
  v_profile public.profiles;
  v_attempt public.school_account_invitation_provisions;
  v_roles text[];
  v_email text;
  v_old_nonce uuid;
  v_now timestamptz;
begin
  if v_actor is null or not public.school_actor_active() or not public.school_is_leader() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_auth_user_id is null or p_auth_user_id = v_actor or p_replacement_nonce is null then
    raise exception 'invalid_reissue' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('school:account-administration'));
  if not public.school_actor_active() or not public.school_is_leader() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_auth from auth.users where id = p_auth_user_id for update;
  if not found then return jsonb_build_object('reserved', false); end if;
  select * into v_profile from public.profiles where id = p_auth_user_id for update;
  if not found then return jsonb_build_object('reserved', false); end if;
  select * into v_attempt from public.school_account_invitation_provisions where auth_user_id = p_auth_user_id for update;
  if not found then return jsonb_build_object('reserved', false); end if;
  select array_agg(role order by role) into v_roles from public.user_roles where user_id = p_auth_user_id;
  v_now := clock_timestamp();
  v_email := lower(btrim(v_auth.email));
  if not v_profile.active or v_attempt.state <> 'provisioned'
    or v_attempt.provisioned_at > v_now
    or v_attempt.invitation_nonce = p_replacement_nonce
    or v_auth.invited_at is null or v_auth.email_confirmed_at is not null
    or v_auth.last_sign_in_at is not null or coalesce(v_auth.encrypted_password, '') <> ''
    or v_auth.deleted_at is not null or v_auth.banned_until > v_now
    or cardinality(v_roles) is distinct from 1 or v_roles[1] not in ('docente', 'tutor', 'direccion')
    or (v_roles[1] = 'direccion' and not public.school_has_role(array['superadmin']::text[]))
    or (v_attempt.inviter_id <> v_actor and not public.school_has_role(array['superadmin']::text[]))
    or not exists (select 1 from public.user_roles where user_id = p_auth_user_id and role = v_roles[1] and assigned_by = v_attempt.inviter_id)
    or (v_roles[1] = 'docente' and not exists (select 1 from public.teachers where user_id = p_auth_user_id and active))
    or (v_roles[1] = 'tutor' and not exists (select 1 from public.guardians where user_id = p_auth_user_id and active))
    or v_email is null or v_email = '' or lower(btrim(v_profile.email)) is distinct from v_email
    or (v_auth.raw_app_meta_data -> 'school_invitation_receipt' ->> 'delivery') is distinct from 'internal'
    or (v_auth.raw_app_meta_data -> 'school_invitation_receipt' ->> 'nonce') is distinct from v_attempt.invitation_nonce::text
    or (v_auth.raw_app_meta_data -> 'school_invitation_receipt' ->> 'email') is distinct from v_email
    or (v_auth.raw_app_meta_data -> 'school_invitation_receipt' ->> 'role') is distinct from v_roles[1]
    or (v_auth.raw_app_meta_data -> 'school_invitation_receipt' ->> 'inviter_id') is distinct from v_attempt.inviter_id::text
    or coalesce(v_auth.raw_app_meta_data ->> 'school_activation_completed_nonce', '') <> '' then
    return jsonb_build_object('reserved', false);
  end if;
  v_old_nonce := v_attempt.invitation_nonce;
  update public.school_account_invitation_provisions
  set state = 'reissuing', invitation_nonce = p_replacement_nonce, provisioned_at = v_now
  where auth_user_id = p_auth_user_id and state = 'provisioned' and invitation_nonce = v_old_nonce;
  if not found then return jsonb_build_object('reserved', false); end if;
  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (gen_random_uuid(), v_actor, 'reserve_internal_activation_reissue', 'activation', p_auth_user_id::text || ':' || p_replacement_nonce::text, v_now);
  return jsonb_build_object('reserved', true, 'id', p_auth_user_id, 'name', v_profile.name,
    'email', v_email, 'role', v_roles[1], 'nonce', p_replacement_nonce,
    'previousNonce', v_old_nonce, 'inviterId', v_attempt.inviter_id);
end;
$$;

create function public.school_finish_internal_activation_reissue(p_auth_user_id uuid, p_replacement_nonce uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_auth auth.users;
  v_profile public.profiles;
  v_attempt public.school_account_invitation_provisions;
  v_roles text[];
  v_email text;
  v_now timestamptz;
begin
  if v_actor is null or not public.school_actor_active() or not public.school_is_leader() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_auth_user_id is null or p_auth_user_id = v_actor or p_replacement_nonce is null then
    raise exception 'invalid_reissue' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('school:account-administration'));
  if not public.school_actor_active() or not public.school_is_leader() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_auth from auth.users where id = p_auth_user_id for update;
  if not found then return jsonb_build_object('finished', false); end if;
  select * into v_profile from public.profiles where id = p_auth_user_id for update;
  if not found then return jsonb_build_object('finished', false); end if;
  select * into v_attempt from public.school_account_invitation_provisions where auth_user_id = p_auth_user_id for update;
  if not found then return jsonb_build_object('finished', false); end if;
  select array_agg(role order by role) into v_roles from public.user_roles where user_id = p_auth_user_id;
  v_now := clock_timestamp();
  v_email := lower(btrim(v_auth.email));
  if not v_profile.active or v_attempt.state <> 'reissuing' or v_attempt.invitation_nonce <> p_replacement_nonce
    or v_attempt.provisioned_at > v_now or v_attempt.provisioned_at <= v_now - interval '5 minutes'
    or not exists (select 1 from public.audit_log where actor_id = v_actor and action = 'reserve_internal_activation_reissue'
      and entity_type = 'activation' and entity_id = p_auth_user_id::text || ':' || p_replacement_nonce::text and created_at = v_attempt.provisioned_at)
    or v_auth.invited_at is null or v_auth.email_confirmed_at is not null
    or v_auth.last_sign_in_at is not null or coalesce(v_auth.encrypted_password, '') <> ''
    or v_auth.deleted_at is not null or v_auth.banned_until > v_now
    or cardinality(v_roles) is distinct from 1 or v_roles[1] not in ('docente', 'tutor', 'direccion')
    or (v_roles[1] = 'direccion' and not public.school_has_role(array['superadmin']::text[]))
    or (v_attempt.inviter_id <> v_actor and not public.school_has_role(array['superadmin']::text[]))
    or not exists (select 1 from public.user_roles where user_id = p_auth_user_id and role = v_roles[1] and assigned_by = v_attempt.inviter_id)
    or (v_roles[1] = 'docente' and not exists (select 1 from public.teachers where user_id = p_auth_user_id and active))
    or (v_roles[1] = 'tutor' and not exists (select 1 from public.guardians where user_id = p_auth_user_id and active))
    or v_email is null or v_email = '' or lower(btrim(v_profile.email)) is distinct from v_email
    or (v_auth.raw_app_meta_data -> 'school_invitation_receipt' ->> 'delivery') is distinct from 'internal'
    or (v_auth.raw_app_meta_data -> 'school_invitation_receipt' ->> 'nonce') is distinct from p_replacement_nonce::text
    or (v_auth.raw_app_meta_data -> 'school_invitation_receipt' ->> 'email') is distinct from v_email
    or (v_auth.raw_app_meta_data -> 'school_invitation_receipt' ->> 'role') is distinct from v_roles[1]
    or (v_auth.raw_app_meta_data -> 'school_invitation_receipt' ->> 'inviter_id') is distinct from v_attempt.inviter_id::text
    or coalesce(v_auth.raw_app_meta_data ->> 'school_activation_completed_nonce', '') <> '' then
    return jsonb_build_object('finished', false);
  end if;
  update public.school_account_invitation_provisions set state = 'provisioned', provisioned_at = v_now
  where auth_user_id = p_auth_user_id and state = 'reissuing' and invitation_nonce = p_replacement_nonce;
  if not found then return jsonb_build_object('finished', false); end if;
  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (gen_random_uuid(), v_actor, 'finish_internal_activation_reissue', 'activation', p_auth_user_id::text || ':' || p_replacement_nonce::text, v_now);
  return jsonb_build_object('finished', true, 'id', p_auth_user_id, 'email', v_email, 'role', v_roles[1], 'nonce', p_replacement_nonce);
end;
$$;

revoke all on function public.school_begin_internal_activation_reissue(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.school_finish_internal_activation_reissue(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.school_begin_internal_activation_reissue(uuid, uuid) to authenticated;
grant execute on function public.school_finish_internal_activation_reissue(uuid, uuid) to authenticated;
commit;
