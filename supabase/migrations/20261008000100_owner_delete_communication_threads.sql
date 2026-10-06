create policy "owners delete communication threads"
on public.communication_threads
for delete
to authenticated
using (
  public.is_company_owner(company_id, auth.uid())
  or public.has_system_admin_company_access(company_id)
);
