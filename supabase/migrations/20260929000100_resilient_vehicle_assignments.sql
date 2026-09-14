-- Keep crew assignment rules aligned with normalized client status values and
-- preserve fire-assignment access when inspection support is added.
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
  if actor_id is null
    or public.is_company_owner(new.company_id, actor_id)
    or public.has_system_admin_company_access(new.company_id)
  then
    return new;
  end if;

  -- Claim a ready, unassigned vehicle. Older imported records may contain
  -- harmless surrounding whitespace even though clients display them as Ready.
  if old.data - 'assignedTo' - 'status' = new.data - 'assignedTo' - 'status' and (
    coalesce(old.data ->> 'assignedTo', '') = ''
    and btrim(old.data ->> 'status') = 'Ready'
    and new.data ->> 'assignedTo' = actor_id::text
    and btrim(new.data ->> 'status') = 'Assigned'
  ) then
    return new;
  end if;

  -- Release own vehicle. Fire assignment must be cleared with it.
  if old.data - 'assignedTo' - 'status' - 'assignedFire' = new.data - 'assignedTo' - 'status' - 'assignedFire' and (
    old.data ->> 'assignedTo' = actor_id::text
    and btrim(old.data ->> 'status') = 'Assigned'
    and coalesce(new.data ->> 'assignedTo', '') = ''
    and btrim(new.data ->> 'status') = 'Ready'
    and not (new.data ? 'assignedFire')
  ) then
    return new;
  end if;

  -- Join, change, or leave a fire using vehicle assigned to actor.
  if old.data - 'assignedFire' - 'status' = new.data - 'assignedFire' - 'status' and (
    old.data ->> 'assignedTo' = actor_id::text
    and new.data ->> 'assignedTo' = actor_id::text
    and btrim(new.data ->> 'status') = 'Assigned'
  ) then
    return new;
  end if;

  -- Add one inspection without changing vehicle details.
  if old.data - 'inspections' = new.data - 'inspections'
    and jsonb_typeof(old_inspections) = 'array'
    and jsonb_typeof(new_inspections) = 'array'
    and jsonb_array_length(new_inspections) = jsonb_array_length(old_inspections) + 1
    and new_inspections - 0 = old_inspections
    and new_inspections -> 0 ->> 'inspectorId' = actor_id::text
  then
    return new;
  end if;

  raise exception 'Crew members may only assign ready vehicles to themselves, release their own assignments, change fire assignment for their assigned vehicle, or submit inspections' using errcode = '42501';
end;
$$;

revoke all on function public.enforce_normalized_vehicle_changes() from public, anon, authenticated;
