-- System administrators may enter any company workspace for support.
-- Access starts through an audited RPC; RLS then permits troubleshooting operations.
create table if not exists public.system_admins (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id)
);

create table if not exists public.system_admin_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null references public.profiles(user_id),
  action text not null,
  company_id uuid references public.companies(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.system_admins enable row level security;
alter table public.system_admin_audit_log enable row level security;
revoke all on public.system_admins from anon, authenticated;
-- This table is recreated after the original admin tables are dropped.
grant select on public.system_admins to service_role;
revoke all on public.system_admin_audit_log from anon, authenticated;

create or replace function public.is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.system_admins where user_id = auth.uid()
  );
$$;

revoke all on function public.is_system_admin() from public, anon;
grant execute on function public.is_system_admin() to authenticated;

create or replace function public.admin_access_company(target_company_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_system_admin() then
    raise exception 'System administrator access required' using errcode = '42501';
  end if;

  if not exists (select 1 from public.companies where id = target_company_id) then
    raise exception 'Company not found' using errcode = 'P0002';
  end if;

  insert into public.system_admin_audit_log (actor_user_id, action, company_id)
  values (auth.uid(), 'company.accessed', target_company_id);
  return true;
end;
$$;

revoke all on function public.admin_access_company(uuid) from public, anon;
grant execute on function public.admin_access_company(uuid) to authenticated;

create policy "admins read all companies" on public.companies
for select to authenticated using (public.is_system_admin());

create policy "admins read all fleet state" on public.fleet_state
for select to authenticated using (public.is_system_admin());
create policy "admins create fleet state" on public.fleet_state
for insert to authenticated with check (
  public.is_system_admin() and updated_by = auth.uid()
);
create policy "admins update fleet state" on public.fleet_state
for update to authenticated
using (public.is_system_admin())
with check (public.is_system_admin() and updated_by = auth.uid());

create policy "admins read fleet files" on storage.objects
for select to authenticated using (
  bucket_id = 'fleet-files' and public.is_system_admin()
);
create policy "admins upload fleet files" on storage.objects
for insert to authenticated with check (
  bucket_id = 'fleet-files'
  and public.is_system_admin()
  and (storage.foldername(name))[2] = auth.uid()::text
);
create policy "admins delete own fleet files" on storage.objects
for delete to authenticated using (
  bucket_id = 'fleet-files'
  and public.is_system_admin()
  and (storage.foldername(name))[2] = auth.uid()::text
);

create or replace function public.enforce_owner_vehicle_changes()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  vehicles_changed boolean;
begin
  if actor_id is null then
    return new;
  end if;

  vehicles_changed := case
    when tg_op = 'INSERT' then coalesce(new.data -> 'vehicles', '[]'::jsonb) <> '[]'::jsonb
    else coalesce(new.data -> 'vehicles', '[]'::jsonb)
      is distinct from coalesce(old.data -> 'vehicles', '[]'::jsonb)
  end;

  if vehicles_changed
    and not public.is_system_admin()
    and not exists (
      select 1
      from public.company_members
      where company_id = new.company_id
        and user_id = actor_id
        and role = 'owner'
    )
  then
    raise exception 'Only company owners may change vehicle details'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_owner_vehicle_changes() from public, anon, authenticated;
