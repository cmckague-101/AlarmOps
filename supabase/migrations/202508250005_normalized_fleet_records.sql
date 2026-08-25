-- Store fleet records independently so unrelated user changes cannot overwrite each other.
create table public.fleet_vehicles (
  company_id uuid not null references public.companies(id) on delete cascade,
  record_id uuid not null,
  data jsonb not null check (jsonb_typeof(data) = 'object' and data ->> 'id' = record_id::text),
  version bigint not null default 1 check (version > 0),
  updated_by uuid not null references public.profiles(user_id),
  updated_at timestamptz not null default now(),
  primary key (company_id, record_id)
);

create table public.fleet_issues (like public.fleet_vehicles including all);
create table public.fleet_crew (like public.fleet_vehicles including all);
create table public.fleet_activities (like public.fleet_vehicles including all);

alter table public.fleet_issues
  add constraint fleet_issues_company_id_fkey foreign key (company_id) references public.companies(id) on delete cascade,
  add constraint fleet_issues_updated_by_fkey foreign key (updated_by) references public.profiles(user_id);
alter table public.fleet_crew
  add constraint fleet_crew_company_id_fkey foreign key (company_id) references public.companies(id) on delete cascade,
  add constraint fleet_crew_updated_by_fkey foreign key (updated_by) references public.profiles(user_id);
alter table public.fleet_activities
  add constraint fleet_activities_company_id_fkey foreign key (company_id) references public.companies(id) on delete cascade,
  add constraint fleet_activities_updated_by_fkey foreign key (updated_by) references public.profiles(user_id);

create trigger fleet_vehicles_touch_updated_at before update on public.fleet_vehicles for each row execute function public.touch_updated_at();
create trigger fleet_issues_touch_updated_at before update on public.fleet_issues for each row execute function public.touch_updated_at();
create trigger fleet_crew_touch_updated_at before update on public.fleet_crew for each row execute function public.touch_updated_at();
create trigger fleet_activities_touch_updated_at before update on public.fleet_activities for each row execute function public.touch_updated_at();

alter table public.fleet_vehicles enable row level security;
alter table public.fleet_issues enable row level security;
alter table public.fleet_crew enable row level security;
alter table public.fleet_activities enable row level security;

create or replace function public.is_company_owner(target_company_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_system_admin() or exists (
    select 1 from public.company_members
    where company_id = target_company_id and user_id = target_user_id and role = 'owner'
  );
$$;
revoke all on function public.is_company_owner(uuid, uuid) from public, anon;
grant execute on function public.is_company_owner(uuid, uuid) to authenticated;

create policy "members read fleet vehicles" on public.fleet_vehicles for select to authenticated
using (public.is_company_member(company_id, auth.uid()) or public.is_system_admin());
create policy "owners add fleet vehicles" on public.fleet_vehicles for insert to authenticated
with check (public.is_company_owner(company_id, auth.uid()) and updated_by = auth.uid());
create policy "members update fleet vehicles" on public.fleet_vehicles for update to authenticated
using (public.is_company_member(company_id, auth.uid()) or public.is_system_admin())
with check ((public.is_company_member(company_id, auth.uid()) or public.is_system_admin()) and updated_by = auth.uid());
create policy "owners delete fleet vehicles" on public.fleet_vehicles for delete to authenticated
using (public.is_company_owner(company_id, auth.uid()));

create or replace function public.enforce_normalized_vehicle_changes()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null or public.is_company_owner(new.company_id, actor_id) then return new; end if;
  if old.data - 'assignedTo' - 'status' = new.data - 'assignedTo' - 'status' and (
    (coalesce(old.data ->> 'assignedTo', '') = '' and old.data ->> 'status' = 'Ready' and new.data ->> 'assignedTo' = actor_id::text and new.data ->> 'status' = 'Assigned')
    or
    (old.data ->> 'assignedTo' = actor_id::text and old.data ->> 'status' = 'Assigned' and coalesce(new.data ->> 'assignedTo', '') = '' and new.data ->> 'status' = 'Ready')
  ) then return new; end if;
  raise exception 'Crew members may only assign ready vehicles to themselves or release their own assignments' using errcode = '42501';
end;
$$;
revoke all on function public.enforce_normalized_vehicle_changes() from public, anon, authenticated;
create trigger fleet_vehicles_member_changes before update on public.fleet_vehicles
for each row execute function public.enforce_normalized_vehicle_changes();

create policy "members read fleet issues" on public.fleet_issues for select to authenticated
using (public.is_company_member(company_id, auth.uid()) or public.is_system_admin());
create policy "members add fleet issues" on public.fleet_issues for insert to authenticated
with check ((public.is_company_member(company_id, auth.uid()) or public.is_system_admin()) and updated_by = auth.uid());
create policy "members update fleet issues" on public.fleet_issues for update to authenticated
using (public.is_company_member(company_id, auth.uid()) or public.is_system_admin())
with check ((public.is_company_member(company_id, auth.uid()) or public.is_system_admin()) and updated_by = auth.uid());
create policy "owners delete fleet issues" on public.fleet_issues for delete to authenticated
using (public.is_company_owner(company_id, auth.uid()));

create policy "members read fleet crew" on public.fleet_crew for select to authenticated
using (public.is_company_member(company_id, auth.uid()) or public.is_system_admin());
create policy "owners add fleet crew" on public.fleet_crew for insert to authenticated
with check (public.is_company_owner(company_id, auth.uid()) and updated_by = auth.uid());
create policy "owners update fleet crew" on public.fleet_crew for update to authenticated
using (public.is_company_owner(company_id, auth.uid()))
with check (public.is_company_owner(company_id, auth.uid()) and updated_by = auth.uid());
create policy "owners delete fleet crew" on public.fleet_crew for delete to authenticated
using (public.is_company_owner(company_id, auth.uid()));

create policy "members read fleet activities" on public.fleet_activities for select to authenticated
using (public.is_company_member(company_id, auth.uid()) or public.is_system_admin());
create policy "members add fleet activities" on public.fleet_activities for insert to authenticated
with check ((public.is_company_member(company_id, auth.uid()) or public.is_system_admin()) and updated_by = auth.uid());
create policy "owners delete fleet activities" on public.fleet_activities for delete to authenticated
using (public.is_company_owner(company_id, auth.uid()));

revoke all on public.fleet_vehicles, public.fleet_issues, public.fleet_crew, public.fleet_activities from anon;
grant select, insert, update, delete on public.fleet_vehicles, public.fleet_issues, public.fleet_crew, public.fleet_activities to authenticated;

-- Copy existing snapshots once. Invalid legacy IDs are skipped rather than blocking deployment.
insert into public.fleet_vehicles (company_id, record_id, data, updated_by, updated_at)
select state.company_id, (record ->> 'id')::uuid, record, state.updated_by, state.updated_at
from public.fleet_state state cross join lateral jsonb_array_elements(state.data -> 'vehicles') record
where record ->> 'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
on conflict do nothing;
insert into public.fleet_issues (company_id, record_id, data, updated_by, updated_at)
select state.company_id, (record ->> 'id')::uuid, record, state.updated_by, state.updated_at
from public.fleet_state state cross join lateral jsonb_array_elements(state.data -> 'issues') record
where record ->> 'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
on conflict do nothing;
insert into public.fleet_crew (company_id, record_id, data, updated_by, updated_at)
select state.company_id, (record ->> 'id')::uuid, record, state.updated_by, state.updated_at
from public.fleet_state state cross join lateral jsonb_array_elements(state.data -> 'crew') record
where record ->> 'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
on conflict do nothing;
insert into public.fleet_activities (company_id, record_id, data, updated_by, updated_at)
select state.company_id, (record ->> 'id')::uuid, record, state.updated_by, state.updated_at
from public.fleet_state state cross join lateral jsonb_array_elements(state.data -> 'activities') record
where record ->> 'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
on conflict do nothing;

do $$
declare table_name text;
begin
  foreach table_name in array array['fleet_vehicles','fleet_issues','fleet_crew','fleet_activities'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end
$$;
