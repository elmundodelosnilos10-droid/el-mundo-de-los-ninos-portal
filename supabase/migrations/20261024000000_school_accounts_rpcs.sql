-- School account administration derives permissions from verified JWT + DB roles.
-- Pending deployment; no Auth identity, password or demonstration account is created.
begin;

-- Track the narrow invitation attempt so uncertain responses can be quarantined
-- without altering accounts that another administrator has since managed.
create table public.school_account_invitation_provisions (
  auth_user_id uuid primary key references auth.users(id),
  invitation_nonce uuid not null unique,
  inviter_id uuid not null references public.profiles(id),
  provisioned_at timestamptz not null,
  state text not null check (state in ('provisioned', 'quarantined', 'managed'))
);
alter table public.school_account_invitation_provisions enable row level security;
revoke all on table public.school_account_invitation_provisions from public, anon, authenticated;

-- Auth can refresh identity fields but cannot replace a school's edited name,
-- active status or access roles from user-controlled Auth metadata.
create or replace function public.sync_profile_from_auth_user()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  if new.email is null then return new; end if;
  insert into public.profiles (id, name, email, email_verified, active, image, created_at, updated_at)
  values (
    new.id, coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1)),
    new.email, new.email_confirmed_at is not null, false,
    new.raw_user_meta_data ->> 'image', new.created_at, new.updated_at
  )
  on conflict (id) do update set
    email = excluded.email, email_verified = excluded.email_verified,
    image = excluded.image, updated_at = excluded.updated_at;
  return new;
end;
$$;
revoke all on function public.sync_profile_from_auth_user() from public, anon, authenticated;

create function public.school_provision_invited_account(
  p_auth_user_id uuid, p_expected_email text, p_name text, p_role text, p_invitation_nonce uuid
)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_auth auth.users;
  v_profile public.profiles;
  v_email text := lower(btrim(p_expected_email));
begin
  if v_actor is null or not public.school_actor_active() or not public.school_is_leader()
    or (p_role = 'direccion' and not public.school_has_role(array['superadmin']::text[])) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_auth_user_id is null or p_auth_user_id = v_actor or p_invitation_nonce is null
    or p_role is null or p_role not in ('direccion', 'docente', 'tutor')
    or p_name is null or char_length(btrim(p_name)) not between 2 and 100 or p_name ~ '[[:cntrl:]]'
    or v_email is null or char_length(v_email) not between 3 and 254 then
    raise exception 'invalid_account' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('school:account-administration'));
  -- A waiting request may have lost its school permissions while another
  -- account-administration transaction held the lock. Recheck after acquiring it.
  if not public.school_actor_active() or not public.school_is_leader()
    or (p_role = 'direccion' and not public.school_has_role(array['superadmin']::text[])) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Auth's trigger locks Auth first, then profiles. Preserve that lock order.
  select * into v_auth from auth.users where id = p_auth_user_id for update;
  if not found then raise exception 'account_not_found' using errcode = 'P0002'; end if;
  select * into v_profile from public.profiles where id = p_auth_user_id for update;
  if not found then raise exception 'profile_not_ready' using errcode = 'P0002'; end if;
  if v_auth.invited_at is null or v_auth.created_at < now() - interval '10 minutes'
    or v_auth.email is null or lower(btrim(v_auth.email)) <> v_email
    or lower(btrim(v_profile.email)) <> v_email
    or coalesce(v_auth.raw_app_meta_data -> 'school_invitation_receipt' ->> 'nonce', '') <> p_invitation_nonce::text
    or coalesce(v_auth.raw_app_meta_data -> 'school_invitation_receipt' ->> 'inviter_id', '') <> v_actor::text
    or coalesce(v_auth.raw_app_meta_data -> 'school_invitation_receipt' ->> 'email', '') <> v_email then
    raise exception 'invitation_receipt_invalid' using errcode = '42501';
  end if;
  if v_profile.active or exists (select 1 from public.user_roles where user_id = p_auth_user_id)
    or exists (select 1 from public.teachers where user_id = p_auth_user_id)
    or exists (select 1 from public.guardians where user_id = p_auth_user_id)
    or exists (select 1 from public.school_account_invitation_provisions where auth_user_id = p_auth_user_id) then
    raise exception 'account_already_provisioned' using errcode = '23505';
  end if;

  insert into public.user_roles (user_id, role, assigned_by, assigned_at)
  values (p_auth_user_id, p_role, v_actor, now());
  if p_role = 'docente' then
    insert into public.teachers (id, user_id, active) values (gen_random_uuid(), p_auth_user_id, true);
  elsif p_role = 'tutor' then
    insert into public.guardians (id, user_id, active) values (gen_random_uuid(), p_auth_user_id, true);
  end if;
  update public.profiles set name = btrim(p_name), active = true, updated_at = now() where id = p_auth_user_id;
  insert into public.school_account_invitation_provisions (auth_user_id, invitation_nonce, inviter_id, provisioned_at, state)
  values (p_auth_user_id, p_invitation_nonce, v_actor, now(), 'provisioned');
  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (gen_random_uuid(), v_actor, 'invite', 'user', p_auth_user_id::text, now());
  return jsonb_build_object('id', p_auth_user_id, 'role', p_role, 'active', true);
end;
$$;

create function public.school_quarantine_invited_account(p_auth_user_id uuid, p_invitation_nonce uuid)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_auth auth.users;
  v_profile public.profiles;
  v_attempt public.school_account_invitation_provisions;
begin
  if v_actor is null or not public.school_actor_active() or not public.school_is_leader()
    or p_auth_user_id is null or p_auth_user_id = v_actor or p_invitation_nonce is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('school:account-administration'));
  if not public.school_actor_active() or not public.school_is_leader() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_auth from auth.users where id = p_auth_user_id for update;
  if not found then raise exception 'account_not_found' using errcode = 'P0002'; end if;
  select * into v_profile from public.profiles where id = p_auth_user_id for update;
  if not found then raise exception 'profile_not_ready' using errcode = 'P0002'; end if;
  if v_auth.invited_at is null or v_auth.created_at < now() - interval '10 minutes'
    or coalesce(v_auth.raw_app_meta_data -> 'school_invitation_receipt' ->> 'nonce', '') <> p_invitation_nonce::text
    or coalesce(v_auth.raw_app_meta_data -> 'school_invitation_receipt' ->> 'inviter_id', '') <> v_actor::text then
    raise exception 'invitation_receipt_invalid' using errcode = '42501';
  end if;
  select * into v_attempt from public.school_account_invitation_provisions where auth_user_id = p_auth_user_id for update;
  if found then
    if v_attempt.inviter_id <> v_actor or v_attempt.invitation_nonce <> p_invitation_nonce or v_attempt.state = 'managed'
      or exists (select 1 from public.user_roles where user_id = p_auth_user_id
        and (assigned_by is distinct from v_actor or role = 'superadmin'
          or (role = 'direccion' and not public.school_has_role(array['superadmin']::text[])))) then
      raise exception 'account_managed_after_invitation' using errcode = '42501';
    end if;
  elsif v_profile.active or exists (select 1 from public.user_roles where user_id = p_auth_user_id) then
    raise exception 'account_not_owned_by_invitation' using errcode = '42501';
  end if;
  update public.profiles set active = false, updated_at = now() where id = p_auth_user_id;
  update public.teachers set active = false where user_id = p_auth_user_id;
  update public.guardians set active = false where user_id = p_auth_user_id;
  delete from public.user_roles where user_id = p_auth_user_id;
  insert into public.school_account_invitation_provisions (auth_user_id, invitation_nonce, inviter_id, provisioned_at, state)
  values (p_auth_user_id, p_invitation_nonce, v_actor, now(), 'quarantined')
  on conflict (auth_user_id) do update set state = 'quarantined';
  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (gen_random_uuid(), v_actor, 'quarantine_invitation', 'user', p_auth_user_id::text, now());
  return jsonb_build_object('quarantined', true);
end;
$$;

create function public.school_update_account(
  p_auth_user_id uuid, p_role text default null, p_active boolean default null,
  p_name text default null, p_expected_email text default null
)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_auth auth.users;
  v_profile public.profiles;
  v_roles text[];
  v_action text;
begin
  if v_actor is null or not public.school_actor_active() or not public.school_is_leader()
    or p_auth_user_id is null or p_auth_user_id = v_actor then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if num_nonnulls(p_role, p_active, p_name) <> 1
    or (p_role is not null and p_role not in ('direccion', 'docente', 'tutor'))
    or (p_name is not null and (char_length(btrim(p_name)) not between 2 and 100 or p_name ~ '[[:cntrl:]]'))
    or (p_name is null and p_expected_email is not null)
    or (p_name is not null and p_expected_email is null) then
    raise exception 'invalid_account_update' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('school:account-administration'));
  if not public.school_actor_active() or not public.school_is_leader() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_auth from auth.users where id = p_auth_user_id for update;
  if not found then raise exception 'account_not_found' using errcode = 'P0002'; end if;
  select * into v_profile from public.profiles where id = p_auth_user_id for update;
  if not found then raise exception 'account_not_found' using errcode = 'P0002'; end if;
  select array_agg(role order by role) into v_roles from public.user_roles where user_id = p_auth_user_id;
  if v_roles is null then raise exception 'account_has_no_school_roles' using errcode = 'P0002'; end if;
  -- No UI RPC can modify any superadmin, so the final superadmin cannot be lost.
  if 'superadmin' = any(v_roles)
    or (not public.school_has_role(array['superadmin']::text[]) and (
      exists (select 1 from unnest(v_roles) role where role not in ('docente', 'tutor'))
      or p_role = 'direccion')) then
    raise exception 'protected_account' using errcode = '42501';
  end if;

  if p_role is not null then
    if cardinality(v_roles) = 1 and v_roles[1] = p_role then
      raise exception 'role_already_assigned' using errcode = '23505';
    end if;
    delete from public.user_roles where user_id = p_auth_user_id;
    insert into public.user_roles (user_id, role, assigned_by, assigned_at) values (p_auth_user_id, p_role, v_actor, now());
    update public.teachers set active = false where user_id = p_auth_user_id;
    update public.guardians set active = false where user_id = p_auth_user_id;
    if p_role = 'docente' then
      insert into public.teachers (id, user_id, active) values (gen_random_uuid(), p_auth_user_id, v_profile.active)
      on conflict (user_id) do update set active = excluded.active;
    elsif p_role = 'tutor' then
      insert into public.guardians (id, user_id, active) values (gen_random_uuid(), p_auth_user_id, v_profile.active)
      on conflict (user_id) do update set active = excluded.active;
    end if;
    v_action := 'change_role';
  elsif p_active is not null then
    update public.profiles set active = p_active, updated_at = now() where id = p_auth_user_id;
    update public.teachers set active = p_active and 'docente' = any(v_roles) where user_id = p_auth_user_id;
    update public.guardians set active = p_active and 'tutor' = any(v_roles) where user_id = p_auth_user_id;
    v_action := case when p_active then 'reactivate' else 'deactivate' end;
  else
    if v_auth.email is null or lower(btrim(v_auth.email)) <> lower(btrim(p_expected_email))
      or lower(btrim(v_profile.email)) <> lower(btrim(p_expected_email)) then
      raise exception 'auth_email_update_required' using errcode = '23505';
    end if;
    update public.profiles set name = btrim(p_name), updated_at = now() where id = p_auth_user_id;
    v_action := 'update';
  end if;
  update public.school_account_invitation_provisions set state = 'managed' where auth_user_id = p_auth_user_id;
  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (gen_random_uuid(), v_actor, v_action, 'user', p_auth_user_id::text, now());
  return jsonb_build_object('id', p_auth_user_id, 'updated', true, 'role', p_role,
    'active', coalesce(p_active, v_profile.active), 'previousRoles', to_jsonb(v_roles));
end;
$$;

-- Role writes outside the RPC could bypass both audit and last-admin protection.
revoke insert, update, delete on table public.user_roles from authenticated;
revoke insert, update, delete on table public.teachers, public.guardians from authenticated;
revoke all on function public.school_provision_invited_account(uuid, text, text, text, uuid) from public, anon;
revoke all on function public.school_quarantine_invited_account(uuid, uuid) from public, anon;
revoke all on function public.school_update_account(uuid, text, boolean, text, text) from public, anon;
grant execute on function public.school_provision_invited_account(uuid, text, text, text, uuid) to authenticated;
grant execute on function public.school_quarantine_invited_account(uuid, uuid) to authenticated;
grant execute on function public.school_update_account(uuid, text, boolean, text, text) to authenticated;

commit;
