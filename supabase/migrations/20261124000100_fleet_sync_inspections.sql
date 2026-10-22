-- Offline vehicle inspections (owners/admins; shop techs server-side), through
-- the verified detail-update path:
-- * `inspections` is append-only: exactly one new inspection, prepended to the
--   exact base list, is prepended to the CURRENT list (never conflicts, never
--   drops others). Edits and deletions stay online-only.
-- * entries are validated (own inspector, item shapes, required photos); every
--   photo must be a server-proven fleet-files copy for this vehicle, exactly like
--   file slots (shared validate_fleet_sync_vehicle_file);
-- * an applied inspection adds the same "inspection completed" activity entry
--   online saves add, in the same transaction.
-- Shop techs may submit inspections (their role trigger still requires exactly
-- one own inspection and no other changes); attachment uploads remain
-- owner/admin, so shop-tech offline inspections cannot carry photos yet.
begin;

-- Proven-copy check shared by file slots and inspection photos.
create function public.validate_fleet_sync_vehicle_file(company uuid, proposer uuid, record_uuid uuid, file jsonb, purpose text)
returns void language plpgsql stable set search_path = '' as $$
declare
  path_parts text[] := regexp_match(coalesce(file ->> 'path', ''),
    '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/sync-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$');
begin
  if jsonb_typeof(file) is distinct from 'object'
    or (select array_agg(k order by k collate "C") from jsonb_object_keys(file) k) is distinct from array['dataUrl','name','path','type']
    or file -> 'dataUrl' is distinct from '""'::jsonb or path_parts is null or path_parts[1]::uuid <> company then
    raise exception 'Vehicle file must reference a verified sync upload' using errcode = '22023';
  end if;
  if purpose = 'sync' and path_parts[2]::uuid is distinct from proposer then raise exception 'Vehicle file belongs to another account' using errcode = '42501'; end if;
  if not exists (select 1 from public.fleet_sync_attachment_copies c
      join public.fleet_sync_attachment_uploads u on u.company_id = c.company_id and u.user_id = c.user_id and u.attachment_id = c.attachment_id
      join storage.objects o on o.bucket_id = 'fleet-files' and o.name = c.destination_path and o.id = c.copy_object_id
      where c.company_id = company and c.user_id = path_parts[2]::uuid and c.attachment_id = path_parts[3]::uuid and c.vehicle_id = record_uuid
        and u.receipt is not null and u.manifest ->> 'name' = file ->> 'name' and u.content_type = file ->> 'type') then
    raise exception 'Vehicle file copy is not verified for this vehicle' using errcode = '55000';
  end if;
end;
$$;
revoke all on function public.validate_fleet_sync_vehicle_file(uuid, uuid, uuid, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.validate_fleet_sync_vehicle_file(uuid, uuid, uuid, jsonb, text) to fireops_sync_writer;

create or replace function public.validate_fleet_sync_detail_field(company uuid, proposer uuid, entity text, record_uuid uuid, field text, slot jsonb, purpose text)
returns void language plpgsql stable set search_path = '' as $$
declare
  field_value jsonb := slot -> 'value';
  value_text text := slot ->> 'value';
begin
  if entity = 'vehicle' and field in ('photo','contract','viprChecklist','registration','insurance','dotInspection') then
    if purpose = 'review-field' or slot -> 'present' = 'false'::jsonb then return; end if;
    perform public.validate_fleet_sync_vehicle_file(company, proposer, record_uuid, field_value, purpose);
    return;
  end if;
  if entity = 'vehicle' and field = 'inspections' then
    if purpose = 'review-field' then return; end if;
    -- Entries (including photo proofs) are checked against the base in the merge hook.
    if purpose = 'review' then raise exception 'Inspections are appended automatically; keep the current inspections' using errcode = '22023'; end if;
    if slot -> 'present' = 'false'::jsonb or jsonb_typeof(field_value) is distinct from 'array' or jsonb_array_length(field_value) > 1000 then
      raise exception 'Invalid vehicle inspections' using errcode = '22023';
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

create or replace function public.fleet_sync_inspection_problem(company uuid, actor uuid, record_uuid uuid, entry jsonb)
returns void language plpgsql stable set search_path = '' as $$
declare item jsonb;
begin
  if jsonb_typeof(entry) <> 'object'
    or (select array_agg(k order by k collate "C") from jsonb_object_keys(entry) k) is distinct from array['assignmentIncident','createdAt','id','inspectorId','inspectorName','items']
    or entry ->> 'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or entry ->> 'inspectorId' is distinct from actor::text
    or jsonb_typeof(entry -> 'assignmentIncident') <> 'string' or char_length(entry ->> 'assignmentIncident') > 200
    or jsonb_typeof(entry -> 'inspectorName') <> 'string' or char_length(entry ->> 'inspectorName') not between 1 and 200
    or jsonb_typeof(entry -> 'createdAt') <> 'string' or entry ->> 'createdAt' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$'
    or jsonb_typeof(entry -> 'items') <> 'array' or jsonb_array_length(entry -> 'items') not between 1 and 100 then
    raise exception 'Invalid inspection' using errcode = '22023';
  end if;
  perform (entry ->> 'createdAt')::timestamptz;
  for item in select value from jsonb_array_elements(entry -> 'items') loop
    if jsonb_typeof(item) <> 'object'
      or exists (select 1 from jsonb_object_keys(item) k where k not in ('id','label','kind','result','defectNotes','photo'))
      or jsonb_typeof(item -> 'id') is distinct from 'string' or char_length(item ->> 'id') not between 1 and 100
      or jsonb_typeof(item -> 'label') is distinct from 'string' or char_length(item ->> 'label') not between 1 and 200
      or (item ? 'kind' and item ->> 'kind' not in ('pass_fail','photo'))
      or (item ? 'result' and item ->> 'result' not in ('Pass','Fail'))
      or (item ? 'defectNotes' and (jsonb_typeof(item -> 'defectNotes') <> 'string' or char_length(item ->> 'defectNotes') > 2000))
      or (item ->> 'kind' = 'photo' and not item ? 'photo')
      or (coalesce(item ->> 'kind', 'pass_fail') = 'pass_fail' and not item ? 'result') then
      raise exception 'Invalid inspection item' using errcode = '22023';
    end if;
    if item ? 'photo' then perform public.validate_fleet_sync_vehicle_file(company, actor, record_uuid, item -> 'photo', 'sync'); end if;
  end loop;
  if (select count(distinct value ->> 'id') from jsonb_array_elements(entry -> 'items')) <> jsonb_array_length(entry -> 'items') then
    raise exception 'Duplicate inspection item' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.fleet_sync_inspection_problem(uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.fleet_sync_inspection_problem(uuid, uuid, uuid, jsonb) to fireops_sync_writer;

-- Generic append for issue notes and vehicle inspections.
create or replace function public.fleet_sync_merge_detail(company uuid, actor uuid, entity text, base_data jsonb, current_data jsonb, patch jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  field text := case when entity = 'issue' and patch ? 'updates' then 'updates' when entity = 'vehicle' and patch ? 'inspections' then 'inspections' end;
  proposed jsonb;
  base_entries jsonb;
  added jsonb;
  added_count int;
  entry jsonb;
begin
  if field is not null then
    if (select count(*) from jsonb_object_keys(patch)) <> 1 then
      raise exception '% are saved separately from other changes', case field when 'updates' then 'Issue updates' else 'Inspections' end using errcode = '22023';
    end if;
    proposed := patch -> field -> 'value';
    base_entries := coalesce(base_data -> field, '[]'::jsonb);
    if jsonb_typeof(base_entries) <> 'array' then raise exception 'Invalid base list' using errcode = '22023'; end if;
    added_count := jsonb_array_length(proposed) - jsonb_array_length(base_entries);
    if added_count < 1 or added_count > (case field when 'updates' then 20 else 1 end)
      or coalesce((select jsonb_agg(e order by i) from jsonb_array_elements(proposed) with ordinality t(e, i) where i > added_count), '[]'::jsonb) <> base_entries then
      raise exception '% can only add new entries', case field when 'updates' then 'Issue updates' else 'Inspections' end using errcode = '22023';
    end if;
    select jsonb_agg(e order by i) into added from jsonb_array_elements(proposed) with ordinality t(e, i) where i <= added_count;
    for entry in select value from jsonb_array_elements(added) loop
      if field = 'inspections' then
        perform public.fleet_sync_inspection_problem(company, actor, (base_data ->> 'id')::uuid, entry);
      else
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
      end if;
    end loop;
    if (select count(distinct e ->> 'id') from jsonb_array_elements(added) e) <> added_count then raise exception 'Duplicate entry' using errcode = '22023'; end if;
    return jsonb_build_object('kind', 'merged', 'changedFields', jsonb_build_array(field), 'record', current_data || jsonb_build_object(field,
      coalesce((select jsonb_agg(e order by i) from jsonb_array_elements(added) with ordinality t(e, i)
        where not exists (select 1 from jsonb_array_elements(coalesce(current_data -> field, '[]'::jsonb)) c where c ->> 'id' = e ->> 'id')), '[]'::jsonb)
      || coalesce(current_data -> field, '[]'::jsonb)));
  end if;
  return public.merge_fleet_sync_fields(base_data, current_data, patch,
    case entity when 'vehicle' then '[["status","assignedTo","assignedFire"]]'::jsonb when 'issue' then '[["status","resolvedAt"]]'::jsonb else '[]'::jsonb end);
end;
$$;

create or replace function public.fleet_sync_detail_side_effects(company uuid, actor uuid, entity text, record_uuid uuid, before_data jsonb, after_data jsonb, provenance jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  actor_label text;
  action text;
  detail text;
  tone text;
  unit text;
  added jsonb;
  failed int;
  activity uuid := gen_random_uuid();
begin
  if entity <> 'vehicle' or before_data is null or after_data is null then return '[]'::jsonb; end if;
  unit := coalesce(nullif(after_data ->> 'unit', ''), 'Vehicle');
  tone := case when after_data ->> 'status' = 'Out of service' then 'urgent' else 'complete' end;
  if after_data -> 'inspections' is distinct from before_data -> 'inspections' then
    select e into added from jsonb_array_elements(coalesce(after_data -> 'inspections', '[]'::jsonb)) e
      where not exists (select 1 from jsonb_array_elements(coalesce(before_data -> 'inspections', '[]'::jsonb)) b where b ->> 'id' = e ->> 'id') limit 1;
    if added is null then return '[]'::jsonb; end if;
    select count(*) into failed from jsonb_array_elements(added -> 'items') item where item ->> 'result' = 'Fail';
    action := unit || ' inspection completed';
    detail := failed || ' failed checks · ' || coalesce(nullif(added ->> 'assignmentIncident', ''), 'No assignment / incident');
    tone := case when failed > 0 then 'urgent' else 'complete' end;
  elsif after_data -> 'status' is distinct from before_data -> 'status' then action := unit || ' status changed to ' || (after_data ->> 'status');
  elsif after_data -> 'assignedTo' is distinct from before_data -> 'assignedTo' then action := unit || ' assignment updated';
  elsif after_data -> 'assignedFire' is distinct from before_data -> 'assignedFire' then action := unit || ' fire assignment updated';
  else return '[]'::jsonb; end if;
  detail := coalesce(detail || ' · ', '') || 'Synced from a device change saved ' || coalesce(provenance ->> 'connectivity', 'unknown') || ' at ' || coalesce(provenance ->> 'savedAt', 'an unknown time') || ' (device-reported)';
  select coalesce(nullif(full_name, ''), 'Company user') into actor_label from public.profiles where user_id = actor;
  return jsonb_build_array(jsonb_build_object('collection', 'activities', 'event', 'insert', 'recordId', activity, 'data', jsonb_build_object(
    'id', activity, 'action', action, 'detail', detail,
    'createdBy', coalesce(actor_label, 'Company user'), 'createdById', actor, 'createdAt', to_jsonb(statement_timestamp()) #>> '{}',
    'targetType', 'vehicle', 'targetId', record_uuid, 'tone', tone)));
end;
$$;

create or replace function public.validate_fleet_sync_submitter_patch(company uuid, actor uuid, entity text, patch jsonb)
returns void language plpgsql stable set search_path = '' as $$
declare
  shop_tech boolean := exists (select 1 from public.company_members m where m.company_id = company and m.user_id = actor and m.role = 'shop_tech');
begin
  if public.is_company_owner(company, actor) then return; end if;
  if entity = 'vehicle' and shop_tech and patch ? 'inspections' then return; end if; -- alone; role trigger checks the rest
  if (entity = 'vehicle' and exists (select 1 from jsonb_object_keys(patch) k where k not in ('status','assignedTo','assignedFire')))
    or (entity = 'issue' and exists (select 1 from jsonb_object_keys(patch) k where k <> 'updates'))
    or entity not in ('vehicle','issue') then
    raise exception 'This role can only claim/release vehicles, add issue notes or (shop techs) add inspections offline' using errcode = '42501';
  end if;
end;
$$;
commit;
