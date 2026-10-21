-- First server sync slice: monotonic fleet revisions, deletion fingerprints,
-- and atomic idempotent batches. No offline merge or conflict approval yet.
begin;

-- Keep backfill and trigger installation atomic with respect to existing writers.
lock table public.fleet_vehicles, public.fleet_issues, public.fleet_crew, public.fleet_activities
  in share row exclusive mode;

-- Fingerprints verify future client-supplied bases without retaining row contents.
-- No client read access: even hashes/provenance can expose private crew/issue history.
create table public.fleet_sync_revisions (
  company_id uuid not null references public.companies(id) on delete cascade,
  collection text not null check (collection in ('vehicles','issues','crew','activities')),
  record_id uuid not null,
  version bigint not null check (version > 0),
  deleted boolean not null,
  data_sha256 bytea,
  changed_fields text[] not null,
  actor_user_id uuid,
  origin text not null check (origin in ('baseline','authenticated','service_role','database')),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (company_id, collection, record_id, version),
  check ((deleted and data_sha256 is null) or (not deleted and octet_length(data_sha256) = 32 and data_sha256 is not null))
);
alter table public.fleet_sync_revisions enable row level security;
revoke all on public.fleet_sync_revisions from public, anon, authenticated, service_role;
grant select on public.fleet_sync_revisions to service_role;

-- This role inherits the SAME RLS/trigger restrictions as authenticated users.
-- It is not a table owner, superuser, or BYPASSRLS role. Only this trusted RPC
-- receives receipt-write privileges; callers cannot forge their own receipts.
create role fireops_sync_writer nologin nosuperuser nocreatedb nocreaterole inherit nobypassrls;
grant authenticated to fireops_sync_writer;
grant fireops_sync_writer to current_user;
grant usage, create on schema public to fireops_sync_writer;

create table public.fleet_sync_receipts (
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_user_id uuid not null,
  operation_id uuid not null,
  request_sha256 bytea not null check (octet_length(request_sha256) = 32),
  result jsonb not null check (jsonb_typeof(result) = 'array'),
  received_at timestamptz not null default clock_timestamp(),
  primary key (company_id, actor_user_id, operation_id)
);
alter table public.fleet_sync_receipts enable row level security;
revoke all on public.fleet_sync_receipts from public, anon, authenticated, service_role;
grant select on public.fleet_sync_receipts to service_role;
grant select, insert on public.fleet_sync_receipts to fireops_sync_writer;
create policy "sync writer reads own receipts" on public.fleet_sync_receipts
  for select to fireops_sync_writer using (actor_user_id = (select auth.uid()));
create policy "sync writer creates own receipts" on public.fleet_sync_receipts
  for insert to fireops_sync_writer with check (actor_user_id = (select auth.uid()));

-- BEFORE only chooses a revision. AFTER records the actual outcome, so an
-- INSERT ... ON CONFLICT UPDATE cannot leave a phantom insert fingerprint.
create function public.assign_fleet_sync_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  collection_name text := case tg_table_name
    when 'fleet_vehicles' then 'vehicles' when 'fleet_issues' then 'issues'
    when 'fleet_crew' then 'crew' when 'fleet_activities' then 'activities' end;
  previous_version bigint;
begin
  if collection_name is null then raise exception 'Unsupported sync table'; end if;
  if tg_op = 'UPDATE' and (new.company_id <> old.company_id or new.record_id <> old.record_id) then
    raise exception 'Fleet identity cannot change; delete and create explicitly' using errcode = '22023';
  end if;
  select coalesce(max(version), 0) into previous_version from public.fleet_sync_revisions
    where company_id = new.company_id and collection = collection_name and record_id = new.record_id;
  if tg_op = 'UPDATE' then previous_version := greatest(previous_version, old.version); end if;
  -- Never trust a client/integration-supplied revision, including on re-creation.
  new.version := previous_version + 1;
  return new;
end;
$$;
revoke all on function public.assign_fleet_sync_revision() from public, anon, authenticated, service_role;

create function public.capture_fleet_sync_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  collection_name text := case tg_table_name
    when 'fleet_vehicles' then 'vehicles' when 'fleet_issues' then 'issues'
    when 'fleet_crew' then 'crew' when 'fleet_activities' then 'activities' end;
  item_company uuid;
  item_id uuid;
  item_version bigint;
  before_data jsonb := case when tg_op <> 'INSERT' then old.data else '{}'::jsonb end;
  after_data jsonb := case when tg_op <> 'DELETE' then new.data else '{}'::jsonb end;
  fields text[];
  actor uuid := auth.uid();
  source text := case auth.role() when 'authenticated' then 'authenticated' when 'service_role' then 'service_role' else 'database' end;
begin
  if collection_name is null then raise exception 'Unsupported sync table'; end if;
  if tg_op = 'DELETE' then
    item_company := old.company_id; item_id := old.record_id; item_version := old.version + 1;
  else
    item_company := new.company_id; item_id := new.record_id; item_version := new.version;
  end if;
  -- Do not recreate history while a company's FK cascades remove its records.
  if not exists (select 1 from public.companies where id = item_company) then return null; end if;
  if actor is null and auth.role() = 'service_role' then
    actor := nullif(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-fireops-actor-id', '')::uuid;
  end if;
  select coalesce(array_agg(key order by key), '{}'::text[]) into fields
    from jsonb_object_keys(before_data || after_data) keys(key)
    where before_data -> key is distinct from after_data -> key;
  insert into public.fleet_sync_revisions
    (company_id, collection, record_id, version, deleted, data_sha256, changed_fields, actor_user_id, origin)
    values (item_company, collection_name, item_id, item_version, tg_op = 'DELETE',
      case when tg_op <> 'DELETE' then sha256(convert_to(after_data::text, 'UTF8')) end, fields, actor, source);
  return null;
end;
$$;
revoke all on function public.capture_fleet_sync_revision() from public, anon, authenticated, service_role;

do $$
declare item record;
begin
  for item in select * from (values
    ('fleet_vehicles','vehicles'), ('fleet_issues','issues'), ('fleet_crew','crew'), ('fleet_activities','activities')
  ) tracked(table_name, collection_name) loop
    -- Baseline attribution/time are unknown, not the time/author of the original edit.
    execute format('insert into public.fleet_sync_revisions
      (company_id, collection, record_id, version, deleted, data_sha256, changed_fields, origin)
      select company_id, %L, record_id, version, false, sha256(convert_to(data::text, ''UTF8'')),
        array(select jsonb_object_keys(data) order by 1), ''baseline'' from public.%I', item.collection_name, item.table_name);
    execute format('create trigger assign_sync_revision before insert or update on public.%I
      for each row execute function public.assign_fleet_sync_revision()', item.table_name);
    execute format('create trigger capture_sync_revision after insert or update or delete on public.%I
      for each row execute function public.capture_fleet_sync_revision()', item.table_name);
  end loop;
end;
$$;

-- Future mobile replay can use one stable operation UUID across network retries.
-- The function owner inherits authenticated, so apply_fleet_changes (invoker)
-- still enforces all existing RLS policies and member-change triggers.
create function public.apply_fleet_changes_once(target_company_id uuid, operation_id uuid, changes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  request_hash bytea;
  previous public.fleet_sync_receipts%rowtype;
  response jsonb;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if target_company_id is null or operation_id is null or changes is null
    or jsonb_typeof(changes) <> 'array' then
    raise exception 'Invalid fleet operation' using errcode = '22023';
  end if;
  if jsonb_array_length(changes) not between 1 and 500 then
    raise exception 'Invalid fleet operation size' using errcode = '22023';
  end if;
  -- Recheck current access BEFORE returning a cached receipt after a retry.
  if not (public.is_company_member(target_company_id, actor) or public.has_system_admin_company_access(target_company_id)) then
    raise exception 'Company access required' using errcode = '42501';
  end if;
  request_hash := sha256(convert_to(jsonb_build_object('kind','fleet_batch_v1','changes',changes)::text, 'UTF8'));
  -- Collisions only serialize unrelated work; full scoped keys below decide identity.
  perform pg_advisory_xact_lock(hashtextextended(target_company_id::text || ':' || actor::text || ':' || operation_id::text, 0));
  select * into previous from public.fleet_sync_receipts receipt
    where receipt.company_id = target_company_id and receipt.actor_user_id = actor
      and receipt.operation_id = apply_fleet_changes_once.operation_id;
  if found then
    if previous.request_sha256 <> request_hash then
      raise exception 'Operation ID was reused for different work' using errcode = '22023';
    end if;
    return previous.result;
  end if;
  response := public.apply_fleet_changes(target_company_id, changes);
  insert into public.fleet_sync_receipts(company_id, actor_user_id, operation_id, request_sha256, result)
    values (target_company_id, actor, operation_id, request_hash, response);
  return response;
end;
$$;
alter function public.apply_fleet_changes_once(uuid, uuid, jsonb) owner to fireops_sync_writer;
revoke create on schema public from fireops_sync_writer;
revoke all on function public.apply_fleet_changes_once(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.apply_fleet_changes_once(uuid, uuid, jsonb) to authenticated;

commit;
