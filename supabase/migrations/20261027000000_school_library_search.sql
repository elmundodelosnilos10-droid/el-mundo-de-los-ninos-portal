-- Private library search, facets and pagination; caller JWT and table RLS apply.
-- Existing publishing/removal RPCs and permissions remain unchanged.
begin;
create function public.school_search_materials(
  p_query text, p_group_id uuid, p_category text, p_limit integer, p_offset integer
)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_query text := btrim(coalesce(p_query, ''));
  v_category text := nullif(btrim(p_category), '');
  v_total integer;
  v_items jsonb;
  v_categories jsonb;
begin
  if auth.uid() is null or not public.school_actor_active() or
    not public.school_has_role(array['superadmin','direccion','docente','tutor']::text[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if char_length(v_query)>100 or char_length(coalesce(v_category,''))>60 or
    p_limit is null or p_limit not between 1 and 50 or p_offset is null or p_offset not between 0 and 100000 then
    raise exception 'invalid_library_query' using errcode = '22023';
  end if;
  if p_group_id is not null and not public.school_can_access_group(p_group_id) then
    raise exception 'group_unavailable' using errcode = 'P0002';
  end if;
  select count(*)::integer into v_total
  from public.materials m
  join public.files f on f.id=m.file_id and f.deleted_at is null and f.purpose='material'
  join public.groups g on g.id=m.group_id and g.active
  where public.school_can_access_group(m.group_id)
    and (p_group_id is null or m.group_id=p_group_id)
    and (v_category is null or m.category=v_category)
    and (v_query='' or strpos(lower(m.title),lower(v_query))>0 or strpos(lower(f.original_name),lower(v_query))>0);

  select coalesce(jsonb_agg(page.item order by page.published_at desc,page.id desc),'[]'::jsonb) into v_items
  from (
    select m.id,m.published_at,jsonb_build_object(
      'id',m.id,'fileId',f.id,'groupId',m.group_id,'groupName',g.name,'title',m.title,'category',m.category,
      'publishedAt',m.published_at,'fileName',f.original_name,'mimeType',f.mime_type,'sizeBytes',f.size_bytes
    ) as item
    from public.materials m
    join public.files f on f.id=m.file_id and f.deleted_at is null and f.purpose='material'
    join public.groups g on g.id=m.group_id and g.active
    where public.school_can_access_group(m.group_id)
      and (p_group_id is null or m.group_id=p_group_id)
      and (v_category is null or m.category=v_category)
      and (v_query='' or strpos(lower(m.title),lower(v_query))>0 or strpos(lower(f.original_name),lower(v_query))>0)
    order by m.published_at desc,m.id desc limit p_limit offset p_offset
  ) page;

  -- Facets use only accessible resources in the selected group; they do not
  -- depend on the current page, text query or selected category.
  select coalesce(jsonb_agg(facets.category order by facets.category),'[]'::jsonb) into v_categories
  from (
    select distinct m.category
    from public.materials m
    join public.files f on f.id=m.file_id and f.deleted_at is null and f.purpose='material'
    join public.groups g on g.id=m.group_id and g.active
    where public.school_can_access_group(m.group_id) and (p_group_id is null or m.group_id=p_group_id)
  ) facets;
  return jsonb_build_object('items',v_items,'total',v_total,'categories',v_categories);
end;
$$;
revoke all on function public.school_search_materials(text,uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.school_search_materials(text,uuid,text,integer,integer) to authenticated;
commit;
