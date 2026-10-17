-- Scheduled USDA Forest Service VIPR dispatch-list data. Importer writes through a
-- server-side Postgres connection; signed-in FireOps users receive read-only access.
create table public.usfs_geographic_areas (
  id integer primary key,
  name text not null,
  is_active boolean not null default true,
  source_updated_at timestamptz not null default now()
);

create table public.usfs_dispatch_centers (
  id integer primary key,
  geographic_area_id integer not null references public.usfs_geographic_areas(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  source_updated_at timestamptz not null default now()
);
create index usfs_dispatch_centers_area_idx on public.usfs_dispatch_centers(geographic_area_id);

create table public.usfs_priority_lists (
  file_id bigint primary key,
  dispatch_center_id integer not null references public.usfs_dispatch_centers(id) on delete cascade,
  name text not null,
  dispatch_center_name text,
  resource_type text,
  published_at timestamptz,
  pdf_sha256 text,
  sync_status text not null default 'pending' check (sync_status in ('pending', 'complete', 'partial', 'failed')),
  last_error text,
  row_count integer check (row_count is null or row_count >= 0),
  is_active boolean not null default true,
  discovered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_checked_at timestamptz,
  synced_at timestamptz
);
create index usfs_priority_lists_center_idx on public.usfs_priority_lists(dispatch_center_id);
create index usfs_priority_lists_active_published_idx on public.usfs_priority_lists(is_active, published_at desc);
create index usfs_priority_lists_retry_idx on public.usfs_priority_lists(sync_status, last_checked_at);

create table public.usfs_agreements (
  piid text primary key,
  pdf_sha256 text not null,
  sync_status text not null default 'complete' check (sync_status in ('complete', 'failed')),
  last_error text,
  last_checked_at timestamptz not null default now(),
  synced_at timestamptz not null default now()
);

create table public.usfs_agreement_rates (
  agreement_piid text not null references public.usfs_agreements(piid) on delete cascade,
  clin text not null,
  vin text not null,
  normalized_vin text not null check (normalized_vin <> ''),
  daily_rate numeric(12, 2) not null check (daily_rate >= 0),
  resource_type text,
  dispatch_center text,
  source_data jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  primary key (agreement_piid, clin, normalized_vin)
);
create index usfs_agreement_rates_vin_idx on public.usfs_agreement_rates(agreement_piid, normalized_vin);

-- Contact information is intentionally not collected or stored.
create table public.usfs_dpl_entries (
  priority_list_file_id bigint not null references public.usfs_priority_lists(file_id) on delete cascade,
  rank integer not null check (rank > 0),
  agreement_piid text not null,
  company_name text,
  equipment_location text,
  vin text,
  normalized_vin text not null default '',
  cafs text,
  synced_at timestamptz not null default now(),
  primary key (priority_list_file_id, rank)
);
create index usfs_dpl_entries_vin_idx on public.usfs_dpl_entries(agreement_piid, normalized_vin);

create table public.usfs_sync_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'completed', 'completed_with_errors', 'failed')),
  parser_version text not null,
  lists_discovered integer not null default 0 check (lists_discovered >= 0),
  lists_synced integer not null default 0 check (lists_synced >= 0),
  entries_synced integer not null default 0 check (entries_synced >= 0),
  error_message text
);

alter table public.usfs_geographic_areas enable row level security;
alter table public.usfs_dispatch_centers enable row level security;
alter table public.usfs_priority_lists enable row level security;
alter table public.usfs_agreements enable row level security;
alter table public.usfs_agreement_rates enable row level security;
alter table public.usfs_dpl_entries enable row level security;
alter table public.usfs_sync_runs enable row level security;

create policy "authenticated read usfs areas" on public.usfs_geographic_areas
for select to authenticated using (true);
create policy "authenticated read usfs centers" on public.usfs_dispatch_centers
for select to authenticated using (true);
create policy "authenticated read usfs lists" on public.usfs_priority_lists
for select to authenticated using (true);
create policy "authenticated read usfs agreements" on public.usfs_agreements
for select to authenticated using (true);
create policy "authenticated read usfs rates" on public.usfs_agreement_rates
for select to authenticated using (true);
create policy "authenticated read usfs entries" on public.usfs_dpl_entries
for select to authenticated using (true);

revoke all on public.usfs_geographic_areas, public.usfs_dispatch_centers,
  public.usfs_priority_lists, public.usfs_agreements, public.usfs_agreement_rates,
  public.usfs_dpl_entries, public.usfs_sync_runs from anon, authenticated;
grant select on public.usfs_geographic_areas, public.usfs_dispatch_centers,
  public.usfs_priority_lists, public.usfs_agreements, public.usfs_agreement_rates,
  public.usfs_dpl_entries to authenticated;

-- App-facing result. Rate is resolved from current agreement data by agreement +
-- normalized VIN. Multiple records are accepted only when all daily rates agree.
create view public.usfs_dispatch_entries
with (security_invoker = true)
as
select
  area.id as geographic_area_id,
  area.name as geographic_area_name,
  center.id as dispatch_center_id,
  center.name as dispatch_center_name,
  list.file_id as priority_list_file_id,
  list.name as priority_list_name,
  list.resource_type,
  list.published_at,
  list.synced_at as list_synced_at,
  entry.rank,
  entry.company_name,
  entry.equipment_location,
  entry.vin,
  entry.cafs,
  matched.daily_rate,
  case
    when entry.normalized_vin = '' then 'not_found'
    when matched.rate_count = 0 then 'not_found'
    when matched.distinct_rate_count = 1 then 'matched'
    else 'ambiguous'
  end as rate_status
from public.usfs_dpl_entries entry
join public.usfs_priority_lists list on list.file_id = entry.priority_list_file_id
join public.usfs_dispatch_centers center on center.id = list.dispatch_center_id
join public.usfs_geographic_areas area on area.id = center.geographic_area_id
left join lateral (
  select
    case when count(distinct rate.daily_rate) = 1 then min(rate.daily_rate) end as daily_rate,
    count(*) as rate_count,
    count(distinct rate.daily_rate) as distinct_rate_count
  from public.usfs_agreement_rates rate
  where rate.agreement_piid = entry.agreement_piid
    and rate.normalized_vin = entry.normalized_vin
    and entry.normalized_vin <> ''
) matched on true
where area.is_active and center.is_active and list.is_active and list.sync_status in ('complete', 'partial');

revoke all on public.usfs_dispatch_entries from anon;
grant select on public.usfs_dispatch_entries to authenticated;
