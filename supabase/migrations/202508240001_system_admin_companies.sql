create extension if not exists pgcrypto;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_email_lower_idx on public.profiles (lower(email)) where email <> '';

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  company_code text not null unique check (company_code ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'),
  industry text not null default '',
  owner_user_id uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.company_members (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

-- No client policy exposes this table. Add administrators only with SQL or a trusted backend.
create table public.system_admins (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id)
);

create table public.system_admin_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null references public.profiles(user_id),
  action text not null,
  company_id uuid references public.companies(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.handle_auth_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (user_id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (user_id) do update
    set email = excluded.email,
        full_name = case when excluded.full_name <> '' then excluded.full_name else public.profiles.full_name end,
        updated_at = now();
  return new;
end;
$$;

create trigger auth_user_profile_created
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function public.handle_auth_user();

insert into public.profiles (user_id, email, full_name)
select id, coalesce(email, ''), coalesce(raw_user_meta_data ->> 'full_name', '')
from auth.users
on conflict (user_id) do nothing;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();
create trigger companies_touch_updated_at before update on public.companies
for each row execute function public.touch_updated_at();

create or replace function public.is_company_member(target_company_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.company_members
    where company_id = target_company_id and user_id = target_user_id
  );
$$;

revoke all on function public.is_company_member(uuid, uuid) from public;
grant execute on function public.is_company_member(uuid, uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.system_admins enable row level security;
alter table public.system_admin_audit_log enable row level security;

create policy "users read own profile" on public.profiles
for select to authenticated using (user_id = auth.uid());
create policy "users update own profile" on public.profiles
for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;
-- Data API access must not depend on Supabase's default table privileges.
grant select on public.profiles, public.companies, public.company_members to authenticated;
grant select on public.profiles, public.companies, public.system_admins to service_role;
grant select, insert, delete on public.company_members to service_role;
create policy "members read company" on public.companies
for select to authenticated using (public.is_company_member(id, auth.uid()));
create policy "members read memberships" on public.company_members
for select to authenticated using (public.is_company_member(company_id, auth.uid()));

-- Called only by Edge Function with service-role client. Actor check remains in database.
create or replace function public.admin_upsert_company(
  actor_user_id uuid,
  target_company_id uuid,
  company_name text,
  code text,
  company_industry text,
  owner_id uuid
)
returns public.companies
language plpgsql
security definer set search_path = ''
as $$
declare
  result public.companies;
  normalized_code text := upper(trim(code));
begin
  if not exists (select 1 from public.system_admins where user_id = actor_user_id) then
    raise exception 'System administrator access required' using errcode = '42501';
  end if;

  if not exists (select 1 from public.profiles where user_id = owner_id) then
    raise exception 'Owner account not found' using errcode = '23503';
  end if;

  if target_company_id is null then
    insert into public.companies (name, company_code, industry, owner_user_id)
    values (trim(company_name), normalized_code, trim(company_industry), owner_id)
    returning * into result;
  else
    update public.company_members
      set role = 'member'
      where company_id = target_company_id and role = 'owner' and user_id <> owner_id;

    update public.companies
      set name = trim(company_name),
          company_code = normalized_code,
          industry = trim(company_industry),
          owner_user_id = owner_id
      where id = target_company_id
      returning * into result;

    if result.id is null then
      raise exception 'Company not found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.company_members (company_id, user_id, role)
  values (result.id, owner_id, 'owner')
  on conflict (company_id, user_id) do update set role = 'owner';

  insert into public.system_admin_audit_log (actor_user_id, action, company_id, details)
  values (
    actor_user_id,
    case when target_company_id is null then 'company.created' else 'company.updated' end,
    result.id,
    jsonb_build_object('name', result.name, 'company_code', result.company_code, 'owner_user_id', owner_id)
  );

  return result;
end;
$$;

revoke all on function public.admin_upsert_company(uuid, uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_upsert_company(uuid, uuid, text, text, text, uuid) to service_role;

revoke all on public.system_admins from anon, authenticated;
revoke all on public.system_admin_audit_log from anon, authenticated;
