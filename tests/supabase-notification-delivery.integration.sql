-- LOCAL ONLY. Execute migration31 + this fixture in one external BEGIN/ROLLBACK.
-- No passwords, actual emails, provider requests, Storage writes or broad cleanup.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,created_at,updated_at) values
('e1000000-0000-4000-8000-000000000001','notice-admin@example.test',now(),'{"name":"Synthetic notice admin"}',now(),now()),
('e1000000-0000-4000-8000-000000000002','notice-teacher@example.test',now(),'{"name":"Synthetic notice teacher"}',now(),now()),
('e1000000-0000-4000-8000-000000000003','notice-family-a@example.test',now(),'{"name":"Synthetic notice family A"}',now(),now()),
('e1000000-0000-4000-8000-000000000004','notice-family-b@example.test',now(),'{"name":"Synthetic notice family B"}',now(),now()),
('e1000000-0000-4000-8000-000000000005','notice-child@example.test',now(),'{"name":"Synthetic notice child account"}',now(),now());
update public.profiles set active=true where id::text like 'e1000000-%';
insert into public.user_roles(user_id,role) values
('e1000000-0000-4000-8000-000000000001','superadmin'),('e1000000-0000-4000-8000-000000000002','docente'),
('e1000000-0000-4000-8000-000000000003','tutor'),('e1000000-0000-4000-8000-000000000004','tutor'),('e1000000-0000-4000-8000-000000000005','alumno');
insert into public.school_years(id,name,starts_on,ends_on,active)values('e2000000-0000-4000-8000-000000000001','Synthetic external-notice year','2026-01-01','2026-12-31',true);
insert into public.groups(id,year_id,name,stage)values('e2000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000001','Synthetic group A','preescolar');
insert into public.students(id,given_name,family_name)values('e2000000-0000-4000-8000-000000000003','Synthetic child','Notice fixture');
insert into public.enrollments(id,student_id,group_id,enrolled_at)values('e2000000-0000-4000-8000-000000000004','e2000000-0000-4000-8000-000000000003','e2000000-0000-4000-8000-000000000002',now());
insert into public.teachers(id,user_id)values('e2000000-0000-4000-8000-000000000005','e1000000-0000-4000-8000-000000000002');
insert into public.teacher_groups(teacher_id,group_id)values('e2000000-0000-4000-8000-000000000005','e2000000-0000-4000-8000-000000000002');
insert into public.guardians(id,user_id)values('e2000000-0000-4000-8000-000000000006','e1000000-0000-4000-8000-000000000003'),('e2000000-0000-4000-8000-000000000007','e1000000-0000-4000-8000-000000000004');
insert into public.student_guardians(student_id,guardian_id,relationship)values('e2000000-0000-4000-8000-000000000003','e2000000-0000-4000-8000-000000000006','Synthetic tutor');
insert into public.tasks(id,group_id,title,instructions,created_by,created_at)values('e2000000-0000-4000-8000-000000000008','e2000000-0000-4000-8000-000000000002','Synthetic task','Synthetic task text','e1000000-0000-4000-8000-000000000002',now());

-- Resource authorization probes do not enqueue or contact a provider.
insert into public.observations(id,student_id,category,body,visible_to_family,recorded_by,recorded_at)values('e4000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000003','lenguaje','Synthetic private observation',true,'e1000000-0000-4000-8000-000000000002',now());
insert into public.conversations(id,student_id,teacher_id,guardian_id,created_at)values('e4000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000003','e2000000-0000-4000-8000-000000000005','e2000000-0000-4000-8000-000000000006',now());
insert into public.messages(id,conversation_id,author_id,body,sent_at)values('e4000000-0000-4000-8000-000000000003','e4000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000002','Synthetic private chat',now());
do $$declare n public.notifications;begin
  n.id:='e4000000-0000-4000-8000-000000000004';n.user_id:='e1000000-0000-4000-8000-000000000003';n.kind:='seguimiento';n.dedupe_key:='seguimiento:e4000000-0000-4000-8000-000000000001:'||n.user_id::text;
  if not public.school_external_notice_resource_allowed(n)then raise exception 'visible own observation denied';end if;
  update public.observations set visible_to_family=false where id='e4000000-0000-4000-8000-000000000001';
  if public.school_external_notice_resource_allowed(n)then raise exception 'internal observation served to family';end if;
  n.kind:='mensaje';n.dedupe_key:='message:e4000000-0000-4000-8000-000000000003';
  if not public.school_external_notice_resource_allowed(n)then raise exception 'own private chat denied';end if;
  n.user_id:='e1000000-0000-4000-8000-000000000004';
  if public.school_external_notice_resource_allowed(n)then raise exception 'cross-family chat served';end if;
  n.user_id:='e1000000-0000-4000-8000-000000000001';
  if public.school_external_notice_resource_allowed(n)then raise exception 'administration-only private chat served';end if;
  n.user_id:='e1000000-0000-4000-8000-000000000003';
  delete from public.teacher_groups where teacher_id='e2000000-0000-4000-8000-000000000005';
  if public.school_external_notice_resource_allowed(n)then raise exception 'unassigned teacher conversation served';end if;
  n.user_id:='e1000000-0000-4000-8000-000000000002';n.kind:='tarea';n.dedupe_key:='task:e2000000-0000-4000-8000-000000000008:'||n.user_id::text;
  if public.school_external_notice_resource_allowed(n)then raise exception 'unassigned teacher task served';end if;
  insert into public.teacher_groups(teacher_id,group_id)values('e2000000-0000-4000-8000-000000000005','e2000000-0000-4000-8000-000000000002');
  if not public.school_external_notice_resource_allowed(n)then raise exception 'assigned teacher task denied';end if;
end $$;

-- A dual docente+tutor must not gain staff-only access through their tutor link.
insert into public.user_roles(user_id,role)values('e1000000-0000-4000-8000-000000000003','docente');
insert into public.teachers(id,user_id)values('e4000000-0000-4000-8000-000000000005','e1000000-0000-4000-8000-000000000003');
do $$declare n public.notifications;begin
  n.user_id:='e1000000-0000-4000-8000-000000000003';n.kind:='seguimiento';n.dedupe_key:='seguimiento:e4000000-0000-4000-8000-000000000001:'||n.user_id::text;
  if public.school_external_notice_resource_allowed(n)then raise exception 'dual-role unassigned tutor bypassed internal observation';end if;
  insert into public.teacher_groups(teacher_id,group_id)values('e4000000-0000-4000-8000-000000000005','e2000000-0000-4000-8000-000000000002');
  if not public.school_external_notice_resource_allowed(n)then raise exception 'assigned dual-role teacher denied internal observation';end if;
  delete from public.teacher_groups where teacher_id='e4000000-0000-4000-8000-000000000005';
  if public.school_external_notice_resource_allowed(n)then raise exception 'revoked dual-role teacher retained internal observation';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claim.role','authenticated',true);
do $$begin
  if exists(select 1 from public.observations where id='e4000000-0000-4000-8000-000000000001')then raise exception 'observation RLS unexpectedly permits revoked dual role';end if;
  begin perform public.school_external_staff_student('e1000000-0000-4000-8000-000000000003','e2000000-0000-4000-8000-000000000003');raise exception 'private helper publicly callable';exception when insufficient_privilege then null;end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claim.role','authenticated',true);
do $$ begin
  begin perform public.school_set_notification_preference('email',true,false);raise exception 'missing opt-in accepted';exception when invalid_parameter_value then null;end;
  perform public.school_set_notification_preference('email',true,true);
  perform public.school_set_notification_preference('webpush',true,true);
  perform public.school_store_push_subscription('https://fcm.googleapis.com/fcm/send/synthetic-notice-device',repeat('A',87),repeat('A',22));
  begin perform public.school_store_push_subscription('https://127.0.0.1/secret',repeat('A',87),repeat('A',22));raise exception 'SSRF endpoint accepted';exception when invalid_parameter_value then null;end;
  if (select count(*) from public.notification_channel_preferences)<>2 then raise exception 'own preferences not readable';end if;
  begin perform 1 from public.school_push_subscriptions;raise exception 'private endpoint browser-readable';exception when insufficient_privilege then null;end;
  begin perform public.school_claim_notification_deliveries(array['email'],5);raise exception 'browser can dispatch';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000004',true);
do $$ begin
  if (select count(*) from public.notification_channel_preferences)<>0 then raise exception 'family B reads A preferences';end if;
  perform public.school_set_notification_preference('email',true,true);
  perform public.school_set_notification_preference('webpush',true,true);
  begin perform public.school_store_push_subscription('https://fcm.googleapis.com/fcm/send/synthetic-notice-device',repeat('A',87),repeat('A',22));raise exception 'shared endpoint stolen';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000005',true);
do $$ begin
  begin perform public.school_set_notification_preference('email',true,true);raise exception 'child opted in';exception when insufficient_privilege then null;end;
end $$;
reset role;

insert into public.notifications(id,user_id,kind,title,href,dedupe_key,created_at) values
('e3000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000003','tarea','No content leaves the portal','/tareas','task:e2000000-0000-4000-8000-000000000008:e1000000-0000-4000-8000-000000000003',now()),
('e3000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000004','tarea','Foreign group notice','/tareas','task:e2000000-0000-4000-8000-000000000008:e1000000-0000-4000-8000-000000000004',now()),
('e3000000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000003','unknown','Unsupported resource','/tareas','unknown:e2000000-0000-4000-8000-000000000008:e1000000-0000-4000-8000-000000000003',now());
do $$ begin
  if(select count(*) from public.notification_delivery_outbox where notification_id='e3000000-0000-4000-8000-000000000001')<>2 then raise exception 'transactional enqueue missing';end if;
  begin insert into public.notification_delivery_outbox(notification_id,user_id,channel,destination_id)values('e3000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000003','email','e1000000-0000-4000-8000-000000000003');raise exception 'duplicate delivery allowed';exception when unique_violation then null;end;
end $$;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('test.notice.jobs',public.school_claim_notification_deliveries(array['email','webpush'],5)::text,true);
do $$ declare j jsonb; authz jsonb;begin
  if jsonb_array_length(current_setting('test.notice.jobs')::jsonb->'jobs')<>2 then raise exception 'foreign/unknown resource queued';end if;
  for j in select * from jsonb_array_elements(current_setting('test.notice.jobs')::jsonb->'jobs') loop
    authz:=public.school_authorize_notification_delivery((j->>'id')::uuid,(j->>'claimNonce')::uuid);
    if authz->>'authorized'<>'true' then raise exception 'own current resource denied';end if;
    if public.school_authorize_notification_delivery((j->>'id')::uuid,(j->>'claimNonce')::uuid)->>'authorized'<>'false' then raise exception 'authorization replay allowed';end if;
    perform public.school_finish_notification_delivery((j->>'id')::uuid,(j->>'claimNonce')::uuid,'uncertain','transport_uncertain');
  end loop;
  if jsonb_array_length(public.school_claim_notification_deliveries(array['email','webpush'],5)->'jobs')<>0 then raise exception 'uncertain jobs reclaimed';end if;
end $$;
reset role;
-- Internal observation must be suppressed at claim for the dual-role unassigned tutor.
insert into public.notifications(id,user_id,kind,title,href,dedupe_key,created_at)values('e3000000-0000-4000-8000-000000000006','e1000000-0000-4000-8000-000000000003','seguimiento','Synthetic internal observation','/seguimiento','seguimiento:e4000000-0000-4000-8000-000000000001:e1000000-0000-4000-8000-000000000003',now());
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$begin
  if jsonb_array_length(public.school_claim_notification_deliveries(array['email','webpush'],5)->'jobs')<>0 then raise exception 'internal observation claimed by dual-role unassigned tutor';end if;
end $$;
reset role;
-- Recipient loses the link after enqueue; claim must suppress both channels.
insert into public.notifications(id,user_id,kind,title,href,dedupe_key,created_at)values('e3000000-0000-4000-8000-000000000004','e1000000-0000-4000-8000-000000000003','tarea','Revoked linked resource','/tareas','task:e2000000-0000-4000-8000-000000000008:e1000000-0000-4000-8000-000000000003:invalid',now());
-- An exact recognized key cannot repeat; use another synthetic task resource.
insert into public.tasks(id,group_id,title,instructions,created_by,created_at)values('e2000000-0000-4000-8000-000000000009','e2000000-0000-4000-8000-000000000002','Synthetic second task','Synthetic','e1000000-0000-4000-8000-000000000002',now());
insert into public.notifications(id,user_id,kind,title,href,dedupe_key,created_at)values('e3000000-0000-4000-8000-000000000005','e1000000-0000-4000-8000-000000000003','tarea','Link subsequently revoked','/tareas','task:e2000000-0000-4000-8000-000000000009:e1000000-0000-4000-8000-000000000003',now());
update public.student_guardians set active=false where guardian_id='e2000000-0000-4000-8000-000000000006';
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$begin
  if jsonb_array_length(public.school_claim_notification_deliveries(array['email','webpush'],5)->'jobs')<>0 then raise exception 'revoked guardian link served';end if;
end $$;
reset role;
do $$begin
  if exists(select 1 from public.notification_delivery_outbox where state='accepted')then raise exception 'fixture pretended provider acceptance';end if;
  if (select count(*) from public.notification_delivery_outbox where state='uncertain')<>2 then raise exception 'uncertain persistence lost';end if;
  if exists(select 1 from public.notification_delivery_outbox where state in('pending','claimed'))then raise exception 'ineligible jobs remain dispatchable';end if;
end $$;
-- Caller must ROLLBACK the outer transaction, including migration31 DDL.
