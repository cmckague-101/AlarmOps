-- Company owners may remove non-owner crew memberships.
-- Removing membership makes every company RLS policy reject target user's next request.
create or replace function public.remove_company_member(
  target_company_id uuid,
  target_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  removed_count integer;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if target_user_id = actor_id then
    raise exception 'Company owners cannot remove themselves' using errcode = '42501';
  end if;

  if not public.is_system_admin()
    and not exists (
      select 1
      from public.company_members
      where company_id = target_company_id
        and user_id = actor_id
        and role = 'owner'
    )
  then
    raise exception 'Company owner access required' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.company_members
    where company_id = target_company_id
      and user_id = target_user_id
      and role = 'owner'
  )
  then
    raise exception 'Company owner cannot be removed' using errcode = '42501';
  end if;

  delete from public.company_members
  where company_id = target_company_id
    and user_id = target_user_id
    and role = 'member';

  get diagnostics removed_count = row_count;
  return removed_count > 0;
end;
$$;

revoke all on function public.remove_company_member(uuid, uuid) from public, anon;
grant execute on function public.remove_company_member(uuid, uuid) to authenticated;
