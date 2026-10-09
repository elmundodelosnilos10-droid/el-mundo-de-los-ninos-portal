-- El portal es de acceso por invitación. La identidad de Auth no debe crear
-- por sí sola un perfil escolar activo ni habilitar altas públicas.
alter table public.profiles alter column active set default false;

create or replace function public.sync_profile_from_auth_user()
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
    false,
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

-- Una cuenta sin un rol escolar explícito no debe entrar al área protegida.
update public.profiles p
set active = false
where not exists (
  select 1 from public.user_roles r where r.user_id = p.id
);
