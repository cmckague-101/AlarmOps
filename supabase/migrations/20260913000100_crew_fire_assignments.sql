-- Crew may assign their own fleet vehicle to an incident or clear that fire assignment.
create or replace function public.enforce_normalized_vehicle_changes()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null
    or public.is_company_owner(new.company_id, actor_id)
    or public.has_system_admin_company_access(new.company_id)
  then
    return new;
  end if;

  -- Claim a ready, unassigned vehicle.
  if old.data - 'assignedTo' - 'status' = new.data - 'assignedTo' - 'status' and (
    coalesce(old.data ->> 'assignedTo', '') = ''
    and old.data ->> 'status' = 'Ready'
    and new.data ->> 'assignedTo' = actor_id::text
    and new.data ->> 'status' = 'Assigned'
  ) then
    return new;
  end if;

  -- Release own vehicle. Fire assignment must be cleared with it.
  if old.data - 'assignedTo' - 'status' - 'assignedFire' = new.data - 'assignedTo' - 'status' - 'assignedFire' and (
    old.data ->> 'assignedTo' = actor_id::text
    and old.data ->> 'status' = 'Assigned'
    and coalesce(new.data ->> 'assignedTo', '') = ''
    and new.data ->> 'status' = 'Ready'
    and not (new.data ? 'assignedFire')
  ) then
    return new;
  end if;

  -- Join, change, or leave a fire using vehicle assigned to actor.
  if old.data - 'assignedFire' - 'status' = new.data - 'assignedFire' - 'status' and (
    old.data ->> 'assignedTo' = actor_id::text
    and new.data ->> 'assignedTo' = actor_id::text
    and new.data ->> 'status' = 'Assigned'
  ) then
    return new;
  end if;

  raise exception 'Crew members may only assign ready vehicles to themselves, release their own assignments, or change fire assignment for their assigned vehicle' using errcode = '42501';
end;
$$;

revoke all on function public.enforce_normalized_vehicle_changes() from public, anon, authenticated;
