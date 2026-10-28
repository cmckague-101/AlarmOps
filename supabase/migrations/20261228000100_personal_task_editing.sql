-- Only task content is editable; ownership and company remain immutable.
grant update (subject, description, due_date) on public.personal_tasks to authenticated;
create policy "eligible users edit own tasks" on public.personal_tasks
for update to authenticated using (
  user_id = (select auth.uid()) and exists (
    select 1 from public.company_members m
    where m.company_id = personal_tasks.company_id and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin', 'shop_tech')
  )
) with check (
  user_id = (select auth.uid()) and exists (
    select 1 from public.company_members m
    where m.company_id = personal_tasks.company_id and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin', 'shop_tech')
  )
);
