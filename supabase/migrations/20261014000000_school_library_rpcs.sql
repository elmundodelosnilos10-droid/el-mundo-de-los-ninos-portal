-- Biblioteca escolar: lecturas y cambios de archivos privados con permisos
-- de grupo, almacenamiento en Supabase y auditoría atómica.
begin;

create function public.school_list_materials(
  p_limit integer default 250,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_total integer;
  v_items jsonb;
begin
  if v_actor is null or not public.school_actor_active()
    or not public.school_has_role(array['superadmin', 'direccion', 'docente', 'tutor']::text[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 250 or p_offset is null or p_offset < 0 or p_offset > 100000 then
    raise exception 'invalid_page' using errcode = '22023';
  end if;

  select pg_catalog.count(*)::integer into v_total
  from public.materials m
  join public.files f on f.id = m.file_id and f.deleted_at is null and f.purpose = 'material'
  join public.groups g on g.id = m.group_id and g.active = true
  where public.school_can_access_group(m.group_id);

  select coalesce(pg_catalog.jsonb_agg(page.item order by page.published_at, page.material_id), '[]'::jsonb)
  into v_items
  from (
    select m.id as material_id, m.published_at,
      pg_catalog.jsonb_build_object(
        'id', m.id,
        'fileId', f.id,
        'groupId', m.group_id,
        'groupName', g.name,
        'title', m.title,
        'category', m.category,
        'publishedAt', m.published_at,
        'fileName', f.original_name,
        'mimeType', f.mime_type,
        'sizeBytes', f.size_bytes
      ) as item
    from public.materials m
    join public.files f on f.id = m.file_id and f.deleted_at is null and f.purpose = 'material'
    join public.groups g on g.id = m.group_id and g.active = true
    where public.school_can_access_group(m.group_id)
    order by m.published_at, m.id
    limit p_limit offset p_offset
  ) page;

  return pg_catalog.jsonb_build_object('items', coalesce(v_items, '[]'::jsonb), 'total', v_total);
end;
$$;

create function public.school_publish_material_file(
  p_material_id uuid,
  p_file_id uuid,
  p_object_key text,
  p_original_name text,
  p_mime_type text,
  p_size_bytes integer,
  p_group_id uuid,
  p_title text,
  p_category text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := pg_catalog.now();
  v_title text;
  v_category text;
begin
  if v_actor is null or not public.school_actor_active()
    or not public.school_has_role(array['superadmin', 'direccion', 'docente']::text[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_material_id is null or p_file_id is null or p_group_id is null or p_object_key is null
    or p_original_name is null or p_mime_type is null or p_size_bytes is null
    or p_title is null or p_category is null
    or pg_catalog.char_length(pg_catalog.btrim(p_original_name)) not between 1 and 160
    or pg_catalog.char_length(pg_catalog.btrim(p_title)) not between 2 and 120
    or pg_catalog.char_length(pg_catalog.btrim(p_category)) not between 2 and 60
    or p_size_bytes < 1 or p_size_bytes > 26214400
    or p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'audio/mpeg', 'audio/ogg', 'audio/wav')
    or p_object_key !~ '^supabase:private/material/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89a-fA-F][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
    raise exception 'invalid_material' using errcode = '22023';
  end if;
  if not public.school_is_leader_or_teacher(p_group_id)
    or not exists (
      select 1 from public.groups g
      join public.school_years y on y.id = g.year_id and y.active = true
      where g.id = p_group_id and g.active = true
    ) then
    raise exception 'group_not_available' using errcode = 'P0002';
  end if;

  v_title := pg_catalog.btrim(p_title);
  v_category := pg_catalog.btrim(p_category);
  insert into public.files (id, object_key, original_name, mime_type, size_bytes, purpose, uploaded_by, group_id, student_id, created_at, deleted_at)
  values (p_file_id, p_object_key, pg_catalog.btrim(p_original_name), p_mime_type, p_size_bytes, 'material', v_actor, p_group_id, null, v_now, null);
  insert into public.materials (id, file_id, group_id, title, category, published_by, published_at)
  values (p_material_id, p_file_id, p_group_id, v_title, v_category, v_actor, v_now);
  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (pg_catalog.gen_random_uuid(), v_actor, 'upload_material', 'file', p_file_id::text, v_now);

  return pg_catalog.jsonb_build_object('published', true, 'id', p_material_id, 'fileId', p_file_id);
end;
$$;

create function public.school_replace_material_file(
  p_material_id uuid,
  p_object_key text,
  p_original_name text,
  p_mime_type text,
  p_size_bytes integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := pg_catalog.now();
  v_group_id uuid;
  v_file_id uuid;
  v_old_object_key text;
begin
  if v_actor is null or not public.school_actor_active()
    or not public.school_has_role(array['superadmin', 'direccion', 'docente']::text[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_material_id is null or p_object_key is null or p_original_name is null or p_mime_type is null or p_size_bytes is null
    or pg_catalog.char_length(pg_catalog.btrim(p_original_name)) not between 1 and 160
    or p_size_bytes < 1 or p_size_bytes > 26214400
    or p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'audio/mpeg', 'audio/ogg', 'audio/wav')
    or p_object_key !~ '^supabase:private/material/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89a-fA-F][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
    raise exception 'invalid_material_file' using errcode = '22023';
  end if;

  select m.group_id, f.id, f.object_key into v_group_id, v_file_id, v_old_object_key
  from public.materials m
  join public.files f on f.id = m.file_id and f.deleted_at is null and f.purpose = 'material'
  where m.id = p_material_id
  for update of f;
  if v_file_id is null then
    raise exception 'material_not_available' using errcode = 'P0002';
  end if;
  if not public.school_is_leader_or_teacher(v_group_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.files set
    object_key = p_object_key,
    original_name = pg_catalog.btrim(p_original_name),
    mime_type = p_mime_type,
    size_bytes = p_size_bytes,
    uploaded_by = v_actor,
    created_at = v_now
  where id = v_file_id;
  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (pg_catalog.gen_random_uuid(), v_actor, 'replace_material_file', 'file', v_file_id::text, v_now);

  return pg_catalog.jsonb_build_object('replaced', true, 'fileId', v_file_id, 'oldObjectKey', v_old_object_key);
end;
$$;

create function public.school_remove_material(p_material_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := pg_catalog.now();
  v_group_id uuid;
  v_file_id uuid;
  v_object_key text;
begin
  if v_actor is null or not public.school_actor_active()
    or not public.school_has_role(array['superadmin', 'direccion', 'docente']::text[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_material_id is null then
    raise exception 'invalid_material' using errcode = '22023';
  end if;
  select m.group_id, f.id, f.object_key into v_group_id, v_file_id, v_object_key
  from public.materials m
  join public.files f on f.id = m.file_id and f.deleted_at is null and f.purpose = 'material'
  where m.id = p_material_id
  for update of f;
  if v_file_id is null then
    raise exception 'material_not_available' using errcode = 'P0002';
  end if;
  if not public.school_is_leader_or_teacher(v_group_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.files set deleted_at = v_now where id = v_file_id;
  delete from public.materials where id = p_material_id;
  insert into public.audit_log (id, actor_id, action, entity_type, entity_id, created_at)
  values (pg_catalog.gen_random_uuid(), v_actor, 'delete_material', 'file', v_file_id::text, v_now);

  return pg_catalog.jsonb_build_object('removed', true, 'fileId', v_file_id, 'objectKey', v_object_key);
end;
$$;

-- Las escrituras deben pasar por RPC para mantener actor, auditoría y archivo alineados.
revoke insert, update, delete on table public.materials from authenticated;

revoke all on function public.school_list_materials(integer, integer) from public, anon, authenticated;
revoke all on function public.school_publish_material_file(uuid, uuid, text, text, text, integer, uuid, text, text) from public, anon, authenticated;
revoke all on function public.school_replace_material_file(uuid, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.school_remove_material(uuid) from public, anon, authenticated;

grant execute on function public.school_list_materials(integer, integer) to authenticated;
grant execute on function public.school_publish_material_file(uuid, uuid, text, text, text, integer, uuid, text, text) to authenticated;
grant execute on function public.school_replace_material_file(uuid, text, text, text, integer) to authenticated;
grant execute on function public.school_remove_material(uuid) to authenticated;

commit;
