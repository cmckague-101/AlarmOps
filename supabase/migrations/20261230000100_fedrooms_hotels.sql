-- GSA FedRooms accepted properties, imported from the monthly XLSX linked on
-- gsa.gov/travel/hotels-fedrooms. Importer writes through a server-side Postgres
-- connection; signed-in FireOps users receive read-only access.
create table public.fedrooms_hotels (
  -- SHA-256 of normalized name, address, city, state, zip and country. The GSA file
  -- has no property ID, so an edited address is treated as a new property.
  property_key text primary key,
  name text not null,
  address text,
  city text,
  state text,
  postal_code text,
  country text not null default 'United States',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index fedrooms_hotels_location_idx on public.fedrooms_hotels(country, state, city);

create table public.fedrooms_sync_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'completed', 'unchanged', 'failed')),
  source_url text,
  source_sha256 text,
  hotels_total integer check (hotels_total is null or hotels_total >= 0),
  hotels_added integer check (hotels_added is null or hotels_added >= 0),
  hotels_removed integer check (hotels_removed is null or hotels_removed >= 0),
  error_message text
);
create index fedrooms_sync_runs_status_idx on public.fedrooms_sync_runs(status, started_at desc);

alter table public.fedrooms_hotels enable row level security;
alter table public.fedrooms_sync_runs enable row level security;

create policy "authenticated read fedrooms hotels" on public.fedrooms_hotels
for select to authenticated using (true);

revoke all on public.fedrooms_hotels, public.fedrooms_sync_runs from anon, authenticated;
grant select on public.fedrooms_hotels to authenticated;
