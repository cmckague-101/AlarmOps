-- Crew resolve/reopen offline: an issue status change saved together with one
-- own note (the member issue trigger already requires exactly that for crew).
-- * fleet_sync_merge_detail: an issue patch with status (and resolvedAt) plus
--   `updates` adding exactly one entry merges the status group, then appends
--   the note. If the issue already has the proposed status, the current
--   status/resolution time is kept and only the note is added (never a
--   conflict). Managers may send the same combined change.
-- * validate_fleet_sync_submitter_patch: crew issue changes may carry
--   status/resolvedAt only together with a note. The role trigger still
--   requires the reporter's own issue and one own note per write.
-- Otherwise identical to the 20261124000100 definitions.
begin;

create or replace function public.fleet_sync_merge_detail(company uuid, actor uuid, entity text, base_data jsonb, current_data jsonb, patch jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  field text := case when entity = 'issue' and patch ? 'updates' then 'updates' when entity = 'vehicle' and patch ? 'inspections' then 'inspections' end;
  proposed jsonb;
  base_entries jsonb;
  added jsonb;
  added_count int;
  entry jsonb;
  status_result jsonb;
  noted jsonb;
begin
  -- Crew resolve/reopen: one status change plus exactly one own note in the
  -- same change (the member issue trigger requires the note). If the issue
  -- already has the proposed status, the current status/resolution is kept and
  -- only the note is added, so this never conflicts.
  if entity = 'issue' and patch ? 'updates' and patch ? 'status' then
    if exists (select 1 from jsonb_object_keys(patch) k where k not in ('status','resolvedAt','updates'))
      or jsonb_array_length(coalesce(patch -> 'updates' -> 'value', '[]'::jsonb)) - jsonb_array_length(coalesce(base_data -> 'updates', '[]'::jsonb)) <> 1 then
      raise exception 'A status change carries exactly one new note' using errcode = '22023';
    end if;
    if current_data -> 'status' is not distinct from patch -> 'status' -> 'value' then
      status_result := jsonb_build_object('kind', 'merged', 'record', current_data, 'changedFields', '[]'::jsonb);
    else
      status_result := public.merge_fleet_sync_fields(base_data, current_data, patch - 'updates', '[["status","resolvedAt"]]'::jsonb);
      if status_result ->> 'kind' <> 'merged' then return status_result; end if;
    end if;
    noted := public.fleet_sync_merge_detail(company, actor, entity, base_data, status_result -> 'record', jsonb_build_object('updates', patch -> 'updates'));
    return jsonb_build_object('kind', 'merged', 'record', noted -> 'record', 'changedFields', (status_result -> 'changedFields') || '["updates"]'::jsonb);
  end if;
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

create or replace function public.validate_fleet_sync_submitter_patch(company uuid, actor uuid, entity text, patch jsonb)
returns void language plpgsql stable set search_path = '' as $$
declare
  shop_tech boolean := exists (select 1 from public.company_members m where m.company_id = company and m.user_id = actor and m.role = 'shop_tech');
begin
  if public.is_company_owner(company, actor) then return; end if;
  if entity = 'vehicle' and shop_tech and patch ? 'inspections' then return; end if; -- alone; role trigger checks the rest
  if (entity = 'vehicle' and exists (select 1 from jsonb_object_keys(patch) k where k not in ('status','assignedTo','assignedFire')))
    or (entity = 'issue' and (exists (select 1 from jsonb_object_keys(patch) k where k not in ('updates','status','resolvedAt')) or not patch ? 'updates'))
    or entity not in ('vehicle','issue') then
    raise exception 'This role can only claim/release vehicles, add issue notes (optionally resolving/reopening) or (shop techs) add inspections offline' using errcode = '42501';
  end if;
end;
$$;
commit;
