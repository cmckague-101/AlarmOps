-- Members may report and update issues, but only company owners may change vehicle records.
-- Enforce this in the database so a modified browser client cannot bypass the UI.
create or replace function public.enforce_owner_vehicle_changes()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  vehicles_changed boolean;
begin
  -- Allow trusted server and administrative SQL operations. RLS still governs browser clients.
  if actor_id is null then
    return new;
  end if;

  vehicles_changed := case
    when tg_op = 'INSERT' then coalesce(new.data -> 'vehicles', '[]'::jsonb) <> '[]'::jsonb
    else coalesce(new.data -> 'vehicles', '[]'::jsonb)
      is distinct from coalesce(old.data -> 'vehicles', '[]'::jsonb)
  end;

  if vehicles_changed and not exists (
    select 1
    from public.company_members
    where company_id = new.company_id
      and user_id = actor_id
      and role = 'owner'
  ) then
    raise exception 'Only company owners may change vehicle details'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_owner_vehicle_changes() from public, anon, authenticated;

create trigger fleet_state_owner_vehicle_changes
before insert or update of data on public.fleet_state
for each row execute function public.enforce_owner_vehicle_changes();
