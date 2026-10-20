-- Close pilot-readiness gaps: scoped administrator access, member issue integrity,
-- server-attributed activity, and atomic optimistic fleet writes.

create table public.system_admin_company_access (
  user_id uuid not null references public.system_admins(user_id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (user_id, company_id)
);

alter table public.system_admin_company_access enable row level security;
revoke all on public.system_admin_company_access from public, anon, authenticated;
grant select on public.system_admin_company_access to service_role;

create or replace function public.has_system_admin_company_access(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_system_admin() and exists (
    select 1
    from public.system_admin_company_access access
    where access.user_id = auth.uid()
      and access.company_id = target_company_id
      and access.expires_at > now()
  );
$$;
revoke all on function public.has_system_admin_company_access(uuid) from public, anon;
grant execute on function public.has_system_admin_company_access(uuid) to authenticated;

create or replace function public.admin_access_company(target_company_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_system_admin() then
    raise exception 'System administrator access required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.companies where id = target_company_id) then
    raise exception 'Company not found' using errcode = 'P0002';
  end if;

  insert into public.system_admin_company_access (user_id, company_id, expires_at)
  values (auth.uid(), target_company_id, now() + interval '1 hour')
  on conflict (user_id, company_id) do update set expires_at = excluded.expires_at;

  insert into public.system_admin_audit_log (actor_user_id, action, company_id, details)
  values (auth.uid(), 'company.accessed', target_company_id, jsonb_build_object('expires_at', now() + interval '1 hour'));
  return true;
end;
$$;
revoke all on function public.admin_access_company(uuid) from public, anon;
grant execute on function public.admin_access_company(uuid) to authenticated;

create or replace function public.is_company_owner(target_company_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_system_admin_company_access(target_company_id) or exists (
    select 1 from public.company_members
    where company_id = target_company_id and user_id = target_user_id and role = 'owner'
  );
$$;
revoke all on function public.is_company_owner(uuid, uuid) from public, anon;
grant execute on function public.is_company_owner(uuid, uuid) to authenticated;

-- Existing admin policies granted global fleet access. Replace them with audited,
-- time-limited company access.
drop policy if exists "admins read all fleet state" on public.fleet_state;
drop policy if exists "admins create fleet state" on public.fleet_state;
drop policy if exists "admins update fleet state" on public.fleet_state;
create policy "scoped admins read fleet state" on public.fleet_state for select to authenticated
using (public.has_system_admin_company_access(company_id));
create policy "scoped admins create fleet state" on public.fleet_state for insert to authenticated
with check (public.has_system_admin_company_access(company_id) and updated_by = auth.uid());
create policy "scoped admins update fleet state" on public.fleet_state for update to authenticated
using (public.has_system_admin_company_access(company_id))
with check (public.has_system_admin_company_access(company_id) and updated_by = auth.uid());

drop policy if exists "admins read fleet files" on storage.objects;
drop policy if exists "admins upload fleet files" on storage.objects;
drop policy if exists "admins delete own fleet files" on storage.objects;
create policy "scoped admins read fleet files" on storage.objects for select to authenticated
using (
  bucket_id = 'fleet-files'
  and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then public.has_system_admin_company_access(((storage.foldername(name))[1])::uuid) else false end
);
create policy "scoped admins upload fleet files" on storage.objects for insert to authenticated
with check (
  bucket_id = 'fleet-files'
  and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then public.has_system_admin_company_access(((storage.foldername(name))[1])::uuid) else false end
  and (storage.foldername(name))[2] = auth.uid()::text
);
create policy "scoped admins delete fleet files" on storage.objects for delete to authenticated
using (
  bucket_id = 'fleet-files'
  and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then public.has_system_admin_company_access(((storage.foldername(name))[1])::uuid) else false end
);

-- Fold scoped admin access into normalized policies. Member behavior remains
-- unchanged except issue visibility, which now matches the product UI.
drop policy if exists "members read fleet vehicles" on public.fleet_vehicles;
create policy "members read fleet vehicles" on public.fleet_vehicles for select to authenticated
using (public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id));

drop policy if exists "members update fleet vehicles" on public.fleet_vehicles;
create policy "members update fleet vehicles" on public.fleet_vehicles for update to authenticated
using (public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id))
with check ((public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id)) and updated_by = auth.uid());

drop policy if exists "members read fleet issues" on public.fleet_issues;
create policy "members read fleet issues" on public.fleet_issues for select to authenticated
using (
  public.is_company_owner(company_id, auth.uid())
  or (
    public.is_company_member(company_id, auth.uid())
    and data ->> 'createdById' = auth.uid()::text
  )
);

drop policy if exists "members add fleet issues" on public.fleet_issues;
create policy "members add fleet issues" on public.fleet_issues for insert to authenticated
with check ((public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id)) and updated_by = auth.uid());

drop policy if exists "members update fleet issues" on public.fleet_issues;
create policy "members update fleet issues" on public.fleet_issues for update to authenticated
using (public.is_company_owner(company_id, auth.uid()) or data ->> 'createdById' = auth.uid()::text)
with check ((public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id)) and updated_by = auth.uid());

drop policy if exists "members read fleet crew" on public.fleet_crew;
create policy "members read fleet crew" on public.fleet_crew for select to authenticated
using (public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id));

drop policy if exists "members read fleet activities" on public.fleet_activities;
create policy "members read fleet activities" on public.fleet_activities for select to authenticated
using (public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id));

drop policy if exists "members add fleet activities" on public.fleet_activities;
create policy "members add fleet activities" on public.fleet_activities for insert to authenticated
with check ((public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id)) and updated_by = auth.uid());

create or replace function public.company_crew_seats_used(target_company_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare seats_used integer;
begin
  if auth.uid() is null
    or (not public.is_company_member(target_company_id, auth.uid()) and not public.has_system_admin_company_access(target_company_id))
  then raise exception 'Company access required' using errcode = '42501'; end if;
  select count(*) into seats_used from (
    select user_id as seat_id from public.company_members where company_id = target_company_id and role = 'member'
    union
    select record_id as seat_id from public.fleet_crew where company_id = target_company_id and data ->> 'role' = 'member'
  ) occupied;
  return seats_used;
end;
$$;
revoke all on function public.company_crew_seats_used(uuid) from public, anon;
grant execute on function public.company_crew_seats_used(uuid) to authenticated;

-- Recover creator UUIDs for legacy issues when company membership and profile name
-- identify one unambiguous person.
with creator_matches as (
  select issue.company_id, issue.record_id, (array_agg(profile.user_id))[1]::text as creator_id
  from public.fleet_issues issue
  join public.company_members membership on membership.company_id = issue.company_id
  join public.profiles profile on profile.user_id = membership.user_id
  where coalesce(issue.data ->> 'createdById', '') = ''
    and profile.full_name = issue.data ->> 'createdBy'
  group by issue.company_id, issue.record_id
  having count(*) = 1
)
update public.fleet_issues issue
set data = issue.data || jsonb_build_object('createdById', matches.creator_id),
    version = issue.version + 1
from creator_matches matches
where issue.company_id = matches.company_id and issue.record_id = matches.record_id;

create or replace function public.enforce_member_issue_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  old_updates jsonb;
  new_updates jsonb;
begin
  if actor_id is null or public.is_company_owner(new.company_id, actor_id) then return new; end if;

  if tg_op = 'INSERT' then
    if new.data ->> 'createdById' = actor_id::text
      and new.data ->> 'status' = 'Open'
      and coalesce(new.data -> 'updates', '[]'::jsonb) = '[]'::jsonb
    then return new; end if;
    raise exception 'Crew members may only report issues as themselves' using errcode = '42501';
  end if;

  if old.data ->> 'createdById' <> actor_id::text then
    raise exception 'Crew members may only update issues they reported' using errcode = '42501';
  end if;

  old_updates := coalesce(old.data -> 'updates', '[]'::jsonb);
  new_updates := coalesce(new.data -> 'updates', '[]'::jsonb);
  if old.data - 'status' - 'resolvedAt' - 'updates' = new.data - 'status' - 'resolvedAt' - 'updates'
    and new.data ->> 'status' in ('Open', 'Resolved')
    and jsonb_array_length(new_updates) = jsonb_array_length(old_updates) + 1
    and new_updates -> 0 ->> 'createdById' = actor_id::text
    and (new_updates #- '{0}') = old_updates
  then return new; end if;

  raise exception 'Crew members may only append their own update and change issue status' using errcode = '42501';
end;
$$;
revoke all on function public.enforce_member_issue_changes() from public, anon, authenticated;
drop trigger if exists fleet_issues_member_changes on public.fleet_issues;
create trigger fleet_issues_member_changes before insert or update on public.fleet_issues
for each row execute function public.enforce_member_issue_changes();

create or replace function public.enforce_activity_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.is_company_owner(new.company_id, auth.uid()) then return new; end if;
  if new.data ->> 'createdById' = auth.uid()::text then return new; end if;
  raise exception 'Activity must be attributed to the signed-in user' using errcode = '42501';
end;
$$;
revoke all on function public.enforce_activity_attribution() from public, anon, authenticated;
drop trigger if exists fleet_activities_attribution on public.fleet_activities;
create trigger fleet_activities_attribution before insert on public.fleet_activities
for each row execute function public.enforce_activity_attribution();

-- Apply one client snapshot delta in one Postgres transaction. Any conflict or
-- policy failure rolls back every record operation in the request.
create or replace function public.apply_fleet_changes(target_company_id uuid, changes jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  change jsonb;
  table_name text;
  record_id uuid;
  event_name text;
  expected_version bigint;
  result_version bigint;
  results jsonb := '[]'::jsonb;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(changes) <> 'array' or jsonb_array_length(changes) > 500 then
    raise exception 'Invalid fleet change batch' using errcode = '22023';
  end if;

  for change in select value from jsonb_array_elements(changes) loop
    table_name := case change ->> 'collection'
      when 'vehicles' then 'fleet_vehicles'
      when 'issues' then 'fleet_issues'
      when 'crew' then 'fleet_crew'
      when 'activities' then 'fleet_activities'
      else null
    end;
    if table_name is null then raise exception 'Invalid fleet collection' using errcode = '22023'; end if;

    record_id := (change ->> 'recordId')::uuid;
    event_name := change ->> 'event';
    expected_version := nullif(change ->> 'expectedVersion', '')::bigint;

    if event_name = 'insert' then
      execute format(
        'insert into public.%I (company_id, record_id, data, version, updated_by) values ($1,$2,$3,1,$4) returning version',
        table_name
      ) into result_version using target_company_id, record_id, change -> 'data', actor_id;
    elsif event_name = 'update' and expected_version is not null then
      execute format(
        'update public.%I set data=$1, version=$2+1, updated_by=$3 where company_id=$4 and record_id=$5 and version=$2 returning version',
        table_name
      ) into result_version using change -> 'data', expected_version, actor_id, target_company_id, record_id;
      if result_version is null then raise exception 'Record changed by another user' using errcode = '40001'; end if;
    elsif event_name = 'delete' and expected_version is not null then
      execute format(
        'delete from public.%I where company_id=$1 and record_id=$2 and version=$3 returning version',
        table_name
      ) into result_version using target_company_id, record_id, expected_version;
      if result_version is null then raise exception 'Record changed by another user' using errcode = '40001'; end if;
    else
      raise exception 'Invalid fleet change operation' using errcode = '22023';
    end if;

    results := results || jsonb_build_array(jsonb_build_object(
      'collection', change ->> 'collection',
      'recordId', record_id,
      'event', event_name,
      'version', result_version
    ));
    result_version := null;
  end loop;
  return results;
end;
$$;
revoke all on function public.apply_fleet_changes(uuid, jsonb) from public, anon;
grant execute on function public.apply_fleet_changes(uuid, jsonb) to authenticated;
