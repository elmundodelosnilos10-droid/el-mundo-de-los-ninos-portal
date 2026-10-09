-- Execute inside BEGIN ... ROLLBACK after migration26. No passwords or email.
insert into auth.users(id, email, raw_user_meta_data, created_at, updated_at) values
('d1000000-0000-4000-8000-000000000001','privacy-super@example.test','{"name":"Super sintético"}',now(),now()),
('d1000000-0000-4000-8000-000000000002','privacy-direction@example.test','{"name":"Dirección sintética"}',now(),now()),
('d1000000-0000-4000-8000-000000000003','privacy-family-a@example.test','{"name":"Familia sintética A"}',now(),now()),
('d1000000-0000-4000-8000-000000000004','privacy-family-b@example.test','{"name":"Familia sintética B"}',now(),now()),
('d1000000-0000-4000-8000-000000000005','privacy-teacher@example.test','{"name":"Docente sintética"}',now(),now());
update public.profiles set active = true where id::text like 'd1000000-%';
insert into public.user_roles(user_id,role) values
('d1000000-0000-4000-8000-000000000001','superadmin'),('d1000000-0000-4000-8000-000000000002','direccion'),
('d1000000-0000-4000-8000-000000000003','tutor'),('d1000000-0000-4000-8000-000000000004','tutor'),
('d1000000-0000-4000-8000-000000000005','docente');
insert into public.students(id,given_name,family_name) values
('d2000000-0000-4000-8000-000000000001','Menor sintético A','Prueba'),
('d2000000-0000-4000-8000-000000000002','Menor sintético B','Prueba');
insert into public.guardians(id,user_id) values
('d3000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000003'),
('d3000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000004');
insert into public.student_guardians(student_id,guardian_id,relationship) values
('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','tutor sintético'),
('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000002','tutor sintético'),
('d2000000-0000-4000-8000-000000000002','d3000000-0000-4000-8000-000000000002','tutor sintético');

select set_config('test.privacy.notice', jsonb_build_object('version','privacy-fixture-v1','responsibleName','Escuela sintética',
  'address','Dirección sintética de pruebas','contactName','Contacto sintético','contactEmail','privacy@example.test',
  'personalDataCategories','Categorías sintéticas de datos de prueba','sensitiveDataCategories','Datos sintéticos sin contenido real',
  'purposes','Finalidades sintéticas para comprobar esta transacción','consentPurposes','Usos sintéticos con comprobantes',
  'limitationMeans','Medios sintéticos de limitación','arcoProcedure','Procedimiento sintético que la escuela aprobó',
  'noticeChanges','Cambios sintéticos publicados','processorsAndTransfers','Responsables sintéticos sin datos reales',
  'effectiveDate','2000-01-01','approvalConfirmed',true)::text, true);
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
do $$
declare content jsonb := current_setting('test.privacy.notice')::jsonb;
begin
  perform public.school_publish_privacy_notice(content);
  begin
    perform public.school_publish_privacy_notice(content);
    raise exception 'duplicate approved version overwritten';
  exception when unique_violation then null; end;
  begin
    perform public.school_publish_privacy_notice(content || '{"version":"unapproved","approvalConfirmed":false}');
    raise exception 'unapproved notice published';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.school_publish_privacy_notice(content || '{"version":"invalid-date","effectiveDate":"2026-02-30"}');
    raise exception 'invalid date published';
  exception when invalid_parameter_value then null; end;
end;
$$;

select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);
do $$
declare body jsonb;
begin
  begin
    perform public.school_publish_privacy_notice(current_setting('test.privacy.notice')::jsonb || '{"version":"direction-bypass"}');
    raise exception 'Direction published notice';
  exception when insufficient_privilege then null; end;
  body := public.school_record_consent('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','class_recording',false,'privacy-fixture-v1','evidence-A');
  perform set_config('test.privacy.consent_a',body->>'id',true);
  perform public.school_record_consent('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000002','class_recording',true,'privacy-fixture-v1','evidence-B');
  begin
    perform public.school_record_consent('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','public_image',true,'unapproved','evidence');
    raise exception 'consent accepted nonexistent notice';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.school_record_consent('d2000000-0000-4000-8000-000000000002','d3000000-0000-4000-8000-000000000001','public_image',true,'privacy-fixture-v1','evidence');
    raise exception 'consent accepted unrelated guardian';
  exception when no_data_found then null; end;
  begin
    perform public.school_record_consent('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','public_image',true,'privacy-fixture-v1','evidence',now()-interval '1 day');
    raise exception 'expired grant accepted';
  exception when invalid_parameter_value then null; end;
  begin
    update public.consents set granted=true where id=current_setting('test.privacy.consent_a')::uuid;
    raise exception 'consent altered without append/audit';
  exception when insufficient_privilege then null; end;
  body := public.school_consent_directory();
  if jsonb_array_length(body->'students') < 2 or jsonb_array_length(body->'items') < 2 then raise exception 'leadership consent directory missing'; end if;
end;
$$;

select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000003',true);
do $$
declare body jsonb;
begin
  if (select count(*) from public.consents where student_id='d2000000-0000-4000-8000-000000000001') <> 1 then raise exception 'same-child other guardian consent leaked'; end if;
  if (select granted from public.consents where id=current_setting('test.privacy.consent_a')::uuid) is distinct from false then raise exception 'recorded refusal changed'; end if;
  begin
    perform public.school_consent_directory(); raise exception 'family read school consent directory';
  exception when insufficient_privilege then null; end;
  begin
    perform public.school_record_consent('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','public_image',true,'privacy-fixture-v1','bypass');
    raise exception 'family recorded school evidence';
  exception when insufficient_privilege then null; end;
  body := public.school_submit_privacy_request('d2000000-0000-4000-8000-000000000001','eliminacion','Solicitud sintética sin eliminación automática');
  perform set_config('test.privacy.request_a',body->>'id',true);
  begin
    perform public.school_submit_privacy_request('d2000000-0000-4000-8000-000000000001','eliminacion','Otra solicitud sintética duplicada');
    raise exception 'duplicate pending request accepted';
  exception when unique_violation then null; end;
  begin
    perform public.school_submit_privacy_request('d2000000-0000-4000-8000-000000000002','acceso','Solicitud para menor no vinculado');
    raise exception 'unrelated child privacy request accepted';
  exception when no_data_found then null; end;
  begin
    perform public.school_update_privacy_request(current_setting('test.privacy.request_a')::uuid,'cerrada','Intento familiar de cierre');
    raise exception 'family reviewed privacy request';
  exception when insufficient_privilege then null; end;
  body := public.school_privacy_request_directory();
  if jsonb_array_length(body->'items') <> 1 or jsonb_array_length(body->'students') <> 1 then raise exception 'family request directory invalid'; end if;
end;
$$;

select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000004',true);
do $$
declare body jsonb;
begin
  if exists(select 1 from public.privacy_requests where id=current_setting('test.privacy.request_a')::uuid) then raise exception 'other guardian request leaked'; end if;
  body := public.school_submit_privacy_request('d2000000-0000-4000-8000-000000000002','acceso','Solicitud sintética de familia B');
  perform set_config('test.privacy.request_b',body->>'id',true);
end;
$$;

select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);
do $$
declare request_id uuid := current_setting('test.privacy.request_a')::uuid;
begin
  perform public.school_update_privacy_request(request_id,'en_revision');
  begin
    perform public.school_update_privacy_request(request_id,'respondida'); raise exception 'response without note accepted';
  exception when invalid_parameter_value then null; end;
  perform public.school_update_privacy_request(request_id,'respondida','La escuela documentó su respuesta sintética');
  begin
    perform public.school_update_privacy_request(request_id,'en_revision'); raise exception 'backward transition accepted';
  exception when unique_violation then null; end;
  perform public.school_update_privacy_request(request_id,'cerrada','Seguimiento sintético concluido sin borrar datos');
  begin
    perform public.school_update_privacy_request(request_id,'cerrada','Intento de segundo cierre sintético'); raise exception 'closed request changed';
  exception when unique_violation then null; end;
  if not exists(select 1 from public.students where id='d2000000-0000-4000-8000-000000000001') then raise exception 'privacy review silently deleted child'; end if;
end;
$$;

select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000005',true);
do $$
begin
  begin perform public.school_privacy_request_directory(); raise exception 'teacher read family requests'; exception when insufficient_privilege then null; end;
  begin perform public.school_submit_privacy_request('d2000000-0000-4000-8000-000000000001','acceso','Solicitud docente sin tutor'); raise exception 'teacher submitted family request'; exception when insufficient_privilege then null; end;
end;
$$;

reset role;
update public.student_guardians set active=false where guardian_id='d3000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000003',true);
do $$
begin
  begin perform public.school_submit_privacy_request('d2000000-0000-4000-8000-000000000001','correccion','Solicitud desde vínculo retirado'); raise exception 'inactive link accepted'; exception when no_data_found then null; end;
  if exists(select 1 from public.consents where guardian_id='d3000000-0000-4000-8000-000000000001') then raise exception 'inactive link retained evidence read'; end if;
end;
$$;
reset role;
do $$
begin
  if (select count(*) from public.audit_log where actor_id::text like 'd1000000-%') <> 8 then raise exception 'privacy audit transaction count invalid'; end if;
  if (select count(*) from public.notifications where user_id::text like 'd1000000-%' and kind like 'privacy_request%') <> 7 then raise exception 'privacy notifications transaction count invalid'; end if;
end;
$$;
select 'PASS: school privacy JWT/RLS, own evidence, notice approval, request links/transitions/audit' as result;
