-- Payroll creators may discard drafts; owners and admins may delete any company payroll form.
drop policy if exists "creators delete payroll drafts" on public.payroll_forms;

create policy "creators and managers delete payroll forms" on public.payroll_forms
for delete to authenticated using (
  (created_by = auth.uid() and status = 'draft')
  or public.is_company_owner(company_id, auth.uid())
);
