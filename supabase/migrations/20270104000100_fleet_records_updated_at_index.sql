-- Workspaces load each fleet table newest first for one company
-- (company_id = ? order by updated_at desc), and activities with a limit.
-- The primary key (company_id, record_id) cannot serve that order, so every
-- load sorted the whole company slice. These indexes let Postgres read rows
-- already in order and stop at the limit.
create index if not exists fleet_vehicles_company_updated_idx on public.fleet_vehicles (company_id, updated_at desc);
create index if not exists fleet_issues_company_updated_idx on public.fleet_issues (company_id, updated_at desc);
create index if not exists fleet_crew_company_updated_idx on public.fleet_crew (company_id, updated_at desc);
create index if not exists fleet_activities_company_updated_idx on public.fleet_activities (company_id, updated_at desc);
