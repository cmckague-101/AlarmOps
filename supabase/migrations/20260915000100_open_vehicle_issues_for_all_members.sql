-- Every company member can see current vehicle issues. Resolved issue history
-- remains restricted to company owners and authorized system administrators.
drop policy if exists "members read fleet issues" on public.fleet_issues;
create policy "members read fleet issues" on public.fleet_issues
for select to authenticated
using (
  public.is_company_owner(company_id, auth.uid())
  or public.has_system_admin_company_access(company_id)
  or (
    public.is_company_member(company_id, auth.uid())
    and coalesce(data ->> 'status', 'Open') = 'Open'
  )
);
