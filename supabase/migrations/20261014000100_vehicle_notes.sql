-- Vehicle note history is separate from fleet vehicle JSON so firefighters cannot read it.
create table public.vehicle_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vehicle_id uuid not null,
  subject text not null check (char_length(trim(subject)) between 1 and 160),
  body text not null check (char_length(trim(body)) between 1 and 5000),
  created_by uuid not null default auth.uid(),
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (company_id, vehicle_id) references public.fleet_vehicles(company_id, record_id) on delete cascade
);

create index vehicle_notes_vehicle_history_idx
  on public.vehicle_notes(company_id, vehicle_id, created_at desc);

create trigger vehicle_notes_touch_updated_at
before update on public.vehicle_notes
for each row execute function public.touch_updated_at();

create or replace function public.attribute_vehicle_note()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare actor_name text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if tg_op = 'INSERT' then
    select full_name into actor_name from public.profiles where user_id = auth.uid();
    new.created_by := auth.uid();
    new.created_by_name := coalesce(nullif(trim(actor_name), ''), 'FireOps user');
  else
    new.company_id := old.company_id;
    new.vehicle_id := old.vehicle_id;
    new.created_by := old.created_by;
    new.created_by_name := old.created_by_name;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
revoke all on function public.attribute_vehicle_note() from public, anon, authenticated;
create trigger vehicle_notes_attribute
before insert or update on public.vehicle_notes
for each row execute function public.attribute_vehicle_note();

alter table public.vehicle_notes enable row level security;

create or replace function public.can_access_vehicle_notes(target_company_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_system_admin_company_access(target_company_id) or exists (
    select 1 from public.company_members
    where company_id = target_company_id
      and user_id = target_user_id
      and role in ('owner', 'admin', 'shop_tech')
  );
$$;
revoke all on function public.can_access_vehicle_notes(uuid, uuid) from public, anon;
grant execute on function public.can_access_vehicle_notes(uuid, uuid) to authenticated;

create policy "authorized users read vehicle notes" on public.vehicle_notes
for select to authenticated
using (public.can_access_vehicle_notes(company_id, auth.uid()));

create policy "authorized users create vehicle notes" on public.vehicle_notes
for insert to authenticated
with check (
  public.can_access_vehicle_notes(company_id, auth.uid())
  and created_by = auth.uid()
  and exists (
    select 1 from public.fleet_vehicles vehicle
    where vehicle.company_id = vehicle_notes.company_id and vehicle.record_id = vehicle_notes.vehicle_id
  )
);

create policy "authorized users update vehicle notes" on public.vehicle_notes
for update to authenticated
using (public.can_access_vehicle_notes(company_id, auth.uid()))
with check (public.can_access_vehicle_notes(company_id, auth.uid()));

create policy "authorized users delete vehicle notes" on public.vehicle_notes
for delete to authenticated
using (public.can_access_vehicle_notes(company_id, auth.uid()));

grant select, insert, update, delete on public.vehicle_notes to authenticated;
