alter table public.company_motive_integrations
  add column last_sync_at timestamptz,
  add column sync_snapshot jsonb;

create table public.company_motive_vehicle_mappings (
  company_id uuid not null references public.companies(id) on delete cascade,
  fleet_vehicle_id uuid not null,
  motive_entity_type text not null check (motive_entity_type in ('vehicle', 'asset')),
  motive_entity_id text not null,
  vin text not null check (vin = upper(trim(vin)) and vin <> ''),
  matched_at timestamptz not null default now(),
  primary key (company_id, fleet_vehicle_id),
  unique (company_id, motive_entity_type, motive_entity_id),
  foreign key (company_id, fleet_vehicle_id)
    references public.fleet_vehicles(company_id, record_id) on delete cascade
);

create index company_motive_vehicle_mappings_vin_idx
  on public.company_motive_vehicle_mappings(company_id, vin);

alter table public.company_motive_vehicle_mappings enable row level security;
revoke all on public.company_motive_vehicle_mappings from public, anon, authenticated;
grant all on public.company_motive_vehicle_mappings to service_role;

comment on table public.company_motive_vehicle_mappings is
  'Server-managed exact VIN matches between FireOps vehicles and Motive vehicles/assets.';
