-- Offline removal of one entry inside a vehicle record (owners/admins), under
-- the decided policy: it applies only if that entry is unchanged since the
-- device saw it (otherwise notApplied 'changed_elsewhere'; already gone is a
-- no-op). Inspections or documents added by others meanwhile are kept.
-- * vehicle_inspection (entity = inspection ID): `inspection.delete`
--   {vehicleId, base: <inspection as seen>}; only failed inspections, as
--   online, with the same "failed inspection deleted" activity.
-- * vehicle_document (entity = document ID): `document.remove`
--   {vehicleId, base: <document as seen>}. Replacing a document offline is a
--   removal plus the existing offline document attach. The removed file is left
--   in storage (proven sync copies are retained anyway).
-- Both write through apply_fleet_changes under the vehicle's record-group lock
-- (the same lock fleet sync submissions take first), so revisions, RLS and
-- role triggers stay authoritative.
begin;

insert into public.user_sync_commands values ('vehicle_inspection','inspection.delete',false),('vehicle_document','document.remove',false);

grant create on schema public to fireops_sync_writer;
create function public.user_sync_vehicle_entry(company uuid, field text, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$
  select e from public.fleet_vehicles v cross join lateral jsonb_array_elements(coalesce(v.data -> field, '[]'::jsonb)) e
    where v.company_id = company and jsonb_typeof(v.data -> field) = 'array' and e ->> 'id' = record_uuid::text limit 1;
$$;
create function public.user_sync_state_vehicle_inspection(company uuid, actor uuid, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$ select public.user_sync_vehicle_entry(company, 'inspections', record_uuid) $$;
create function public.user_sync_state_vehicle_document(company uuid, actor uuid, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$ select public.user_sync_vehicle_entry(company, 'documents', record_uuid) $$;

create function public.user_sync_remove_vehicle_entry(company uuid, actor uuid, record_uuid uuid, field text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  vehicle uuid;
  current_data jsonb;
  current_version bigint;
  entry jsonb;
  unit text;
  actor_label text;
  activity uuid := gen_random_uuid();
  changes jsonb;
begin
  if (select array_agg(k order by k collate "C") from jsonb_object_keys(payload) k) is distinct from array['base','vehicleId']
    or jsonb_typeof(payload -> 'vehicleId') <> 'string' or payload ->> 'vehicleId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(payload -> 'base') <> 'object' or payload -> 'base' ->> 'id' is distinct from record_uuid::text then
    raise exception 'Invalid vehicle entry removal' using errcode = '22023';
  end if;
  if not public.is_company_owner(company, actor) then raise exception 'Company owner access required' using errcode = '42501'; end if;
  vehicle := (payload ->> 'vehicleId')::uuid;
  perform public.lock_fleet_sync_review(company, 'vehicle', vehicle);
  select v.data, v.version into current_data, current_version from public.fleet_vehicles v where v.company_id = company and v.record_id = vehicle for update;
  if current_data is null then return '{}'::jsonb; end if; -- vehicle gone: the entry is gone too
  select e into entry from jsonb_array_elements(case when jsonb_typeof(current_data -> field) = 'array' then current_data -> field else '[]'::jsonb end) e
    where e ->> 'id' = record_uuid::text limit 1;
  if entry is null then return '{}'::jsonb; end if;
  if entry is distinct from payload -> 'base' then return jsonb_build_object('notApplied', 'changed_elsewhere'); end if;
  if field = 'inspections' and not exists (select 1 from jsonb_array_elements(coalesce(entry -> 'items', '[]'::jsonb)) item where item ->> 'result' = 'Fail') then
    raise exception 'Only failed inspections can be deleted' using errcode = '22023';
  end if;
  changes := jsonb_build_array(jsonb_build_object('collection', 'vehicles', 'recordId', vehicle, 'event', 'update', 'expectedVersion', current_version,
    'data', current_data || jsonb_build_object(field, (select coalesce(jsonb_agg(e order by i), '[]'::jsonb) from jsonb_array_elements(current_data -> field) with ordinality t(e, i)
      where e ->> 'id' <> record_uuid::text))));
  if field = 'inspections' then
    unit := coalesce(nullif(current_data ->> 'unit', ''), 'Vehicle');
    select coalesce(nullif(p.full_name, ''), 'Company user') into actor_label from public.profiles p where p.user_id = actor;
    changes := changes || jsonb_build_array(jsonb_build_object('collection', 'activities', 'event', 'insert', 'recordId', activity, 'data', jsonb_build_object(
      'id', activity, 'action', unit || ' failed inspection deleted',
      'detail', 'Inspection by ' || coalesce(entry ->> 'inspectorName', 'Unknown') || ' · ' || coalesce(nullif(entry ->> 'assignmentIncident', ''), 'No assignment / incident') || ' · Synced from a device change (device-reported)',
      'createdBy', coalesce(actor_label, 'Company user'), 'createdById', actor, 'createdAt', to_jsonb(statement_timestamp()) #>> '{}',
      'targetType', 'vehicle', 'targetId', vehicle, 'tone', 'urgent')));
  end if;
  perform public.apply_fleet_changes(company, changes);
  return '{}'::jsonb;
end;
$$;
create function public.user_sync_apply_vehicle_inspection(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language sql volatile set search_path = '' as $$ select public.user_sync_remove_vehicle_entry(company, actor, record_uuid, 'inspections', payload) $$;
create function public.user_sync_apply_vehicle_document(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language sql volatile set search_path = '' as $$ select public.user_sync_remove_vehicle_entry(company, actor, record_uuid, 'documents', payload) $$;

alter function public.user_sync_vehicle_entry(uuid, text, uuid) owner to fireops_sync_writer;
alter function public.user_sync_state_vehicle_inspection(uuid, uuid, uuid) owner to fireops_sync_writer;
alter function public.user_sync_state_vehicle_document(uuid, uuid, uuid) owner to fireops_sync_writer;
alter function public.user_sync_remove_vehicle_entry(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
alter function public.user_sync_apply_vehicle_inspection(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
alter function public.user_sync_apply_vehicle_document(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
revoke all on function public.user_sync_vehicle_entry(uuid, text, uuid), public.user_sync_state_vehicle_inspection(uuid, uuid, uuid),
  public.user_sync_state_vehicle_document(uuid, uuid, uuid), public.user_sync_remove_vehicle_entry(uuid, uuid, uuid, text, jsonb),
  public.user_sync_apply_vehicle_inspection(uuid, uuid, uuid, text, jsonb), public.user_sync_apply_vehicle_document(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke create on schema public from fireops_sync_writer;
commit;
