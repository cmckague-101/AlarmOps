-- Crew members only receive notifications for trainings, new Crew Chats, and
-- replies to Crew Chats they participate in. Owners retain all notification types.

create or replace function public.create_user_notification(
  target_company_id uuid,
  target_user_id uuid,
  actor_id uuid,
  notification_event_type text,
  notification_entity_type text,
  notification_entity_id uuid,
  notification_title text,
  notification_body text,
  notification_path text,
  notification_group_key text,
  notification_dedupe_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  notification_id uuid;
  preferences public.notification_preferences;
  push_allowed boolean;
  target_role text;
begin
  if target_user_id is null or target_user_id = actor_id then return null; end if;

  select member.role into target_role
  from public.company_members member
  where member.company_id = target_company_id
    and member.user_id = target_user_id;

  if target_role is null then return null; end if;
  if target_role = 'member'
     and notification_event_type not in ('communication_reply', 'training_created') then
    return null;
  end if;

  insert into public.user_notifications (
    company_id, user_id, actor_user_id, event_type, entity_type, entity_id,
    title, body, path, group_key, dedupe_key
  ) values (
    target_company_id, target_user_id, actor_id, notification_event_type,
    notification_entity_type, notification_entity_id,
    left(notification_title, 180), left(notification_body, 500),
    notification_path, notification_group_key, notification_dedupe_key
  )
  on conflict (user_id, dedupe_key) do nothing
  returning id into notification_id;

  if notification_id is null then return null; end if;

  select * into preferences
  from public.notification_preferences
  where company_id = target_company_id and user_id = target_user_id;

  push_allowed := notification_event_type = 'system' or (
    coalesce(preferences.push_enabled, true) and case notification_event_type
      when 'communication_reply' then coalesce(preferences.communication_replies, true)
      when 'document_added' then coalesce(preferences.document_added, true)
      when 'training_created' then coalesce(preferences.training_created, true)
      when 'vehicle_assigned' then coalesce(preferences.vehicle_assigned, true)
      when 'issue_updated' then coalesce(preferences.issue_updates, true)
      else false
    end
  );

  if push_allowed then
    insert into public.push_notification_jobs (notification_id) values (notification_id);
  end if;
  return notification_id;
end;
$$;

revoke all on function public.create_user_notification(uuid, uuid, uuid, text, text, uuid, text, text, text, text, text)
  from public, anon, authenticated;

-- Remove now-disallowed inbox rows and their cascading push jobs/deliveries.
delete from public.user_notifications notification
using public.company_members member
where member.company_id = notification.company_id
  and member.user_id = notification.user_id
  and member.role = 'member'
  and notification.event_type not in ('communication_reply', 'training_created');
