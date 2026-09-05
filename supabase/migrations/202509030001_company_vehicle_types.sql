create table public.company_vehicle_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index company_vehicle_types_name_idx
  on public.company_vehicle_types (company_id, lower(name));

create or replace function public.normalize_company_vehicle_type()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  if new.name = '' then
    raise exception 'Vehicle type name is required' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.normalize_company_vehicle_type() from public, anon, authenticated;

create trigger company_vehicle_types_normalize
before insert or update on public.company_vehicle_types
for each row execute function public.normalize_company_vehicle_type();

create or replace function public.add_default_company_vehicle_types()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.company_vehicle_types (company_id, name)
  select new.id, type_name
  from unnest(array[
    'Type 3 Engine',
    'Type 4 Engine',
    'Type 6 Engine',
    'Water Tender',
    'Crew Carrier',
    'Crew Transport',
    'Command Vehicle',
    'Dozer',
    'Transport',
    'Support Vehicle',
    'Other'
  ]) as type_name;
  return new;
end;
$$;
revoke all on function public.add_default_company_vehicle_types() from public, anon, authenticated;

create trigger companies_add_default_vehicle_types
after insert on public.companies
for each row execute function public.add_default_company_vehicle_types();

insert into public.company_vehicle_types (company_id, name)
select company.id, type_name
from public.companies company
cross join unnest(array[
  'Type 3 Engine',
  'Type 4 Engine',
  'Type 6 Engine',
  'Water Tender',
  'Crew Carrier',
  'Crew Transport',
  'Command Vehicle',
  'Dozer',
  'Transport',
  'Support Vehicle',
  'Other'
]) as type_name
on conflict do nothing;

-- Keep custom types already saved on vehicle records available after migration.
insert into public.company_vehicle_types (company_id, name)
select distinct vehicle.company_id, btrim(vehicle.data ->> 'type')
from public.fleet_vehicles vehicle
where nullif(btrim(vehicle.data ->> 'type'), '') is not null
on conflict do nothing;

create or replace function public.prevent_used_vehicle_type_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.fleet_vehicles vehicle
    where vehicle.company_id = old.company_id
      and lower(btrim(vehicle.data ->> 'type')) = lower(old.name)
  ) then
    raise exception 'Vehicle type is in use' using errcode = '23503';
  end if;
  return old;
end;
$$;
revoke all on function public.prevent_used_vehicle_type_delete() from public, anon, authenticated;

create trigger company_vehicle_types_prevent_used_delete
before delete on public.company_vehicle_types
for each row execute function public.prevent_used_vehicle_type_delete();

alter table public.company_vehicle_types enable row level security;

create policy "members read vehicle types" on public.company_vehicle_types
for select to authenticated
using (
  public.is_company_member(company_id, auth.uid())
  or public.has_system_admin_company_access(company_id)
);

create policy "owners insert vehicle types" on public.company_vehicle_types
for insert to authenticated
with check (public.is_company_owner(company_id, auth.uid()));

create policy "owners update vehicle types" on public.company_vehicle_types
for update to authenticated
using (public.is_company_owner(company_id, auth.uid()))
with check (public.is_company_owner(company_id, auth.uid()));

create policy "owners delete vehicle types" on public.company_vehicle_types
for delete to authenticated
using (public.is_company_owner(company_id, auth.uid()));

revoke all on public.company_vehicle_types from anon;
grant select, insert, update, delete on public.company_vehicle_types to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'company_vehicle_types'
  ) then
    alter publication supabase_realtime add table public.company_vehicle_types;
  end if;
end $$;
