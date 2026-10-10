-- Keep crew inboxes focused while sending shop technicians operational push alerts.

delete from public.user_notifications where event_type = 'vehicle_assigned';
alter table public.user_notifications drop constraint if exists user_notifications_event_type_check;
alter table public.user_notifications add constraint user_notifications_event_type_check check (event_type in (
  'communication_reply', 'document_added', 'training_created', 'issue_updated',
  'qualification_approved', 'vehicle_note_added', 'failed_inspection', 'system'
));

-- Preserve prior qualification approvals under their explicit event type.
update public.user_notifications
set event_type = 'qualification_approved'
where event_type = 'system'
  and dedupe_key like 'qualification-card-approved:%';

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

  -- Older qualification RPCs emitted this as a generic system event.
  if notification_event_type = 'system'
     and notification_dedupe_key like 'qualification-card-approved:%' then
    notification_event_type := 'qualification_approved';
  end if;

  if target_role not in ('owner', 'admin')
     and notification_event_type not in ('communication_reply', 'training_created', 'qualification_approved')
     and not (
       target_role = 'shop_tech'
       and notification_event_type in ('vehicle_note_added', 'failed_inspection')
     ) then
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

  push_allowed := notification_event_type in ('system', 'qualification_approved') or (
    coalesce(preferences.push_enabled, true) and case notification_event_type
      when 'communication_reply' then coalesce(preferences.communication_replies, true)
      when 'document_added' then coalesce(preferences.document_added, true)
      when 'training_created' then coalesce(preferences.training_created, true)
      when 'issue_updated' then coalesce(preferences.issue_updates, true)
      when 'vehicle_note_added' then true
      when 'failed_inspection' then true
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

create or replace function public.notify_vehicle_note_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_id uuid;
  vehicle_name text;
begin
  select coalesce(nullif(vehicle.data ->> 'unit', ''), nullif(vehicle.data ->> 'name', ''), 'Vehicle')
    into vehicle_name
  from public.fleet_vehicles vehicle
  where vehicle.company_id = new.company_id and vehicle.record_id = new.vehicle_id;

  for recipient_id in
    select member.user_id
    from public.company_members member
    where member.company_id = new.company_id
      and member.role = 'shop_tech'
      and member.user_id <> new.created_by
  loop
    perform public.create_user_notification(
      new.company_id, recipient_id, new.created_by,
      'vehicle_note_added', 'vehicle', new.vehicle_id,
      'New vehicle note: ' || coalesce(vehicle_name, 'Vehicle'),
      new.created_by_name || ' added “' || new.subject || '”.',
      '/vehicle/' || new.vehicle_id::text,
      'vehicle-note:' || new.vehicle_id::text,
      'vehicle-note-added:' || new.id::text
    );
  end loop;
  return new;
end;
$$;
revoke all on function public.notify_vehicle_note_added() from public, anon, authenticated;
drop trigger if exists vehicle_note_added_notification on public.vehicle_notes;
create trigger vehicle_note_added_notification
  after insert on public.vehicle_notes
  for each row execute function public.notify_vehicle_note_added();

create or replace function public.notify_failed_vehicle_inspection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  inspection jsonb;
  inspection_id text;
  failed_count integer;
  recipient_id uuid;
  vehicle_name text;
  inspector_name text;
begin
  if jsonb_typeof(new.data -> 'inspections') <> 'array'
    or jsonb_array_length(new.data -> 'inspections') = 0
  then return new; end if;

  inspection := new.data -> 'inspections' -> 0;
  inspection_id := inspection ->> 'id';
  if inspection_id is null or exists (
    select 1 from jsonb_array_elements(coalesce(old.data -> 'inspections', '[]'::jsonb)) prior
    where prior ->> 'id' = inspection_id
  ) then return new; end if;

  select count(*) into failed_count
  from jsonb_array_elements(coalesce(inspection -> 'items', '[]'::jsonb)) item
  where item ->> 'result' = 'Fail';
  if failed_count = 0 then return new; end if;

  vehicle_name := coalesce(nullif(new.data ->> 'unit', ''), 'Vehicle');
  inspector_name := coalesce(nullif(inspection ->> 'inspectorName', ''), 'Crew member');
  for recipient_id in
    select member.user_id from public.company_members member
    where member.company_id = new.company_id
      and member.role in ('owner', 'admin', 'shop_tech')
  loop
    perform public.create_user_notification(
      new.company_id, recipient_id, null,
      'failed_inspection', 'vehicle', new.record_id,
      vehicle_name || ' failed inspection',
      inspector_name || ' reported ' || failed_count || case when failed_count = 1 then ' failed check.' else ' failed checks.' end,
      '/vehicle/' || new.record_id::text,
      'inspection:' || inspection_id,
      'failed-inspection:' || inspection_id
    );
  end loop;
  return new;
end;
$$;
revoke all on function public.notify_failed_vehicle_inspection() from public, anon, authenticated;

-- Assignment changes never belong in push delivery or inbox history.
drop trigger if exists fleet_vehicle_assignment_notifications on public.fleet_vehicles;
drop function if exists public.notify_vehicle_assigned();

-- Remove crew inbox history outside chat, training, and their qualification approval.
delete from public.user_notifications notification
using public.company_members member
where member.company_id = notification.company_id
  and member.user_id = notification.user_id
  and member.role not in ('owner', 'admin')
  and notification.event_type not in ('communication_reply', 'training_created', 'qualification_approved', 'vehicle_note_added', 'failed_inspection');

create or replace function public.claim_push_notification_jobs(p_limit integer default 100)
returns table (
  job_id uuid,
  notification_id uuid,
  user_id uuid,
  event_type text,
  title text,
  body text,
  path text,
  group_key text,
  entity_id uuid,
  badge_count bigint,
  attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.push_notification_jobs job
  set status = 'pending', locked_at = null, next_attempt_at = now(), last_error = 'Processing lock expired'
  where job.status = 'processing' and job.locked_at < now() - interval '10 minutes';

  update public.push_notification_jobs job
  set status = 'failed', last_error = coalesce(job.last_error, 'Maximum delivery attempts reached')
  where job.status = 'pending' and job.attempts >= 5;

  update public.push_notification_jobs job
  set status = 'skipped', locked_at = null, last_error = 'Recipient no longer belongs to company'
  from public.user_notifications notice
  where job.notification_id = notice.id and job.status = 'pending'
    and not exists (
      select 1 from public.company_members member
      where member.company_id = notice.company_id and member.user_id = notice.user_id
    );

  update public.push_notification_jobs job
  set status = 'skipped', locked_at = null, last_error = 'Disabled by notification preferences'
  from (
    select notice.id
    from public.user_notifications notice
    left join public.notification_preferences preference
      on preference.company_id = notice.company_id and preference.user_id = notice.user_id
    where notice.event_type not in ('system', 'qualification_approved') and not (
      coalesce(preference.push_enabled, true) and case notice.event_type
        when 'communication_reply' then coalesce(preference.communication_replies, true)
        when 'document_added' then coalesce(preference.document_added, true)
        when 'training_created' then coalesce(preference.training_created, true)
        when 'issue_updated' then coalesce(preference.issue_updates, true)
        when 'vehicle_note_added' then true
        when 'failed_inspection' then true
        else false
      end
    )
  ) disabled
  where job.notification_id = disabled.id and job.status = 'pending';

  return query
  with candidates as (
    select job.id
    from public.push_notification_jobs job
    where job.status = 'pending' and job.next_attempt_at <= now() and job.attempts < 5
    order by job.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 100), 100))
  ), claimed as (
    update public.push_notification_jobs job
    set status = 'processing', attempts = job.attempts + 1, locked_at = now(), last_error = null
    from candidates
    where job.id = candidates.id
    returning job.*
  )
  select claimed.id, notice.id, notice.user_id, notice.event_type, notice.title,
    notice.body, notice.path, notice.group_key, notice.entity_id,
    (select count(*) from public.user_notifications unread
      join public.company_members member
        on member.company_id = unread.company_id and member.user_id = unread.user_id
      where unread.user_id = notice.user_id and unread.read_at is null
        and (
          member.role in ('owner', 'admin')
          or unread.event_type in ('communication_reply', 'training_created', 'qualification_approved')
        )),
    claimed.attempts
  from claimed join public.user_notifications notice on notice.id = claimed.notification_id;
end;
$$;
revoke all on function public.claim_push_notification_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_push_notification_jobs(integer) to service_role;
