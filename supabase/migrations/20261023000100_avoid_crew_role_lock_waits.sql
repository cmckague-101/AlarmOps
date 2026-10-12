-- Changes between crew roles do not allocate a seat. Avoid taking the
-- company-wide seat-allocation lock for routine role and profile updates.
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

    if tg_op = 'UPDATE'
      and old.company_id = new.company_id
      and old.user_id = new.user_id
      and old.role <> 'owner'
      and new.role <> 'owner'
    then
      return new;
    end if;
  else
    target_company_id := new.company_id;
    target_user_id := new.record_id;
    target_role := new.data ->> 'role';

    if tg_op = 'UPDATE'
      and old.company_id = new.company_id
      and old.record_id = new.record_id
      and old.data ->> 'role' <> 'owner'
      and new.data ->> 'role' <> 'owner'
    then
      return new;
    end if;
  end if;

  if target_role = 'owner' then
    return new;
  end if;

  -- Serialize actual seat allocation so concurrent invitations cannot exceed limit.
  select crew_invite_limit
  into invite_limit
  from public.companies
  where id = target_company_id
  for update;

  if invite_limit is null then
    raise exception 'Company not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.company_members
    where company_id = target_company_id and user_id = target_user_id and role <> 'owner'
    union all
    select 1 from public.fleet_crew
    where company_id = target_company_id and record_id = target_user_id and data ->> 'role' <> 'owner'
  ) then
    return new;
  end if;

  select count(*)
  into seats_used
  from (
    select user_id as seat_id from public.company_members
    where company_id = target_company_id and role <> 'owner'
    union
    select record_id as seat_id from public.fleet_crew
    where company_id = target_company_id and data ->> 'role' <> 'owner'
  ) occupied;

  if seats_used >= invite_limit then
    raise exception 'Company crew invite limit reached' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_company_crew_invite_limit() from public, anon, authenticated;
