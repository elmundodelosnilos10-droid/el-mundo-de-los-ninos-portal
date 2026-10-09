-- Horarios de comunicación: ajuste de Dirección y auditoría en una transacción.
-- Pendiente de aplicar en el proyecto Supabase de la escuela.
begin;

create function public.school_update_communication_settings(
  p_enabled boolean,
  p_weekdays integer[],
  p_start_time text,
  p_end_time text
)
returns public.communication_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.communication_settings;
begin
  if auth.uid() is null or not public.school_actor_active() or not public.school_is_leader() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_enabled is null or p_weekdays is null or cardinality(p_weekdays) > 7
    or (cardinality(p_weekdays) > 0 and array_ndims(p_weekdays) <> 1) then
    raise exception 'invalid_communication_settings' using errcode = '22023';
  end if;
  if array_position(p_weekdays, null) is not null
    or exists (select 1 from unnest(p_weekdays) day where day < 0 or day > 6)
    or (select count(distinct day) from unnest(p_weekdays) day) <> cardinality(p_weekdays)
    or p_start_time is null or p_end_time is null
    or p_start_time !~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$'
    or p_end_time !~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$'
    or (p_enabled and (cardinality(p_weekdays) = 0 or p_start_time >= p_end_time)) then
    raise exception 'invalid_communication_settings' using errcode = '22023';
  end if;

  insert into public.communication_settings (
    id, enabled, weekdays, start_time, end_time, updated_by, updated_at
  ) values (
    'school', p_enabled, coalesce(array_to_string(p_weekdays, ','), ''),
    p_start_time, p_end_time, auth.uid(), now()
  )
  on conflict (id) do update set
    enabled = excluded.enabled,
    weekdays = excluded.weekdays,
    start_time = excluded.start_time,
    end_time = excluded.end_time,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at
  returning * into result;

  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (gen_random_uuid(), auth.uid(), 'update_communication_hours', 'school_settings', 'school', now());
  return result;
end;
$$;

-- Impide guardar ajustes por fuera del RPC y omitir la auditoría.
revoke insert, update, delete on table public.communication_settings from authenticated;
revoke all on function public.school_update_communication_settings(boolean, integer[], text, text) from public, anon;
grant execute on function public.school_update_communication_settings(boolean, integer[], text, text) to authenticated;

-- La misma regla se aplica al RPC de mensajes; no basta con validarla en la UI.
-- Esta función interna acepta un instante para verificar los límites con fixtures.
create function public.school_communication_hours_open(p_instant timestamptz)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  settings public.communication_settings;
  days integer[];
  local_instant timestamp;
begin
  if p_instant is null then return false; end if;
  select * into settings from public.communication_settings where id = 'school';
  -- Mantiene la política existente: sin ajuste persistido no hay restricción.
  if not found then return true; end if;
  -- Un ajuste corrupto nunca abre el chat silenciosamente.
  if settings.enabled is null or settings.weekdays is null
    or settings.weekdays !~ '^([0-6](,[0-6])*)?$'
    or settings.start_time is null or settings.end_time is null
    or settings.start_time !~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$'
    or settings.end_time !~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' then
    return false;
  end if;
  days := case when settings.weekdays = '' then array[]::integer[]
    else string_to_array(settings.weekdays, ',')::integer[] end;
  if cardinality(days) > 7
    or (select count(distinct day) from unnest(days) day) <> cardinality(days) then
    return false;
  end if;
  if not settings.enabled then return true; end if;
  if cardinality(days) = 0 or settings.start_time >= settings.end_time then return false; end if;
  local_instant := p_instant at time zone 'America/Mexico_City';
  return extract(dow from local_instant)::integer = any(days)
    and local_instant::time >= settings.start_time::time
    and local_instant::time < settings.end_time::time;
end;
$$;

create function public.school_enforce_message_communication_hours()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  -- Permite importación histórica del dueño sin JWT; un participante que llama
  -- un RPC SECURITY DEFINER conserva auth.uid() y sí está sujeto a la regla.
  if auth.uid() is not null then
    if not public.school_actor_active()
      or not public.school_communication_hours_open(clock_timestamp()) then
      raise exception 'communication_hours_closed' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger school_message_communication_hours
before insert on public.messages
for each row execute function public.school_enforce_message_communication_hours();

revoke all on function public.school_communication_hours_open(timestamptz) from public, anon, authenticated;
revoke all on function public.school_enforce_message_communication_hours() from public, anon, authenticated;

commit;
