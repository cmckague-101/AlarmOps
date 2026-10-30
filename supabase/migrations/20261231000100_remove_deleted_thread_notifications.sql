-- Deleting a communication thread left its reply notifications behind, so they
-- opened "Thread not found". Remove a thread's notifications when it is deleted.

create or replace function public.remove_communication_thread_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.user_notifications
  where company_id = old.company_id
    and entity_type = 'communication'
    and entity_id = old.id;
  return old;
end;
$$;
revoke all on function public.remove_communication_thread_notifications() from public, anon, authenticated;

drop trigger if exists communication_thread_notification_cleanup on public.communication_threads;
create trigger communication_thread_notification_cleanup
after delete on public.communication_threads
for each row execute function public.remove_communication_thread_notifications();

-- Clear notifications already orphaned by earlier thread deletions.
delete from public.user_notifications notification
where notification.entity_type = 'communication'
  and not exists (
    select 1 from public.communication_threads thread
    where thread.company_id = notification.company_id and thread.id = notification.entity_id
  );
