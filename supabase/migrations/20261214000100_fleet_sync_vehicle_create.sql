-- Offline vehicle creation through the existing idempotent create endpoint
-- (20261126000100). Owners/admins only, as online. A new vehicle is fully
-- validated and starts Ready or Out of service, unassigned, without files,
-- documents or inspections (their own adapters add those later). It is
-- inserted through apply_fleet_changes together with the same "added to
-- fleet" activity the online form writes. An identity with any revision
-- history or an existing issue/vehicle row is refused (creates never overwrite
-- or resurrect). Issue creation is unchanged.
begin;
grant create on schema public to fireops_sync_writer;
create or replace function public.sync_fleet_create(operation jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  company uuid;
  operation_uuid uuid;
  record_uuid uuid;
  provenance jsonb := operation -> 'provenance';
  issue_data jsonb := operation -> 'mutation' -> 'record';
  entity text := operation ->> 'entityType';
  activity uuid := gen_random_uuid();
  collection_name text := case operation ->> 'entityType' when 'vehicle' then 'vehicles' else 'issues' end;
  device_time timestamptz;
  request_hash bytea;
  previous public.fleet_sync_submissions;
  actor_label text;
  current_version bigint;
  receipt_time timestamptz := statement_timestamp();
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(operation) is distinct from 'object' or octet_length(operation::text) > 1048576
    or operation -> 'schemaVersion' is distinct from '1'::jsonb
    or (select array_agg(k order by k collate "C") from jsonb_object_keys(operation) k)
      is distinct from array['companyId','dependsOn','entityId','entityType','mutation','operationId','provenance','schemaVersion']
    or operation ->> 'entityType' is null or operation ->> 'entityType' not in ('issue','vehicle')
    or operation -> 'dependsOn' is distinct from '[]'::jsonb
    or jsonb_typeof(operation -> 'mutation') is distinct from 'object'
    or (select array_agg(k order by k collate "C") from jsonb_object_keys(operation -> 'mutation') k) is distinct from array['kind','record']
    or operation -> 'mutation' ->> 'kind' is distinct from 'create' then
    raise exception 'Only single issue or vehicle creates are supported' using errcode = '22023';
  end if;
  company := (operation ->> 'companyId')::uuid; operation_uuid := (operation ->> 'operationId')::uuid; record_uuid := (operation ->> 'entityId')::uuid;
  if entity = 'vehicle' and not public.is_company_owner(company, actor) then
    raise exception 'Only owners and admins can add vehicles' using errcode = '42501';
  end if;
  if entity = 'issue' and not (public.is_company_owner(company, actor) or exists (select 1 from public.company_members m where m.company_id = company and m.user_id = actor and m.role = 'shop_tech')) then
    raise exception 'This role cannot report issues' using errcode = '42501';
  end if;
  if jsonb_typeof(provenance) is distinct from 'object'
    or (select array_agg(k order by k collate "C") from jsonb_object_keys(provenance) k) is distinct from array['connectivity','deviceId','savedAt','userId']
    or provenance ->> 'userId' is distinct from actor::text
    or jsonb_typeof(provenance -> 'deviceId') is distinct from 'string' or char_length(btrim(provenance ->> 'deviceId')) not between 1 and 200
    or jsonb_typeof(provenance -> 'savedAt') is distinct from 'string' or provenance ->> 'savedAt' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$'
    or provenance ->> 'connectivity' is null or provenance ->> 'connectivity' not in ('online','offline','unknown') then
    raise exception 'Invalid or misattributed sync provenance' using errcode = '22023';
  end if;
  device_time := (provenance ->> 'savedAt')::timestamptz;
  if entity = 'vehicle' then
    -- A new vehicle starts Ready or Out of service, unassigned, with no files,
    -- documents or inspections (those are added by their own adapters later).
    if jsonb_typeof(issue_data) is distinct from 'object'
      or (select array_agg(k order by k collate "C") from jsonb_object_keys(issue_data) k)
        is distinct from array['createdAt','id','make','model','notes','plate','status','type','unit','vin','year']
      or issue_data ->> 'id' is distinct from record_uuid::text
      or exists (select 1 from unnest(array['unit','type','make','model']) f where jsonb_typeof(issue_data -> f) <> 'string' or btrim(issue_data ->> f) = '' or char_length(issue_data ->> f) > 200)
      or exists (select 1 from unnest(array['vin','plate']) f where jsonb_typeof(issue_data -> f) <> 'string' or char_length(issue_data ->> f) > 200)
      or jsonb_typeof(issue_data -> 'notes') <> 'string' or char_length(issue_data ->> 'notes') > 10000
      or jsonb_typeof(issue_data -> 'year') <> 'number' or issue_data ->> 'year' !~ '^[0-9]{4}$'
      or issue_data ->> 'status' is null or issue_data ->> 'status' not in ('Ready','Out of service')
      or jsonb_typeof(issue_data -> 'createdAt') <> 'string' or issue_data ->> 'createdAt' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then
      raise exception 'Invalid new vehicle' using errcode = '22023';
    end if;
  else
    if jsonb_typeof(issue_data) is distinct from 'object'
      or (select array_agg(k order by k collate "C") from jsonb_object_keys(issue_data) k)
        is distinct from array['createdAt','createdBy','createdById','description','id','priority','status','title','updates','vehicleId']
      or issue_data ->> 'id' is distinct from record_uuid::text or issue_data ->> 'createdById' is distinct from actor::text
      or issue_data ->> 'vehicleId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(issue_data -> 'title') <> 'string' or btrim(issue_data ->> 'title') = '' or char_length(issue_data ->> 'title') > 200
      or jsonb_typeof(issue_data -> 'description') <> 'string' or btrim(issue_data ->> 'description') = '' or char_length(issue_data ->> 'description') > 10000
      or issue_data ->> 'priority' is null or issue_data ->> 'priority' not in ('Low','Medium','High','Critical')
      or issue_data -> 'status' is distinct from '"Open"'::jsonb or issue_data -> 'updates' is distinct from '[]'::jsonb
      or jsonb_typeof(issue_data -> 'createdBy') <> 'string' or char_length(issue_data ->> 'createdBy') not between 1 and 200
      or jsonb_typeof(issue_data -> 'createdAt') <> 'string' or issue_data ->> 'createdAt' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then
      raise exception 'Invalid new issue' using errcode = '22023';
    end if;
  end if;
  perform (issue_data ->> 'createdAt')::timestamptz;
  request_hash := sha256(convert_to(operation::text, 'UTF8'));
  perform public.lock_fleet_sync_review(company, entity, record_uuid);
  perform pg_advisory_xact_lock(hashtextextended(company::text || ':' || actor::text || ':' || operation_uuid::text, 0));
  select * into previous from public.fleet_sync_submissions s where s.company_id = company and s.actor_user_id = actor and s.operation_id = operation_uuid;
  if found then
    if previous.request_sha256 <> request_hash then raise exception 'Operation ID was reused for different work' using errcode = '22023'; end if;
    return previous.result;
  end if;
  if exists (select 1 from public.fleet_sync_revisions r where r.company_id = company and r.collection = collection_name and r.record_id = record_uuid)
    or exists (select 1 from public.fleet_issues i where i.company_id = company and i.record_id = record_uuid)
    or exists (select 1 from public.fleet_vehicles v where v.company_id = company and v.record_id = record_uuid) then
    raise exception 'This record identity was already used' using errcode = '23505';
  end if;
  select nullif(full_name, '') into actor_label from public.profiles where user_id = actor;
  if entity = 'vehicle' then
    -- Same activity entry the online add writes, plus device-reported provenance.
    perform public.apply_fleet_changes(company, jsonb_build_array(
      jsonb_build_object('collection', 'vehicles', 'recordId', record_uuid, 'event', 'insert', 'data', issue_data),
      jsonb_build_object('collection', 'activities', 'event', 'insert', 'recordId', activity, 'data', jsonb_build_object(
        'id', activity, 'action', (issue_data ->> 'unit') || ' added to fleet',
        'detail', 'Vehicle record created · Synced from a device change saved ' || (provenance ->> 'connectivity') || ' at ' || (provenance ->> 'savedAt') || ' (device-reported)',
        'createdBy', coalesce(actor_label, 'Company user'), 'createdById', actor, 'createdAt', to_jsonb(receipt_time) #>> '{}',
        'targetType', 'vehicle', 'targetId', record_uuid, 'tone', 'complete'))));
    select v.version into current_version from public.fleet_vehicles v where v.company_id = company and v.record_id = record_uuid;
  else
    if not exists (select 1 from public.fleet_vehicles v where v.company_id = company and v.record_id = (issue_data ->> 'vehicleId')::uuid) then
      raise exception 'The vehicle is unavailable or was deleted' using errcode = '22023';
    end if;
    perform public.apply_fleet_changes(company, jsonb_build_array(jsonb_build_object('collection', 'issues', 'recordId', record_uuid, 'event', 'insert', 'data', issue_data)));
    select i.version into current_version from public.fleet_issues i where i.company_id = company and i.record_id = record_uuid;
  end if;
  result := jsonb_build_object('kind', 'applied', 'receivedAt', receipt_time, 'revision', current_version::text, 'record', issue_data);
  insert into public.fleet_sync_submissions
    (company_id, actor_user_id, operation_id, entity_type, record_id, request_sha256, actor_name, device_id, saved_at, connectivity, received_at, applied_revision, result)
    values (company, actor, operation_uuid, entity, record_uuid, request_hash, actor_label, provenance ->> 'deviceId', device_time, provenance ->> 'connectivity', receipt_time, current_version, result);
  return result;
end;
$$;
revoke create on schema public from fireops_sync_writer;
commit;
