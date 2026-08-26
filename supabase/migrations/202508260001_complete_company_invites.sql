-- Mark authenticated invitees active after account setup.
create or replace function public.complete_company_invite()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  member_name text;
  activated_count integer;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select full_name into member_name
  from public.profiles
  where user_id = actor_id;

  update public.fleet_crew crew
  set data = crew.data || jsonb_build_object(
        'status', 'Active',
        'name', coalesce(nullif(trim(member_name), ''), crew.data ->> 'name'),
        'joinedAt', current_date::text
      ),
      version = crew.version + 1,
      updated_by = actor_id
  where crew.record_id = actor_id
    and crew.data ->> 'status' = 'Invited'
    and exists (
      select 1
      from public.company_members membership
      where membership.company_id = crew.company_id
        and membership.user_id = actor_id
        and membership.role = 'member'
    );

  get diagnostics activated_count = row_count;
  return activated_count;
end;
$$;

revoke all on function public.complete_company_invite() from public, anon;
grant execute on function public.complete_company_invite() to authenticated;
