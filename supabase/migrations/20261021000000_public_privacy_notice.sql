-- Only the school's approved legal notice is public; no school records or
-- approval-account identifiers are exposed. The underlying table stays private.
begin;
create function public.school_public_privacy_notice(p_version integer default 1)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_notice jsonb;
begin
  if p_version is distinct from 1 then
    raise exception 'invalid_version' using errcode = '22023';
  end if;
  select pg_catalog.jsonb_build_object(
    'version',n.version,'responsibleName',n.responsible_name,'address',n.address,
    'contactName',n.contact_name,'contactEmail',n.contact_email,
    'personalDataCategories',n.personal_data_categories,'sensitiveDataCategories',n.sensitive_data_categories,
    'purposes',n.purposes,'consentPurposes',n.consent_purposes,'limitationMeans',n.limitation_means,
    'arcoProcedure',n.arco_procedure,'noticeChanges',n.notice_changes,
    'processorsAndTransfers',n.processors_and_transfers,'effectiveDate',n.effective_date
  ) into v_notice from public.privacy_notices n
  where n.approved_at <= pg_catalog.now() and n.published_at <= pg_catalog.now()
    and n.effective_date <= (pg_catalog.now() at time zone 'America/Mexico_City')::date::text
  order by n.published_at desc,n.id desc limit 1;
  return pg_catalog.jsonb_build_object('notice',v_notice);
end;
$$;
revoke all on function public.school_public_privacy_notice(integer) from public;
grant execute on function public.school_public_privacy_notice(integer) to anon,authenticated;
notify pgrst, 'reload schema';
commit;
