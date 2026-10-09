-- Operator: BEGIN + migration27 definitions (without their BEGIN/COMMIT) +
-- this fixture + ROLLBACK. Metadata only; no passwords/storage objects/real children.
savepoint school_library_fixture;
insert into auth.users(id,email,raw_user_meta_data,created_at,updated_at) values
('a1000000-0000-4000-8000-000000000001','library-leader@example.test','{"name":"Dirección sintética"}',now(),now()),
('a1000000-0000-4000-8000-000000000002','library-teacher@example.test','{"name":"Docente sintética"}',now(),now()),
('a1000000-0000-4000-8000-000000000003','library-family-a@example.test','{"name":"Familia A sintética"}',now(),now()),
('a1000000-0000-4000-8000-000000000004','library-family-b@example.test','{"name":"Familia B sintética"}',now(),now());
update public.profiles set active=true where id in ('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000004');
insert into public.user_roles(user_id,role) values
('a1000000-0000-4000-8000-000000000001','superadmin'),('a1000000-0000-4000-8000-000000000002','docente'),
('a1000000-0000-4000-8000-000000000003','tutor'),('a1000000-0000-4000-8000-000000000004','tutor');
insert into public.school_years(id,name,starts_on,ends_on,active) values ('a2000000-0000-4000-8000-000000000001','Ciclo biblioteca sintético','2026-08-01','2027-07-31',true);
insert into public.groups(id,year_id,name,stage,active) values
('a2000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000001','Biblioteca A','preescolar',true),
('a2000000-0000-4000-8000-000000000003','a2000000-0000-4000-8000-000000000001','Biblioteca B','maternal',true),
('a2000000-0000-4000-8000-000000000004','a2000000-0000-4000-8000-000000000001','Biblioteca inactiva','maternal',false);
insert into public.students(id,given_name,family_name,active,created_at,updated_at) values
('a3000000-0000-4000-8000-000000000001','Alumno sintético A','Prueba',true,now(),now()),
('a3000000-0000-4000-8000-000000000002','Alumno sintético B','Prueba',true,now(),now());
insert into public.enrollments(id,student_id,group_id,enrolled_at,ended_at) values
('a4000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002',now(),null),
('a4000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000003',now(),null);
insert into public.guardians(id,user_id) values
('a4000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000003'),
('a4000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000004');
insert into public.student_guardians(student_id,guardian_id,relationship,may_collect,active) values
('a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000003','Tutor sintético',false,true),
('a3000000-0000-4000-8000-000000000002','a4000000-0000-4000-8000-000000000004','Tutor sintético',false,true);
insert into public.teachers(id,user_id) values('a4000000-0000-4000-8000-000000000005','a1000000-0000-4000-8000-000000000002');
insert into public.teacher_groups(teacher_id,group_id) values('a4000000-0000-4000-8000-000000000005','a2000000-0000-4000-8000-000000000002');
insert into public.files(id,object_key,original_name,mime_type,size_bytes,purpose,uploaded_by,group_id,created_at,deleted_at) values
('a5000000-0000-4000-8000-000000000001','supabase:private/material/a5000000-0000-4000-8000-000000000001','cat.pdf','application/pdf',20,'material','a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002',now(),null),
('a5000000-0000-4000-8000-000000000002','supabase:private/material/a5000000-0000-4000-8000-000000000002','SonidoCat.mp3','audio/mpeg',20,'material','a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002',now(),null),
('a5000000-0000-4000-8000-000000000003','supabase:private/material/a5000000-0000-4000-8000-000000000003','retirado.jpg','image/jpeg',20,'material','a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002',now(),now()),
('a5000000-0000-4000-8000-000000000004','supabase:private/material/a5000000-0000-4000-8000-000000000004','cuento.pdf','application/pdf',20,'material','a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002',now(),null),
('a5000000-0000-4000-8000-000000000005','supabase:private/material/a5000000-0000-4000-8000-000000000005','literal_.pdf','application/pdf',20,'material','a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002',now(),null),
('a5000000-0000-4000-8000-000000000006','supabase:private/material/a5000000-0000-4000-8000-000000000006','secreto-b.pdf','application/pdf',20,'material','a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000003',now(),null),
('a5000000-0000-4000-8000-000000000007','supabase:private/material/a5000000-0000-4000-8000-000000000007','inactivo.pdf','application/pdf',20,'material','a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000004',now(),null);
insert into public.materials(id,file_id,group_id,title,category,published_by,published_at) values
('a6000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002','Guía Cat','Guía','a1000000-0000-4000-8000-000000000001','2026-10-08T10:00:01Z'),
('a6000000-0000-4000-8000-000000000002','a5000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000002','Colores','Audio','a1000000-0000-4000-8000-000000000001','2026-10-08T10:00:02Z'),
('a6000000-0000-4000-8000-000000000003','a5000000-0000-4000-8000-000000000003','a2000000-0000-4000-8000-000000000002','Retirado','Imagen','a1000000-0000-4000-8000-000000000001','2026-10-08T10:00:03Z'),
('a6000000-0000-4000-8000-000000000004','a5000000-0000-4000-8000-000000000004','a2000000-0000-4000-8000-000000000002','Lectura para familias','Lectura','a1000000-0000-4000-8000-000000000001','2026-10-08T10:00:04Z'),
('a6000000-0000-4000-8000-000000000005','a5000000-0000-4000-8000-000000000005','a2000000-0000-4000-8000-000000000002','Porcentaje 100%','Guía','a1000000-0000-4000-8000-000000000001','2026-10-08T10:00:05Z'),
('a6000000-0000-4000-8000-000000000006','a5000000-0000-4000-8000-000000000006','a2000000-0000-4000-8000-000000000003','Secreto B','Categoría privada B','a1000000-0000-4000-8000-000000000001','2026-10-08T10:00:06Z'),
('a6000000-0000-4000-8000-000000000007','a5000000-0000-4000-8000-000000000007','a2000000-0000-4000-8000-000000000004','Grupo inactivo','Categoría inactiva','a1000000-0000-4000-8000-000000000001','2026-10-08T10:00:07Z');
set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000003',true);
do $$
declare result jsonb; first_id text;
begin
  result:=public.school_search_materials('',null,null,1,0);
  if (result->>'total')::integer is distinct from 4 or jsonb_array_length(result->'items') is distinct from 1 or
    result->'items'->0->>'title' is distinct from 'Porcentaje 100%' then raise exception 'family pagination/count/order failed'; end if;
  first_id:=result->'items'->0->>'id';
  result:=public.school_search_materials('',null,null,1,1);
  if result->'items'->0->>'id'=first_id or result->'items'->0->>'title' is distinct from 'Lectura para familias' then raise exception 'page overlap/order failed'; end if;
  if result->'categories' is distinct from '["Audio","Guía","Lectura"]'::jsonb then raise exception 'authorized facets missing or leaked'; end if;
  result:=public.school_search_materials('cAt',null,null,12,0);
  if (result->>'total')::integer is distinct from 2 then raise exception 'title/filename case insensitive search failed'; end if;
  result:=public.school_search_materials('SonidoCat',null,'Audio',12,0);
  if (result->>'total')::integer is distinct from 1 or result->'items'->0->>'fileName' is distinct from 'SonidoCat.mp3' then raise exception 'filename/category filter failed'; end if;
  result:=public.school_search_materials('%',null,null,12,0);
  if (result->>'total')::integer is distinct from 1 then raise exception 'percent was treated as wildcard'; end if;
  result:=public.school_search_materials('_',null,null,12,0);
  if (result->>'total')::integer is distinct from 1 then raise exception 'underscore was treated as wildcard'; end if;
  result:=public.school_search_materials('missing text',null,null,12,0);
  if (result->>'total')::integer is distinct from 0 or result->'items' is distinct from '[]'::jsonb or jsonb_array_length(result->'categories') is distinct from 3 then raise exception 'empty search/facets failed'; end if;
  begin perform public.school_search_materials('','a2000000-0000-4000-8000-000000000003',null,12,0); raise exception 'family A filtered foreign group'; exception when no_data_found then null; end;
  begin perform public.school_search_materials('',null,null,51,0); raise exception 'excessive page allowed'; exception when invalid_parameter_value then null; end;
  begin perform public.school_search_materials(repeat('x',101),null,null,12,0); raise exception 'excessive search allowed'; exception when invalid_parameter_value then null; end;
  result:=public.school_search_materials('',null,null,12,0);
  if exists(select 1 from jsonb_array_elements(result->'items') as item(value) where (value-'id'-'fileId'-'groupId'-'groupName'-'title'-'category'-'publishedAt'-'fileName'-'mimeType'-'sizeBytes')<>'{}'::jsonb) then raise exception 'library fields leaked'; end if;
end $$;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000004',true);
do $$
declare result jsonb;
begin
  result:=public.school_search_materials('',null,null,12,0);
  if (result->>'total')::integer is distinct from 1 or result->'categories' is distinct from '["Categoría privada B"]'::jsonb then raise exception 'family B scope failed'; end if;
  begin perform public.school_search_materials('','a2000000-0000-4000-8000-000000000002',null,12,0); raise exception 'family B filtered A'; exception when no_data_found then null; end;
end $$;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
do $$
begin
  if (public.school_search_materials('',null,null,12,0)->>'total')::integer is distinct from 4 then raise exception 'teacher assigned group search failed'; end if;
  begin perform public.school_search_materials('','a2000000-0000-4000-8000-000000000003',null,12,0); raise exception 'teacher filtered unassigned group'; exception when no_data_found then null; end;
end $$;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
do $$
declare result jsonb;
begin
  result:=public.school_search_materials('','a2000000-0000-4000-8000-000000000003',null,12,0);
  if (result->>'total')::integer is distinct from 1 then raise exception 'leadership filtered group failed'; end if;
  result:=public.school_search_materials('','a2000000-0000-4000-8000-000000000004',null,12,0);
  if (result->>'total')::integer is distinct from 0 or result->'categories' is distinct from '[]'::jsonb then raise exception 'inactive group leaked'; end if;
end $$;
reset role;
update public.profiles set active=false where id='a1000000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000003',true);
do $$ begin
  begin perform public.school_search_materials('',null,null,12,0); raise exception 'inactive family searched'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform public.school_search_materials('',null,null,12,0); raise exception 'anonymous searched'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: library JWT/RLS scope, title/filename literal search, category/group filters, pagination, facets, deleted/inactive exclusion and DTO whitelist' as result;
release savepoint school_library_fixture;
