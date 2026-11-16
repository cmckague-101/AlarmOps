-- HTTPS (PostgREST RPC) write path for the USFS/VIPR dispatch sync.
-- SECURITY DEFINER functions, empty search_path, EXECUTE granted to service_role only.
-- One RPC call = one transaction, so each function is atomic.

begin;

-- =========================== USFS / VIPR ===================================

-- Lease row replaces the session-level pg_advisory_lock, which cannot span HTTP calls.
create table if not exists public.usfs_sync_lease (
  id          boolean primary key default true check (id),
  holder      uuid,
  run_id      bigint,
  acquired_at timestamptz,
  expires_at  timestamptz
);
insert into public.usfs_sync_lease (id) values (true) on conflict do nothing;
alter table public.usfs_sync_lease enable row level security;
revoke all on public.usfs_sync_lease from anon, authenticated;

-- Internal: lock the lease row, verify the holder, and extend the lease.
create or replace function public._usfs_require_lease(p_holder uuid, p_lease_seconds integer default 1800)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare v public.usfs_sync_lease;
begin
  select * into v from public.usfs_sync_lease where id for update;
  if v.holder is distinct from p_holder or v.expires_at < now() then
    raise exception 'USFS sync lease not held by % (holder %, expires %)', p_holder, v.holder, v.expires_at
      using errcode = '55P03';
  end if;
  update public.usfs_sync_lease
     set expires_at = now() + make_interval(secs => p_lease_seconds)
   where id;
  return v.run_id;
end;
$$;

-- Internal: snapshot used by the Python weekly planner (existing_lists + existing_agreements).
create or replace function public._usfs_state()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'lists', coalesce((select jsonb_agg(jsonb_build_object(
        'file_id', l.file_id, 'name', l.name, 'sync_status', l.sync_status,
        'last_checked_at', l.last_checked_at, 'pdf_sha256', l.pdf_sha256,
        'synced_at', l.synced_at, 'last_error', l.last_error))
      from public.usfs_priority_lists l), '[]'::jsonb),
    'agreements', coalesce((select jsonb_object_agg(a.piid, a.pdf_sha256)
      from public.usfs_agreements a), '{}'::jsonb));
$$;

-- Acquire the lease, snapshot the previous state, upsert the catalog, and create a run row.
-- p_areas:   [{id, name}]
-- p_centers: [{id, geographic_area_id, name}]
-- p_lists:   [{file_id, dispatch_center_id, name}]
create or replace function public.usfs_begin_run(
  p_holder uuid,
  p_areas jsonb,
  p_centers jsonb,
  p_lists jsonb,
  p_deactivate_missing boolean default false,
  p_lease_seconds integer default 1800,
  p_parser_version text default '1'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease public.usfs_sync_lease;
  v_state jsonb;
  v_run   bigint;
begin
  -- Same key as the legacy psycopg runner's session lock: this fails while the old server job runs.
  if not pg_try_advisory_xact_lock(73185422390455611) then
    raise exception 'Another USFS dispatch sync (legacy runner) is already running' using errcode = '55P03';
  end if;

  select * into v_lease from public.usfs_sync_lease where id for update;
  if v_lease.holder is not null and v_lease.holder <> p_holder and v_lease.expires_at > now() then
    raise exception 'Another USFS dispatch sync is already running (lease until %)', v_lease.expires_at
      using errcode = '55P03';
  end if;

  if jsonb_typeof(p_lists) <> 'array' then
    raise exception 'p_lists must be a JSON array';
  end if;

  v_state := public._usfs_state();   -- snapshot before the catalog upsert, matching the current code order

  if p_deactivate_missing then
    update public.usfs_priority_lists   set is_active = false where true;
    update public.usfs_dispatch_centers set is_active = false where true;
    update public.usfs_geographic_areas set is_active = false where true;
  end if;

  insert into public.usfs_geographic_areas (id, name, is_active, source_updated_at)
  select distinct on (a.id) a.id::integer, a.name, true, now()
  from jsonb_to_recordset(p_areas) as a(id integer, name text)
  order by a.id
  on conflict (id) do update
    set name = excluded.name, is_active = true, source_updated_at = now();

  insert into public.usfs_dispatch_centers (id, geographic_area_id, name, is_active, source_updated_at)
  select distinct on (c.id) c.id::integer, c.geographic_area_id::integer, c.name, true, now()
  from jsonb_to_recordset(p_centers) as c(id integer, geographic_area_id integer, name text)
  order by c.id
  on conflict (id) do update
    set geographic_area_id = excluded.geographic_area_id, name = excluded.name,
        is_active = true, source_updated_at = now();

  insert into public.usfs_priority_lists (file_id, dispatch_center_id, name, is_active, last_seen_at)
  select distinct on (l.file_id) l.file_id::bigint, l.dispatch_center_id::integer, l.name, true, now()
  from jsonb_to_recordset(p_lists) as l(file_id bigint, dispatch_center_id integer, name text)
  order by l.file_id
  on conflict (file_id) do update
    set dispatch_center_id = excluded.dispatch_center_id, name = excluded.name,
        is_active = true, last_seen_at = now();

  insert into public.usfs_sync_runs (lists_discovered, parser_version)
  values (jsonb_array_length(p_lists), p_parser_version)
  returning id into v_run;

  update public.usfs_sync_lease
     set holder = p_holder, run_id = v_run, acquired_at = now(),
         expires_at = now() + make_interval(secs => p_lease_seconds)
   where id;

  return jsonb_build_object('run_id', v_run, 'state', v_state);
end;
$$;

create or replace function public.usfs_heartbeat(p_holder uuid, p_lease_seconds integer default 1800)
returns void
language plpgsql
security definer
set search_path = ''
as $$ begin perform public._usfs_require_lease(p_holder, p_lease_seconds); end; $$;

-- Re-read state, e.g. for the weekly coverage summary after syncing.
create or replace function public.usfs_get_state(p_holder uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$ begin perform public._usfs_require_lease(p_holder); return public._usfs_state(); end; $$;

-- One priority list, atomically. Mirrors write_list().
-- p_list:       {dispatch_center_name, resource_type, published_at, pdf_sha256}
-- p_agreements: [{piid, pdf_sha256, rates:[{clin, vin, normalized_vin, daily_rate, resource_type, dispatch_center, source_data}]}]
-- p_rows:       [{rank, agreement_piid, company_name, equipment_location, vin, normalized_vin, cafs}]
create or replace function public.usfs_write_list(
  p_holder uuid,
  p_file_id bigint,
  p_list jsonb,
  p_agreements jsonb,
  p_rows jsonb,
  p_errors text[] default '{}',
  p_warnings text[] default '{}'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_complete boolean := coalesce(array_length(p_errors, 1), 0) = 0;
  v_rows integer;
begin
  perform public._usfs_require_lease(p_holder);

  insert into public.usfs_agreements (piid, pdf_sha256, sync_status, last_checked_at, synced_at, last_error)
  select a.piid, a.pdf_sha256, 'complete', now(), now(), null
  from jsonb_to_recordset(p_agreements) as a(piid text, pdf_sha256 text)
  on conflict (piid) do update
    set pdf_sha256 = excluded.pdf_sha256, sync_status = 'complete',
        last_checked_at = now(), synced_at = now(), last_error = null;

  delete from public.usfs_agreement_rates r
  using jsonb_to_recordset(p_agreements) as a(piid text)
  where r.agreement_piid = a.piid;

  insert into public.usfs_agreement_rates
    (agreement_piid, clin, vin, normalized_vin, daily_rate, resource_type, dispatch_center, source_data, synced_at)
  select a.piid, r.clin, r.vin, r.normalized_vin, r.daily_rate, r.resource_type, r.dispatch_center,
         r.source_data, now()
  from jsonb_to_recordset(p_agreements) as a(piid text, rates jsonb)
  cross join lateral jsonb_to_recordset(coalesce(a.rates, '[]'::jsonb)) as r(
    clin text, vin text, normalized_vin text, daily_rate numeric,
    resource_type text, dispatch_center text, source_data jsonb);

  delete from public.usfs_dpl_entries where priority_list_file_id = p_file_id;

  insert into public.usfs_dpl_entries
    (priority_list_file_id, rank, agreement_piid, company_name, equipment_location, vin, normalized_vin, cafs, synced_at)
  select p_file_id, e.rank, e.agreement_piid, e.company_name, e.equipment_location, e.vin,
         coalesce(e.normalized_vin, ''), e.cafs, now()
  from jsonb_to_recordset(p_rows) as e(
    rank integer, agreement_piid text, company_name text, equipment_location text,
    vin text, normalized_vin text, cafs text);
  get diagnostics v_rows = row_count;

  update public.usfs_priority_lists
     set dispatch_center_name = p_list->>'dispatch_center_name',
         resource_type        = p_list->>'resource_type',
         published_at         = (p_list->>'published_at')::timestamptz,  -- client sends ISO-8601 UTC or null
         pdf_sha256           = p_list->>'pdf_sha256',
         sync_status          = case when v_complete then 'complete' else 'partial' end,
         last_error           = nullif(array_to_string(p_errors, E'\n'), ''),
         last_warning         = nullif(array_to_string(p_warnings, E'\n'), ''),
         row_count            = v_rows,
         last_checked_at      = now(),
         synced_at            = case when v_complete then now() else synced_at end
   where file_id = p_file_id;

  return jsonb_build_object('file_id', p_file_id, 'entries', v_rows,
                            'status', case when v_complete then 'complete' else 'partial' end);
end;
$$;

create or replace function public.usfs_mark_list_failed(p_holder uuid, p_file_id bigint, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._usfs_require_lease(p_holder);
  update public.usfs_priority_lists
     set sync_status = 'failed', last_error = left(p_error, 2000), last_checked_at = now()
   where file_id = p_file_id;
end;
$$;

-- Mirrors cleanup_obsolete(). The client only calls it when the run had no errors.
create or replace function public.usfs_cleanup(p_holder uuid, p_retention_days integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_lists integer; v_agreements integer;
begin
  perform public._usfs_require_lease(p_holder);
  if p_retention_days < 1 then raise exception 'retention_days must be >= 1'; end if;

  delete from public.usfs_priority_lists
   where not is_active and last_seen_at < now() - make_interval(days => p_retention_days);
  get diagnostics v_lists = row_count;

  delete from public.usfs_agreements a
   where a.last_checked_at < now() - make_interval(days => p_retention_days)
     and not exists (select 1 from public.usfs_dpl_entries e where e.agreement_piid = a.piid);
  get diagnostics v_agreements = row_count;

  return jsonb_build_object('lists_deleted', v_lists, 'agreements_deleted', v_agreements);
end;
$$;

-- Finish the run and release the lease.
create or replace function public.usfs_finish_run(
  p_holder uuid, p_run_id bigint, p_status text,
  p_lists_synced integer, p_entries_synced integer, p_error_message text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._usfs_require_lease(p_holder);
  update public.usfs_sync_runs
     set status = p_status, lists_synced = p_lists_synced, entries_synced = p_entries_synced,
         error_message = p_error_message, finished_at = now()
   where id = p_run_id;
  update public.usfs_sync_lease set holder = null, run_id = null, expires_at = null where id;
end;
$$;

-- ============================ PRIVILEGES ====================================
-- Supabase default privileges grant EXECUTE on new public functions to anon/authenticated,
-- so revoke explicitly.
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('_usfs_require_lease','_usfs_state',
                        'usfs_begin_run','usfs_heartbeat','usfs_get_state','usfs_write_list',
                        'usfs_mark_list_failed','usfs_cleanup','usfs_finish_run')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    if f::text not like '\_usfs%' then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;

commit;
