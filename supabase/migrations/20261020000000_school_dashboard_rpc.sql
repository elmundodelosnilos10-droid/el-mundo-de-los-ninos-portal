-- A single RLS-scoped snapshot for the role-specific home page.
begin;
create function public.school_dashboard(p_version integer default 1)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_mode text;
  v_now timestamptz := pg_catalog.now();
  v_day date := (pg_catalog.now() at time zone 'America/Mexico_City')::date;
  v_counts jsonb;
  v_events jsonb;
  v_announcements jsonb;
  v_children jsonb := '[]'::jsonb;
  v_tasks jsonb := '[]'::jsonb;
  v_classes jsonb := '[]'::jsonb;
begin
  if v_actor is null or not public.school_actor_active() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_version is distinct from 1 then
    raise exception 'invalid_version' using errcode = '22023';
  end if;
  v_mode := case when public.school_is_leader() then 'direccion'
    when public.school_has_role(array['tutor']::text[]) then 'tutor'
    when public.school_has_role(array['docente']::text[]) then 'docente' else 'alumno' end;

  select coalesce(pg_catalog.jsonb_agg(page.item order by page.starts_at, page.id), '[]'::jsonb)
  into v_events from (
    select e.id, e.starts_at, pg_catalog.jsonb_build_object('id',e.id,'title',e.title,'startsAt',e.starts_at) item
    from public.calendar_events e
    where e.starts_at >= v_now
      and (e.group_id is null or exists (select 1 from public.groups g where g.id=e.group_id and g.active))
    order by e.starts_at, e.id limit 4
  ) page;
  select coalesce(pg_catalog.jsonb_agg(page.item order by page.published_at desc, page.id desc), '[]'::jsonb)
  into v_announcements from (
    select a.id, a.published_at, pg_catalog.jsonb_build_object('id',a.id,'title',a.title,'important',a.important) item
    from public.announcements a
    where a.group_id is null or exists (select 1 from public.groups g where g.id=a.group_id and g.active)
    order by a.published_at desc, a.id desc limit 3
  ) page;

  if v_mode = 'direccion' then
    v_counts := pg_catalog.jsonb_build_object(
      'activeStudents',(select count(*) from public.students where active),
      'activeGroups',(select count(*) from public.groups where active),
      'presentToday',(select count(distinct student_id) from public.attendance where on_date=v_day::text and status='presente'),
      'schoolYear',(select name from public.school_years where active order by starts_on desc,id limit 1)
    );
  elsif v_mode = 'tutor' then
    select coalesce(pg_catalog.jsonb_agg(page.item order by page.family_name,page.given_name,page.id,page.group_id), '[]'::jsonb)
    into v_children from (
      select distinct s.id,s.family_name,s.given_name,e.group_id,
        pg_catalog.jsonb_build_object('id',s.id,'givenName',s.given_name,'familyName',s.family_name,'groupId',g.id,'groupName',g.name) item
      from public.students s
      join public.student_guardians sg on sg.student_id=s.id and sg.active
      join public.guardians guardian on guardian.id=sg.guardian_id and guardian.active and guardian.user_id=v_actor
      left join public.enrollments e on e.student_id=s.id and e.ended_at is null
      left join public.groups g on g.id=e.group_id and g.active
      where s.active
    ) page;
    select coalesce(pg_catalog.jsonb_agg(page.item order by page.due_at nulls last,page.id), '[]'::jsonb)
    into v_tasks from (
      select t.id,t.due_at,pg_catalog.jsonb_build_object('id',t.id,'title',t.title,'dueAt',t.due_at) item
      from public.tasks t where t.archived_at is null and exists (
        select 1 from public.enrollments e
        join public.students s on s.id=e.student_id and s.active
        join public.student_guardians sg on sg.student_id=s.id and sg.active
        join public.guardians guardian on guardian.id=sg.guardian_id and guardian.active and guardian.user_id=v_actor
        where e.group_id=t.group_id and e.ended_at is null
          and not exists(select 1 from public.submissions sub where sub.task_id=t.id and sub.student_id=s.id)
      ) order by t.due_at nulls last,t.id limit 4
    ) page;
    v_counts := pg_catalog.jsonb_build_object(
      'linkedChildren',(select count(distinct sg.student_id) from public.student_guardians sg join public.guardians guardian on guardian.id=sg.guardian_id join public.students s on s.id=sg.student_id where guardian.user_id=v_actor and guardian.active and sg.active and s.active),
      'pendingTasks',(select count(*) from public.tasks t where t.archived_at is null and exists (
        select 1 from public.enrollments e join public.students s on s.id=e.student_id and s.active
        join public.student_guardians sg on sg.student_id=s.id and sg.active
        join public.guardians guardian on guardian.id=sg.guardian_id and guardian.active and guardian.user_id=v_actor
        where e.group_id=t.group_id and e.ended_at is null and not exists(select 1 from public.submissions sub where sub.task_id=t.id and sub.student_id=s.id)
      ))
    );
  elsif v_mode = 'docente' then
    select coalesce(pg_catalog.jsonb_agg(page.item order by page.starts_at,page.id),'[]'::jsonb)
    into v_classes from (
      select c.id,e.starts_at,pg_catalog.jsonb_build_object('id',c.id,'title',e.title,'startsAt',e.starts_at) item
      from public.class_sessions c join public.calendar_events e on e.id=c.event_id
      where public.school_is_teacher_of_group(c.group_id)
        and (e.starts_at at time zone 'America/Mexico_City')::date=v_day
      order by e.starts_at,c.id limit 6
    ) page;
    v_counts := pg_catalog.jsonb_build_object(
      'assignedGroups',(select count(*) from public.groups g where g.active and public.school_is_teacher_of_group(g.id)),
      'needsReview',(select count(*) from public.submissions sub join public.tasks t on t.id=sub.task_id where sub.status='entregada' and t.archived_at is null and public.school_is_teacher_of_group(t.group_id)),
      'todayClasses',(select count(*) from public.class_sessions c join public.calendar_events e on e.id=c.event_id where public.school_is_teacher_of_group(c.group_id) and (e.starts_at at time zone 'America/Mexico_City')::date=v_day)
    );
  else
    v_counts := '{}'::jsonb;
  end if;
  return pg_catalog.jsonb_build_object('mode',v_mode,'counts',v_counts,'events',v_events,'announcements',v_announcements,'children',v_children,'tasks',v_tasks,'classes',v_classes,'timeZone','America/Mexico_City');
end;
$$;
revoke all on function public.school_dashboard(integer) from public,anon;
grant execute on function public.school_dashboard(integer) to authenticated;
notify pgrst, 'reload schema';
commit;
