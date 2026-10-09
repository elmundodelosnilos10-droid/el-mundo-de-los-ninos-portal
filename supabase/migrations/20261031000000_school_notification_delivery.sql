-- Optional external notices. Applying this migration does not enable a provider.
begin;

create table public.notification_channel_preferences (
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null check (channel in ('email','webpush')),
  enabled boolean not null default false,
  consented_at timestamptz,
  email_at_consent text,
  updated_at timestamptz not null default now(),
  primary key(user_id,channel),
  check (not enabled or consented_at is not null)
);
create table public.school_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null check (char_length(endpoint) between 20 and 4096),
  endpoint_hash text not null unique,
  p256dh text not null,
  auth_key text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.notification_delivery_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null check (channel in ('email','webpush')),
  destination_id uuid not null,
  subscription_id uuid references public.school_push_subscriptions(id) on delete set null,
  state text not null default 'pending' check (state in ('pending','claimed','accepted','uncertain','suppressed','rejected')),
  claim_nonce uuid,
  claimed_at timestamptz,
  authorized_at timestamptz,
  finished_at timestamptz,
  result_code text check (result_code in ('provider_accepted','provider_rejected','subscription_gone','transport_uncertain','lease_expired','not_eligible','invalid_destination','not_configured')),
  created_at timestamptz not null default now(),
  unique(notification_id,channel,destination_id),
  check ((channel='email' and subscription_id is null) or channel='webpush')
);
create index notification_delivery_pending_idx on public.notification_delivery_outbox(state,created_at);

alter table public.notification_channel_preferences enable row level security;
alter table public.school_push_subscriptions enable row level security;
alter table public.notification_delivery_outbox enable row level security;
revoke all on public.notification_channel_preferences,public.school_push_subscriptions,public.notification_delivery_outbox from public,anon,authenticated;
-- Included only when the external-notices backup catalog is explicitly selected.
grant select on public.notification_channel_preferences,public.school_push_subscriptions,public.notification_delivery_outbox to service_role;
grant select(user_id,channel,enabled,consented_at,updated_at) on public.notification_channel_preferences to authenticated;
create policy notification_preferences_read_own on public.notification_channel_preferences for select to authenticated
  using(user_id=auth.uid() and public.school_actor_active());
-- Subscription endpoints, encryption keys, email consent binding and delivery jobs
-- have no direct browser grant. Public RPC DTOs omit those private fields.

create function public.school_external_notice_actor()
returns boolean language sql stable security definer set search_path='' as $$
  select public.school_actor_active() and public.school_has_role(array['superadmin','direccion','docente','tutor']::text[]);
$$;

create function public.school_notification_preferences()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.school_external_notice_actor() then raise exception 'forbidden' using errcode='42501'; end if;
  return jsonb_build_object('preferences',coalesce((select jsonb_agg(jsonb_build_object('channel',channel,'enabled',enabled,'consentedAt',consented_at,'updatedAt',updated_at) order by channel)
    from public.notification_channel_preferences where user_id=auth.uid()),'[]'::jsonb),
    'subscriptions',coalesce((select jsonb_agg(jsonb_build_object('id',id,'active',active,'createdAt',created_at) order by created_at,id)
    from public.school_push_subscriptions where user_id=auth.uid()),'[]'::jsonb));
end;
$$;

create function public.school_set_notification_preference(p_channel text,p_enabled boolean,p_consent_confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_email text;
begin
  if not public.school_external_notice_actor() then raise exception 'forbidden' using errcode='42501'; end if;
  if p_channel is null or p_channel not in ('email','webpush') or p_enabled is null or (p_enabled and p_consent_confirmed is distinct from true) then
    raise exception 'explicit_consent_required' using errcode='22023'; end if;
  -- Serialize preference changes with subscribe/enqueue for this account.
  perform 1 from public.profiles where id=auth.uid() for update;
  if p_enabled and p_channel='email' then
    select lower(u.email) into v_email from auth.users u join public.profiles p on p.id=u.id
      where u.id=auth.uid() and u.email_confirmed_at is not null and lower(u.email)=lower(p.email);
    if v_email is null then raise exception 'verified_email_required' using errcode='22023'; end if;
  end if;
  insert into public.notification_channel_preferences(user_id,channel,enabled,consented_at,email_at_consent,updated_at)
    values(auth.uid(),p_channel,p_enabled,case when p_enabled then now() end,v_email,now())
    on conflict(user_id,channel) do update set enabled=excluded.enabled,consented_at=excluded.consented_at,email_at_consent=excluded.email_at_consent,updated_at=excluded.updated_at;
  if not p_enabled then
    update public.notification_delivery_outbox set state='suppressed',finished_at=now(),result_code='not_eligible'
      where user_id=auth.uid() and channel=p_channel and state in ('pending','claimed');
  end if;
  insert into public.audit_log(id,actor_id,action,entity_type,entity_id,created_at)
    values(gen_random_uuid(),auth.uid(),case when p_enabled then 'opt_in_external_notices' else 'opt_out_external_notices' end,'notification_preference',p_channel,now());
  return jsonb_build_object('channel',p_channel,'enabled',p_enabled);
end;
$$;

create function public.school_store_push_subscription(p_endpoint text,p_p256dh text,p_auth text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_hash text; v_id uuid; v_owner uuid;
begin
  if not public.school_external_notice_actor() then raise exception 'forbidden' using errcode='42501'; end if;
  if p_endpoint is null or char_length(p_endpoint)>4096 or p_endpoint !~ '^https://(fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|web[.]push[.]apple[.]com)/[A-Za-z0-9_./%=-]+$'
    or p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]{87}$' or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{22}$' then
    raise exception 'invalid_subscription' using errcode='22023'; end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  if not exists(select 1 from public.notification_channel_preferences where user_id=auth.uid() and channel='webpush' and enabled and consented_at is not null) then
    raise exception 'explicit_consent_required' using errcode='22023'; end if;
  v_hash:=encode(sha256(convert_to(p_endpoint,'UTF8')),'hex');
  select id,user_id into v_id,v_owner from public.school_push_subscriptions where endpoint_hash=v_hash for update;
  if v_owner is not null and v_owner<>auth.uid() then raise exception 'subscription_unavailable' using errcode='42501'; end if;
  if v_id is null and (select count(*) from public.school_push_subscriptions where user_id=auth.uid())>=5 then
    raise exception 'subscription_limit' using errcode='22023'; end if;
  insert into public.school_push_subscriptions(user_id,endpoint,endpoint_hash,p256dh,auth_key)
    values(auth.uid(),p_endpoint,v_hash,p_p256dh,p_auth)
    on conflict(endpoint_hash) do update set p256dh=excluded.p256dh,auth_key=excluded.auth_key,active=true,updated_at=now()
    where public.school_push_subscriptions.user_id=auth.uid()
    returning id into v_id;
  if v_id is null then raise exception 'subscription_unavailable' using errcode='42501'; end if;
  insert into public.audit_log(id,actor_id,action,entity_type,entity_id,created_at)
    values(gen_random_uuid(),auth.uid(),'register_push_subscription','push_subscription',v_id::text,now());
  return jsonb_build_object('id',v_id,'registered',true);
end;
$$;

create function public.school_remove_push_subscription(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.school_external_notice_actor() then raise exception 'forbidden' using errcode='42501'; end if;
  perform 1 from public.school_push_subscriptions where id=p_id and user_id=auth.uid() for update;
  if not found then raise exception 'subscription_unavailable' using errcode='P0002'; end if;
  update public.notification_delivery_outbox set state='suppressed',finished_at=now(),result_code='not_eligible'
    where subscription_id=p_id and state in ('pending','claimed');
  delete from public.school_push_subscriptions where id=p_id and user_id=auth.uid();
  insert into public.audit_log(id,actor_id,action,entity_type,entity_id,created_at)
    values(gen_random_uuid(),auth.uid(),'remove_push_subscription','push_subscription',p_id::text,now());
  return jsonb_build_object('removed',true);
end;
$$;

create function public.school_enqueue_external_notice()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  -- Opt-in applies only to newly committed private notices, never historical backfill.
  perform 1 from public.profiles p where p.id=new.user_id and p.active for share;
  if not found or not public.school_has_role_for_user(new.user_id,array['superadmin','direccion','docente','tutor']::text[]) then return new; end if;
  insert into public.notification_delivery_outbox(notification_id,user_id,channel,destination_id)
    select new.id,new.user_id,'email',new.user_id from public.notification_channel_preferences
    where user_id=new.user_id and channel='email' and enabled and consented_at is not null on conflict do nothing;
  insert into public.notification_delivery_outbox(notification_id,user_id,channel,destination_id,subscription_id)
    select new.id,new.user_id,'webpush',s.id,s.id from public.school_push_subscriptions s
    join public.notification_channel_preferences p on p.user_id=s.user_id and p.channel='webpush' and p.enabled and p.consented_at is not null
    where s.user_id=new.user_id and s.active on conflict do nothing;
  return new;
end;
$$;
-- Use current roles without evaluating auth.uid() from an unrelated event author.
create function public.school_has_role_for_user(p_user_id uuid,p_roles text[])
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.user_roles where user_id=p_user_id and role=any(p_roles));
$$;
create trigger school_external_notice_enqueue after insert on public.notifications for each row execute function public.school_enqueue_external_notice();

create function public.school_external_user_group(p_user uuid,p_group uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.groups g where g.id=p_group and g.active and (
    public.school_has_role_for_user(p_user,array['superadmin','direccion']::text[])
    or (public.school_has_role_for_user(p_user,array['docente']::text[]) and exists(select 1 from public.teachers t join public.teacher_groups tg on tg.teacher_id=t.id where t.user_id=p_user and t.active and tg.group_id=g.id))
    or (public.school_has_role_for_user(p_user,array['tutor']::text[]) and exists(select 1 from public.guardians gu join public.student_guardians sg on sg.guardian_id=gu.id and sg.active
      join public.students s on s.id=sg.student_id and s.active join public.enrollments e on e.student_id=s.id and e.ended_at is null where gu.user_id=p_user and gu.active and e.group_id=g.id))));
$$;
create function public.school_external_user_student(p_user uuid,p_student uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.students s where s.id=p_student and s.active and (
    public.school_has_role_for_user(p_user,array['superadmin','direccion']::text[])
    or (public.school_has_role_for_user(p_user,array['tutor']::text[]) and exists(select 1 from public.guardians g join public.student_guardians sg on sg.guardian_id=g.id and sg.active where g.user_id=p_user and g.active and sg.student_id=s.id))
    or (public.school_has_role_for_user(p_user,array['docente']::text[]) and exists(select 1 from public.enrollments e where e.student_id=s.id and e.ended_at is null and public.school_external_user_group(p_user,e.group_id)))));
$$;
-- Staff authorization must never be satisfied through an unrelated tutor role.
create function public.school_external_staff_group(p_user uuid,p_group uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.groups g where g.id=p_group and g.active and (
    public.school_has_role_for_user(p_user,array['superadmin','direccion']::text[])
    or (public.school_has_role_for_user(p_user,array['docente']::text[]) and exists(select 1 from public.teachers t join public.teacher_groups tg on tg.teacher_id=t.id where t.user_id=p_user and t.active and tg.group_id=g.id))));
$$;
create function public.school_external_staff_student(p_user uuid,p_student uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.students s where s.id=p_student and s.active and (
    public.school_has_role_for_user(p_user,array['superadmin','direccion']::text[])
    or exists(select 1 from public.enrollments e where e.student_id=s.id and e.ended_at is null and public.school_external_staff_group(p_user,e.group_id))));
$$;
create function public.school_external_user_audience(p_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.school_has_role_for_user(p_user,array['superadmin','direccion']::text[])
    or exists(select 1 from public.groups g where g.active and public.school_external_user_group(p_user,g.id));
$$;
create function public.school_external_notice_resource_allowed(p_notice public.notifications)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_parts text[]:=string_to_array(p_notice.dedupe_key,':'); v_id uuid; v_student uuid;
begin
  -- Recognize only server-generated key shapes. Never infer authorization from href/title.
  if v_parts[2] is null or v_parts[2]!~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  v_id:=v_parts[2]::uuid;
  if p_notice.kind='mensaje' and v_parts[1]='message' and cardinality(v_parts)=2 then
    return exists(select 1 from public.messages m join public.conversations c on c.id=m.conversation_id
      join public.teachers t on t.id=c.teacher_id and t.active join public.profiles tp on tp.id=t.user_id and tp.active
      join public.guardians g on g.id=c.guardian_id and g.active join public.profiles gp on gp.id=g.user_id and gp.active
      join public.students s on s.id=c.student_id and s.active join public.student_guardians sg on sg.student_id=s.id and sg.guardian_id=g.id and sg.active
      join public.enrollments e on e.student_id=s.id and e.ended_at is null join public.groups gr on gr.id=e.group_id and gr.active
      join public.teacher_groups tg on tg.group_id=gr.id and tg.teacher_id=t.id
      where m.id=v_id and m.read_at is null and m.author_id<>p_notice.user_id and ((p_notice.user_id=t.user_id and public.school_has_role_for_user(t.user_id,array['docente']::text[]))
        or (p_notice.user_id=g.user_id and public.school_has_role_for_user(g.user_id,array['tutor']::text[]))));
  elsif p_notice.kind='tarea' and v_parts[1]='task' and cardinality(v_parts)=3 and v_parts[3]=p_notice.user_id::text then
    return exists(select 1 from public.tasks t where t.id=v_id and t.archived_at is null and public.school_external_user_group(p_notice.user_id,t.group_id));
  elsif p_notice.kind='entrega' and v_parts[1]='submission' and cardinality(v_parts)=5 and v_parts[4]=p_notice.user_id::text and v_parts[5]~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    if v_parts[3]!~ '^[0-9a-f-]{36}$' then return false; end if;
    begin v_student:=v_parts[3]::uuid; exception when invalid_text_representation then return false; end;
    return public.school_has_role_for_user(p_notice.user_id,array['superadmin','direccion','docente']::text[]) and exists(select 1 from public.submissions su join public.tasks t on t.id=su.task_id and t.archived_at is null
      join public.enrollments e on e.student_id=su.student_id and e.group_id=t.group_id and e.ended_at is null
      where su.task_id=v_id and su.student_id=v_student and public.school_external_staff_group(p_notice.user_id,t.group_id));
  elsif p_notice.kind='entrega_revisada' and v_parts[1]='review' and cardinality(v_parts)=4 and v_parts[4]=p_notice.user_id::text and v_parts[3]~'^[0-9]{17}$' then
    return exists(select 1 from public.submissions su join public.tasks t on t.id=su.task_id and t.archived_at is null
      where su.id=v_id and public.school_external_user_student(p_notice.user_id,su.student_id) and public.school_external_user_group(p_notice.user_id,t.group_id));
  elsif p_notice.kind='seguimiento' and v_parts[1]='seguimiento' and cardinality(v_parts)=3 and v_parts[3]=p_notice.user_id::text then
    return exists(select 1 from public.observations o where o.id=v_id and ((o.visible_to_family and public.school_external_user_student(p_notice.user_id,o.student_id)) or public.school_external_staff_student(p_notice.user_id,o.student_id)));
  elsif p_notice.kind='comunicado' and v_parts[1]='announcement' and cardinality(v_parts)=3 and v_parts[3]=p_notice.user_id::text then
    return exists(select 1 from public.announcements a where a.id=v_id and ((a.group_id is null and public.school_external_user_audience(p_notice.user_id)) or public.school_external_user_group(p_notice.user_id,a.group_id)));
  elsif p_notice.kind='calendario' and v_parts[1]='calendario' and cardinality(v_parts)=3 and v_parts[3]=p_notice.user_id::text then
    return exists(select 1 from public.calendar_events e where e.id=v_id and ((e.group_id is null and public.school_external_user_audience(p_notice.user_id)) or public.school_external_user_group(p_notice.user_id,e.group_id)));
  elsif p_notice.kind='clase' and v_parts[1]='clase' and cardinality(v_parts)=3 and v_parts[3]=p_notice.user_id::text then
    return exists(select 1 from public.class_sessions c join public.teachers t on t.id=c.teacher_id and t.active where c.id=v_id and public.school_external_user_group(p_notice.user_id,c.group_id));
  elsif p_notice.kind in ('asistencia_justificacion','asistencia_justificacion_aceptada','asistencia_justificacion_rechazada')
    and v_parts[1]='attendance-justification' and cardinality(v_parts)=5 and v_parts[5]=p_notice.user_id::text and v_parts[4]~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return exists(select 1 from public.attendance_justifications a where a.id=v_id and public.school_external_user_student(p_notice.user_id,a.student_id) and public.school_external_user_group(p_notice.user_id,a.group_id)
      and ((p_notice.kind='asistencia_justificacion' and v_parts[3]='pending' and public.school_external_staff_student(p_notice.user_id,a.student_id) and public.school_external_staff_group(p_notice.user_id,a.group_id))
        or (p_notice.kind='asistencia_justificacion_'||v_parts[3] and v_parts[3] in ('aceptada','rechazada') and public.school_has_role_for_user(p_notice.user_id,array['tutor']::text[]))));
  elsif p_notice.kind in ('privacy_request','privacy_request_en_revision','privacy_request_respondida','privacy_request_cerrada')
    and v_parts[1]='privacy-request' and cardinality(v_parts)=4 and v_parts[4]=p_notice.user_id::text then
    return exists(select 1 from public.privacy_requests r where r.id=v_id and public.school_external_user_student(p_notice.user_id,r.student_id)
      and ((p_notice.kind='privacy_request' and v_parts[3]='received' and public.school_has_role_for_user(p_notice.user_id,array['superadmin','direccion']::text[]))
        or (r.requester_id=p_notice.user_id and p_notice.kind='privacy_request_'||v_parts[3] and public.school_has_role_for_user(p_notice.user_id,array['tutor']::text[]))));
  end if;
  return false;
end;
$$;
revoke all on function public.school_external_user_audience(uuid),public.school_external_staff_group(uuid,uuid),public.school_external_staff_student(uuid,uuid),public.school_external_user_group(uuid,uuid),public.school_external_user_student(uuid,uuid),public.school_external_notice_resource_allowed(public.notifications) from public,anon,authenticated;

create function public.school_external_delivery_eligible(p_job public.notification_delivery_outbox)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p join public.notifications n on n.id=p_job.notification_id and n.user_id=p.id
    join public.notification_channel_preferences pref on pref.user_id=p.id and pref.channel=p_job.channel and pref.enabled and pref.consented_at is not null
    where p.id=p_job.user_id and p.active and n.read_at is null and n.created_at>now()-interval '24 hours'
      and public.school_has_role_for_user(p.id,array['superadmin','direccion','docente','tutor']::text[])
      and public.school_external_notice_resource_allowed(n)
      and ((p_job.channel='email' and exists(select 1 from auth.users u where u.id=p.id and u.email_confirmed_at is not null and lower(u.email)=lower(p.email) and lower(u.email)=pref.email_at_consent))
        or (p_job.channel='webpush' and exists(select 1 from public.school_push_subscriptions s where s.id=p_job.subscription_id and s.user_id=p.id and s.active))));
$$;

create function public.school_claim_notification_deliveries(p_channels text[],p_limit integer default 5)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_jobs jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_limit is null or p_limit<1 or p_limit>10 or p_channels is null or cardinality(p_channels)<1 or cardinality(p_channels)>2
    or not p_channels<@array['email','webpush']::text[] then raise exception 'invalid_batch' using errcode='22023'; end if;
  -- A crashed or timed-out sender may already have posted. Never reclaim its lease.
  update public.notification_delivery_outbox set state='uncertain',finished_at=now(),result_code='lease_expired'
    where state='claimed' and claimed_at<now()-interval '2 minutes';
  update public.notification_delivery_outbox j set state='suppressed',finished_at=now(),result_code='not_eligible'
    where j.state='pending' and not public.school_external_delivery_eligible(j);
  with picked as (select id from public.notification_delivery_outbox where state='pending' and channel=any(p_channels)
      order by created_at,id for update skip locked limit p_limit),
    claimed as (update public.notification_delivery_outbox j set state='claimed',claim_nonce=gen_random_uuid(),claimed_at=now()
      from picked where j.id=picked.id returning j.id,j.channel,j.claim_nonce)
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'channel',channel,'claimNonce',claim_nonce)),'[]'::jsonb) into v_jobs from claimed;
  return jsonb_build_object('jobs',v_jobs);
end;
$$;

create function public.school_authorize_notification_delivery(p_id uuid,p_claim_nonce uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_job public.notification_delivery_outbox; v_destination jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_job from public.notification_delivery_outbox where id=p_id and state='claimed' and claim_nonce=p_claim_nonce for update;
  if not found or v_job.authorized_at is not null then return jsonb_build_object('authorized',false); end if;
  if v_job.claimed_at<now()-interval '2 minutes' or not public.school_external_delivery_eligible(v_job) then
    update public.notification_delivery_outbox set state='suppressed',finished_at=now(),result_code='not_eligible' where id=p_id;
    return jsonb_build_object('authorized',false);
  end if;
  update public.notification_delivery_outbox set authorized_at=now() where id=p_id;
  if v_job.channel='email' then select jsonb_build_object('email',u.email) into v_destination from auth.users u where u.id=v_job.user_id;
  else select jsonb_build_object('endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth_key)) into v_destination from public.school_push_subscriptions s where s.id=v_job.subscription_id; end if;
  return jsonb_build_object('authorized',true,'id',v_job.id,'channel',v_job.channel,'idempotencyKey','school-notice/'||v_job.id::text,'destination',v_destination);
end;
$$;

create function public.school_finish_notification_delivery(p_id uuid,p_claim_nonce uuid,p_state text,p_result_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_subscription uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_state is null or p_result_code is null or not ((p_state='accepted' and p_result_code='provider_accepted')
    or (p_state='uncertain' and p_result_code='transport_uncertain')
    or (p_state='rejected' and p_result_code in ('provider_rejected','subscription_gone','invalid_destination','not_configured'))) then
    raise exception 'invalid_result' using errcode='22023'; end if;
  update public.notification_delivery_outbox set state=p_state,result_code=p_result_code,finished_at=now()
    where id=p_id and claim_nonce=p_claim_nonce and state='claimed' and authorized_at is not null returning subscription_id into v_subscription;
  if not found then return jsonb_build_object('confirmed',false); end if;
  if p_result_code='subscription_gone' then update public.school_push_subscriptions set active=false,updated_at=now() where id=v_subscription; end if;
  return jsonb_build_object('confirmed',true);
end;
$$;

revoke all on function public.school_external_notice_actor(),public.school_has_role_for_user(uuid,text[]),public.school_external_delivery_eligible(public.notification_delivery_outbox),public.school_enqueue_external_notice() from public,anon,authenticated;
revoke all on function public.school_notification_preferences(),public.school_set_notification_preference(text,boolean,boolean),public.school_store_push_subscription(text,text,text),public.school_remove_push_subscription(uuid) from public,anon,authenticated;
grant execute on function public.school_notification_preferences(),public.school_set_notification_preference(text,boolean,boolean),public.school_store_push_subscription(text,text,text),public.school_remove_push_subscription(uuid) to authenticated;
revoke all on function public.school_claim_notification_deliveries(text[],integer),public.school_authorize_notification_delivery(uuid,uuid),public.school_finish_notification_delivery(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.school_claim_notification_deliveries(text[],integer),public.school_authorize_notification_delivery(uuid,uuid),public.school_finish_notification_delivery(uuid,uuid,text,text) to service_role;
commit;
