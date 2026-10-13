-- SQL32: consume a school-owned internal invitation exactly once.
-- Pending deployment. No Auth identity, password, table or school role is created.
begin;

create or replace function public.school_claim_internal_activation(p_invitation_nonce uuid)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_auth auth.users;
  v_profile public.profiles;
  v_attempt public.school_account_invitation_provisions;
  v_roles text[];
  v_email text;
  v_now timestamptz;
  v_claimed boolean := false;
begin
  if v_actor is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_invitation_nonce is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- Share the lock with provision/quarantine/role/status changes from SQL24.
  -- Auth's trigger also locks Auth first, then profiles; preserve that order.
  perform pg_advisory_xact_lock(hashtext('school:account-administration'));
  select * into v_auth from auth.users where id = v_actor for update;
  if not found then return jsonb_build_object('claimed', false); end if;
  select * into v_profile from public.profiles where id = v_actor for update;
  if not found then return jsonb_build_object('claimed', false); end if;
  select * into v_attempt from public.school_account_invitation_provisions
  where auth_user_id = v_actor for update;
  if not found then return jsonb_build_object('claimed', false); end if;

  -- Check current state after every waiting lock, using the current wall clock.
  v_now := clock_timestamp();
  if not v_profile.active or not public.school_actor_active()
    or v_auth.invited_at is null or v_auth.deleted_at is not null
    or v_auth.banned_until > v_now
    or v_attempt.state <> 'provisioned'
    or v_attempt.invitation_nonce <> p_invitation_nonce
    or v_attempt.provisioned_at > v_now
    or v_attempt.provisioned_at <= v_now - interval '30 minutes' then
    return jsonb_build_object('claimed', false);
  end if;

  select array_agg(role order by role) into v_roles from public.user_roles where user_id = v_actor;
  if cardinality(v_roles) is distinct from 1
    or v_roles[1] not in ('docente', 'tutor', 'direccion')
    or not exists (select 1 from public.user_roles where user_id = v_actor
      and role = v_roles[1] and assigned_by = v_attempt.inviter_id)
    or (v_roles[1] = 'docente' and not exists (
      select 1 from public.teachers where user_id = v_actor and active))
    or (v_roles[1] = 'tutor' and not exists (
      select 1 from public.guardians where user_id = v_actor and active)) then
    return jsonb_build_object('claimed', false);
  end if;

  v_email := lower(btrim(v_auth.email));
  if v_email is null or v_email = '' or lower(btrim(v_profile.email)) is distinct from v_email
    or (v_auth.raw_app_meta_data -> 'school_invitation_receipt' ->> 'delivery') is distinct from 'internal'
    or (v_auth.raw_app_meta_data -> 'school_invitation_receipt' ->> 'nonce') is distinct from p_invitation_nonce::text
    or (v_auth.raw_app_meta_data -> 'school_invitation_receipt' ->> 'email') is distinct from v_email
    or (v_auth.raw_app_meta_data -> 'school_invitation_receipt' ->> 'role') is distinct from v_roles[1]
    or (v_auth.raw_app_meta_data -> 'school_invitation_receipt' ->> 'inviter_id') is distinct from v_attempt.inviter_id::text
    or (v_auth.raw_app_meta_data ->> 'school_activation_completed_nonce') = p_invitation_nonce::text then
    return jsonb_build_object('claimed', false);
  end if;

  -- This is the claim, not a password-change receipt. On an uncertain external
  -- Auth result the claim stays consumed; a second request cannot reuse it.
  update public.school_account_invitation_provisions set state = 'managed'
  where auth_user_id = v_actor and invitation_nonce = p_invitation_nonce and state = 'provisioned'
  returning true into v_claimed;
  if not found then return jsonb_build_object('claimed', false); end if;
  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (gen_random_uuid(), v_actor, 'claim_internal_activation', 'user', v_actor::text, v_now);
  return jsonb_build_object('claimed', v_claimed);
end;
$$;

create or replace function public.school_internal_activation_ready()
returns jsonb language plpgsql stable security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.school_actor_active() or not public.school_is_leader() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object('ready', true, 'version', 32);
end;
$$;

-- No access to the private provision table or other school tables is granted.
revoke all on function public.school_claim_internal_activation(uuid) from public, anon, authenticated, service_role;
revoke all on function public.school_internal_activation_ready() from public, anon, authenticated, service_role;
grant execute on function public.school_claim_internal_activation(uuid) to authenticated;
grant execute on function public.school_internal_activation_ready() to authenticated;

commit;
