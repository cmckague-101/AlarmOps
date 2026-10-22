-- First verified offline adapter: manager vehicle/issue detail UPDATEs only.
-- Assignments, readiness, files, inspections, crew, creates and deletes need
-- dedicated permission/invariant adapters before they can use this endpoint.
begin;

-- Replaceable access hooks. Defaults: current owners/admins only. A later
-- adapter widens them for crew roles with restricted fields; the production
-- RLS/role triggers still guard every resulting write.
create function public.fleet_sync_submitter_allowed(company uuid, actor uuid)
returns boolean language sql stable set search_path = '' as $$ select public.is_company_owner(company, actor); $$;
create function public.fleet_sync_reader_allowed(company uuid, actor uuid)
returns boolean language sql stable set search_path = '' as $$ select public.is_company_owner(company, actor); $$;
-- Raises when this submitter may not propose these fields.
create function public.validate_fleet_sync_submitter_patch(company uuid, actor uuid, entity text, patch jsonb)
returns void language sql stable set search_path = '' as $$ select; $$;
revoke all on function public.fleet_sync_submitter_allowed(uuid, uuid), public.fleet_sync_reader_allowed(uuid, uuid),
  public.validate_fleet_sync_submitter_patch(uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.fleet_sync_submitter_allowed(uuid, uuid), public.fleet_sync_reader_allowed(uuid, uuid),
  public.validate_fleet_sync_submitter_patch(uuid, uuid, text, jsonb) to fireops_sync_writer;


create table public.fleet_sync_submissions (
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_user_id uuid not null,
  operation_id uuid not null,
  entity_type text not null check (entity_type in ('vehicle','issue')),
  record_id uuid not null,
  request_sha256 bytea not null check (octet_length(request_sha256) = 32),
  actor_name text,
  device_id text not null,
  saved_at timestamptz not null,
  connectivity text not null check (connectivity in ('online','offline','unknown')),
  received_at timestamptz not null,
  -- Only actual mutations claim authorship of a revision, never no-op receipts.
  applied_revision bigint check (applied_revision > 0),
  result jsonb not null check (jsonb_typeof(result) = 'object' and result ->> 'kind' is not null and result ->> 'kind' in ('applied','awaiting_review')),
  primary key (company_id, actor_user_id, operation_id)
);
create index fleet_sync_submissions_revision_idx on public.fleet_sync_submissions(company_id, entity_type, record_id, applied_revision)
  where applied_revision is not null;
alter table public.fleet_sync_submissions enable row level security;
revoke all on public.fleet_sync_submissions from public, anon, authenticated, service_role;
grant select on public.fleet_sync_submissions to service_role;
grant select, insert on public.fleet_sync_submissions to fireops_sync_writer;
create policy "sync writer reads manager submissions" on public.fleet_sync_submissions
  for select to fireops_sync_writer using (public.is_company_owner(company_id, (select auth.uid()))
    or (actor_user_id = (select auth.uid()) and public.fleet_sync_submitter_allowed(company_id, (select auth.uid()))));
create policy "sync writer creates own manager submission" on public.fleet_sync_submissions
  for insert to fireops_sync_writer with check (
    actor_user_id = (select auth.uid()) and public.fleet_sync_submitter_allowed(company_id, (select auth.uid()))
  );

create table public.fleet_sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_user_id uuid not null,
  operation_id uuid not null,
  entity_type text not null check (entity_type in ('vehicle','issue')),
  record_id uuid not null,
  base_revision bigint not null check (base_revision > 0),
  current_revision bigint not null check (current_revision >= base_revision),
  base_record jsonb not null check (jsonb_typeof(base_record) = 'object'),
  current_record jsonb check (jsonb_typeof(current_record) = 'object'),
  proposed_record jsonb not null check (jsonb_typeof(proposed_record) = 'object'),
  reason text not null check (reason in ('fields','deleted','recreated')),
  field_conflicts jsonb not null check (jsonb_typeof(field_conflicts) = 'array'),
  provenance jsonb not null check (jsonb_typeof(provenance) = 'object'),
  current_provenance jsonb not null check (jsonb_typeof(current_provenance) = 'object'),
  received_at timestamptz not null,
  state text not null default 'pending' check (state in ('pending','resolved')),
  unique(company_id, actor_user_id, operation_id),
  check ((reason = 'deleted' and current_record is null) or (reason <> 'deleted' and current_record is not null)),
  foreign key(company_id, actor_user_id, operation_id)
    references public.fleet_sync_submissions(company_id, actor_user_id, operation_id)
    on delete cascade deferrable initially deferred
);
create index fleet_sync_conflicts_pending_idx on public.fleet_sync_conflicts(company_id, entity_type, record_id, received_at)
  where state = 'pending';
alter table public.fleet_sync_conflicts enable row level security;
revoke all on public.fleet_sync_conflicts from public, anon, authenticated, service_role;
grant select on public.fleet_sync_conflicts to authenticated, service_role;
grant select, insert on public.fleet_sync_conflicts to fireops_sync_writer;
create policy "managers read company sync conflicts" on public.fleet_sync_conflicts
  for select to authenticated using (public.is_company_owner(company_id, (select auth.uid())));
create policy "sync writer creates manager conflict" on public.fleet_sync_conflicts
  for insert to fireops_sync_writer with check (
    actor_user_id = (select auth.uid()) and public.fleet_sync_submitter_allowed(company_id, (select auth.uid()))
  );

-- The non-bypass executor can verify bases/read provenance, but only for a
-- currently managed company. Ordinary clients still have no ledger ACL.
grant select on public.fleet_sync_revisions to fireops_sync_writer;
create policy "sync writer reads managed fleet revisions" on public.fleet_sync_revisions
  for select to fireops_sync_writer using (public.fleet_sync_reader_allowed(company_id, (select auth.uid())));

-- SQL counterpart of @fireops/domain mergeSyncUpdate, covered by shared fixtures.
-- SQL NULL current_data means an authoritative deletion; JSON null is invalid.
create function public.merge_fleet_sync_fields(base_data jsonb, current_data jsonb, patch jsonb, field_groups jsonb default '[]'::jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  item record;
  proposed_value jsonb;
  related text[];
  conflicts jsonb := '[]'::jsonb;
  merged jsonb := current_data;
  changed jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(base_data) is distinct from 'object' or jsonb_typeof(patch) is distinct from 'object' then
    raise exception 'Invalid sync record or patch' using errcode = '22023';
  end if;
  for item in select key, value from jsonb_each(patch) loop
    if jsonb_typeof(item.value) is distinct from 'object' then
      raise exception 'Invalid sync field' using errcode = '22023';
    end if;
    if item.value -> 'present' is null or item.value -> 'present' not in ('true'::jsonb,'false'::jsonb)
      or (select count(*) from jsonb_object_keys(item.value)) <> (case when item.value -> 'present' = 'true'::jsonb then 2 else 1 end)
      or (item.value ? 'value') <> (item.value -> 'present' = 'true'::jsonb) then
      raise exception 'Invalid sync field presence' using errcode = '22023';
    end if;
  end loop;
  if current_data is null then return jsonb_build_object('kind','conflict','reason','deleted'); end if;
  if jsonb_typeof(current_data) <> 'object' or jsonb_typeof(field_groups) is distinct from 'array' then
    raise exception 'Invalid current record or field groups' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(field_groups) loop
    if jsonb_typeof(item.value) <> 'array' then raise exception 'Invalid field group' using errcode = '22023'; end if;
    if exists (select 1 from jsonb_array_elements(item.value) entry where jsonb_typeof(entry) <> 'string') then
      raise exception 'Invalid grouped field name' using errcode = '22023';
    end if;
  end loop;
  for item in select key, value from jsonb_each(patch) order by key collate "C" loop
    proposed_value := case when item.value -> 'present' = 'true'::jsonb then item.value -> 'value' end;
    if base_data -> item.key is not distinct from proposed_value or current_data -> item.key is not distinct from proposed_value then continue; end if;
    select coalesce(array_agg(distinct grouped.key order by grouped.key), '{}'::text[]) into related
      from jsonb_array_elements(field_groups) groups(fields)
      cross join lateral jsonb_array_elements_text(groups.fields) grouped(key)
      where groups.fields ? item.key and base_data -> grouped.key is distinct from current_data -> grouped.key;
    if base_data -> item.key is distinct from current_data -> item.key or cardinality(related) > 0 then
      conflicts := conflicts || jsonb_build_array(jsonb_build_object(
        'field', item.key,
        'reason', case when base_data -> item.key is distinct from current_data -> item.key then 'overlap' else 'related_fields' end,
        'base', case when base_data ? item.key then jsonb_build_object('present',true,'value',base_data -> item.key) else jsonb_build_object('present',false) end,
        'current', case when current_data ? item.key then jsonb_build_object('present',true,'value',current_data -> item.key) else jsonb_build_object('present',false) end,
        'proposed', item.value, 'relatedFields', to_jsonb(related)));
    else
      merged := case when item.value -> 'present' = 'true'::jsonb then jsonb_set(merged, array[item.key], proposed_value, true) else merged - item.key end;
      changed := changed || jsonb_build_array(item.key);
    end if;
  end loop;
  if jsonb_array_length(conflicts) > 0 then return jsonb_build_object('kind','conflict','reason','fields','fields',conflicts); end if;
  return jsonb_build_object('kind','merged','record',merged,'changedFields',changed);
end;
$$;
revoke all on function public.merge_fleet_sync_fields(jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.merge_fleet_sync_fields(jsonb, jsonb, jsonb, jsonb) to fireops_sync_writer;

-- One allowlist/value check shared by submission (purpose 'sync') and review
-- approval (purpose 'review', which revalidates possibly old candidates).
-- Later adapters extend it with `create or replace`; never relax a field here.
create function public.validate_fleet_sync_detail_field(company uuid, proposer uuid, entity text, record_uuid uuid, field text, slot jsonb, purpose text)
returns void language plpgsql stable set search_path = '' as $$
declare
  field_value jsonb := slot -> 'value';
  value_text text := slot ->> 'value';
begin
  if field <> all(case entity when 'vehicle' then array['unit','type','year','make','model','vin','plate','notes'] else array['title','description','priority'] end) then
    if purpose in ('review','review-field') then raise exception 'Field requires a different review adapter' using errcode = '22023'; end if;
    raise exception 'Field requires a different sync adapter: %', field using errcode = '22023';
  end if;
  if purpose = 'review-field' then return; end if; -- allowlist only
  if slot -> 'present' = 'false'::jsonb then
    if field not in ('vin','plate','notes') then raise exception 'Required detail field cannot be removed' using errcode = '22023'; end if;
  elsif field = 'year' then
    if jsonb_typeof(field_value) is distinct from 'number' or value_text !~ '^[0-9]{4}$' then raise exception 'Invalid vehicle year' using errcode = '22023'; end if;
  else
    if jsonb_typeof(field_value) is distinct from 'string' or char_length(value_text) > (case when field in ('notes','description') then 10000 else 200 end) then
      raise exception 'Invalid detail field value' using errcode = '22023';
    end if;
    if field in ('unit','type','make','model','title') and btrim(value_text) = '' then raise exception 'Detail field cannot be blank' using errcode = '22023'; end if;
    if field = 'priority' and value_text not in ('Low','Medium','High','Critical') then raise exception 'Invalid issue priority' using errcode = '22023'; end if;
  end if;
end;
$$;
revoke all on function public.validate_fleet_sync_detail_field(uuid, uuid, text, uuid, text, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.validate_fleet_sync_detail_field(uuid, uuid, text, uuid, text, jsonb, text) to fireops_sync_writer;

-- Replaceable adapter hooks (defaults = plain field merge, no extra effects).
-- Later adapters add invariant groups, append-only fields, record invariants
-- and audited side effects without copying the submission/approval functions.
create function public.fleet_sync_merge_detail(company uuid, actor uuid, entity text, base_data jsonb, current_data jsonb, patch jsonb)
returns jsonb language sql stable set search_path = '' as $$
  select public.merge_fleet_sync_fields(base_data, current_data, patch);
$$;
-- Raises when an assembled record violates domain invariants; `before` may be null.
create function public.validate_fleet_sync_record(company uuid, entity text, before_data jsonb, after_data jsonb)
returns void language sql stable set search_path = '' as $$ select; $$;
-- Extra apply_fleet_changes entries committed in the same transaction.
create function public.fleet_sync_detail_side_effects(company uuid, actor uuid, entity text, record_uuid uuid, before_data jsonb, after_data jsonb, provenance jsonb)
returns jsonb language sql stable set search_path = '' as $$ select '[]'::jsonb; $$;
revoke all on function public.fleet_sync_merge_detail(uuid, uuid, text, jsonb, jsonb, jsonb),
  public.validate_fleet_sync_record(uuid, text, jsonb, jsonb),
  public.fleet_sync_detail_side_effects(uuid, uuid, text, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.fleet_sync_merge_detail(uuid, uuid, text, jsonb, jsonb, jsonb),
  public.validate_fleet_sync_record(uuid, text, jsonb, jsonb),
  public.fleet_sync_detail_side_effects(uuid, uuid, text, uuid, jsonb, jsonb, jsonb) to fireops_sync_writer;

-- No privilege escalation through generic JSON: this adapter admits only manager
-- scalar-detail updates. Other workflows must implement their own allowlists,
-- permission checks and transactional invariants, not relax this function.
grant create on schema public to fireops_sync_writer;
create function public.sync_fleet_update(operation jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  company uuid;
  operation_uuid uuid;
  record_uuid uuid;
  entity text;
  collection_name text;
  table_name text;
  provenance jsonb;
  mutation jsonb;
  base_data jsonb;
  base_version bigint;
  patch jsonb;
  candidate jsonb;
  current_data jsonb;
  current_version bigint;
  base_hash bytea;
  latest_deleted boolean;
  result jsonb;
  merge_result jsonb;
  request_hash bytea;
  previous public.fleet_sync_submissions%rowtype;
  receipt_time timestamptz := clock_timestamp();
  device_time timestamptz;
  actor_label text;
  conflict_uuid uuid;
  conflict_reason text;
  field_context jsonb := '{}'::jsonb;
  applied_version bigint;
  item record;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(operation) is distinct from 'object' or octet_length(operation::text) > 1048576 then
    raise exception 'Invalid sync operation' using errcode = '22023';
  end if;
  if operation -> 'schemaVersion' is distinct from '1'::jsonb
    or not operation ?& array['schemaVersion','operationId','companyId','entityType','entityId','provenance','dependsOn','mutation']
    or exists (select 1 from jsonb_object_keys(operation) keys(key) where key <> all(array['schemaVersion','operationId','companyId','entityType','entityId','provenance','dependsOn','mutation'])) then
    raise exception 'Unsupported sync operation shape/version' using errcode = '22023';
  end if;
  if jsonb_typeof(operation -> 'companyId') <> 'string' or jsonb_typeof(operation -> 'operationId') <> 'string'
    or jsonb_typeof(operation -> 'entityId') <> 'string' then raise exception 'Invalid sync identity' using errcode = '22023'; end if;
  company := (operation ->> 'companyId')::uuid;
  operation_uuid := (operation ->> 'operationId')::uuid;
  record_uuid := (operation ->> 'entityId')::uuid;
  if company is null or operation_uuid is null or record_uuid is null then raise exception 'Missing sync identity' using errcode = '22023'; end if;
  -- Both initial submissions AND receipt replay require current manager access.
  if not public.fleet_sync_submitter_allowed(company, actor) then raise exception 'Company manager access required' using errcode = '42501'; end if;
  entity := operation ->> 'entityType';
  collection_name := case entity when 'vehicle' then 'vehicles' when 'issue' then 'issues' end;
  table_name := case entity when 'vehicle' then 'fleet_vehicles' when 'issue' then 'fleet_issues' end;
  if table_name is null then raise exception 'Unsupported sync entity' using errcode = '22023'; end if;
  provenance := operation -> 'provenance';
  if jsonb_typeof(provenance) is distinct from 'object' then raise exception 'Invalid sync provenance' using errcode = '22023'; end if;
  if (select count(*) from jsonb_object_keys(provenance)) <> 4
    or not provenance ?& array['userId','deviceId','savedAt','connectivity']
    or provenance ->> 'userId' is distinct from actor::text
    or jsonb_typeof(provenance -> 'deviceId') is distinct from 'string'
    or char_length(btrim(provenance ->> 'deviceId')) not between 1 and 200
    or jsonb_typeof(provenance -> 'savedAt') is distinct from 'string'
    or provenance ->> 'savedAt' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$'
    or provenance ->> 'connectivity' is null or provenance ->> 'connectivity' not in ('online','offline','unknown') then
    raise exception 'Invalid or misattributed sync provenance' using errcode = '22023';
  end if;
  device_time := (provenance ->> 'savedAt')::timestamptz;
  if not isfinite(device_time) then raise exception 'Invalid device time' using errcode = '22023'; end if;
  mutation := operation -> 'mutation';
  if jsonb_typeof(mutation) is distinct from 'object' then raise exception 'Invalid sync mutation' using errcode = '22023'; end if;
  if (select count(*) from jsonb_object_keys(mutation)) <> 4
    or not mutation ?& array['kind','baseRevision','base','patch'] or mutation ->> 'kind' is distinct from 'update'
    or jsonb_typeof(mutation -> 'baseRevision') is distinct from 'string'
    or mutation ->> 'baseRevision' !~ '^[1-9][0-9]{0,17}$' then
    raise exception 'Only versioned detail updates are supported' using errcode = '22023';
  end if;
  base_version := (mutation ->> 'baseRevision')::bigint;
  base_data := mutation -> 'base'; patch := mutation -> 'patch';
  -- Validate explicit presence markers and construct the original proposal.
  candidate := public.merge_fleet_sync_fields(base_data, base_data, patch) -> 'record';
  if base_data ->> 'id' is distinct from record_uuid::text then raise exception 'Base record identity mismatch' using errcode = '22023'; end if;
  for item in select key, value from jsonb_each(patch) loop
    perform public.validate_fleet_sync_detail_field(company, actor, entity, record_uuid, item.key, item.value, 'sync');
  end loop;
  perform public.validate_fleet_sync_submitter_patch(company, actor, entity, patch);
  if jsonb_typeof(operation -> 'dependsOn') is distinct from 'array' then raise exception 'Invalid sync dependencies' using errcode = '22023'; end if;
  if jsonb_array_length(operation -> 'dependsOn') > 100
    or exists (select 1 from jsonb_array_elements(operation -> 'dependsOn') dependency where jsonb_typeof(dependency) <> 'string')
    or (select count(distinct value) from jsonb_array_elements(operation -> 'dependsOn')) <> jsonb_array_length(operation -> 'dependsOn') then
    raise exception 'Invalid sync dependencies' using errcode = '22023';
  end if;
  request_hash := sha256(convert_to(operation::text,'UTF8'));
  perform pg_advisory_xact_lock(hashtextextended(company::text || ':' || actor::text || ':' || operation_uuid::text, 0));
  select * into previous from public.fleet_sync_submissions receipt
    where receipt.company_id = company and receipt.actor_user_id = actor and receipt.operation_id = operation_uuid;
  if found then
    if previous.request_sha256 <> request_hash then raise exception 'Operation ID was reused for different work' using errcode = '22023'; end if;
    return previous.result;
  end if;
  for item in select value #>> '{}' as id from jsonb_array_elements(operation -> 'dependsOn') loop
    if item.id::uuid = operation_uuid or not exists (select 1 from public.fleet_sync_submissions receipt
      where receipt.company_id = company and receipt.actor_user_id = actor and receipt.operation_id = item.id::uuid and receipt.result ->> 'kind' = 'applied') then
      raise exception 'Sync dependency has not been applied' using errcode = '55000';
    end if;
  end loop;
  select revision.data_sha256 into base_hash from public.fleet_sync_revisions revision
    where revision.company_id = company and revision.collection = collection_name and revision.record_id = record_uuid
      and revision.version = base_version and not revision.deleted;
  if base_hash is null then raise exception 'Base revision is unavailable; refresh required' using errcode = '55000'; end if;
  if base_hash <> sha256(convert_to(base_data::text,'UTF8')) then raise exception 'Base snapshot does not match its server revision' using errcode = '22023'; end if;

  -- Invoker table access through the non-bypass executor: retain production RLS.
  execute format('select data, version from public.%I where company_id=$1 and record_id=$2 for update', table_name)
    into current_data, current_version using company, record_uuid;
  if current_data is null then
    select revision.version, revision.deleted into current_version, latest_deleted from public.fleet_sync_revisions revision
      where revision.company_id = company and revision.collection = collection_name and revision.record_id = record_uuid
      order by revision.version desc limit 1;
    if latest_deleted is distinct from true then raise exception 'Record is unavailable' using errcode = '42501'; end if;
    conflict_reason := 'deleted';
  elsif exists (select 1 from public.fleet_sync_revisions revision where revision.company_id = company
    and revision.collection = collection_name and revision.record_id = record_uuid and revision.version > base_version and revision.deleted) then
    conflict_reason := 'recreated';
  else
    merge_result := public.fleet_sync_merge_detail(company, actor, entity, base_data, current_data, patch);
    if merge_result ->> 'kind' = 'conflict' then conflict_reason := 'fields';
    else perform public.validate_fleet_sync_record(company, entity, current_data, merge_result -> 'record'); end if;
  end if;
  select nullif(full_name,'') into actor_label from public.profiles where user_id = actor;
  if conflict_reason is null then
    if merge_result -> 'record' is distinct from current_data then
      result := public.apply_fleet_changes(company, jsonb_build_array(jsonb_build_object(
        'collection',collection_name,'recordId',record_uuid,'event','update','expectedVersion',current_version,'data',merge_result -> 'record'))
        || public.fleet_sync_detail_side_effects(company, actor, entity, record_uuid, current_data, merge_result -> 'record', provenance));
      execute format('select data, version from public.%I where company_id=$1 and record_id=$2', table_name)
        into current_data, current_version using company, record_uuid;
      applied_version := current_version;
    end if;
    result := jsonb_build_object('kind','applied','receivedAt',receipt_time,'revision',current_version::text,'record',current_data);
  else
    -- Preserve field-level authorship. Legacy writes have unknown connectivity;
    -- baseline timestamps are NOT represented as original edit times.
    select coalesce(jsonb_object_agg(fields.key, jsonb_build_object(
      'userId', latest.actor_user_id, 'actorName', coalesce(submission.actor_name, profile.full_name),
      'revision', latest.version::text, 'origin', latest.origin,
      'serverRecordedAt', case when latest.origin <> 'baseline' then latest.recorded_at end,
      'savedAt', submission.saved_at, 'deviceId', submission.device_id,
      'connectivity', coalesce(submission.connectivity,'unknown'))), '{}'::jsonb) into field_context
    from jsonb_object_keys(base_data || coalesce(current_data,'{}'::jsonb) || candidate) fields(key)
    left join lateral (
      select revision.* from public.fleet_sync_revisions revision where revision.company_id = company
        and revision.collection = collection_name and revision.record_id = record_uuid and revision.version <= current_version
        and fields.key = any(revision.changed_fields) order by revision.version desc limit 1
    ) latest on true
    left join public.fleet_sync_submissions submission on submission.company_id = company and submission.entity_type = entity
      and submission.record_id = record_uuid and submission.applied_revision = latest.version
    left join public.profiles profile on profile.user_id = latest.actor_user_id;
    conflict_uuid := gen_random_uuid();
    insert into public.fleet_sync_conflicts
      (id,company_id,actor_user_id,operation_id,entity_type,record_id,base_revision,current_revision,base_record,current_record,
       proposed_record,reason,field_conflicts,provenance,current_provenance,received_at)
      values (conflict_uuid,company,actor,operation_uuid,entity,record_uuid,base_version,current_version,base_data,current_data,
        candidate,conflict_reason,coalesce(merge_result -> 'fields','[]'::jsonb),
        provenance || jsonb_build_object('actorName',actor_label),field_context,receipt_time);
    result := jsonb_build_object('kind','awaiting_review','receivedAt',receipt_time,'conflictId',conflict_uuid);
  end if;
  insert into public.fleet_sync_submissions
    (company_id,actor_user_id,operation_id,entity_type,record_id,request_sha256,actor_name,device_id,saved_at,connectivity,received_at,applied_revision,result)
    values (company,actor,operation_uuid,entity,record_uuid,request_hash,actor_label,provenance ->> 'deviceId',device_time,
      provenance ->> 'connectivity',receipt_time,applied_version,result);
  return result;
end;
$$;
alter function public.sync_fleet_update(jsonb) owner to fireops_sync_writer;
revoke create on schema public from fireops_sync_writer;
revoke all on function public.sync_fleet_update(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.sync_fleet_update(jsonb) to authenticated;

commit;
