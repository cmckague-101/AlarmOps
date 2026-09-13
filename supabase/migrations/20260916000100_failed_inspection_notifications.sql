-- Allow crew to submit inspections without changing other vehicle data, then notify owners about failures.

create or replace function public.enforce_normalized_vehicle_changes()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  old_inspections jsonb := coalesce(old.data -> 'inspections', '[]'::jsonb);
  new_inspections jsonb := coalesce(new.data -> 'inspections', '[]'::jsonb);
begin
  if actor_id is null or public.is_company_owner(new.company_id, actor_id) then return new; end if;

  if old.data - 'assignedTo' - 'status' = new.data - 'assignedTo' - 'status' and (
    (coalesce(old.data ->> 'assignedTo', '') = '' and old.data ->> 'status' = 'Ready' and new.data ->> 'assignedTo' = actor_id::text and new.data ->> 'status' = 'Assigned')
    or
    (old.data ->> 'assignedTo' = actor_id::text and old.data ->> 'status' = 'Assigned' and coalesce(new.data ->> 'assignedTo', '') = '' and new.data ->> 'status' = 'Ready')
  ) then return new; end if;

  if old.data - 'inspections' = new.data - 'inspections'
    and jsonb_typeof(old_inspections) = 'array'
    and jsonb_typeof(new_inspections) = 'array'
    and jsonb_array_length(new_inspections) = jsonb_array_length(old_inspections) + 1
    and new_inspections - 0 = old_inspections
    and new_inspections -> 0 ->> 'inspectorId' = actor_id::text
  then return new; end if;

  raise exception 'Crew members may only assign ready vehicles to themselves, release their own assignments, or submit inspections' using errcode = '42501';
end;
$$;
revoke all on function public.enforce_normalized_vehicle_changes() from public, anon, authenticated;

create or replace function public.notify_failed_vehicle_inspection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  inspection jsonb;
  inspection_id text;
  failed_count integer;
  owner_id uuid;
  vehicle_name text;
  inspector_name text;
begin
  if jsonb_typeof(new.data -> 'inspections') <> 'array'
    or jsonb_array_length(new.data -> 'inspections') = 0
  then return new; end if;

  inspection := new.data -> 'inspections' -> 0;
  inspection_id := inspection ->> 'id';
  if inspection_id is null or exists (
    select 1 from jsonb_array_elements(coalesce(old.data -> 'inspections', '[]'::jsonb)) prior
    where prior ->> 'id' = inspection_id
  ) then return new; end if;

  select count(*) into failed_count
  from jsonb_array_elements(coalesce(inspection -> 'items', '[]'::jsonb)) item
  where item ->> 'result' = 'Fail';
  if failed_count = 0 then return new; end if;

  vehicle_name := coalesce(nullif(new.data ->> 'unit', ''), 'Vehicle');
  inspector_name := coalesce(nullif(inspection ->> 'inspectorName', ''), 'Crew member');
  for owner_id in
    select member.user_id from public.company_members member
    where member.company_id = new.company_id and member.role = 'owner'
  loop
    perform public.create_user_notification(
      new.company_id, owner_id, null,
      'system', 'vehicle', new.record_id,
      vehicle_name || ' failed inspection',
      inspector_name || ' reported ' || failed_count || case when failed_count = 1 then ' failed check.' else ' failed checks.' end,
      '/inspections',
      'inspection:' || inspection_id,
      'failed-inspection:' || inspection_id
    );
  end loop;
  return new;
end;
$$;
revoke all on function public.notify_failed_vehicle_inspection() from public, anon, authenticated;

drop trigger if exists fleet_vehicle_failed_inspection_notification on public.fleet_vehicles;
create trigger fleet_vehicle_failed_inspection_notification
  after update on public.fleet_vehicles
  for each row execute function public.notify_failed_vehicle_inspection();
