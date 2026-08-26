-- Cap company crew invitations. Owners do not consume invite capacity.
alter table public.companies
  add column crew_invite_limit integer not null default 0
  check (crew_invite_limit >= 0);

create or replace function public.company_crew_seats_used(target_company_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  seats_used integer;
begin
  if auth.uid() is null
    or (
      not public.is_company_member(target_company_id, auth.uid())
      and not public.is_system_admin()
    )
  then
    raise exception 'Company access required' using errcode = '42501';
  end if;

  select count(*)
  into seats_used
  from (
    select user_id as seat_id
    from public.company_members
    where company_id = target_company_id and role = 'member'
    union
    select record_id as seat_id
    from public.fleet_crew
    where company_id = target_company_id and data ->> 'role' = 'member'
  ) occupied;

  return seats_used;
end;
$$;

revoke all on function public.company_crew_seats_used(uuid) from public, anon;
grant execute on function public.company_crew_seats_used(uuid) to authenticated;

create or replace function public.enforce_company_crew_invite_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite_limit integer;
  seats_used integer;
  target_company_id uuid;
  target_user_id uuid;
  target_role text;
begin
  if tg_table_name = 'company_members' then
    target_company_id := new.company_id;
    target_user_id := new.user_id;
    target_role := new.role;
  else
    target_company_id := new.company_id;
    target_user_id := new.record_id;
    target_role := new.data ->> 'role';
  end if;

  if target_role <> 'member' then
    return new;
  end if;

  -- Serialize seat allocation so concurrent invitations cannot exceed limit.
  select crew_invite_limit
  into invite_limit
  from public.companies
  where id = target_company_id
  for update;

  if invite_limit is null then
    raise exception 'Company not found' using errcode = 'P0002';
  end if;

  -- Existing pending invite becoming membership, or membership gaining crew profile,
  -- keeps same seat and must not consume another one.
  if exists (
    select 1
    from public.company_members
    where company_id = target_company_id
      and user_id = target_user_id
      and role = 'member'
    union all
    select 1
    from public.fleet_crew
    where company_id = target_company_id
      and record_id = target_user_id
      and data ->> 'role' = 'member'
  ) then
    return new;
  end if;

  select count(*)
  into seats_used
  from (
    select user_id as seat_id
    from public.company_members
    where company_id = target_company_id and role = 'member'
    union
    select record_id as seat_id
    from public.fleet_crew
    where company_id = target_company_id and data ->> 'role' = 'member'
  ) occupied;

  if seats_used >= invite_limit then
    raise exception 'Company crew invite limit reached' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_company_crew_invite_limit() from public, anon, authenticated;

create trigger company_members_enforce_crew_invite_limit
before insert or update of company_id, user_id, role on public.company_members
for each row execute function public.enforce_company_crew_invite_limit();

create trigger fleet_crew_enforce_invite_limit
before insert or update of company_id, record_id, data on public.fleet_crew
for each row execute function public.enforce_company_crew_invite_limit();
