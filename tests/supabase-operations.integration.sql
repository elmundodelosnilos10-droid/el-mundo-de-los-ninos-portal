-- Operator: BEGIN + migration25 + this fixture + ROLLBACK. No passwords or real data.
savepoint school_operations_fixture;
insert into auth.users (id,email,raw_user_meta_data,created_at,updated_at) values
('91000000-0000-4000-8000-000000000001','operations-superadmin@example.test','{"name":"Superadministración sintética"}',now(),now()),
('91000000-0000-4000-8000-000000000002','operations-director@example.test','{"name":"Dirección sintética"}',now(),now()),
('91000000-0000-4000-8000-000000000003','operations-teacher@example.test','{"name":"Docente sintética"}',now(),now()),
('91000000-0000-4000-8000-000000000004','operations-family@example.test','{"name":"Familia sintética"}',now(),now());
update public.profiles set active=true where id in (
'91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002',
'91000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000004');
insert into public.user_roles(user_id,role) values
('91000000-0000-4000-8000-000000000001','superadmin'),('91000000-0000-4000-8000-000000000002','direccion'),
('91000000-0000-4000-8000-000000000003','docente'),('91000000-0000-4000-8000-000000000004','tutor');
insert into public.audit_log(id,actor_id,action,entity_type,entity_id,created_at)
select ('92000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
case when n=124 then null else '91000000-0000-4000-8000-000000000001'::uuid end,
'operations_fixture','school','synthetic-reference-'||n,
'2040-01-01T00:00:00Z'::timestamptz + n*interval '1 second'
from generate_series(1,124) n;
set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
do $$
declare result jsonb;
begin
  result:=public.school_audit_feed(1);
  if jsonb_array_length(result->'items') is distinct from 100 or result->'items'->0->>'entityId' is distinct from 'synthetic-reference-124' or
    result->'items'->99->>'entityId' is distinct from 'synthetic-reference-25' then raise exception 'audit feed sorting/limit failed'; end if;
  if jsonb_typeof(result->'items'->0->'actorName') is distinct from 'null' or
    result->'items'->1->>'actorName' is distinct from 'Superadministración sintética' then raise exception 'audit actor display failed'; end if;
  if exists(select 1 from jsonb_array_elements(result->'items') as item(value) where
    (value - 'id' - 'actorName' - 'action' - 'entityType' - 'entityId' - 'createdAt') <> '{}'::jsonb) then raise exception 'audit fields leaked'; end if;
  result:=public.school_system_status(1);
  if (result->>'activeAccounts')::integer < 4 or (result->>'auditRecords')::integer < 124 or
    result->>'checkedAt' is null or (result->>'latestAuditAt')::timestamptz is distinct from '2040-01-01T00:02:04Z'::timestamptz then raise exception 'real database status failed'; end if;
  begin perform public.school_audit_feed(null); raise exception 'null audit version accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.school_system_status(2); raise exception 'invalid system version accepted'; exception when invalid_parameter_value then null; end;
  begin update public.audit_log set action='tampered' where actor_id=auth.uid(); raise exception 'audit mutable'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
do $$
begin
  if jsonb_array_length(public.school_audit_feed(1)->'items') is distinct from 100 then raise exception 'director audit read denied'; end if;
  begin perform public.school_system_status(1); raise exception 'director read superadmin status'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000003',true);
do $$
begin
  if exists(select 1 from public.audit_log) then raise exception 'teacher audit table leaked'; end if;
  begin perform public.school_audit_feed(1); raise exception 'teacher audit RPC allowed'; exception when insufficient_privilege then null; end;
  begin perform public.school_system_status(1); raise exception 'teacher system RPC allowed'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000004',true);
do $$
begin
  if exists(select 1 from public.audit_log) then raise exception 'family audit table leaked'; end if;
  begin perform public.school_audit_feed(1); raise exception 'family audit RPC allowed'; exception when insufficient_privilege then null; end;
  begin perform public.school_system_status(1); raise exception 'family system RPC allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.profiles set active=false where id='91000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
do $$
begin
  begin perform public.school_audit_feed(1); raise exception 'inactive leader audit RPC allowed'; exception when insufficient_privilege then null; end;
  begin perform public.school_system_status(1); raise exception 'inactive leader system RPC allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$
begin
  begin perform public.school_audit_feed(1); raise exception 'anon audit RPC allowed'; exception when insufficient_privilege then null; end;
  begin perform public.school_system_status(1); raise exception 'anon system RPC allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: operating RPC role/active checks, RLS isolation, audit chronology/limit/DTO, immutable history and real status counts' as result;
release savepoint school_operations_fixture;
