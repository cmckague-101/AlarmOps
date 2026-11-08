-- Joining Crew Chat posts a fixed reply body so the member becomes a
-- participant. That should stay in the thread, but must not notify anyone.

create or replace function public.notify_communication_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  thread_record public.communication_threads;
  recipient_id uuid;
  actor_name text := coalesce(public.notification_actor_name(new.created_by), new.created_by_name, 'FireOps user');
begin
  -- Exact join marker sent by the web (App.tsx) and mobile (communication/[id].tsx)
  -- "Join conversation" actions; keep in sync with those call sites.
  if btrim(new.body) = 'Joined the conversation.' then
    return new;
  end if;

  select * into thread_record from public.communication_threads
  where company_id = new.company_id and id = new.thread_id;

  for recipient_id in
    select distinct candidate.user_id from (
      select thread_record.created_by as user_id
      union all
      select reply.created_by from public.communication_replies reply
        where reply.company_id = new.company_id and reply.thread_id = new.thread_id
      union all
      select member.user_id from public.company_members member
        where member.company_id = new.company_id and member.role = 'owner'
    ) candidate
    where candidate.user_id is not null and candidate.user_id <> new.created_by
      and (not thread_record.is_private or exists (
        select 1 from public.company_members member
        where member.company_id = new.company_id and member.user_id = candidate.user_id and member.role in ('owner', 'admin')
      ))
  loop
    perform public.create_user_notification(
      new.company_id, recipient_id, new.created_by,
      'communication_reply', 'communication', new.thread_id,
      'Reply: ' || thread_record.subject,
      actor_name || ' replied: ' || new.body,
      '/communication/' || new.thread_id::text,
      'communication:' || new.thread_id::text,
      'communication-reply:' || new.id::text
    );
  end loop;
  return new;
end;
$$;
revoke all on function public.notify_communication_reply() from public, anon, authenticated;

-- Clear join notices already sitting in inboxes / push queues.
delete from public.user_notifications
where event_type = 'communication_reply'
  and entity_type = 'communication'
  and body like '% replied: Joined the conversation.';
