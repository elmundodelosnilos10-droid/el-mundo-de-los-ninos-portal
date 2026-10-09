-- Progreso escolar: lecturas con JWT/RLS y escrituras con auditoría atómica.
begin;

create function public.school_progress_students()
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'name', s.given_name, 'familyName', s.family_name,
    'groupId', g.id, 'groupName', g.name, 'stage', g.stage
  ) order by s.family_name, s.given_name, s.id, g.name), '[]'::jsonb))
  from public.students s
  join public.enrollments e on e.student_id = s.id and e.ended_at is null
  join public.groups g on g.id = e.group_id and g.active
  where s.active and public.school_actor_active() and public.school_can_access_student(s.id);
$$;

create function public.school_record_observation(
  p_id uuid, p_student_id uuid, p_category text, p_body text, p_visible_to_family boolean
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_now timestamptz := now();
begin
  if auth.uid() is null or not public.school_actor_active() or
     not public.school_has_role(array['superadmin','direccion','docente']::text[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_id is null or p_student_id is null or p_category is null or
    p_category not in ('lenguaje','motricidad','socioemocional','participacion','autonomia','convivencia','creatividad','objetivo_aprendizaje') or
    p_body is null or char_length(btrim(p_body)) not between 2 and 2000 or p_visible_to_family is null then
    raise exception 'invalid_observation' using errcode = '22023';
  end if;
  if not public.school_is_leader_or_teacher_for_student(p_student_id) or not exists (
    select 1 from public.students s join public.enrollments e on e.student_id = s.id and e.ended_at is null
    join public.groups g on g.id = e.group_id and g.active
    where s.id = p_student_id and s.active and
      (public.school_is_leader() or public.school_is_teacher_of_group(g.id))
  ) then
    raise exception 'student_unavailable' using errcode = 'P0002';
  end if;
  insert into public.observations (id, student_id, category, body, visible_to_family, recorded_by, recorded_at)
  values (p_id, p_student_id, p_category, btrim(p_body), p_visible_to_family, auth.uid(), v_now);
  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (gen_random_uuid(), auth.uid(), 'record_observation', 'student', p_student_id::text, v_now);
  if p_visible_to_family then
    insert into public.notifications (id, user_id, kind, title, href, dedupe_key, created_at)
    select gen_random_uuid(), recipient.user_id, 'seguimiento', 'Nueva observación de seguimiento',
      '/alumnos/' || p_student_id::text, 'seguimiento:' || p_id::text || ':' || recipient.user_id::text, v_now
    from (
      select distinct g.user_id from public.student_guardians sg
      join public.guardians g on g.id = sg.guardian_id and g.active
      join public.profiles p on p.id = g.user_id and p.active
      join public.user_roles r on r.user_id = p.id and r.role = 'tutor'
      where sg.student_id = p_student_id and sg.active
    ) recipient
    on conflict (dedupe_key) do nothing;
  end if;
  return jsonb_build_object('id', p_id);
end;
$$;

create function public.school_save_activity_progress(
  p_student_id uuid, p_activity_id text, p_answer text default null, p_artwork jsonb default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_kind text;
  v_stages text[];
  v_answer text;
  v_stroke jsonb;
  v_point jsonb;
begin
  if auth.uid() is null or not public.school_actor_active() or not public.school_has_role(array['tutor']::text[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_student_id is null or not public.school_is_guardian_of_student(p_student_id) then
    raise exception 'student_unavailable' using errcode = 'P0002';
  end if;
  -- This catalogue is the authoritative server check. Keep it aligned with
  -- app/actividades/catalog.ts and answers.ts when adding real activities.
  case p_activity_id
    when 'palabra-cat' then v_kind := 'choice'; v_answer := 'cat'; v_stages := array['lactantes','maternal','prekinder','preescolar'];
    when 'semillas-contar' then v_kind := 'choice'; v_answer := '3'; v_stages := array['maternal','prekinder','preescolar'];
    when 'huerto-cuidado' then v_kind := 'choice'; v_answer := 'agua'; v_stages := array['lactantes','maternal','prekinder','preescolar'];
    when 'equipo-amable' then v_kind := 'choice'; v_answer := 'invitar'; v_stages := array['lactantes','maternal','prekinder','preescolar'];
    when 'patron-colores' then v_kind := 'choice'; v_answer := 'azul'; v_stages := array['prekinder','preescolar'];
    when 'historia-semilla' then v_kind := 'choice'; v_answer := 'semilla'; v_stages := array['maternal','prekinder','preescolar'];
    when 'dibuja-huerto' then v_kind := 'drawing'; v_stages := array['lactantes','maternal','prekinder','preescolar'];
    else raise exception 'activity_unavailable' using errcode = '22023';
  end case;
  if not exists (
    select 1 from public.enrollments e join public.groups g on g.id = e.group_id and g.active
    join public.students s on s.id = e.student_id and s.active
    where e.student_id = p_student_id and e.ended_at is null and g.stage = any(v_stages)
  ) then raise exception 'activity_stage_unavailable' using errcode = '22023'; end if;

  if v_kind = 'choice' then
    if p_answer is distinct from v_answer or p_artwork is not null then
      raise exception 'activity_answer_invalid' using errcode = '22023';
    end if;
  else
    if p_answer is not null or p_artwork is null or jsonb_typeof(p_artwork) <> 'array' then
      raise exception 'activity_artwork_invalid' using errcode = '22023';
    end if;
    if jsonb_array_length(p_artwork) not between 1 and 30 or octet_length(p_artwork::text) > 512000 then
      raise exception 'activity_artwork_invalid' using errcode = '22023';
    end if;
    for v_stroke in select value from jsonb_array_elements(p_artwork) loop
      if jsonb_typeof(v_stroke) <> 'object' or jsonb_typeof(v_stroke->'color') is distinct from 'string' or
        (v_stroke->>'color') not in ('#237345','#ffb629','#ed6b68','#4285d4','#8659ad','#293c30') or
        jsonb_typeof(v_stroke->'points') is distinct from 'array' then
        raise exception 'activity_artwork_invalid' using errcode = '22023';
      end if;
      if jsonb_array_length(v_stroke->'points') not between 1 and 160 then
        raise exception 'activity_artwork_invalid' using errcode = '22023';
      end if;
      for v_point in select value from jsonb_array_elements(v_stroke->'points') loop
        if jsonb_typeof(v_point) <> 'object' or jsonb_typeof(v_point->'x') is distinct from 'number' or
          jsonb_typeof(v_point->'y') is distinct from 'number' then
          raise exception 'activity_artwork_invalid' using errcode = '22023';
        end if;
        if (v_point->>'x')::numeric not between 0 and 1 or (v_point->>'y')::numeric not between 0 and 1 then
          raise exception 'activity_artwork_invalid' using errcode = '22023';
        end if;
      end loop;
    end loop;
  end if;
  insert into public.activity_progress (id, student_id, activity_id, completed_at, artwork_json, updated_at)
  values (gen_random_uuid(), p_student_id, p_activity_id, v_now, case when p_artwork is null then null else p_artwork::text end, v_now)
  on conflict (student_id, activity_id) do update set completed_at = excluded.completed_at,
    artwork_json = excluded.artwork_json, updated_at = excluded.updated_at;
  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (gen_random_uuid(), auth.uid(), 'complete_activity', 'student', p_student_id::text, v_now);
  return jsonb_build_object('saved', true, 'activityId', p_activity_id, 'completedAt', v_now);
end;
$$;

revoke insert, update, delete on public.observations, public.activity_progress from authenticated;
revoke all on function public.school_progress_students() from public, anon;
revoke all on function public.school_record_observation(uuid, uuid, text, text, boolean) from public, anon;
revoke all on function public.school_save_activity_progress(uuid, text, text, jsonb) from public, anon;
grant execute on function public.school_progress_students() to authenticated;
grant execute on function public.school_record_observation(uuid, uuid, text, text, boolean) to authenticated;
grant execute on function public.school_save_activity_progress(uuid, text, text, jsonb) to authenticated;
commit;
