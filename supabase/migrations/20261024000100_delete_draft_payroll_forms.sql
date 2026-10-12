-- Creators may discard their own in-progress payroll forms.
create policy "creators delete payroll drafts" on public.payroll_forms
for delete to authenticated using (
  created_by = auth.uid() and status = 'draft'
);

grant delete on public.payroll_forms to authenticated;
