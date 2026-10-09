-- Esquema inicial de Supabase para El Mundo de los Niños.
-- Revisión/aplicación pendiente en el proyecto Supabase de la escuela.
-- Supabase Auth administra identidades y sesiones; esta migración solo crea
-- perfiles y datos escolares. No incluye usuarios ni datos de demostración.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null unique,
  email_verified boolean not null default false,
  active boolean not null default true,
  image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Mantiene public.profiles como equivalente escolar de la tabla `user` del
-- esquema D1: Supabase Auth es la identidad y este perfil contiene sus campos
-- visibles y de estado. Los usuarios que solo tengan teléfono no se usan en
-- este portal, que requiere correo para iniciar sesión.
create function public.sync_profile_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null then
    return new;
  end if;

  insert into public.profiles (
    id, name, email, email_verified, active, image, created_at, updated_at
  ) values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1)),
    new.email,
    new.email_confirmed_at is not null,
    true,
    new.raw_user_meta_data ->> 'image',
    new.created_at,
    new.updated_at
  )
  on conflict (id) do update set
    name = coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1)),
    email = excluded.email,
    email_verified = excluded.email_verified,
    image = excluded.image,
    updated_at = excluded.updated_at;

  return new;
end;
$$;

revoke all on function public.sync_profile_from_auth_user() from public, anon, authenticated;

create trigger sync_profile_after_auth_user_change
after insert or update on auth.users
for each row execute function public.sync_profile_from_auth_user();

-- También cubre usuarios Auth que ya existían antes de aplicar la migración.
insert into public.profiles (
  id, name, email, email_verified, active, image, created_at, updated_at
)
select
  id,
  coalesce(nullif(raw_user_meta_data ->> 'name', ''), split_part(email, '@', 1)),
  email,
  email_confirmed_at is not null,
  true,
  raw_user_meta_data ->> 'image',
  created_at,
  updated_at
from auth.users
where email is not null
on conflict (id) do nothing;

create table public.user_roles (
  user_id uuid not null references public.profiles(id),
  role text not null check (role in ('superadmin', 'direccion', 'docente', 'tutor', 'alumno')),
  assigned_by uuid references public.profiles(id),
  assigned_at timestamptz not null default now(),
  primary key (user_id, role)
);
create index user_roles_role_idx on public.user_roles(role);

create table public.school_years (
  id uuid primary key,
  name text not null unique,
  starts_on text not null,
  ends_on text not null,
  active boolean not null default false,
  check (ends_on >= starts_on)
);

create table public.groups (
  id uuid primary key,
  year_id uuid not null references public.school_years(id),
  name text not null,
  stage text not null check (stage in ('lactantes', 'maternal', 'prekinder', 'preescolar')),
  active boolean not null default true,
  unique (year_id, name)
);

create table public.students (
  id uuid primary key,
  given_name text not null,
  family_name text not null,
  birth_date text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index students_name_idx on public.students(family_name, given_name);

create table public.enrollments (
  id uuid primary key,
  student_id uuid not null references public.students(id),
  group_id uuid not null references public.groups(id),
  enrolled_at timestamptz not null,
  ended_at timestamptz
);
create unique index enrollments_student_group_active_idx on public.enrollments(student_id, group_id) where ended_at is null;
create index enrollments_group_idx on public.enrollments(group_id);

create table public.teachers (
  id uuid primary key,
  user_id uuid not null unique references public.profiles(id),
  active boolean not null default true
);
create table public.teacher_groups (
  teacher_id uuid not null references public.teachers(id),
  group_id uuid not null references public.groups(id),
  primary key (teacher_id, group_id)
);
create index teacher_groups_group_idx on public.teacher_groups(group_id);

create table public.guardians (
  id uuid primary key,
  user_id uuid not null unique references public.profiles(id),
  active boolean not null default true
);
create table public.student_guardians (
  student_id uuid not null references public.students(id),
  guardian_id uuid not null references public.guardians(id),
  relationship text not null,
  may_collect boolean not null default false,
  active boolean not null default true,
  primary key (student_id, guardian_id)
);
create index student_guardians_guardian_idx on public.student_guardians(guardian_id);

create table public.audit_log (
  id uuid primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  created_at timestamptz not null
);
create index audit_entity_idx on public.audit_log(entity_type, entity_id);
create index audit_created_idx on public.audit_log(created_at);

create table public.files (
  id uuid primary key,
  object_key text not null unique,
  original_name text not null,
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  purpose text not null check (purpose in ('material', 'submission', 'message', 'recording')),
  uploaded_by uuid not null references public.profiles(id),
  group_id uuid references public.groups(id),
  student_id uuid references public.students(id),
  created_at timestamptz not null,
  deleted_at timestamptz
);
create index files_group_idx on public.files(group_id);
create index files_student_idx on public.files(student_id);

create table public.materials (
  id uuid primary key,
  file_id uuid not null references public.files(id),
  group_id uuid not null references public.groups(id),
  title text not null,
  category text not null,
  published_by uuid not null references public.profiles(id),
  published_at timestamptz not null
);
create index materials_group_idx on public.materials(group_id, published_at);

create table public.tasks (
  id uuid primary key,
  group_id uuid not null references public.groups(id),
  title text not null,
  instructions text not null,
  due_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null,
  archived_at timestamptz
);
create index tasks_group_due_idx on public.tasks(group_id, due_at);
create table public.task_files (
  task_id uuid not null references public.tasks(id),
  file_id uuid not null references public.files(id),
  primary key (task_id, file_id)
);

create table public.submissions (
  id uuid primary key,
  task_id uuid not null references public.tasks(id),
  student_id uuid not null references public.students(id),
  submitted_by uuid not null references public.profiles(id),
  status text not null check (status in ('entregada', 'revisada', 'completada')),
  note text,
  evaluation text check (evaluation in ('logrado', 'en_proceso', 'con_acompanamiento')),
  reviewed_by uuid references public.profiles(id),
  review_note text,
  submitted_at timestamptz not null,
  reviewed_at timestamptz,
  unique (task_id, student_id)
);
create table public.submission_files (
  submission_id uuid not null references public.submissions(id),
  file_id uuid not null references public.files(id),
  primary key (submission_id, file_id)
);

create table public.calendar_events (
  id uuid primary key,
  group_id uuid references public.groups(id),
  kind text not null,
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_by uuid not null references public.profiles(id),
  check (ends_at is null or ends_at >= starts_at)
);
create index events_start_idx on public.calendar_events(starts_at);
create index events_group_idx on public.calendar_events(group_id);

create table public.class_sessions (
  id uuid primary key,
  event_id uuid not null unique references public.calendar_events(id),
  group_id uuid not null references public.groups(id),
  teacher_id uuid not null references public.teachers(id),
  meet_url text,
  recording_allowed boolean not null default false,
  recording_file_id uuid references public.files(id)
);
create index class_sessions_group_idx on public.class_sessions(group_id);

create table public.attendance (
  id uuid primary key,
  student_id uuid not null references public.students(id),
  group_id uuid not null references public.groups(id),
  on_date text not null,
  status text not null check (status in ('presente', 'ausente', 'retardo', 'justificada')),
  note text,
  recorded_by uuid not null references public.profiles(id),
  modified_by uuid references public.profiles(id),
  modified_at timestamptz,
  unique (student_id, on_date)
);
create index attendance_group_date_idx on public.attendance(group_id, on_date);

create table public.attendance_justifications (
  id uuid primary key,
  student_id uuid not null references public.students(id),
  group_id uuid not null references public.groups(id),
  on_date text not null,
  submitted_by uuid not null references public.profiles(id),
  reason text not null,
  status text not null default 'pendiente' check (status in ('pendiente', 'aceptada', 'rechazada')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null,
  unique (student_id, on_date)
);
create index attendance_justifications_group_date_idx on public.attendance_justifications(group_id, on_date);

create table public.observations (
  id uuid primary key,
  student_id uuid not null references public.students(id),
  category text not null,
  body text not null,
  visible_to_family boolean not null default false,
  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null
);
create index observations_student_idx on public.observations(student_id, recorded_at);

create table public.conversations (
  id uuid primary key,
  student_id uuid not null references public.students(id),
  teacher_id uuid not null references public.teachers(id),
  guardian_id uuid not null references public.guardians(id),
  created_at timestamptz not null,
  unique (student_id, teacher_id, guardian_id)
);
create table public.messages (
  id uuid primary key,
  conversation_id uuid not null references public.conversations(id),
  author_id uuid not null references public.profiles(id),
  body text not null,
  file_id uuid references public.files(id),
  sent_at timestamptz not null,
  read_at timestamptz
);
create index messages_conversation_idx on public.messages(conversation_id, sent_at);

create table public.announcements (
  id uuid primary key,
  group_id uuid references public.groups(id),
  title text not null,
  body text not null,
  important boolean not null default false,
  published_by uuid not null references public.profiles(id),
  published_at timestamptz not null
);
create index announcements_group_idx on public.announcements(group_id, published_at);
create table public.announcement_reads (
  announcement_id uuid not null references public.announcements(id),
  user_id uuid not null references public.profiles(id),
  read_at timestamptz not null,
  primary key (announcement_id, user_id)
);

create table public.notifications (
  id uuid primary key,
  user_id uuid not null references public.profiles(id),
  kind text not null,
  title text not null,
  href text,
  dedupe_key text not null unique,
  created_at timestamptz not null,
  read_at timestamptz
);
create index notifications_user_idx on public.notifications(user_id, created_at);

create table public.communication_settings (
  id text primary key,
  enabled boolean not null default false,
  weekdays text not null default '1,2,3,4,5',
  start_time text not null default '08:00',
  end_time text not null default '17:00',
  updated_by uuid references public.profiles(id),
  updated_at timestamptz
);

create table public.consents (
  id uuid primary key,
  student_id uuid not null references public.students(id),
  guardian_id uuid not null references public.guardians(id),
  purpose text not null,
  granted boolean not null,
  recorded_at timestamptz not null,
  expires_at timestamptz,
  notice_version text,
  evidence_reference text,
  recorded_by uuid references public.profiles(id)
);

create table public.privacy_notices (
  id uuid primary key,
  version text not null unique,
  responsible_name text not null,
  address text not null,
  contact_name text not null,
  contact_email text not null,
  personal_data_categories text not null,
  sensitive_data_categories text not null,
  purposes text not null,
  consent_purposes text not null,
  limitation_means text not null,
  arco_procedure text not null,
  notice_changes text not null,
  processors_and_transfers text not null,
  effective_date text not null,
  approved_by uuid not null references public.profiles(id),
  approved_at timestamptz not null,
  published_at timestamptz not null
);
create index privacy_notice_published_idx on public.privacy_notices(published_at);

create table public.privacy_requests (
  id uuid primary key,
  student_id uuid not null references public.students(id),
  requester_id uuid not null references public.profiles(id),
  kind text not null,
  details text not null,
  status text not null default 'recibida',
  open_key text unique,
  response_note text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  responded_at timestamptz,
  resolved_by uuid references public.profiles(id)
);
create index privacy_request_student_idx on public.privacy_requests(student_id, created_at);
create index privacy_request_requester_idx on public.privacy_requests(requester_id, created_at);

create table public.activity_progress (
  id uuid primary key,
  student_id uuid not null references public.students(id) on delete cascade,
  activity_id text not null,
  completed_at timestamptz not null,
  artwork_json text,
  updated_at timestamptz not null,
  unique (student_id, activity_id)
);
create index activity_progress_student_idx on public.activity_progress(student_id, completed_at);

-- Ninguna tabla escolar queda expuesta directamente al navegador. No hay
-- políticas para anon/authenticated todavía; el servidor usa credenciales
-- secretas y valida rol/pertenencia antes de operar.
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
  end loop;
end $$;
