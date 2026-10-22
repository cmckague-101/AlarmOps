-- Offline status, assignment and issue-update adapter (owners/admins), through
-- the existing verified detail-update path:
-- * vehicle status/assignedTo/assignedFire and issue status/resolvedAt are
--   invariant groups: any concurrent change to the group conflicts as a unit;
-- * assembled records (merge or review choices) must satisfy assignment and
--   resolution invariants, and assignees must be current company members;
-- * issue `updates` is append-only: new entries are prepended to whatever is
--   current, so concurrent notes never conflict and none is overwritten;
-- * applied vehicle status/assignment changes add an activity entry in the
--   same transaction, labeled with device-reported provenance.
-- Firefighter self-claim/release still requires a connection (member read and
-- download endpoints are manager-only); the role trigger keeps guarding them.
begin;

create or replace function public.validate_fleet_sync_detail_field(company uuid, proposer uuid, entity text, record_uuid uuid, field text, slot jsonb, purpose text)
returns void language plpgsql stable set search_path = '' as $$
declare
  field_value jsonb := slot -> 'value';
  value_text text := slot ->> 'value';
  path_parts text[];
  file_owner uuid;
  copied_attachment uuid;
begin
  if entity = 'vehicle' and field in ('photo','contract','viprChecklist','registration','insurance','dotInspection') then
    if purpose = 'review-field' or slot -> 'present' = 'false'::jsonb then return; end if;
    path_parts := regexp_match(coalesce(field_value ->> 'path', ''),
      '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/sync-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$');
    if jsonb_typeof(field_value) is distinct from 'object'
      or (select array_agg(k order by k collate "C") from jsonb_object_keys(field_value) k) is distinct from array['dataUrl','name','path','type']
      or field_value -> 'dataUrl' is distinct from '""'::jsonb or path_parts is null or path_parts[1]::uuid <> company then
      raise exception 'Vehicle file must reference a verified sync upload' using errcode = '22023';
    end if;
    file_owner := path_parts[2]::uuid; copied_attachment := path_parts[3]::uuid;
    if purpose = 'sync' and file_owner is distinct from proposer then raise exception 'Vehicle file belongs to another account' using errcode = '42501'; end if;
    if not exists (select 1 from public.fleet_sync_attachment_copies c
        join public.fleet_sync_attachment_uploads u on u.company_id = c.company_id and u.user_id = c.user_id and u.attachment_id = c.attachment_id
        join storage.objects o on o.bucket_id = 'fleet-files' and o.name = c.destination_path and o.id = c.copy_object_id
        where c.company_id = company and c.user_id = file_owner and c.attachment_id = copied_attachment and c.vehicle_id = record_uuid
          and u.receipt is not null and u.manifest ->> 'name' = field_value ->> 'name' and u.content_type = field_value ->> 'type') then
      raise exception 'Vehicle file copy is not verified for this vehicle' using errcode = '55000';
    end if;
    return;
  end if;
  if (entity = 'vehicle' and field in ('status','assignedTo','assignedFire')) or (entity = 'issue' and field in ('status','resolvedAt','updates')) then
    if purpose = 'review-field' then return; end if;
    if field = 'updates' then
      -- Entries are checked against the base in the merge hook.
      if purpose = 'review' then raise exception 'Issue updates are appended automatically; keep the current updates' using errcode = '22023'; end if;
      if slot -> 'present' = 'false'::jsonb or jsonb_typeof(field_value) is distinct from 'array' or jsonb_array_length(field_value) > 1000 then
        raise exception 'Invalid issue updates' using errcode = '22023';
      end if;
      return;
    end if;
    if slot -> 'present' = 'false'::jsonb then
      if field = 'status' then raise exception 'Required detail field cannot be removed' using errcode = '22023'; end if;
      return;
    end if;
    if field = 'status' then
      if jsonb_typeof(field_value) is distinct from 'string'
        or value_text <> all(case entity when 'vehicle' then array['Ready','Assigned','Out of service'] else array['Open','Resolved'] end) then
        raise exception 'Invalid status' using errcode = '22023';
      end if;
    elsif field = 'assignedTo' then
      if jsonb_typeof(field_value) is distinct from 'string' or value_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Invalid assignee' using errcode = '22023';
      end if;
    elsif field = 'assignedFire' then
      if jsonb_typeof(field_value) is distinct from 'object'
        or (select array_agg(k order by k collate "C") from jsonb_object_keys(field_value) k) is distinct from array['id','name','state']
        or exists (select 1 from jsonb_each(field_value) e where jsonb_typeof(e.value) <> 'string' or char_length(e.value #>> '{}') not between 1 and 200) then
        raise exception 'Invalid fire assignment' using errcode = '22023';
      end if;
    elsif field = 'resolvedAt' then
      if jsonb_typeof(field_value) is distinct from 'string' or value_text !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then
        raise exception 'Invalid resolution time' using errcode = '22023';
      end if;
      perform value_text::timestamptz;
    end if;
    return;
  end if;
  if field <> all(case entity when 'vehicle' then array['unit','type','year','make','model','vin','plate','notes'] else array['title','description','priority'] end) then
    if purpose in ('review','review-field') then raise exception 'Field requires a different review adapter' using errcode = '22023'; end if;
    raise exception 'Field requires a different sync adapter: %', field using errcode = '22023';
  end if;
  if purpose = 'review-field' then return; end if;
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

create or replace function public.fleet_sync_merge_detail(company uuid, actor uuid, entity text, base_data jsonb, current_data jsonb, patch jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  proposed jsonb;
  base_updates jsonb;
  added jsonb;
  added_count int;
  entry jsonb;
begin
  if entity = 'issue' and patch ? 'updates' then
    if (select count(*) from jsonb_object_keys(patch)) <> 1 then
      raise exception 'Issue updates are saved separately from other issue changes' using errcode = '22023';
    end if;
    proposed := patch -> 'updates' -> 'value';
    base_updates := coalesce(base_data -> 'updates', '[]'::jsonb);
    if jsonb_typeof(base_updates) <> 'array' then raise exception 'Invalid base issue updates' using errcode = '22023'; end if;
    added_count := jsonb_array_length(proposed) - jsonb_array_length(base_updates);
    -- Append-only: new entries first, then the exact base list unchanged.
    if added_count < 1 or added_count > 20 or coalesce((select jsonb_agg(e order by i) from jsonb_array_elements(proposed) with ordinality t(e, i) where i > added_count), '[]'::jsonb) <> base_updates then
      raise exception 'Issue updates can only add new entries' using errcode = '22023';
    end if;
    select jsonb_agg(e order by i) into added from jsonb_array_elements(proposed) with ordinality t(e, i) where i <= added_count;
    for entry in select value from jsonb_array_elements(added) loop
      if jsonb_typeof(entry) <> 'object'
        or (select array_agg(k order by k collate "C") from jsonb_object_keys(entry) k) is distinct from array['createdAt','createdBy','createdById','id','text']
        or entry ->> 'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or entry ->> 'createdById' is distinct from actor::text
        or jsonb_typeof(entry -> 'text') <> 'string' or btrim(entry ->> 'text') = '' or char_length(entry ->> 'text') > 2000
        or jsonb_typeof(entry -> 'createdBy') <> 'string' or char_length(entry ->> 'createdBy') not between 1 and 200
        or jsonb_typeof(entry -> 'createdAt') <> 'string' or entry ->> 'createdAt' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then
        raise exception 'Invalid issue update entry' using errcode = '22023';
      end if;
      perform (entry ->> 'createdAt')::timestamptz;
    end loop;
    if (select count(distinct e ->> 'id') from jsonb_array_elements(added) e) <> added_count then raise exception 'Duplicate issue update entry' using errcode = '22023'; end if;
    -- Skip entries already present (an earlier delivery of the same note).
    return jsonb_build_object('kind', 'merged', 'changedFields', '["updates"]'::jsonb, 'record', current_data || jsonb_build_object('updates',
      coalesce((select jsonb_agg(e order by i) from jsonb_array_elements(added) with ordinality t(e, i)
        where not exists (select 1 from jsonb_array_elements(coalesce(current_data -> 'updates', '[]'::jsonb)) c where c ->> 'id' = e ->> 'id')), '[]'::jsonb)
      || coalesce(current_data -> 'updates', '[]'::jsonb)));
  end if;
  return public.merge_fleet_sync_fields(base_data, current_data, patch,
    case entity when 'vehicle' then '[["status","assignedTo","assignedFire"]]'::jsonb when 'issue' then '[["status","resolvedAt"]]'::jsonb else '[]'::jsonb end);
end;
$$;

create or replace function public.validate_fleet_sync_record(company uuid, entity text, before_data jsonb, after_data jsonb)
returns void language plpgsql stable set search_path = '' as $$
declare
  assignee text;
begin
  if after_data is null then return; end if;
  if entity = 'vehicle' and (before_data is null
      or (after_data -> 'status', after_data -> 'assignedTo', after_data -> 'assignedFire')
        is distinct from (before_data -> 'status', before_data -> 'assignedTo', before_data -> 'assignedFire')) then
    assignee := nullif(after_data ->> 'assignedTo', '');
    if after_data ->> 'status' is null or after_data ->> 'status' not in ('Ready','Assigned','Out of service')
      or (after_data ->> 'status' = 'Assigned') <> (assignee is not null)
      or (after_data ? 'assignedFire' and assignee is null) then
      raise exception 'Vehicle status and assignment are inconsistent' using errcode = '22023';
    end if;
    if assignee is not null and not exists (select 1 from public.company_members m where m.company_id = company and m.user_id::text = assignee) then
      raise exception 'Assignee is not a current company member' using errcode = '22023';
    end if;
  elsif entity = 'issue' and (before_data is null
      or (after_data -> 'status', after_data -> 'resolvedAt') is distinct from (before_data -> 'status', before_data -> 'resolvedAt')) then
    if after_data ->> 'status' is null or after_data ->> 'status' not in ('Open','Resolved')
      or (after_data ->> 'status' = 'Resolved') <> (after_data ? 'resolvedAt') then
      raise exception 'Issue status and resolution time are inconsistent' using errcode = '22023';
    end if;
  end if;
end;
$$;

create or replace function public.fleet_sync_detail_side_effects(company uuid, actor uuid, entity text, record_uuid uuid, before_data jsonb, after_data jsonb, provenance jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  actor_label text;
  action text;
  unit text;
  activity uuid := gen_random_uuid();
begin
  if entity <> 'vehicle' or before_data is null or after_data is null then return '[]'::jsonb; end if;
  unit := coalesce(nullif(after_data ->> 'unit', ''), 'Vehicle');
  if after_data -> 'status' is distinct from before_data -> 'status' then action := unit || ' status changed to ' || (after_data ->> 'status');
  elsif after_data -> 'assignedTo' is distinct from before_data -> 'assignedTo' then action := unit || ' assignment updated';
  elsif after_data -> 'assignedFire' is distinct from before_data -> 'assignedFire' then action := unit || ' fire assignment updated';
  else return '[]'::jsonb; end if;
  select coalesce(nullif(full_name, ''), 'Company user') into actor_label from public.profiles where user_id = actor;
  return jsonb_build_array(jsonb_build_object('collection', 'activities', 'event', 'insert', 'recordId', activity, 'data', jsonb_build_object(
    'id', activity, 'action', action,
    'detail', 'Synced from a device change saved ' || coalesce(provenance ->> 'connectivity', 'unknown') || ' at ' || coalesce(provenance ->> 'savedAt', 'an unknown time') || ' (device-reported)',
    'createdBy', coalesce(actor_label, 'Company user'), 'createdById', actor, 'createdAt', to_jsonb(statement_timestamp()) #>> '{}',
    'targetType', 'vehicle', 'targetId', record_uuid,
    'tone', case when after_data ->> 'status' = 'Out of service' then 'urgent' else 'complete' end)));
end;
$$;
commit;
