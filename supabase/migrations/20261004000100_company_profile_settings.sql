alter table public.companies
  add column if not exists phone text not null default '',
  add column if not exists location text not null default '',
  add column if not exists logo_path text;

alter table public.companies
  drop constraint if exists companies_phone_length,
  add constraint companies_phone_length check (char_length(phone) <= 40),
  drop constraint if exists companies_location_length,
  add constraint companies_location_length check (char_length(location) <= 160),
  drop constraint if exists companies_logo_path_length,
  add constraint companies_logo_path_length check (logo_path is null or char_length(logo_path) <= 500);

create or replace function public.update_company_profile(
  target_company_id uuid,
  company_name text,
  company_phone text,
  company_location text,
  company_logo_path text
)
returns public.companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.companies;
  normalized_name text := trim(company_name);
  normalized_phone text := trim(company_phone);
  normalized_location text := trim(company_location);
  normalized_logo_path text := nullif(trim(company_logo_path), '');
  actor_is_owner boolean;
  actor_has_admin_access boolean;
begin
  select exists (
    select 1 from public.company_members
    where company_id = target_company_id
      and user_id = auth.uid()
      and role = 'owner'
  ) into actor_is_owner;

  select public.has_system_admin_company_access(target_company_id)
  into actor_has_admin_access;

  if not actor_is_owner and not actor_has_admin_access then
    raise exception 'Company owner access required' using errcode = '42501';
  end if;

  if char_length(normalized_name) not between 2 and 120 then
    raise exception 'Company name must be between 2 and 120 characters' using errcode = '22023';
  end if;
  if char_length(normalized_phone) > 40 then
    raise exception 'Phone number must be 40 characters or fewer' using errcode = '22023';
  end if;
  if char_length(normalized_location) > 160 then
    raise exception 'Location must be 160 characters or fewer' using errcode = '22023';
  end if;
  if normalized_logo_path is not null and normalized_logo_path !~
    ('^' || target_company_id::text || '/[0-9a-f-]+/[^/]+$') then
    raise exception 'Company logo path is invalid' using errcode = '22023';
  end if;

  update public.companies
  set name = normalized_name,
      phone = normalized_phone,
      location = normalized_location,
      logo_path = normalized_logo_path
  where id = target_company_id
  returning * into result;

  if result.id is null then
    raise exception 'Company not found' using errcode = 'P0002';
  end if;

  return result;
end;
$$;

revoke all on function public.update_company_profile(uuid, text, text, text, text) from public;
grant execute on function public.update_company_profile(uuid, text, text, text, text) to authenticated;
