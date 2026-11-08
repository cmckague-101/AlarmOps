-- Shop board and fleet repairs.
--
-- * shop_jobs: company shop tasks, either general shop work or tied to a fleet
--   vehicle. Owners, admins and shop techs ("shop writers") work the board;
--   every company member can read it. Job numbers (SJ-0001…) are allocated per
--   company by a trigger. Creating a job, assigning it and adding notes go
--   through the shop-job-* Edge Functions; shop writers change priority/status
--   and delete jobs directly under RLS.
-- * shop_job_notes: the job's activity log. Clients only read it; notes are
--   written by the Edge Functions (service role) and by the triggers below
--   (status changes, fleet issue sync), so authors cannot be forged.
-- * Fleet issue sync: every open fleet issue gets one linked shop job. Resolving
--   or deleting the issue closes the job, reopening it reopens the job, and
--   title/description/priority edits carry over. The sync only writes shop rows;
--   closing a linked job resolves the issue from the client through the normal
--   fleet issue path (so fleet sync versions stay intact).
-- * repair_types / fleet_repairs: Motive-backed repair log per vehicle. Filing
--   goes through the fleet-repair-file Edge Function, which reads the odometer
--   from the server's Motive snapshot (or records a manual reading with a reason
--   and an audit entry). Clients only read these tables.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_shop_writer(target_company_id uuid, target_user_id uuid)
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
revoke all on function public.is_shop_writer(uuid, uuid) from public, anon;
grant execute on function public.is_shop_writer(uuid, uuid) to authenticated;

-- The signed-in user, or the verified user an Edge Function forwards.
create or replace function public.shop_actor()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare actor uuid := auth.uid();
begin
  if actor is null and auth.role() = 'service_role' then
    actor := nullif(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-fireops-actor-id', '')::uuid;
  end if;
  return actor;
end;
$$;
revoke all on function public.shop_actor() from public, anon, authenticated;

create or replace function public.shop_status_label(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case value
    when 'parts' then 'Waiting on parts' when 'approval' then 'Waiting on approval'
    when 'blocked' then 'Blocked' when 'progress' then 'In progress' when 'queued' then 'Not started'
    when 'ready' then 'Ready for pickup' when 'done' then 'Done' else value end;
$$;
revoke all on function public.shop_status_label(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shop jobs
-- ---------------------------------------------------------------------------

create table public.shop_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_number text not null,
  title text not null check (char_length(trim(title)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 5000),
  priority text not null default 'medium' check (priority in ('critical', 'high', 'medium', 'low')),
  status text not null default 'queued' check (status in ('parts', 'approval', 'blocked', 'progress', 'queued', 'ready', 'done')),
  blocker_reason text check (blocker_reason is null or char_length(trim(blocker_reason)) between 1 and 500),
  kind text not null default 'general' check (kind in ('general', 'fleet')),
  shop_area text check (shop_area is null or char_length(trim(shop_area)) between 1 and 160),
  fleet_vehicle_id uuid,
  source_fleet_issue_id uuid,
  assigned_tech_id uuid references public.profiles(user_id) on delete set null,
  assigned_tech_name text,
  assigned_at timestamptz,
  location text check (location is null or char_length(trim(location)) <= 200),
  opened_by uuid references public.profiles(user_id) on delete set null,
  opened_by_name text not null,
  opened_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, job_number),
  unique (company_id, id),
  unique (company_id, source_fleet_issue_id),
  check (
    (status in ('parts', 'approval', 'blocked') and blocker_reason is not null)
    or (status not in ('parts', 'approval', 'blocked'))
  ),
  check (
    (kind = 'general' and fleet_vehicle_id is null and source_fleet_issue_id is null)
    or (kind = 'fleet' and fleet_vehicle_id is not null)
  ),
  foreign key (company_id, fleet_vehicle_id) references public.fleet_vehicles(company_id, record_id) on delete cascade
);

create index shop_jobs_board_idx on public.shop_jobs (company_id, status, priority, opened_at);
create index shop_jobs_vehicle_idx on public.shop_jobs (company_id, fleet_vehicle_id, status);

-- Backend-only counter for per-company job numbers.
create table public.shop_job_sequences (
  company_id uuid primary key references public.companies(id) on delete cascade,
  last_number int not null default 0 check (last_number >= 0)
);

create table public.shop_job_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null,
  body text not null check (char_length(trim(body)) between 1 and 4000),
  kind text not null default 'note' check (kind in ('note', 'system')),
  status_set text check (status_set is null or status_set in ('parts', 'approval', 'blocked', 'progress', 'queued', 'ready', 'done')),
  author_id uuid references public.profiles(user_id) on delete set null,
  author_name text not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (company_id, job_id) references public.shop_jobs(company_id, id) on delete cascade
);

create index shop_job_notes_thread_idx on public.shop_job_notes (company_id, job_id, created_at desc);

create or replace function public.prepare_shop_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare next_value int;
begin
  if tg_op = 'INSERT' then
    insert into public.shop_job_sequences (company_id, last_number)
    values (new.company_id, 1)
    on conflict (company_id) do update set last_number = public.shop_job_sequences.last_number + 1
    returning last_number into next_value;
    new.job_number := 'SJ-' || lpad(next_value::text, 4, '0');
    new.created_at := now();
    new.updated_at := now();
    new.assigned_at := case when new.assigned_tech_id is null then null else now() end;
    new.assigned_tech_name := null;
  else
    if new.id is distinct from old.id or new.company_id is distinct from old.company_id
      or new.job_number is distinct from old.job_number or new.kind is distinct from old.kind
      or new.fleet_vehicle_id is distinct from old.fleet_vehicle_id
      or new.source_fleet_issue_id is distinct from old.source_fleet_issue_id
      or new.opened_by is distinct from old.opened_by or new.opened_by_name is distinct from old.opened_by_name
      or new.opened_at is distinct from old.opened_at or new.created_at is distinct from old.created_at then
      raise exception 'A shop job''s number, origin and opener cannot change' using errcode = '22023';
    end if;
    if new.assigned_tech_id is distinct from old.assigned_tech_id then
      new.assigned_at := case when new.assigned_tech_id is null then null else now() end;
      new.assigned_tech_name := null;
    else
      new.assigned_at := old.assigned_at;
      new.assigned_tech_name := old.assigned_tech_name;
    end if;
    new.updated_at := now();
  end if;
  if new.status not in ('parts', 'approval', 'blocked') then new.blocker_reason := null; end if;
  if new.assigned_tech_id is not null and (tg_op = 'INSERT' or new.assigned_tech_id is distinct from old.assigned_tech_id)
    and not exists (select 1 from public.company_members where company_id = new.company_id and user_id = new.assigned_tech_id) then
    raise exception 'Shop jobs can only be assigned to company members' using errcode = '22023';
  end if;
  if new.assigned_tech_id is not null and new.assigned_tech_name is null then
    select coalesce(nullif(trim(full_name), ''), 'FireOps user') into new.assigned_tech_name
    from public.profiles where user_id = new.assigned_tech_id;
  end if;
  return new;
end;
$$;
revoke all on function public.prepare_shop_job() from public, anon, authenticated;
create trigger shop_jobs_prepare before insert or update on public.shop_jobs
for each row execute function public.prepare_shop_job();

-- Every status change leaves a system note naming who made it.
create or replace function public.log_shop_job_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  actor_name text;
begin
  if new.status is not distinct from old.status
    or coalesce(current_setting('fireops.shop_issue_sync', true), '') = 'on' then
    return null;
  end if;
  actor := public.shop_actor();
  select nullif(trim(full_name), '') into actor_name from public.profiles where user_id = actor;
  insert into public.shop_job_notes (company_id, job_id, body, kind, status_set, author_id, author_name)
  values (new.company_id, new.id,
    'Status changed ' || public.shop_status_label(old.status) || ' → ' || public.shop_status_label(new.status),
    'system', new.status, actor, coalesce(actor_name, case when actor is null then 'System' else 'FireOps user' end));
  return null;
end;
$$;
revoke all on function public.log_shop_job_status() from public, anon, authenticated;
create trigger shop_jobs_log_status after update of status on public.shop_jobs
for each row execute function public.log_shop_job_status();

alter table public.shop_jobs enable row level security;
alter table public.shop_job_notes enable row level security;
alter table public.shop_job_sequences enable row level security;

create policy "members read shop jobs" on public.shop_jobs for select to authenticated
using (public.is_company_member(company_id, (select auth.uid())) or public.has_system_admin_company_access(company_id));
create policy "shop writers update shop jobs" on public.shop_jobs for update to authenticated
using (public.is_shop_writer(company_id, (select auth.uid())))
with check (public.is_shop_writer(company_id, (select auth.uid())));
create policy "shop writers delete shop jobs" on public.shop_jobs for delete to authenticated
using (public.is_shop_writer(company_id, (select auth.uid())));

create policy "members read shop job notes" on public.shop_job_notes for select to authenticated
using (public.is_company_member(company_id, (select auth.uid())) or public.has_system_admin_company_access(company_id));

revoke all on public.shop_jobs from public, anon, authenticated;
revoke all on public.shop_job_notes from public, anon, authenticated;
revoke all on public.shop_job_sequences from public, anon, authenticated;
grant select, delete on public.shop_jobs to authenticated;
-- Board edits only: number, origin and opener stay server-owned.
grant update (title, description, priority, status, blocker_reason, assigned_tech_id, location) on public.shop_jobs to authenticated;
grant select on public.shop_job_notes to authenticated;
grant all on public.shop_jobs to service_role;
grant all on public.shop_job_notes to service_role;
grant all on public.shop_job_sequences to service_role;

-- ---------------------------------------------------------------------------
-- Fleet issue → shop job sync
-- ---------------------------------------------------------------------------

create or replace function public.shop_priority_from_issue(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case lower(coalesce(value, '')) when 'critical' then 'critical' when 'high' then 'high' when 'low' then 'low' else 'medium' end;
$$;
revoke all on function public.shop_priority_from_issue(text) from public, anon, authenticated;

create or replace function public.shop_sync_note(target_company uuid, target_job uuid, note text, status_value text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.shop_job_notes (company_id, job_id, body, kind, status_set, author_name)
  values (target_company, target_job, note, 'system', status_value, 'System');
$$;
revoke all on function public.shop_sync_note(uuid, uuid, text, text) from public, anon, authenticated;

-- Create, update, close or reopen the shop job linked to one fleet issue.
-- `issue` is null when the issue was deleted.
create or replace function public.sync_shop_job_for_fleet_issue(target_company uuid, issue_id uuid, issue jsonb, previous jsonb, fallback_opener uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.shop_jobs;
  vehicle uuid;
  opener uuid;
  opener_name text;
  opened timestamptz;
  is_open boolean := issue is not null and coalesce(issue ->> 'status', 'Open') = 'Open';
  issue_title text := left(coalesce(nullif(trim(issue ->> 'title'), ''), 'Fleet issue'), 200);
  issue_description text := left(coalesce(issue ->> 'description', ''), 5000);
begin
  select * into job from public.shop_jobs where company_id = target_company and source_fleet_issue_id = issue_id;
  perform set_config('fireops.shop_issue_sync', 'on', true);

  if job.id is null then
    if not is_open then perform set_config('fireops.shop_issue_sync', '', true); return; end if;
    begin vehicle := (issue ->> 'vehicleId')::uuid; exception when others then vehicle := null; end;
    if vehicle is null or not exists (select 1 from public.fleet_vehicles where company_id = target_company and record_id = vehicle) then
      perform set_config('fireops.shop_issue_sync', '', true);
      return;
    end if;
    begin opener := (issue ->> 'createdById')::uuid; exception when others then opener := null; end;
    if opener is null or not exists (select 1 from public.profiles where user_id = opener) then opener := fallback_opener; end if;
    select nullif(trim(full_name), '') into opener_name from public.profiles where user_id = opener;
    opener_name := left(coalesce(nullif(trim(issue ->> 'createdBy'), ''), opener_name, 'Fleet'), 200);
    begin opened := (issue ->> 'createdAt')::timestamptz; exception when others then opened := null; end;
    insert into public.shop_jobs (company_id, title, description, priority, status, kind, fleet_vehicle_id,
      source_fleet_issue_id, opened_by, opened_by_name, opened_at)
    values (target_company, issue_title, issue_description, public.shop_priority_from_issue(issue ->> 'priority'),
      'queued', 'fleet', vehicle, issue_id, opener, opener_name, coalesce(opened, now()))
    returning * into job;
    perform public.shop_sync_note(target_company, job.id, 'Created from fleet issue reported by ' || opener_name, null);
  elsif not is_open then
    if job.status <> 'done' then
      update public.shop_jobs set status = 'done' where id = job.id;
      perform public.shop_sync_note(target_company, job.id,
        case when issue is null then 'Fleet issue removed — shop task closed' else 'Fleet issue resolved — shop task closed' end, 'done');
    end if;
  else
    update public.shop_jobs set
      title = case when previous is null or previous -> 'title' is distinct from issue -> 'title' then issue_title else title end,
      description = case when previous is null or previous -> 'description' is distinct from issue -> 'description' then issue_description else description end,
      priority = case when previous is null or previous -> 'priority' is distinct from issue -> 'priority'
        then public.shop_priority_from_issue(issue ->> 'priority') else priority end,
      status = case when status = 'done' then 'queued' else status end
    where id = job.id;
    if job.status = 'done' then
      perform public.shop_sync_note(target_company, job.id, 'Fleet issue reopened — shop task reopened', 'queued');
    end if;
  end if;
  perform set_config('fireops.shop_issue_sync', '', true);
end;
$$;
revoke all on function public.sync_shop_job_for_fleet_issue(uuid, uuid, jsonb, jsonb, uuid) from public, anon, authenticated;

create or replace function public.sync_shop_jobs_from_fleet_issues()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Company removal cascades; nothing to close.
    if exists (select 1 from public.companies where id = old.company_id) then
      perform public.sync_shop_job_for_fleet_issue(old.company_id, old.record_id, null, old.data, old.updated_by);
    end if;
    return null;
  end if;
  if tg_op = 'UPDATE' and new.data is not distinct from old.data then return null; end if;
  perform public.sync_shop_job_for_fleet_issue(new.company_id, new.record_id, new.data,
    case when tg_op = 'UPDATE' then old.data else null end, new.updated_by);
  return null;
end;
$$;
revoke all on function public.sync_shop_jobs_from_fleet_issues() from public, anon, authenticated;
create trigger fleet_issues_sync_shop_jobs after insert or update or delete on public.fleet_issues
for each row execute function public.sync_shop_jobs_from_fleet_issues();

-- One shop job for each fleet issue that is open today.
do $$
declare issue record;
begin
  for issue in
    select company_id, record_id, data, updated_by from public.fleet_issues
    where coalesce(data ->> 'status', 'Open') = 'Open'
    order by company_id, coalesce(data ->> 'createdAt', '')
  loop
    perform public.sync_shop_job_for_fleet_issue(issue.company_id, issue.record_id, issue.data, null, issue.updated_by);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fleet repairs
-- ---------------------------------------------------------------------------

create table public.repair_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  name_normalized text not null,
  is_custom boolean not null default false,
  use_count int not null default 0 check (use_count >= 0),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, name_normalized)
);

create table public.fleet_repairs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  fleet_vehicle_id uuid not null,
  repair_type_id uuid references public.repair_types(id) on delete set null,
  repair_type_text text not null check (char_length(trim(repair_type_text)) between 1 and 120),
  reading_value numeric(14,2) not null check (reading_value >= 0),
  reading_unit text not null check (reading_unit in ('miles', 'hrs')),
  reading_source text not null check (reading_source in ('motive', 'manual')),
  manual_reason text check (manual_reason is null or char_length(trim(manual_reason)) between 1 and 500),
  motive_located_at timestamptz,
  tech_id uuid references public.profiles(user_id) on delete set null,
  tech_name text not null,
  labor_hours numeric(8,2) check (labor_hours is null or labor_hours between 0 and 999),
  notes text not null default '' check (char_length(notes) <= 4000),
  shop_job_id uuid,
  repaired_on date not null default (timezone('utc', now()))::date,
  created_at timestamptz not null default now(),
  check (
    (reading_source = 'motive' and manual_reason is null)
    or (reading_source = 'manual' and manual_reason is not null)
  ),
  foreign key (company_id, fleet_vehicle_id) references public.fleet_vehicles(company_id, record_id) on delete cascade,
  foreign key (company_id, shop_job_id) references public.shop_jobs(company_id, id) on delete set null (shop_job_id)
);

create index fleet_repairs_vehicle_reading_idx
  on public.fleet_repairs (company_id, fleet_vehicle_id, reading_value desc, created_at desc);
create index repair_types_suggest_idx
  on public.repair_types (company_id, use_count desc, last_used_at desc nulls last);

alter table public.repair_types enable row level security;
alter table public.fleet_repairs enable row level security;

create policy "members read repair types" on public.repair_types for select to authenticated
using (public.is_company_member(company_id, (select auth.uid())) or public.has_system_admin_company_access(company_id));
create policy "members read fleet repairs" on public.fleet_repairs for select to authenticated
using (public.is_company_member(company_id, (select auth.uid())) or public.has_system_admin_company_access(company_id));

revoke all on public.repair_types from public, anon, authenticated;
revoke all on public.fleet_repairs from public, anon, authenticated;
grant select on public.repair_types to authenticated;
grant select on public.fleet_repairs to authenticated;
grant all on public.repair_types to service_role;
grant all on public.fleet_repairs to service_role;

-- Common repair types for every company, now and when a company is created.
create or replace function public.seed_company_repair_types(target_company_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.repair_types (company_id, name, name_normalized, is_custom, use_count)
  select target_company_id, item.name, lower(item.name), false, 0
  from (values
    ('Oil change'), ('Filters'), ('Brakes'), ('Tires'), ('Battery'), ('Belts'), ('Coolant flush'),
    ('Hydraulic hose'), ('DOT inspection prep'), ('Electrical'), ('Lights'), ('Wipers'),
    ('Pump service'), ('Undercarriage')
  ) as item(name)
  on conflict (company_id, name_normalized) do nothing;
$$;
revoke all on function public.seed_company_repair_types(uuid) from public, anon, authenticated;

create or replace function public.seed_new_company_repair_types()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_company_repair_types(new.id);
  return null;
end;
$$;
revoke all on function public.seed_new_company_repair_types() from public, anon, authenticated;
create trigger companies_seed_repair_types after insert on public.companies
for each row execute function public.seed_new_company_repair_types();

select public.seed_company_repair_types(id) from public.companies;

-- ---------------------------------------------------------------------------
-- Audit log and Realtime
-- ---------------------------------------------------------------------------

create trigger capture_company_audit after insert or update or delete on public.shop_jobs
for each row execute function public.capture_company_audit_log('shop job');
create trigger capture_company_audit after insert or update or delete on public.fleet_repairs
for each row execute function public.capture_company_audit_log('fleet repair');

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shop_jobs') then
    alter publication supabase_realtime add table public.shop_jobs;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shop_job_notes') then
    alter publication supabase_realtime add table public.shop_job_notes;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fleet_repairs') then
    alter publication supabase_realtime add table public.fleet_repairs;
  end if;
end
$$;
