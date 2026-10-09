-- NOT APPLIED: operator must obtain approval for this server access expansion.
-- Existing server service_role gains SELECT only on the exact backup catalog.
-- It bypasses RLS: keep the secret exclusively in trusted server/backup tooling.
-- No access is granted to browser roles; school routes must still use caller JWT.
begin;
grant select on table
  public.profiles,
  public.user_roles,
  public.school_years,
  public.groups,
  public.students,
  public.enrollments,
  public.teachers,
  public.teacher_groups,
  public.guardians,
  public.student_guardians,
  public.audit_log,
  public.files,
  public.materials,
  public.tasks,
  public.task_files,
  public.submissions,
  public.submission_files,
  public.calendar_events,
  public.class_sessions,
  public.attendance,
  public.attendance_justifications,
  public.observations,
  public.conversations,
  public.messages,
  public.announcements,
  public.announcement_reads,
  public.notifications,
  public.communication_settings,
  public.consents,
  public.privacy_notices,
  public.privacy_requests,
  public.activity_progress,
  public.school_account_invitation_provisions
to service_role;
commit;
