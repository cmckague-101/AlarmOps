-- Replace vehicle inspection templates with required operational checklist.
alter table public.company_vehicle_inspection_items
add column kind text not null default 'pass_fail'
check (kind in ('pass_fail', 'photo'));

create or replace function public.seed_vehicle_inspection_template(target_company_id uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.company_vehicle_inspection_items (company_id, label, position, kind)
  select target_company_id, item.label, item.position, item.kind
  from (values
    ('VIPR Inventory', 0, 'pass_fail'),
    ('Damage to Vehicle', 1, 'pass_fail'),
    ('Light Check', 2, 'pass_fail'),
    ('Horn', 3, 'pass_fail'),
    ('Washer Fluid', 4, 'pass_fail'),
    ('Tires', 5, 'pass_fail'),
    ('Interior Cleanliness', 6, 'photo')
  ) as item(label, position, kind)
  where not exists (
    select 1
    from public.company_vehicle_inspection_items existing
    where existing.company_id = target_company_id
  );
$$;
revoke all on function public.seed_vehicle_inspection_template(uuid) from public, anon, authenticated;

delete from public.company_vehicle_inspection_items;

insert into public.company_vehicle_inspection_items (company_id, label, position, kind)
select company.id, item.label, item.position, item.kind
from public.companies company
cross join (values
  ('VIPR Inventory', 0, 'pass_fail'),
  ('Damage to Vehicle', 1, 'pass_fail'),
  ('Light Check', 2, 'pass_fail'),
  ('Horn', 3, 'pass_fail'),
  ('Washer Fluid', 4, 'pass_fail'),
  ('Tires', 5, 'pass_fail'),
  ('Interior Cleanliness', 6, 'photo')
) as item(label, position, kind);
