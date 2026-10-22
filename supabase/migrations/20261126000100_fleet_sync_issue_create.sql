-- Offline issue reports: an idempotent create endpoint for ONE new issue.
-- The record is validated in full (reporter = caller, Open, no notes yet, live
-- vehicle in the company) and inserted through apply_fleet_changes, so the
-- existing insert policy (owners/admins/shop techs) and member issue trigger
-- still apply. An identity that already has any revision history is refused:
-- creates never overwrite or resurrect records. Retries return the original
-- receipt from fleet_sync_submissions; different work for the same operation
-- ID is rejected. Vehicles and other creates stay online-only.
begin;
grant create on schema public to fireops_sync_writer;
create function public.sync_fleet_create(operation jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  company uuid;
  operation_uuid uuid;
  record_uuid uuid;
  provenance jsonb := operation -> 'provenance';
  issue_data jsonb := operation -> 'mutation' -> 'record';
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
    or operation ->> 'entityType' is distinct from 'issue'
    or operation -> 'dependsOn' is distinct from '[]'::jsonb
    or jsonb_typeof(operation -> 'mutation') is distinct from 'object'
    or (select array_agg(k order by k collate "C") from jsonb_object_keys(operation -> 'mutation') k) is distinct from array['kind','record']
    or operation -> 'mutation' ->> 'kind' is distinct from 'create' then
    raise exception 'Only single issue creates are supported' using errcode = '22023';
  end if;
  company := (operation ->> 'companyId')::uuid; operation_uuid := (operation ->> 'operationId')::uuid; record_uuid := (operation ->> 'entityId')::uuid;
  if not (public.is_company_owner(company, actor) or exists (select 1 from public.company_members m where m.company_id = company and m.user_id = actor and m.role = 'shop_tech')) then
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
  perform (issue_data ->> 'createdAt')::timestamptz;
  request_hash := sha256(convert_to(operation::text, 'UTF8'));
  perform public.lock_fleet_sync_review(company, 'issue', record_uuid);
  perform pg_advisory_xact_lock(hashtextextended(company::text || ':' || actor::text || ':' || operation_uuid::text, 0));
  select * into previous from public.fleet_sync_submissions s where s.company_id = company and s.actor_user_id = actor and s.operation_id = operation_uuid;
  if found then
    if previous.request_sha256 <> request_hash then raise exception 'Operation ID was reused for different work' using errcode = '22023'; end if;
    return previous.result;
  end if;
  if exists (select 1 from public.fleet_sync_revisions r where r.company_id = company and r.collection = 'issues' and r.record_id = record_uuid)
    or exists (select 1 from public.fleet_issues i where i.company_id = company and i.record_id = record_uuid) then
    raise exception 'This record identity was already used' using errcode = '23505';
  end if;
  if not exists (select 1 from public.fleet_vehicles v where v.company_id = company and v.record_id = (issue_data ->> 'vehicleId')::uuid) then
    raise exception 'The vehicle is unavailable or was deleted' using errcode = '22023';
  end if;
  perform public.apply_fleet_changes(company, jsonb_build_array(jsonb_build_object('collection', 'issues', 'recordId', record_uuid, 'event', 'insert', 'data', issue_data)));
  select i.version into current_version from public.fleet_issues i where i.company_id = company and i.record_id = record_uuid;
  select nullif(full_name, '') into actor_label from public.profiles where user_id = actor;
  result := jsonb_build_object('kind', 'applied', 'receivedAt', receipt_time, 'revision', current_version::text, 'record', issue_data);
  insert into public.fleet_sync_submissions
    (company_id, actor_user_id, operation_id, entity_type, record_id, request_sha256, actor_name, device_id, saved_at, connectivity, received_at, applied_revision, result)
    values (company, actor, operation_uuid, 'issue', record_uuid, request_hash, actor_label, provenance ->> 'deviceId', device_time, provenance ->> 'connectivity', receipt_time, current_version, result);
  return result;
end;
$$;
alter function public.sync_fleet_create(jsonb) owner to fireops_sync_writer;
revoke all on function public.sync_fleet_create(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.sync_fleet_create(jsonb) to authenticated;
revoke create on schema public from fireops_sync_writer;
commit;
