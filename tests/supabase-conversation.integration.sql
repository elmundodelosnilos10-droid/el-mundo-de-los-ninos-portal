-- Run only inside a transaction that ends in ROLLBACK, after school migrations.
-- No password, storage object, real child, or persistent account is created.
insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at) values
('91000000-0000-4000-8000-000000000001', 'chat-teacher@example.test', '{"name":"Docente sintética"}', now(), now()),
('91000000-0000-4000-8000-000000000002', 'chat-family-a@example.test', '{"name":"Familia sintética A"}', now(), now()),
('91000000-0000-4000-8000-000000000003', 'chat-family-b@example.test', '{"name":"Familia sintética B"}', now(), now());
update public.profiles set active = true where id in (
  '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000003'
);
insert into public.user_roles (user_id, role) values
('91000000-0000-4000-8000-000000000001', 'docente'),
('91000000-0000-4000-8000-000000000002', 'tutor'),
('91000000-0000-4000-8000-000000000003', 'tutor');
insert into public.school_years (id, name, starts_on, ends_on, active)
values ('92000000-0000-4000-8000-000000000001', 'Chat PostgreSQL sintético', '2026-08-01', '2027-07-31', true);
insert into public.groups (id, year_id, name, stage) values
('92000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000001', 'Chat grupo sintético A', 'preescolar'),
('92000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000001', 'Chat grupo sintético B', 'preescolar');
insert into public.students (id, given_name, family_name) values
('93000000-0000-4000-8000-000000000001', 'Alumno sintético A', 'Prueba'),
('93000000-0000-4000-8000-000000000002', 'Alumno sintético B', 'Prueba');
insert into public.enrollments (id, student_id, group_id, enrolled_at) values
('94000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000002', now()),
('94000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000003', now());
insert into public.teachers (id, user_id) values ('94000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000001');
insert into public.teacher_groups (teacher_id, group_id) values ('94000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000002');
insert into public.guardians (id, user_id) values
('94000000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000002'),
('94000000-0000-4000-8000-000000000005', '91000000-0000-4000-8000-000000000003');
insert into public.student_guardians (student_id, guardian_id, relationship) values
('93000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000004', 'tutor de prueba'),
('93000000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000005', 'tutor de prueba');

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
do $$
declare result jsonb; page jsonb; older jsonb; n integer;
begin
  result := public.school_conversation_contacts();
  if jsonb_array_length(result->'items') <> 1 then raise exception 'family contacts scope failed'; end if;
  result := public.school_open_conversation('95000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000003');
  if not (result->>'created')::boolean then raise exception 'conversation create failed'; end if;
  result := public.school_open_conversation('95000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000003');
  if (result->>'created')::boolean or result->>'id' <> '95000000-0000-4000-8000-000000000001' then raise exception 'conversation idempotency failed'; end if;
  for n in 1..51 loop
    perform public.school_send_message(('96000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, '95000000-0000-4000-8000-000000000001', 'Mensaje sintético ' || n::text);
  end loop;
  page := public.school_message_page('95000000-0000-4000-8000-000000000001');
  if jsonb_array_length(page->'items') <> 50 or not (page->>'hasOlder')::boolean
    or page->'items'->0->>'id' <> '96000000-0000-4000-8000-000000000002'
    or page->'items'->49->>'id' <> '96000000-0000-4000-8000-000000000051' then raise exception 'latest page or timestamp tie ordering failed'; end if;
  older := public.school_message_page('95000000-0000-4000-8000-000000000001', (page->'items'->0->>'sentAt')::timestamptz, (page->'items'->0->>'id')::uuid);
  if jsonb_array_length(older->'items') <> 1 or (older->>'hasOlder')::boolean
    or older->'items'->0->>'id' <> '96000000-0000-4000-8000-000000000001' then raise exception 'older page has gaps or duplicates'; end if;
  begin
    perform public.school_message_page('95000000-0000-4000-8000-000000000001', now(), null);
    raise exception 'incomplete cursor accepted';
  exception when invalid_parameter_value then null; end;
  begin
    insert into public.messages (id, conversation_id, author_id, body, sent_at) values
      ('96000000-0000-4000-8000-000000000099', '95000000-0000-4000-8000-000000000001', auth.uid(), 'Direct write must fail', now());
    raise exception 'direct message insert accepted';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
do $$
declare result jsonb; message_date timestamptz; receipts integer;
begin
  result := public.school_conversation_feed();
  if (result->'items'->0->>'unreadCount')::integer <> 51 then raise exception 'unread count failed'; end if;
  select sent_at into message_date from public.messages where id = '96000000-0000-4000-8000-000000000025';
  perform public.school_mark_conversation_read('95000000-0000-4000-8000-000000000001', message_date, '96000000-0000-4000-8000-000000000025');
  select count(*) into receipts from public.messages where conversation_id = '95000000-0000-4000-8000-000000000001' and read_at is not null;
  if receipts <> 25 then raise exception 'read receipt crossed supplied boundary'; end if;
  result := public.school_conversation_feed();
  if (result->'items'->0->>'unreadCount')::integer <> 26 then raise exception 'unread count after receipt failed'; end if;
  if (select count(*) from public.notifications where kind = 'mensaje') <> 51 then raise exception 'message notification transaction failed'; end if;
  begin
    update public.messages set read_at = now() where id = '96000000-0000-4000-8000-000000000051';
    raise exception 'direct read receipt update accepted';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
select public.school_send_message('96000000-0000-4000-8000-000000000052', '95000000-0000-4000-8000-000000000001', '',
  '97000000-0000-4000-8000-000000000001', 'supabase:private/message/97000000-0000-4000-8000-000000000002', 'adjunto-sintetico.pdf', 'application/pdf', 123);

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000003', true);
do $$
begin
  if (select count(*) from public.messages where conversation_id = '95000000-0000-4000-8000-000000000001') <> 0 then raise exception 'other family can read chat via RLS'; end if;
  if (select count(*) from public.files where id = '97000000-0000-4000-8000-000000000001') <> 0 then raise exception 'other family can read attachment via RLS'; end if;
  begin
    perform public.school_message_page('95000000-0000-4000-8000-000000000001');
    raise exception 'other family can call message page';
  exception when no_data_found then null; end;
  begin
    perform public.school_open_conversation('95000000-0000-4000-8000-000000000003', '93000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000003');
    raise exception 'other family can open unauthorized conversation';
  exception when no_data_found then null; end;
end $$;
reset role;

do $$
begin
  if (select count(*) from public.audit_log where entity_type = 'conversation' and entity_id = '95000000-0000-4000-8000-000000000001') <> 53 then raise exception 'conversation audit transaction failed'; end if;
end $$;
select 'PASS: chat PostgreSQL scope, idempotency, 51-message pagination, bounded receipts, notifications, attachment isolation and direct-write denial' as verification;
