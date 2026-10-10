-- Fire fighters can view fleet records, but cannot create vehicle issues or inspections.

drop policy if exists "members add fleet issues" on public.fleet_issues;
create policy "authorized roles add fleet issues" on public.fleet_issues for insert to authenticated
with check (
  updated_by = auth.uid()
  and (
    public.is_company_owner(fleet_issues.company_id, auth.uid())
    or exists (
      select 1
      from public.company_members member
      where member.company_id = fleet_issues.company_id
        and member.user_id = auth.uid()
        and member.role = 'shop_tech'
    )
  )
);

create or replace function public.enforce_normalized_vehicle_changes()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  old_inspections jsonb := coalesce(old.data -> 'inspections', '[]'::jsonb);
  new_inspections jsonb := coalesce(new.data -> 'inspections', '[]'::jsonb);
begin
  if actor_id is null
    or public.is_company_owner(new.company_id, actor_id)
    or public.has_system_admin_company_access(new.company_id)
  then
    return new;
  end if;

  select member.role into actor_role
  from public.company_members member
  where member.company_id = new.company_id and member.user_id = actor_id;

  -- Claim a ready, unassigned vehicle.
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

  -- Shop techs may add one inspection without changing vehicle details.
  if actor_role = 'shop_tech'
    and old.data - 'inspections' = new.data - 'inspections'
    and jsonb_typeof(old_inspections) = 'array'
    and jsonb_typeof(new_inspections) = 'array'
    and jsonb_array_length(new_inspections) = jsonb_array_length(old_inspections) + 1
    and new_inspections - 0 = old_inspections
    and new_inspections -> 0 ->> 'inspectorId' = actor_id::text
  then
    return new;
  end if;

  raise exception 'This role cannot make the requested vehicle change' using errcode = '42501';
end;
$$;

revoke all on function public.enforce_normalized_vehicle_changes() from public, anon, authenticated;
