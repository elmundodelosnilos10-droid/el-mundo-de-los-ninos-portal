-- Lectura paginada del directorio para dirección y alta atómica de alumno.
-- Los endpoints de docentes y tutores usan directamente las políticas RLS.
begin;

create function public.school_list_students(
  p_query text,
  p_group_id uuid,
  p_status text,
  p_limit integer,
  p_offset integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not public.school_actor_active() or not public.school_is_leader() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_limit is null or p_offset is null or p_status is null
    or p_limit not between 1 and 50 or p_offset not between 0 and 100000
    or p_status not in ('todos', 'activos', 'inactivos')
    or (p_query is not null and char_length(p_query) > 100) then
    raise exception 'invalid_student_page' using errcode = '22023';
  end if;

  with filtered as (
    select s.id, s.given_name, s.family_name, s.birth_date, s.active,
      e.group_id, g.name as group_name
    from public.students s
    left join public.enrollments e on e.student_id = s.id and e.ended_at is null
    left join public.groups g on g.id = e.group_id
    where (p_query is null or position(lower(btrim(p_query)) in lower(s.given_name || ' ' || s.family_name)) > 0)
      and (p_group_id is null or e.group_id = p_group_id)
      and (p_status = 'todos' or (p_status = 'activos' and s.active = true) or (p_status = 'inactivos' and s.active = false))
  ), page_rows as (
    select * from filtered
    order by family_name, given_name, id
    limit p_limit offset p_offset
  ), totals as (
    select count(*)::integer as total from filtered
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id,
        'givenName', given_name,
        'familyName', family_name,
        'birthDate', birth_date,
        'active', active,
        'groupId', group_id,
        'groupName', group_name
      ) order by family_name, given_name, id)
      from page_rows
    ), '[]'::jsonb),
    'total', (select total from totals),
    'page', (p_offset / p_limit) + 1,
    'pageSize', p_limit
  ) into result;
  return result;
end;
$$;

create function public.school_create_student(
  p_id uuid,
  p_enrollment_id uuid,
  p_given_name text,
  p_family_name text,
  p_birth_date text,
  p_group_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_student public.students;
begin
  if auth.uid() is null or not public.school_actor_active() or not public.school_is_leader() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_id is null or p_enrollment_id is null or p_group_id is null
    or p_given_name is null or char_length(btrim(p_given_name)) not between 1 and 100
    or p_family_name is null or char_length(btrim(p_family_name)) not between 1 and 100 then
    raise exception 'invalid_student' using errcode = '22023';
  end if;
  if p_birth_date is not null and (p_birth_date !~ '^\d{4}-\d{2}-\d{2}$' or p_birth_date::date is null) then
    raise exception 'invalid_birth_date' using errcode = '22023';
  end if;
  if not exists (select 1 from public.groups g where g.id = p_group_id and g.active = true) then
    raise exception 'active_group_not_found' using errcode = 'P0002';
  end if;

  insert into public.students (id, given_name, family_name, birth_date, active, created_at, updated_at)
  values (p_id, btrim(p_given_name), btrim(p_family_name), p_birth_date, true, now(), now())
  returning * into created_student;
  insert into public.enrollments (id, student_id, group_id, enrolled_at, ended_at)
  values (p_enrollment_id, created_student.id, p_group_id, now(), null);
  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (gen_random_uuid(), auth.uid(), 'create', 'student', created_student.id::text, now());

  return jsonb_build_object('id', created_student.id);
end;
$$;

revoke all on function public.school_list_students(text, uuid, text, integer, integer) from public, anon;
revoke all on function public.school_create_student(uuid, uuid, text, text, text, uuid) from public, anon;
grant execute on function public.school_list_students(text, uuid, text, integer, integer) to authenticated;
grant execute on function public.school_create_student(uuid, uuid, text, text, text, uuid) to authenticated;

commit;
