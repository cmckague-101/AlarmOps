-- Company-owned editable vehicle inspection checklist.
create table public.company_vehicle_inspection_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  label text not null check (char_length(trim(label)) between 1 and 300),
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, position)
);

create trigger company_vehicle_inspection_items_touch_updated_at before update on public.company_vehicle_inspection_items
for each row execute function public.touch_updated_at();

alter table public.company_vehicle_inspection_items enable row level security;
create policy "members read vehicle inspection template" on public.company_vehicle_inspection_items for select to authenticated
using (public.is_company_member(company_id, auth.uid()) or public.is_system_admin());
create policy "owners add vehicle inspection template items" on public.company_vehicle_inspection_items for insert to authenticated
with check (public.is_company_owner(company_id, auth.uid()));
create policy "owners update vehicle inspection template items" on public.company_vehicle_inspection_items for update to authenticated
using (public.is_company_owner(company_id, auth.uid())) with check (public.is_company_owner(company_id, auth.uid()));
create policy "owners delete vehicle inspection template items" on public.company_vehicle_inspection_items for delete to authenticated
using (public.is_company_owner(company_id, auth.uid()));
grant select, insert, update, delete on public.company_vehicle_inspection_items to authenticated;

create or replace function public.seed_vehicle_inspection_template(target_company_id uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.company_vehicle_inspection_items (company_id, label, position)
  select target_company_id, item.label, item.ordinality::integer - 1
  from unnest(array[
    'Brakes, steering, horn, lights, mirrors',
    'Tires, wheels, lug nuts, suspension',
    'Leaks, belts, hoses, oil, coolant',
    'Pump operation, primer, gauges, plumbing',
    'Tank, foam system, hose reels, drafting equipment',
    'Hose, fittings, nozzles, tools, chainsaws',
    'Radios, chargers, mobile data, GPS',
    'Cab, compartments, undercarriage, biohazards',
    'Damage photos, missing equipment, fuel and DEF'
  ]) with ordinality as item(label, ordinality)
  where not exists (select 1 from public.company_vehicle_inspection_items existing where existing.company_id = target_company_id);
$$;
revoke all on function public.seed_vehicle_inspection_template(uuid) from public, anon, authenticated;

insert into public.company_vehicle_inspection_items (company_id, label, position)
select company.id, item.label, item.ordinality::integer - 1
from public.companies company
cross join unnest(array[
  'Brakes, steering, horn, lights, mirrors',
  'Tires, wheels, lug nuts, suspension',
  'Leaks, belts, hoses, oil, coolant',
  'Pump operation, primer, gauges, plumbing',
  'Tank, foam system, hose reels, drafting equipment',
  'Hose, fittings, nozzles, tools, chainsaws',
  'Radios, chargers, mobile data, GPS',
  'Cab, compartments, undercarriage, biohazards',
  'Damage photos, missing equipment, fuel and DEF'
]) with ordinality as item(label, ordinality)
where not exists (select 1 from public.company_vehicle_inspection_items existing where existing.company_id = company.id);

create or replace function public.seed_new_company_vehicle_inspection_template()
returns trigger language plpgsql security definer set search_path = '' as $$
begin perform public.seed_vehicle_inspection_template(new.id); return new; end;
$$;
revoke all on function public.seed_new_company_vehicle_inspection_template() from public, anon, authenticated;
create trigger companies_seed_vehicle_inspection_template after insert on public.companies
for each row execute function public.seed_new_company_vehicle_inspection_template();

alter publication supabase_realtime add table public.company_vehicle_inspection_items;
