-- Acceso mínimo de cliente para el portal escolar.
-- Requiere las tablas de 20261008000000_school_schema.sql.
-- Todo acceso pasa por JWT Supabase Auth; no usa service_role ni políticas públicas.
begin;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'profiles', 'user_roles', 'school_years', 'groups', 'students', 'enrollments',
    'teachers', 'teacher_groups', 'guardians', 'student_guardians', 'audit_log',
    'files', 'materials', 'tasks', 'task_files', 'submissions', 'submission_files',
    'calendar_events', 'class_sessions', 'attendance', 'attendance_justifications',
    'observations', 'conversations', 'messages', 'announcements', 'announcement_reads',
    'notifications', 'communication_settings', 'consents', 'privacy_notices',
    'privacy_requests', 'activity_progress'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
  end loop;
end $$;

-- No heredar permisos de cliente que Supabase pueda haber dado por defecto.
revoke all on table
  public.profiles, public.user_roles, public.school_years, public.groups,
  public.students, public.enrollments, public.teachers, public.teacher_groups,
  public.guardians, public.student_guardians, public.audit_log, public.files,
  public.materials, public.tasks, public.task_files, public.submissions,
  public.submission_files, public.calendar_events, public.class_sessions,
  public.attendance, public.attendance_justifications, public.observations,
  public.conversations, public.messages, public.announcements,
  public.announcement_reads, public.notifications, public.communication_settings,
  public.consents, public.privacy_notices, public.privacy_requests,
  public.activity_progress
from public, anon, authenticated;

grant select, insert, update, delete on table
  public.profiles, public.user_roles, public.school_years, public.groups,
  public.students, public.enrollments, public.teachers, public.teacher_groups,
  public.guardians, public.student_guardians, public.audit_log, public.files,
  public.materials, public.tasks, public.task_files, public.submissions,
  public.submission_files, public.calendar_events, public.class_sessions,
  public.attendance, public.attendance_justifications, public.observations,
  public.conversations, public.messages, public.announcements,
  public.announcement_reads, public.notifications, public.communication_settings,
  public.consents, public.privacy_notices, public.privacy_requests,
  public.activity_progress
 to authenticated;

-- Helpers SECURITY DEFINER evitan recursión entre políticas que consultan
-- roles, grupos y relaciones. No aceptan identidad de actor: siempre usan auth.uid().
create function public.school_actor_active()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active = true
  );
$$;

create function public.school_has_role(p_roles text[])
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.school_actor_active() and exists (
    select 1 from public.user_roles r
    where r.user_id = (select auth.uid()) and r.role = any (p_roles)
  );
$$;

create function public.school_is_leader()
returns boolean
language sql stable security definer
set search_path = ''
as $$ select public.school_has_role(array['superadmin', 'direccion']::text[]); $$;

create function public.school_is_teacher_of_group(p_group_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.school_actor_active() and exists (
    select 1
    from public.teachers t
    join public.teacher_groups tg on tg.teacher_id = t.id
    where t.user_id = (select auth.uid()) and t.active = true
      and tg.group_id = p_group_id
      and exists (select 1 from public.user_roles r where r.user_id = t.user_id and r.role = 'docente')
  );
$$;

create function public.school_is_guardian_of_student(p_student_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.school_actor_active() and exists (
    select 1
    from public.guardians g
    join public.student_guardians sg on sg.guardian_id = g.id
    join public.students s on s.id = sg.student_id
    where g.user_id = (select auth.uid()) and g.active = true
      and sg.student_id = p_student_id and sg.active = true and s.active = true
      and exists (select 1 from public.user_roles r where r.user_id = g.user_id and r.role = 'tutor')
  );
$$;

create function public.school_student_in_group(p_student_id uuid, p_group_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.enrollments e
    join public.students s on s.id = e.student_id
    where e.student_id = p_student_id and e.group_id = p_group_id
      and e.ended_at is null and s.active = true
  );
$$;

create function public.school_can_access_group(p_group_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.school_actor_active() and (
    public.school_is_leader()
    or public.school_is_teacher_of_group(p_group_id)
    or exists (
      select 1 from public.enrollments e
      join public.students s on s.id = e.student_id
      join public.student_guardians sg on sg.student_id = s.id
      join public.guardians g on g.id = sg.guardian_id
      where e.group_id = p_group_id and e.ended_at is null and s.active = true
        and sg.active = true and g.active = true and g.user_id = (select auth.uid())
        and exists (select 1 from public.user_roles r where r.user_id = g.user_id and r.role = 'tutor')
    )
  );
$$;

create function public.school_can_access_student(p_student_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.school_actor_active() and (
    public.school_is_leader()
    or public.school_is_guardian_of_student(p_student_id)
    or exists (
      select 1 from public.enrollments e
      join public.teacher_groups tg on tg.group_id = e.group_id
      join public.teachers t on t.id = tg.teacher_id
      where e.student_id = p_student_id and e.ended_at is null
        and t.user_id = (select auth.uid()) and t.active = true
        and exists (select 1 from public.user_roles r where r.user_id = t.user_id and r.role = 'docente')
    )
  );
$$;

create function public.school_can_access_profile(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.school_actor_active() and (
    p_user_id = (select auth.uid())
    or public.school_is_leader()
    or (
      public.school_has_role(array['docente']::text[])
      and exists (
        select 1
        from public.teachers self_teacher
        join public.teacher_groups tg on tg.teacher_id = self_teacher.id
        join public.enrollments e on e.group_id = tg.group_id and e.ended_at is null
        join public.student_guardians sg on sg.student_id = e.student_id and sg.active = true
        join public.guardians target_guardian on target_guardian.id = sg.guardian_id and target_guardian.active = true
        where self_teacher.user_id = (select auth.uid()) and self_teacher.active = true
          and target_guardian.user_id = p_user_id
      )
    )
    or (
      public.school_has_role(array['tutor']::text[])
      and exists (
        select 1
        from public.guardians self_guardian
        join public.student_guardians self_link on self_link.guardian_id = self_guardian.id and self_link.active = true
        join public.enrollments e on e.student_id = self_link.student_id and e.ended_at is null
        join public.teacher_groups tg on tg.group_id = e.group_id
        join public.teachers target_teacher on target_teacher.id = tg.teacher_id and target_teacher.active = true
        where self_guardian.user_id = (select auth.uid()) and self_guardian.active = true
          and target_teacher.user_id = p_user_id
      )
    )
    or (
      public.school_has_role(array['docente']::text[])
      and exists (
        select 1 from public.teachers self_teacher
        join public.teacher_groups self_tg on self_tg.teacher_id = self_teacher.id
        join public.teacher_groups target_tg on target_tg.group_id = self_tg.group_id
        join public.teachers target_teacher on target_teacher.id = target_tg.teacher_id and target_teacher.active = true
        where self_teacher.user_id = (select auth.uid()) and self_teacher.active = true
          and target_teacher.user_id = p_user_id
      )
    )
  );
$$;

create function public.school_is_conversation_member(p_conversation_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.school_actor_active() and exists (
    select 1 from public.conversations c
    join public.teachers t on t.id = c.teacher_id and t.active = true
    join public.guardians g on g.id = c.guardian_id and g.active = true
    join public.students s on s.id = c.student_id and s.active = true
    join public.enrollments e on e.student_id = c.student_id and e.ended_at is null
    join public.teacher_groups tg on tg.group_id = e.group_id and tg.teacher_id = t.id
    join public.student_guardians sg on sg.student_id = c.student_id and sg.guardian_id = g.id and sg.active = true
    where c.id = p_conversation_id
      and ((t.user_id = (select auth.uid()) and public.school_is_teacher_of_group(e.group_id))
        or (g.user_id = (select auth.uid()) and public.school_is_guardian_of_student(c.student_id)))
  );
$$;

create function public.school_file_matches_group(p_file_id uuid, p_group_id uuid, p_purpose text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.files f
    where f.id = p_file_id and f.group_id = p_group_id
      and f.purpose = p_purpose and f.deleted_at is null
  );
$$;

create function public.school_is_leader_or_teacher(p_group_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select public.school_is_leader() or public.school_is_teacher_of_group(p_group_id); $$;

create function public.school_is_teacher_for_student(p_student_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.enrollments e
    where e.student_id = p_student_id and e.ended_at is null and public.school_is_teacher_of_group(e.group_id)
  );
$$;

create function public.school_is_leader_or_teacher_for_student(p_student_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select public.school_is_leader() or public.school_is_teacher_for_student(p_student_id); $$;

revoke all on function public.school_actor_active() from public, anon;
revoke all on function public.school_has_role(text[]) from public, anon;
revoke all on function public.school_is_leader() from public, anon;
revoke all on function public.school_is_teacher_of_group(uuid) from public, anon;
revoke all on function public.school_is_guardian_of_student(uuid) from public, anon;
revoke all on function public.school_student_in_group(uuid, uuid) from public, anon;
revoke all on function public.school_can_access_group(uuid) from public, anon;
revoke all on function public.school_can_access_student(uuid) from public, anon;
revoke all on function public.school_can_access_profile(uuid) from public, anon;
revoke all on function public.school_is_conversation_member(uuid) from public, anon;
revoke all on function public.school_file_matches_group(uuid, uuid, text) from public, anon;
revoke all on function public.school_is_leader_or_teacher(uuid) from public, anon;
revoke all on function public.school_is_teacher_for_student(uuid) from public, anon;
revoke all on function public.school_is_leader_or_teacher_for_student(uuid) from public, anon;
grant execute on function public.school_actor_active() to authenticated;
grant execute on function public.school_has_role(text[]) to authenticated;
grant execute on function public.school_is_leader() to authenticated;
grant execute on function public.school_is_teacher_of_group(uuid) to authenticated;
grant execute on function public.school_is_guardian_of_student(uuid) to authenticated;
grant execute on function public.school_student_in_group(uuid, uuid) to authenticated;
grant execute on function public.school_can_access_group(uuid) to authenticated;
grant execute on function public.school_can_access_student(uuid) to authenticated;
grant execute on function public.school_can_access_profile(uuid) to authenticated;
grant execute on function public.school_is_conversation_member(uuid) to authenticated;
grant execute on function public.school_file_matches_group(uuid, uuid, text) to authenticated;
grant execute on function public.school_is_leader_or_teacher(uuid) to authenticated;
grant execute on function public.school_is_teacher_for_student(uuid) to authenticated;
grant execute on function public.school_is_leader_or_teacher_for_student(uuid) to authenticated;

-- Nunca se permite editar el perfil Auth directamente; el trigger de auth.users
-- sincroniza los campos protegidos. Lectura limitada a relaciones escolares.
revoke update, insert, delete on table public.profiles from authenticated;
create policy profiles_read_related on public.profiles for select to authenticated
  using (public.school_can_access_profile(id));

create policy user_roles_read_self_or_leadership on public.user_roles for select to authenticated
  using (public.school_actor_active() and (user_id = (select auth.uid()) or public.school_is_leader()));
create policy user_roles_insert_leadership on public.user_roles for insert to authenticated
  with check (
    public.school_has_role(array['superadmin']::text[])
    or (public.school_has_role(array['direccion']::text[]) and role in ('docente', 'tutor', 'alumno'))
  );
create policy user_roles_update_leadership on public.user_roles for update to authenticated
  using (public.school_has_role(array['superadmin']::text[])
    or (public.school_has_role(array['direccion']::text[]) and role in ('docente', 'tutor', 'alumno')))
  with check (public.school_has_role(array['superadmin']::text[])
    or (public.school_has_role(array['direccion']::text[]) and role in ('docente', 'tutor', 'alumno')));
create policy user_roles_delete_leadership on public.user_roles for delete to authenticated
  using (public.school_has_role(array['superadmin']::text[])
    or (public.school_has_role(array['direccion']::text[]) and role in ('docente', 'tutor', 'alumno')));

create policy school_years_read_authenticated on public.school_years for select to authenticated
  using (public.school_actor_active());
create policy school_years_manage_leadership on public.school_years for all to authenticated
  using (public.school_is_leader()) with check (public.school_is_leader());

create policy groups_read_authorized on public.groups for select to authenticated
  using (public.school_can_access_group(id));
create policy groups_manage_leadership on public.groups for all to authenticated
  using (public.school_is_leader()) with check (public.school_is_leader());

create policy students_read_authorized on public.students for select to authenticated
  using (public.school_can_access_student(id));
create policy students_manage_leadership on public.students for all to authenticated
  using (public.school_is_leader()) with check (public.school_is_leader());

create policy enrollments_read_authorized on public.enrollments for select to authenticated
  using (public.school_is_leader() or public.school_can_access_student(student_id) or public.school_is_teacher_of_group(group_id));
create policy enrollments_manage_leadership on public.enrollments for all to authenticated
  using (public.school_is_leader()) with check (public.school_is_leader());

create policy teachers_read_related on public.teachers for select to authenticated
  using (user_id = (select auth.uid()) or public.school_is_leader() or public.school_can_access_profile(user_id));
create policy teachers_manage_leadership on public.teachers for all to authenticated
  using (public.school_is_leader()) with check (public.school_is_leader());

create policy teacher_groups_read_related on public.teacher_groups for select to authenticated
  using (public.school_is_leader() or public.school_is_teacher_of_group(group_id) or public.school_can_access_group(group_id));
create policy teacher_groups_manage_leadership on public.teacher_groups for all to authenticated
  using (public.school_is_leader()) with check (public.school_is_leader());

create policy guardians_read_related on public.guardians for select to authenticated
  using (user_id = (select auth.uid()) or public.school_is_leader() or public.school_can_access_profile(user_id));
create policy guardians_manage_leadership on public.guardians for all to authenticated
  using (public.school_is_leader()) with check (public.school_is_leader());

create policy student_guardians_read_related on public.student_guardians for select to authenticated
  using (public.school_is_leader() or public.school_is_guardian_of_student(student_id) or exists (
    select 1 from public.enrollments e
    where e.student_id = student_guardians.student_id and e.ended_at is null
      and public.school_is_teacher_of_group(e.group_id)
  ));
create policy student_guardians_manage_leadership on public.student_guardians for all to authenticated
  using (public.school_is_leader()) with check (public.school_is_leader());

create policy audit_log_read_leadership on public.audit_log for select to authenticated
  using (public.school_is_leader());
revoke insert, update, delete on table public.audit_log from authenticated;

create policy files_read_authorized on public.files for select to authenticated
  using (
    public.school_is_leader()
    or (student_id is not null and public.school_can_access_student(student_id))
    or (student_id is null and group_id is not null and public.school_can_access_group(group_id))
  );
create policy files_insert_authorized on public.files for insert to authenticated
  with check (
    uploaded_by = (select auth.uid()) and public.school_actor_active()
    and (
      public.school_is_leader()
      or (purpose = 'submission' and student_id is not null and group_id is not null
        and public.school_is_guardian_of_student(student_id) and public.school_student_in_group(student_id, group_id))
      or (purpose in ('material', 'recording') and student_id is null and group_id is not null and public.school_is_teacher_of_group(group_id))
      or (purpose = 'message' and student_id is not null and group_id is null and public.school_can_access_student(student_id))
    )
  );
create policy files_update_authorized on public.files for update to authenticated
  using (public.school_is_leader() or (uploaded_by = (select auth.uid()) and (
    (student_id is not null and public.school_can_access_student(student_id))
    or (student_id is null and group_id is not null and public.school_can_access_group(group_id))
  )))
  with check (public.school_is_leader() or (uploaded_by = (select auth.uid()) and (
    (student_id is not null and public.school_can_access_student(student_id))
    or (student_id is null and group_id is not null and public.school_can_access_group(group_id))
  )));
create policy files_delete_leadership on public.files for delete to authenticated
  using (public.school_is_leader());

create policy materials_read_group on public.materials for select to authenticated
  using (public.school_can_access_group(group_id));
create policy materials_insert_staff on public.materials for insert to authenticated
  with check (published_by = (select auth.uid()) and public.school_is_leader_or_teacher(group_id)
    and public.school_file_matches_group(file_id, group_id, 'material'));
create policy materials_update_staff on public.materials for update to authenticated
  using (public.school_is_leader_or_teacher(group_id)) with check (public.school_is_leader_or_teacher(group_id)
    and public.school_file_matches_group(file_id, group_id, 'material'));
create policy materials_delete_staff on public.materials for delete to authenticated
  using (public.school_is_leader_or_teacher(group_id));

create policy tasks_read_group on public.tasks for select to authenticated
  using (public.school_can_access_group(group_id));
create policy tasks_insert_staff on public.tasks for insert to authenticated
  with check (created_by = (select auth.uid()) and public.school_is_leader_or_teacher(group_id));
create policy tasks_update_staff on public.tasks for update to authenticated
  using (public.school_is_leader_or_teacher(group_id)) with check (public.school_is_leader_or_teacher(group_id));
create policy tasks_delete_staff on public.tasks for delete to authenticated
  using (public.school_is_leader_or_teacher(group_id));

create policy task_files_read_group on public.task_files for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_files.task_id and public.school_can_access_group(t.group_id)));
create policy task_files_insert_staff on public.task_files for insert to authenticated
  with check (exists (select 1 from public.tasks t where t.id = task_files.task_id and public.school_is_leader_or_teacher(t.group_id))
    and exists (select 1 from public.tasks t join public.files f on f.id = task_files.file_id
      where t.id = task_files.task_id and f.group_id = t.group_id and f.purpose = 'material'
        and f.uploaded_by = (select auth.uid()) and f.deleted_at is null));
create policy task_files_delete_staff on public.task_files for delete to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_files.task_id and public.school_is_leader_or_teacher(t.group_id)));

create policy submissions_read_student on public.submissions for select to authenticated
  using (public.school_can_access_student(student_id));
create policy submissions_insert_family on public.submissions for insert to authenticated
  with check (
    submitted_by = (select auth.uid()) and status = 'entregada'
    and evaluation is null and reviewed_by is null and reviewed_at is null and review_note is null
    and public.school_is_guardian_of_student(student_id)
    and exists (select 1 from public.tasks t where t.id = submissions.task_id and public.school_student_in_group(student_id, t.group_id) and t.archived_at is null)
  );
create policy submissions_update_family_resubmit on public.submissions for update to authenticated
  using (submitted_by = (select auth.uid()) and public.school_is_guardian_of_student(student_id))
  with check (
    submitted_by = (select auth.uid()) and status = 'entregada'
    and evaluation is null and reviewed_by is null and reviewed_at is null and review_note is null
    and public.school_is_guardian_of_student(student_id)
    and exists (select 1 from public.tasks t where t.id = submissions.task_id and public.school_student_in_group(student_id, t.group_id))
  );
create policy submissions_review_staff on public.submissions for update to authenticated
  using (exists (select 1 from public.tasks t where t.id = submissions.task_id and public.school_is_leader_or_teacher(t.group_id)))
  with check (exists (select 1 from public.tasks t where t.id = submissions.task_id and public.school_is_leader_or_teacher(t.group_id)));

create policy submission_files_read_student on public.submission_files for select to authenticated
  using (exists (select 1 from public.submissions s where s.id = submission_files.submission_id and public.school_can_access_student(s.student_id)));
create policy submission_files_insert_authorized on public.submission_files for insert to authenticated
  with check (
    exists (select 1 from public.submissions s where s.id = submission_files.submission_id and (
      s.submitted_by = (select auth.uid()) or exists (select 1 from public.tasks t where t.id = s.task_id and public.school_is_leader_or_teacher(t.group_id))
    ))
    and exists (select 1 from public.submissions s
      join public.tasks t on t.id = s.task_id
      join public.files f on f.id = submission_files.file_id
      where s.id = submission_files.submission_id and f.student_id = s.student_id
        and f.group_id = t.group_id and f.purpose = 'submission'
        and f.uploaded_by = (select auth.uid()) and f.deleted_at is null)
  );

create policy calendar_events_read_scope on public.calendar_events for select to authenticated
  using (public.school_actor_active() and (group_id is null or public.school_can_access_group(group_id)));
create policy calendar_events_insert_staff on public.calendar_events for insert to authenticated
  with check (created_by = (select auth.uid()) and (
    (group_id is null and public.school_is_leader())
    or (group_id is not null and public.school_is_leader_or_teacher(group_id))
  ));
create policy calendar_events_update_staff on public.calendar_events for update to authenticated
  using ((group_id is null and public.school_is_leader()) or (group_id is not null and public.school_is_leader_or_teacher(group_id)))
  with check ((group_id is null and public.school_is_leader()) or (group_id is not null and public.school_is_leader_or_teacher(group_id)));
create policy calendar_events_delete_staff on public.calendar_events for delete to authenticated
  using ((group_id is null and public.school_is_leader()) or (group_id is not null and public.school_is_leader_or_teacher(group_id)));
revoke update on table public.calendar_events from authenticated;
grant update (kind, title, description, starts_at, ends_at) on table public.calendar_events to authenticated;

create policy class_sessions_read_group on public.class_sessions for select to authenticated
  using (public.school_can_access_group(group_id));
create policy class_sessions_insert_staff on public.class_sessions for insert to authenticated
  with check (
    (public.school_is_leader() or (public.school_is_teacher_of_group(group_id) and exists (select 1 from public.teachers t where t.id = class_sessions.teacher_id and t.user_id = (select auth.uid()) and t.active)))
    and exists (select 1 from public.teacher_groups tg join public.teachers t on t.id = tg.teacher_id and t.active
      where tg.group_id = class_sessions.group_id and t.id = class_sessions.teacher_id)
    and (meet_url is null or meet_url like 'https://meet.google.com/%')
    and (recording_file_id is null or public.school_file_matches_group(recording_file_id, group_id, 'recording'))
  );
create policy class_sessions_update_staff on public.class_sessions for update to authenticated
  using (public.school_is_leader() or public.school_is_teacher_of_group(group_id))
  with check ((public.school_is_leader() or public.school_is_teacher_of_group(group_id))
    and exists (select 1 from public.teacher_groups tg join public.teachers t on t.id = tg.teacher_id and t.active
      where tg.group_id = class_sessions.group_id and t.id = class_sessions.teacher_id)
    and (meet_url is null or meet_url like 'https://meet.google.com/%')
    and (recording_file_id is null or public.school_file_matches_group(recording_file_id, group_id, 'recording')));

create policy attendance_read_student on public.attendance for select to authenticated
  using (public.school_can_access_student(student_id));
create policy attendance_insert_staff on public.attendance for insert to authenticated
  with check (recorded_by = (select auth.uid()) and (public.school_is_leader() or public.school_is_teacher_of_group(group_id)) and public.school_student_in_group(student_id, group_id));
create policy attendance_update_staff on public.attendance for update to authenticated
  using (public.school_is_teacher_of_group(group_id) or public.school_is_leader())
  with check ((public.school_is_teacher_of_group(group_id) or public.school_is_leader()) and public.school_student_in_group(student_id, group_id));

create policy attendance_justifications_read_student on public.attendance_justifications for select to authenticated
  using (public.school_can_access_student(student_id));
create policy attendance_justifications_insert_family on public.attendance_justifications for insert to authenticated
  with check (submitted_by = (select auth.uid()) and status = 'pendiente' and reviewed_by is null and reviewed_at is null
    and public.school_is_guardian_of_student(student_id) and public.school_student_in_group(student_id, group_id));
create policy attendance_justifications_update_family on public.attendance_justifications for update to authenticated
  using (submitted_by = (select auth.uid()) and public.school_is_guardian_of_student(student_id))
  with check (submitted_by = (select auth.uid()) and status = 'pendiente' and reviewed_by is null and reviewed_at is null
    and public.school_is_guardian_of_student(student_id) and public.school_student_in_group(student_id, group_id));
create policy attendance_justifications_review_staff on public.attendance_justifications for update to authenticated
  using (public.school_is_leader() or public.school_is_teacher_of_group(group_id))
  with check ((public.school_is_leader() or public.school_is_teacher_of_group(group_id))
    and public.school_student_in_group(student_id, group_id) and reviewed_by = (select auth.uid()));

create policy observations_read_authorized on public.observations for select to authenticated
  using (public.school_is_leader() or public.school_is_teacher_for_student(student_id)
    or (visible_to_family and public.school_is_guardian_of_student(student_id)));
create policy observations_insert_staff on public.observations for insert to authenticated
  with check (recorded_by = (select auth.uid()) and public.school_is_leader_or_teacher_for_student(student_id));
revoke update, delete on table public.observations from authenticated;

create policy conversations_read_member on public.conversations for select to authenticated
  using (public.school_is_conversation_member(id));
create policy conversations_insert_member on public.conversations for insert to authenticated
  with check (exists (
    select 1 from public.enrollments e
    join public.teachers t on t.id = conversations.teacher_id and t.active
    join public.teacher_groups tg on tg.teacher_id = t.id and tg.group_id = e.group_id
    join public.student_guardians sg on sg.student_id = e.student_id and sg.guardian_id = conversations.guardian_id and sg.active
    join public.guardians g on g.id = sg.guardian_id and g.active
    where e.student_id = conversations.student_id and e.ended_at is null
      and ((t.user_id = (select auth.uid()) and public.school_is_teacher_of_group(e.group_id))
        or (g.user_id = (select auth.uid()) and public.school_is_guardian_of_student(e.student_id)))
  ));

create policy messages_read_member on public.messages for select to authenticated
  using (public.school_is_conversation_member(conversation_id));
create policy messages_insert_member on public.messages for insert to authenticated
  with check (
    author_id = (select auth.uid()) and public.school_is_conversation_member(conversation_id)
    and char_length(body) <= 3000 and (char_length(btrim(body)) > 0 or file_id is not null)
    and (file_id is null or exists (select 1 from public.files f where f.id = messages.file_id and f.uploaded_by = (select auth.uid()) and f.purpose = 'message' and f.deleted_at is null))
  );
create policy messages_update_read_receipt on public.messages for update to authenticated
  using (author_id <> (select auth.uid()) and public.school_is_conversation_member(conversation_id))
  with check (author_id <> (select auth.uid()) and public.school_is_conversation_member(conversation_id));
revoke update on table public.messages from authenticated;
grant update (read_at) on table public.messages to authenticated;

create policy announcements_read_scope on public.announcements for select to authenticated
  using (public.school_actor_active() and (group_id is null or public.school_can_access_group(group_id)));
create policy announcements_insert_staff on public.announcements for insert to authenticated
  with check (published_by = (select auth.uid()) and (
    (group_id is null and public.school_is_leader())
    or (group_id is not null and public.school_is_leader_or_teacher(group_id))
  ));
revoke update, delete on table public.announcements from authenticated;

create policy announcement_reads_read_own on public.announcement_reads for select to authenticated
  using (public.school_actor_active() and user_id = (select auth.uid()));
create policy announcement_reads_insert_own on public.announcement_reads for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.announcements a
    where a.id = announcement_id and (a.group_id is null or public.school_can_access_group(a.group_id))
  ));
revoke update, delete on table public.announcement_reads from authenticated;

create policy notifications_read_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) and public.school_actor_active());
-- Las inserciones de avisos se reservan a una capa servidor confiable. Los
-- clientes autenticados solo pueden leer y marcar como leído su propio aviso.
create policy notifications_update_own_read_at on public.notifications for update to authenticated
  using (user_id = (select auth.uid()) and public.school_actor_active())
  with check (user_id = (select auth.uid()) and public.school_actor_active());
revoke insert, delete, update on table public.notifications from authenticated;
grant update (read_at) on table public.notifications to authenticated;

create policy communication_settings_read_authenticated on public.communication_settings for select to authenticated
  using (public.school_actor_active());
create policy communication_settings_manage_leadership on public.communication_settings for all to authenticated
  using (public.school_is_leader()) with check (public.school_is_leader());

create policy consents_read_guardian_or_leadership on public.consents for select to authenticated
  using (public.school_is_leader() or public.school_is_guardian_of_student(student_id));
create policy consents_insert_leadership on public.consents for insert to authenticated
  with check (public.school_is_leader() and recorded_by = (select auth.uid()) and exists (
    select 1 from public.student_guardians sg
    join public.guardians g on g.id = sg.guardian_id
    where sg.student_id = consents.student_id and sg.guardian_id = consents.guardian_id
      and sg.active and g.active
  ));
create policy consents_manage_leadership on public.consents for update to authenticated
  using (public.school_is_leader()) with check (public.school_is_leader());
create policy consents_delete_leadership on public.consents for delete to authenticated
  using (public.school_is_leader());

create policy privacy_notices_read_published on public.privacy_notices for select to authenticated
  using (public.school_actor_active() and published_at is not null);
create policy privacy_notices_manage_leadership on public.privacy_notices for all to authenticated
  using (public.school_is_leader()) with check (public.school_is_leader() and approved_by = (select auth.uid()));

create policy privacy_requests_read_requester_or_leadership on public.privacy_requests for select to authenticated
  using (public.school_is_leader() or (public.school_actor_active() and requester_id = (select auth.uid())));
create policy privacy_requests_insert_family on public.privacy_requests for insert to authenticated
  with check (requester_id = (select auth.uid()) and public.school_is_guardian_of_student(student_id));
create policy privacy_requests_manage_leadership on public.privacy_requests for update to authenticated
  using (public.school_is_leader()) with check (public.school_is_leader());

create policy activity_progress_read_student on public.activity_progress for select to authenticated
  using (public.school_can_access_student(student_id));
create policy activity_progress_insert_authorized on public.activity_progress for insert to authenticated
  with check (public.school_can_access_student(student_id) and (
    public.school_is_guardian_of_student(student_id) or public.school_is_leader_or_teacher_for_student(student_id)
  ));
create policy activity_progress_update_authorized on public.activity_progress for update to authenticated
  using (public.school_can_access_student(student_id) and (
    public.school_is_guardian_of_student(student_id) or public.school_is_leader_or_teacher_for_student(student_id)
  ))
  with check (public.school_can_access_student(student_id) and (
    public.school_is_guardian_of_student(student_id) or public.school_is_leader_or_teacher_for_student(student_id)
  ));

-- Mantener al menos un superadmin activo para evitar dejar la escuela sin administración.
create function public.school_prevent_last_superadmin_removal()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.role = 'superadmin' and (tg_op = 'DELETE' or new.role <> 'superadmin' or new.user_id <> old.user_id)
     and not exists (
       select 1 from public.user_roles r
       join public.profiles p on p.id = r.user_id
       where r.role = 'superadmin' and r.user_id <> old.user_id and p.active = true
     ) then
    raise exception 'No se puede retirar al último superadmin activo';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.school_prevent_last_superadmin_removal() from public, anon, authenticated;
create trigger prevent_last_superadmin_removal
before delete or update of role, user_id on public.user_roles
for each row execute function public.school_prevent_last_superadmin_removal();

commit;
