-- Only company owners/admins can start Crew Chat threads. They can also remove
-- individual replies while all company members retain reply access.
drop policy if exists "company creates communication threads" on public.communication_threads;
create policy "company managers create communication threads"
on public.communication_threads
for insert
to authenticated
with check (
  public.is_company_owner(company_id, auth.uid())
  and created_by = auth.uid()
);

drop policy if exists "company managers delete communication replies" on public.communication_replies;
create policy "company managers delete communication replies"
on public.communication_replies
for delete
to authenticated
using (public.is_company_owner(company_id, auth.uid()));

grant delete on public.communication_replies to authenticated;
