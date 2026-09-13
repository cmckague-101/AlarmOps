-- Every company member can read all Crew Chat conversations and replies.
drop policy if exists "company reads communication threads" on public.communication_threads;
create policy "company reads communication threads"
  on public.communication_threads for select to authenticated
  using (
    public.is_company_member(company_id, auth.uid())
    or public.has_system_admin_company_access(company_id)
  );

drop policy if exists "company reads communication replies" on public.communication_replies;
create policy "company reads communication replies"
  on public.communication_replies for select to authenticated
  using (
    public.is_company_member(company_id, auth.uid())
    or public.has_system_admin_company_access(company_id)
  );

-- Notify every other company member when a Crew Chat starts. Reuse communication
-- notification preferences so users retain one control for Crew Chat activity.
create or replace function public.notify_communication_thread_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_id uuid;
  actor_name text := coalesce(public.notification_actor_name(new.created_by), new.created_by_name, 'FireOps user');
begin
  for recipient_id in
    select member.user_id
    from public.company_members member
    where member.company_id = new.company_id
      and member.user_id <> new.created_by
  loop
    perform public.create_user_notification(
      new.company_id, recipient_id, new.created_by,
      'communication_reply', 'communication', new.id,
      'New Crew Chat: ' || new.subject,
      actor_name || ' started a new Crew Chat.',
      '/communication/' || new.id::text,
      'communication:' || new.id::text,
      'communication-thread-created:' || new.id::text
    );
  end loop;
  return new;
end;
$$;
revoke all on function public.notify_communication_thread_created() from public, anon, authenticated;

create trigger communication_thread_created_notifications
  after insert on public.communication_threads
  for each row execute function public.notify_communication_thread_created();
