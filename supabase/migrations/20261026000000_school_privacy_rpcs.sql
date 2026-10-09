-- School privacy records: scoped reads and audited, atomic mutations.
begin;

-- A family cannot inspect another guardian's evidence for the same child.
drop policy consents_read_guardian_or_leadership on public.consents;
create policy consents_read_guardian_or_leadership on public.consents for select to authenticated
using (public.school_is_leader() or (public.school_actor_active() and public.school_has_role(array['tutor']::text[])
  and public.school_is_guardian_of_student(student_id) and exists (
    select 1 from public.guardians g where g.id = guardian_id and g.active and g.user_id = auth.uid()
  )));

create function public.school_consent_directory()
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
begin
  if not public.school_actor_active() or not public.school_is_leader() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(q) order by q."recordedAt" desc, q.id) from (
      select c.id, c.student_id as "studentId", s.given_name as "studentName", s.family_name as "studentFamilyName",
        c.guardian_id as "guardianId", p.name as "guardianName", c.purpose, c.granted,
        c.recorded_at as "recordedAt", c.expires_at as "expiresAt", c.notice_version as "noticeVersion", c.evidence_reference as "evidenceReference"
      from public.consents c join public.students s on s.id = c.student_id
      join public.guardians g on g.id = c.guardian_id join public.profiles p on p.id = g.user_id
      order by c.recorded_at desc, c.id limit 200
    ) q), '[]'::jsonb),
    'students', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'givenName', s.given_name, 'familyName', s.family_name) order by s.family_name, s.given_name, s.id)
      from public.students s where s.active), '[]'::jsonb),
    'guardians', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', p.name, 'studentId', sg.student_id) order by p.name, g.id, sg.student_id)
      from public.guardians g join public.profiles p on p.id = g.user_id and p.active
      join public.user_roles r on r.user_id = p.id and r.role = 'tutor'
      join public.student_guardians sg on sg.guardian_id = g.id and sg.active
      join public.students s on s.id = sg.student_id and s.active where g.active), '[]'::jsonb)
  );
end;
$$;

create function public.school_privacy_request_directory()
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare v_leader boolean := public.school_is_leader(); v_items jsonb; v_students jsonb;
begin
  if not public.school_actor_active() or not (v_leader or public.school_has_role(array['tutor']::text[])) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q."updatedAt" desc, q.id), '[]'::jsonb) into v_items from (
    select pr.id, s.id as "studentId", s.given_name as "studentName", s.family_name as "studentFamilyName",
      pr.requester_id as "requesterId", case when v_leader then p.name else null end as "requesterName",
      pr.kind, pr.details, pr.status, pr.response_note as "responseNote", pr.created_at as "createdAt",
      pr.updated_at as "updatedAt", pr.responded_at as "respondedAt"
    from public.privacy_requests pr join public.students s on s.id = pr.student_id
    join public.profiles p on p.id = pr.requester_id
    where v_leader or pr.requester_id = auth.uid()
    order by pr.updated_at desc, pr.id limit 200
  ) q;
  if v_leader then return jsonb_build_object('items', v_items); end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q."familyName", q."givenName", q.id), '[]'::jsonb) into v_students from (
    select distinct s.id, s.given_name as "givenName", s.family_name as "familyName"
    from public.students s join public.student_guardians sg on sg.student_id = s.id and sg.active
    join public.guardians g on g.id = sg.guardian_id and g.active and g.user_id = auth.uid()
    where s.active and public.school_is_guardian_of_student(s.id)
  ) q;
  return jsonb_build_object('items', v_items, 'students', v_students);
end;
$$;

create function public.school_record_consent(
  p_student_id uuid, p_guardian_id uuid, p_purpose text, p_granted boolean,
  p_notice_version text, p_evidence_reference text, p_expires_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_id uuid := gen_random_uuid(); v_now timestamptz := now();
begin
  if auth.uid() is null or not public.school_actor_active() or not public.school_is_leader() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_student_id is null or p_guardian_id is null or p_purpose is null or p_purpose not in ('school_activity_image','public_image','class_recording')
    or p_granted is null or p_notice_version is null or char_length(btrim(p_notice_version)) not between 1 and 50
    or p_evidence_reference is null or char_length(btrim(p_evidence_reference)) not between 1 and 100
    or (p_expires_at is not null and p_expires_at <= v_now) then raise exception 'invalid_consent' using errcode = '22023'; end if;
  perform 1 from public.students s join public.student_guardians sg on sg.student_id = s.id
    join public.guardians g on g.id = sg.guardian_id join public.profiles p on p.id = g.user_id
    where s.id = p_student_id and g.id = p_guardian_id and s.active and sg.active and g.active and p.active
      and exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'tutor')
    for share of s, sg, g, p;
  if not found then raise exception 'student_guardian_unavailable' using errcode = 'P0002'; end if;
  if not public.school_actor_active() or not public.school_is_leader() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.privacy_notices n where n.version = btrim(p_notice_version) and n.approved_at <= v_now and n.published_at <= v_now
    and n.effective_date <= (v_now at time zone 'America/Mexico_City')::date::text) then raise exception 'approved_notice_required' using errcode = '22023'; end if;
  insert into public.consents(id, student_id, guardian_id, purpose, granted, recorded_at, expires_at, notice_version, evidence_reference, recorded_by)
    values(v_id, p_student_id, p_guardian_id, p_purpose, p_granted, v_now, p_expires_at, btrim(p_notice_version), btrim(p_evidence_reference), auth.uid());
  insert into public.audit_log(id, actor_id, action, entity_type, entity_id, created_at)
    values(gen_random_uuid(), auth.uid(), 'record_consent_evidence', 'consent', v_id::text, v_now);
  return jsonb_build_object('id', v_id, 'saved', true);
end;
$$;

create function public.school_submit_privacy_request(p_student_id uuid, p_kind text, p_details text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_id uuid := gen_random_uuid(); v_now timestamptz := now(); v_actor uuid := auth.uid();
begin
  if v_actor is null or not public.school_actor_active() or not public.school_has_role(array['tutor']::text[]) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_student_id is null or p_kind is null or p_kind not in ('acceso','correccion','eliminacion') or p_details is null or char_length(btrim(p_details)) not between 10 and 1200 then
    raise exception 'invalid_privacy_request' using errcode = '22023'; end if;
  perform 1 from public.students s join public.student_guardians sg on sg.student_id = s.id and sg.active
    join public.guardians g on g.id = sg.guardian_id and g.active join public.profiles p on p.id = g.user_id and p.active
    where s.id = p_student_id and s.active and g.user_id = v_actor for share of s, sg, g, p;
  if not found then raise exception 'student_unavailable' using errcode = 'P0002'; end if;
  if not public.school_actor_active() or not public.school_has_role(array['tutor']::text[]) then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into public.privacy_requests(id, student_id, requester_id, kind, details, status, open_key, created_at, updated_at)
    values(v_id, p_student_id, v_actor, p_kind, btrim(p_details), 'recibida', p_student_id::text || ':' || v_actor::text || ':' || p_kind, v_now, v_now);
  insert into public.audit_log(id, actor_id, action, entity_type, entity_id, created_at)
    values(gen_random_uuid(), v_actor, 'submit_privacy_request', 'privacy_request', v_id::text, v_now);
  insert into public.notifications(id, user_id, kind, title, href, dedupe_key, created_at)
    select gen_random_uuid(), p.id, 'privacy_request', 'Nueva solicitud familiar de privacidad', '/privacidad', 'privacy-request:' || v_id::text || ':received:' || p.id::text, v_now
    from public.profiles p where p.active and exists (select 1 from public.user_roles r where r.user_id = p.id and r.role in ('superadmin','direccion'));
  return jsonb_build_object('id', v_id, 'status', 'recibida');
end;
$$;

create function public.school_update_privacy_request(p_id uuid, p_status text, p_response_note text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_item public.privacy_requests; v_now timestamptz := now();
begin
  if auth.uid() is null or not public.school_actor_active() or not public.school_is_leader() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_id is null or p_status is null or p_status not in ('en_revision','respondida','cerrada')
    or (p_response_note is not null and char_length(btrim(p_response_note)) not between 5 and 1200)
    or (p_status in ('respondida','cerrada') and p_response_note is null) then raise exception 'invalid_privacy_update' using errcode = '22023'; end if;
  select * into v_item from public.privacy_requests where id = p_id for update;
  if not found then raise exception 'request_unavailable' using errcode = 'P0002'; end if;
  if not public.school_actor_active() or not public.school_is_leader() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not ((v_item.status = 'recibida' and p_status in ('en_revision','respondida','cerrada'))
    or (v_item.status = 'en_revision' and p_status in ('respondida','cerrada'))
    or (v_item.status = 'respondida' and p_status = 'cerrada')) then raise exception 'invalid_transition' using errcode = '23505'; end if;
  update public.privacy_requests set status = p_status, response_note = case when p_response_note is null then null else btrim(p_response_note) end,
    open_key = case when p_status = 'en_revision' then v_item.student_id::text || ':' || v_item.requester_id::text || ':' || v_item.kind else null end,
    updated_at = v_now, responded_at = case when p_status = 'en_revision' then null else v_now end,
    resolved_by = case when p_status = 'en_revision' then null else auth.uid() end where id = p_id;
  insert into public.audit_log(id, actor_id, action, entity_type, entity_id, created_at)
    values(gen_random_uuid(), auth.uid(), 'update_privacy_request_status', 'privacy_request', p_id::text, v_now);
  insert into public.notifications(id, user_id, kind, title, href, dedupe_key, created_at)
    values(gen_random_uuid(), v_item.requester_id, 'privacy_request_' || p_status,
      case p_status when 'en_revision' then 'Dirección está revisando tu solicitud' when 'respondida' then 'Dirección respondió a tu solicitud' else 'Dirección actualizó tu solicitud' end,
      '/privacidad', 'privacy-request:' || p_id::text || ':' || p_status || ':' || v_item.requester_id::text, v_now) on conflict(dedupe_key) do nothing;
  return jsonb_build_object('id', p_id, 'status', p_status);
end;
$$;

create function public.school_publish_privacy_notice(p_content jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_id uuid := gen_random_uuid(); v_now timestamptz := now(); v_rule record; v_date date;
begin
  if auth.uid() is null or not public.school_actor_active() or not public.school_has_role(array['superadmin']::text[]) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object' or p_content -> 'approvalConfirmed' is distinct from 'true'::jsonb then raise exception 'school_approval_required' using errcode = '22023'; end if;
  for v_rule in select * from (values
    ('version',1,50),('responsibleName',2,180),('address',5,500),('contactName',2,120),('contactEmail',3,254),
    ('personalDataCategories',20,4000),('sensitiveDataCategories',10,3000),('purposes',20,4000),('consentPurposes',10,3000),
    ('limitationMeans',10,3000),('arcoProcedure',20,4000),('noticeChanges',10,3000),('processorsAndTransfers',10,4000),('effectiveDate',10,10)
  ) as rules(key, minimum, maximum) loop
    if jsonb_typeof(p_content -> v_rule.key) is distinct from 'string' or char_length(btrim(p_content ->> v_rule.key)) not between v_rule.minimum and v_rule.maximum then
      raise exception 'invalid_notice' using errcode = '22023'; end if;
  end loop;
  if (p_content ->> 'contactEmail') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or (p_content ->> 'effectiveDate') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid_notice' using errcode = '22023'; end if;
  begin v_date := (p_content ->> 'effectiveDate')::date; exception when others then raise exception 'invalid_notice_date' using errcode = '22023'; end;
  if v_date::text <> p_content ->> 'effectiveDate' then raise exception 'invalid_notice_date' using errcode = '22023'; end if;
  insert into public.privacy_notices(id, version, responsible_name, address, contact_name, contact_email, personal_data_categories,
    sensitive_data_categories, purposes, consent_purposes, limitation_means, arco_procedure, notice_changes, processors_and_transfers,
    effective_date, approved_by, approved_at, published_at)
  values(v_id, btrim(p_content ->> 'version'), btrim(p_content ->> 'responsibleName'), btrim(p_content ->> 'address'),
    btrim(p_content ->> 'contactName'), btrim(p_content ->> 'contactEmail'), btrim(p_content ->> 'personalDataCategories'),
    btrim(p_content ->> 'sensitiveDataCategories'), btrim(p_content ->> 'purposes'), btrim(p_content ->> 'consentPurposes'),
    btrim(p_content ->> 'limitationMeans'), btrim(p_content ->> 'arcoProcedure'), btrim(p_content ->> 'noticeChanges'),
    btrim(p_content ->> 'processorsAndTransfers'), v_date::text, auth.uid(), v_now, v_now);
  insert into public.audit_log(id, actor_id, action, entity_type, entity_id, created_at)
    values(gen_random_uuid(), auth.uid(), 'publish_privacy_notice', 'privacy_notice', v_id::text, v_now);
  return jsonb_build_object('id', v_id, 'version', btrim(p_content ->> 'version'), 'publishedAt', v_now);
end;
$$;

-- Evidence and published notices are append-only for school actors.
revoke insert, update, delete on public.consents, public.privacy_notices, public.privacy_requests from authenticated;
revoke all on function public.school_consent_directory(), public.school_privacy_request_directory(),
  public.school_record_consent(uuid, uuid, text, boolean, text, text, timestamptz), public.school_submit_privacy_request(uuid, text, text),
  public.school_update_privacy_request(uuid, text, text), public.school_publish_privacy_notice(jsonb) from public, anon;
grant execute on function public.school_consent_directory(), public.school_privacy_request_directory(),
  public.school_record_consent(uuid, uuid, text, boolean, text, text, timestamptz), public.school_submit_privacy_request(uuid, text, text),
  public.school_update_privacy_request(uuid, text, text), public.school_publish_privacy_notice(jsonb) to authenticated;
commit;
