-- Fase 1: vincular/desvincular un tutor existente con un alumno existente.
-- Esta migración es local y queda pendiente de autorización para aplicar.
begin;

create or replace function public.school_link_guardian(
  p_student_id uuid,
  p_guardian_id uuid,
  p_relationship text,
  p_may_collect boolean default false
)
returns table (linked boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null
    or not exists (
      select 1 from public.profiles p
      where p.id = v_actor and p.active = true
    )
    or not exists (
      select 1 from public.user_roles r
      where r.user_id = v_actor and r.role in ('direccion', 'superadmin')
    ) then
    raise exception 'No tienes permiso para vincular tutores.' using errcode = '42501';
  end if;

  if p_student_id is null or p_guardian_id is null
    or p_relationship is null
    or pg_catalog.char_length(pg_catalog.btrim(p_relationship)) < 2
    or pg_catalog.char_length(pg_catalog.btrim(p_relationship)) > 40
    or p_may_collect is null then
    raise exception 'Los datos de la vinculación no son válidos.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.students s
    where s.id = p_student_id and s.active = true
  ) then
    raise exception 'Alumno no disponible.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.guardians g
    join public.profiles p on p.id = g.user_id and p.active = true
    join public.user_roles r on r.user_id = g.user_id and r.role = 'tutor'
    where g.id = p_guardian_id and g.active = true
  ) then
    raise exception 'Tutor no disponible.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.enrollments e
    join public.groups g on g.id = e.group_id and g.active = true
    join public.school_years y on y.id = g.year_id and y.active = true
    where e.student_id = p_student_id and e.ended_at is null
  ) then
    raise exception 'El alumno no tiene un grupo activo.' using errcode = 'P0002';
  end if;

  -- The primary key is the final race-safe duplicate guard; this explicit
  -- check provides the same stable conflict SQLSTATE before the insert.
  if exists (
    select 1 from public.student_guardians sg
    where sg.student_id = p_student_id and sg.guardian_id = p_guardian_id
  ) then
    raise exception 'Este tutor ya está vinculado con el alumno.' using errcode = '23505';
  end if;

  insert into public.student_guardians (student_id, guardian_id, relationship, may_collect, active)
  values (p_student_id, p_guardian_id, pg_catalog.btrim(p_relationship), p_may_collect, true);

  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (pg_catalog.gen_random_uuid(), v_actor, 'link_guardian', 'student', p_student_id::text, pg_catalog.now());

  return query select true;
end;
$$;

create or replace function public.school_unlink_guardian(
  p_student_id uuid,
  p_guardian_id uuid
)
returns table (unlinked boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_deleted boolean := false;
begin
  if v_actor is null
    or not exists (
      select 1 from public.profiles p
      where p.id = v_actor and p.active = true
    )
    or not exists (
      select 1 from public.user_roles r
      where r.user_id = v_actor and r.role in ('direccion', 'superadmin')
    ) then
    raise exception 'No tienes permiso para desvincular tutores.' using errcode = '42501';
  end if;

  if p_student_id is null or p_guardian_id is null then
    raise exception 'Los datos de la vinculación no son válidos.' using errcode = '22023';
  end if;

  delete from public.student_guardians sg
  where sg.student_id = p_student_id and sg.guardian_id = p_guardian_id;
  v_deleted := found;

  if v_deleted then
    insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
    values (pg_catalog.gen_random_uuid(), v_actor, 'unlink_guardian', 'student', p_student_id::text, pg_catalog.now());
  end if;

  return query select v_deleted;
end;
$$;

revoke all on function public.school_link_guardian(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.school_unlink_guardian(uuid, uuid) from public, anon, authenticated;
grant execute on function public.school_link_guardian(uuid, uuid, text, boolean) to authenticated;
grant execute on function public.school_unlink_guardian(uuid, uuid) to authenticated;

commit;
