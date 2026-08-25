-- Crew members may claim ready vehicles for themselves and release their own assignments.
-- Owners retain full vehicle management access.
create or replace function public.enforce_owner_vehicle_changes()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  old_vehicles jsonb;
  new_vehicles jsonb := coalesce(new.data -> 'vehicles', '[]'::jsonb);
  vehicles_changed boolean;
begin
  -- Allow trusted server and administrative SQL operations. RLS still governs browser clients.
  if actor_id is null then
    return new;
  end if;

  if public.is_system_admin() or exists (
    select 1
    from public.company_members
    where company_id = new.company_id
      and user_id = actor_id
      and role = 'owner'
  ) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new_vehicles = '[]'::jsonb then
      return new;
    end if;

    raise exception 'Only company owners may add vehicle details'
      using errcode = '42501';
  end if;

  old_vehicles := coalesce(old.data -> 'vehicles', '[]'::jsonb);
  vehicles_changed := new_vehicles is distinct from old_vehicles;

  if not vehicles_changed then
    return new;
  end if;

  -- Self-assignment cannot add, remove, duplicate, or otherwise edit vehicle records.
  if jsonb_array_length(old_vehicles) <> jsonb_array_length(new_vehicles)
    or (select count(distinct vehicle ->> 'id') from jsonb_array_elements(old_vehicles) vehicle)
      <> jsonb_array_length(old_vehicles)
    or (select count(distinct vehicle ->> 'id') from jsonb_array_elements(new_vehicles) vehicle)
      <> jsonb_array_length(new_vehicles)
    or exists (
      select 1
      from jsonb_array_elements(old_vehicles) old_vehicle
      full join jsonb_array_elements(new_vehicles) new_vehicle
        on old_vehicle ->> 'id' = new_vehicle ->> 'id'
      where old_vehicle is null
        or new_vehicle is null
        or not (
          old_vehicle = new_vehicle
          or (
            old_vehicle - 'assignedTo' - 'status' = new_vehicle - 'assignedTo' - 'status'
            and (
              (
                coalesce(old_vehicle ->> 'assignedTo', '') = ''
                and old_vehicle ->> 'status' = 'Ready'
                and new_vehicle ->> 'assignedTo' = actor_id::text
                and new_vehicle ->> 'status' = 'Assigned'
              )
              or (
                old_vehicle ->> 'assignedTo' = actor_id::text
                and old_vehicle ->> 'status' = 'Assigned'
                and coalesce(new_vehicle ->> 'assignedTo', '') = ''
                and new_vehicle ->> 'status' = 'Ready'
              )
            )
          )
        )
    )
  then
    raise exception 'Crew members may only assign ready vehicles to themselves or release their own assignments'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_owner_vehicle_changes() from public, anon, authenticated;
