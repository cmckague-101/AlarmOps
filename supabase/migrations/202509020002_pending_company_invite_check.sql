-- Allow account setup to verify that authenticated user still has pending company invitation.
create or replace function public.has_pending_company_invite()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.fleet_crew crew
      join public.company_members membership
        on membership.company_id = crew.company_id
       and membership.user_id = crew.record_id
       and membership.role = 'member'
      where crew.record_id = auth.uid()
        and crew.data ->> 'status' = 'Invited'
    );
$$;

revoke all on function public.has_pending_company_invite() from public, anon;
grant execute on function public.has_pending_company_invite() to authenticated;
