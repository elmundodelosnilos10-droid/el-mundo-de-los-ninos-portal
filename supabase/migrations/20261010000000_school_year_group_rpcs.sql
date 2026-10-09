-- Operaciones atómicas para ciclos, grupos y asignación de maestras.
-- Cada función deriva al actor de auth.uid(), valida permisos y registra auditoría.
begin;

create function public.school_create_year(
  p_id uuid,
  p_name text,
  p_starts_on text,
  p_ends_on text
)
returns public.school_years
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_year public.school_years;
begin
  if auth.uid() is null or not public.school_actor_active() or not public.school_is_leader() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_id is null or p_name is null or char_length(btrim(p_name)) not between 4 and 40
    or p_starts_on is null or p_ends_on is null
    or p_starts_on !~ '^\d{4}-\d{2}-\d{2}$'
    or p_ends_on !~ '^\d{4}-\d{2}-\d{2}$'
    or p_starts_on::date >= p_ends_on::date then
    raise exception 'invalid_school_year' using errcode = '22023';
  end if;

  update public.school_years set active = false where active = true;
  insert into public.school_years (id, name, starts_on, ends_on, active)
  values (p_id, btrim(p_name), p_starts_on, p_ends_on, true)
  returning * into created_year;

  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (gen_random_uuid(), auth.uid(), 'create', 'school_year', created_year.id::text, now());
  return created_year;
end;
$$;

create function public.school_create_group(
  p_id uuid,
  p_year_id uuid,
  p_name text,
  p_stage text
)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_group public.groups;
begin
  if auth.uid() is null or not public.school_actor_active() or not public.school_is_leader() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_id is null or p_year_id is null or p_name is null or p_stage is null
    or char_length(btrim(p_name)) not between 1 and 60
    or p_stage not in ('lactantes', 'maternal', 'prekinder', 'preescolar') then
    raise exception 'invalid_group' using errcode = '22023';
  end if;
  if not exists (select 1 from public.school_years y where y.id = p_year_id) then
    raise exception 'school_year_not_found' using errcode = 'P0002';
  end if;

  insert into public.groups (id, year_id, name, stage, active)
  values (p_id, p_year_id, btrim(p_name), p_stage, true)
  returning * into created_group;

  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (gen_random_uuid(), auth.uid(), 'create', 'group', created_group.id::text, now());
  return created_group;
end;
$$;

create function public.school_assign_teacher_to_group(p_group_id uuid, p_teacher_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_rows integer;
begin
  if auth.uid() is null or not public.school_actor_active() or not public.school_is_leader() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.groups g where g.id = p_group_id and g.active = true)
    or not exists (select 1 from public.teachers t where t.id = p_teacher_id and t.active = true) then
    raise exception 'group_or_teacher_not_found' using errcode = 'P0002';
  end if;

  insert into public.teacher_groups (teacher_id, group_id)
  values (p_teacher_id, p_group_id)
  on conflict (teacher_id, group_id) do nothing;
  get diagnostics inserted_rows = row_count;

  if inserted_rows = 1 then
    insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
    values (gen_random_uuid(), auth.uid(), 'assign_teacher', 'group', p_group_id::text, now());
  end if;
  return jsonb_build_object('assigned', true, 'alreadyAssigned', inserted_rows = 0);
end;
$$;

revoke all on function public.school_create_year(uuid, text, text, text) from public, anon;
revoke all on function public.school_create_group(uuid, uuid, text, text) from public, anon;
revoke all on function public.school_assign_teacher_to_group(uuid, uuid) from public, anon;
grant execute on function public.school_create_year(uuid, text, text, text) to authenticated;
grant execute on function public.school_create_group(uuid, uuid, text, text) to authenticated;
grant execute on function public.school_assign_teacher_to_group(uuid, uuid) to authenticated;

commit;
