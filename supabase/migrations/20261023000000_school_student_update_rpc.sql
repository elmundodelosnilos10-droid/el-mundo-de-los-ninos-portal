-- Edición y baja lógica con auditoría atómica; conserva el historial escolar.
begin;

create function public.school_update_student(
  p_student_id uuid, p_given_name text, p_family_name text,
  p_birth_date text, p_replace_birth_date boolean
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_now timestamptz := now();
begin
  if auth.uid() is null or not public.school_is_leader() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_student_id is null or p_given_name is null or char_length(btrim(p_given_name)) not between 1 and 100
    or p_family_name is null or char_length(btrim(p_family_name)) not between 1 and 100
    or p_replace_birth_date is null then
    raise exception 'invalid_student' using errcode = '22023';
  end if;
  if p_replace_birth_date and p_birth_date is not null then
    if p_birth_date !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'invalid_birth_date' using errcode = '22023';
    end if;
    perform p_birth_date::date;
  end if;
  perform 1 from public.students s where s.id = p_student_id for update;
  if not found then raise exception 'student_unavailable' using errcode = 'P0002'; end if;
  update public.students
  set given_name = btrim(p_given_name), family_name = btrim(p_family_name),
    birth_date = case when p_replace_birth_date then p_birth_date else birth_date end,
    updated_at = v_now
  where id = p_student_id;
  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (gen_random_uuid(), auth.uid(), 'update', 'student', p_student_id::text, v_now);
  return jsonb_build_object('updated', true);
end;
$$;

create function public.school_set_student_active(
  p_student_id uuid, p_active boolean, p_group_id uuid default null, p_enrollment_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_active boolean;
  v_now timestamptz := now();
begin
  if auth.uid() is null or not public.school_is_leader() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_student_id is null or p_active is null then
    raise exception 'invalid_student_status' using errcode = '22023';
  end if;
  select s.active into v_active from public.students s where s.id = p_student_id for update;
  if not found then raise exception 'student_unavailable' using errcode = 'P0002'; end if;
  if v_active = p_active then
    raise exception 'student_status_unchanged' using errcode = '23505';
  end if;

  if p_active then
    if p_group_id is null or p_enrollment_id is null then
      raise exception 'reactivation_requires_group' using errcode = '22023';
    end if;
    perform 1 from public.groups g where g.id = p_group_id and g.active for share;
    if not found then raise exception 'active_group_not_found' using errcode = 'P0002'; end if;
    if exists (select 1 from public.enrollments e where e.student_id = p_student_id and e.ended_at is null) then
      raise exception 'student_has_open_enrollment' using errcode = '23505';
    end if;
    insert into public.enrollments (id, student_id, group_id, enrolled_at, ended_at)
    values (p_enrollment_id, p_student_id, p_group_id, v_now, null);
  else
    update public.enrollments set ended_at = v_now where student_id = p_student_id and ended_at is null;
  end if;
  update public.students set active = p_active, updated_at = v_now where id = p_student_id;
  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (gen_random_uuid(), auth.uid(), case when p_active then 'reactivate' else 'deactivate' end,
    'student', p_student_id::text, v_now);
  return jsonb_build_object('updated', true, 'active', p_active);
end;
$$;

revoke all on function public.school_update_student(uuid, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.school_set_student_active(uuid, boolean, uuid, uuid) from public, anon, authenticated;
grant execute on function public.school_update_student(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.school_set_student_active(uuid, boolean, uuid, uuid) to authenticated;
-- Existing create RPCs are SECURITY DEFINER and remain usable. Client table
-- writes would bypass audit and must not alter or erase the school history.
revoke insert, update, delete on table public.students, public.enrollments from authenticated;
commit;
