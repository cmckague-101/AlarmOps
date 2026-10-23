-- Offline vehicle note creation through the user command registry
-- (sync_user_command). Edits and deletes stay online: they are last-write-wins
-- for every authorized user today and need revision tracking first.
-- * vehicle_note: `note.create` inserts one note with the device's client UUID.
--   Existing RLS (owner/admin/shop-tech, live vehicle), attribution and
--   notification triggers apply unchanged; the receipt makes the insert, and
--   so its notifications, happen once. created_at is server receipt time; the
--   device time stays in the receipt. A vehicle deleted meanwhile reports
--   notApplied = 'vehicle_deleted' and creates nothing. A reused note identity
--   with different content fails with 23505.
begin;

insert into public.user_sync_commands values ('vehicle_note','note.create',false);

grant create on schema public to fireops_sync_writer;
create function public.user_sync_state_vehicle_note(company uuid, actor uuid, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', n.id, 'vehicleId', n.vehicle_id, 'subject', n.subject, 'body', n.body, 'createdAt', n.created_at) from public.vehicle_notes n
    where n.id = record_uuid and n.company_id = company and n.created_by = actor;
$$;
create function public.user_sync_apply_vehicle_note(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare existing public.vehicle_notes;
begin
  if (select array_agg(k order by k collate "C") from jsonb_object_keys(payload) k) is distinct from array['body','subject','vehicleId']
    or jsonb_typeof(payload -> 'vehicleId') is distinct from 'string'
    or payload ->> 'vehicleId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(payload -> 'subject') is distinct from 'string' or char_length(btrim(payload ->> 'subject')) not between 1 and 160
    or jsonb_typeof(payload -> 'body') is distinct from 'string' or char_length(btrim(payload ->> 'body')) not between 1 and 5000 then
    raise exception 'Invalid vehicle note' using errcode = '22023';
  end if;
  if not public.can_access_vehicle_notes(company, actor) then raise exception 'Vehicle note access required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('vehicle-note:' || record_uuid::text, 0));
  if exists (select 1 from public.vehicle_notes n where n.id = record_uuid) then
    select * into existing from public.vehicle_notes n where n.id = record_uuid and n.company_id = company and n.created_by = actor;
    if existing.id is null or existing.vehicle_id <> (payload ->> 'vehicleId')::uuid
      or existing.subject <> btrim(payload ->> 'subject') or existing.body <> btrim(payload ->> 'body') then
      raise exception 'This note identity was already used' using errcode = '23505';
    end if;
    return '{}'::jsonb;
  end if;
  if not exists (select 1 from public.fleet_vehicles v where v.company_id = company and v.record_id = (payload ->> 'vehicleId')::uuid) then
    return jsonb_build_object('notApplied', 'vehicle_deleted');
  end if;
  insert into public.vehicle_notes (id, company_id, vehicle_id, subject, body, created_by_name)
    values (record_uuid, company, (payload ->> 'vehicleId')::uuid, btrim(payload ->> 'subject'), btrim(payload ->> 'body'), '');
  return '{}'::jsonb;
end;
$$;
alter function public.user_sync_state_vehicle_note(uuid, uuid, uuid) owner to fireops_sync_writer;
alter function public.user_sync_apply_vehicle_note(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
revoke all on function public.user_sync_state_vehicle_note(uuid, uuid, uuid), public.user_sync_apply_vehicle_note(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke create on schema public from fireops_sync_writer;
commit;
