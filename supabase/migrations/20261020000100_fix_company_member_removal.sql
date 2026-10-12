-- Company roles replaced the legacy "member" role. The old removal path deleted
-- crew rows while leaving memberships behind because no row still used "member".
-- Revoke those hidden orphan memberships before fixing future direct RPC calls.
delete from public.company_members membership
where membership.role <> 'owner'
  and not exists (
    select 1
    from public.fleet_crew crew
    where crew.company_id = membership.company_id
      and crew.record_id = membership.user_id
  );

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
    raise exception 'Company managers cannot remove themselves' using errcode = '42501';
  end if;

  if not public.is_company_owner(target_company_id, actor_id) then
    raise exception 'Company management access required' using errcode = '42501';
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
    and role <> 'owner';

  get diagnostics removed_count = row_count;
  return removed_count > 0;
end;
$$;

revoke all on function public.remove_company_member(uuid, uuid) from public, anon;
grant execute on function public.remove_company_member(uuid, uuid) to authenticated;
