-- Tell the person who submitted an invoice when it is marked paid. Like a
-- returned payroll form, every role receives it and it is always pushed.
-- Requires 20270101000100_invoice_due_and_paid. Adds the 'invoice_paid' event
-- type; create_user_notification and claim_push_notification_jobs are the
-- latest versions (20261226 and 20261229) with only that type added.
begin;

alter table public.user_notifications drop constraint user_notifications_event_type_check;
alter table public.user_notifications add constraint user_notifications_event_type_check check (event_type in (
  'communication_reply', 'document_added', 'training_created', 'issue_updated',
  'qualification_approved', 'vehicle_note_added', 'failed_inspection', 'payroll_rejected', 'invoice_paid', 'task_due', 'system'
));

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
  if notification_event_type = 'system'
     and notification_dedupe_key like 'payroll-rejected:%' then
    notification_event_type := 'payroll_rejected';
  end if;

  if target_role not in ('owner', 'admin')
     and notification_event_type not in ('communication_reply', 'training_created', 'qualification_approved', 'payroll_rejected', 'invoice_paid')
     and not (
       target_role = 'shop_tech'
       and notification_event_type in ('vehicle_note_added', 'failed_inspection')
     )
     and not (
       target_role = 'accounting'
       and notification_event_type = 'system'
       and (notification_dedupe_key like 'payroll-pending:%' or notification_dedupe_key like 'invoice-submitted:%')
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

  push_allowed := notification_event_type in ('system', 'qualification_approved', 'payroll_rejected', 'invoice_paid') or (
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

create or replace function public.claim_push_notification_jobs(p_limit integer default 100)
returns table (
  job_id uuid, notification_id uuid, user_id uuid, event_type text, title text,
  body text, path text, group_key text, entity_id uuid, badge_count bigint, attempts integer
)
language plpgsql security definer set search_path = '' as $$
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

  -- Completion, rescheduling and role loss cancel reminders not yet dispatched.
  update public.push_notification_jobs job
  set status = 'skipped', locked_at = null, last_error = 'Task completed, rescheduled or unavailable'
  from public.user_notifications notice
  where job.notification_id = notice.id and job.status = 'pending' and notice.event_type = 'task_due'
    and not exists (
      select 1 from public.personal_tasks t
      join public.company_members m on m.company_id = t.company_id and m.user_id = t.user_id
        and m.role in ('owner', 'admin', 'shop_tech')
      where t.id = notice.entity_id and t.company_id = notice.company_id and t.user_id = notice.user_id
        and notice.dedupe_key = 'task-due:' || t.id || ':' || t.due_date
    );

  update public.push_notification_jobs job
  set status = 'skipped', locked_at = null, last_error = 'Disabled by notification preferences'
  from (
    select notice.id
    from public.user_notifications notice
    left join public.notification_preferences preference
      on preference.company_id = notice.company_id and preference.user_id = notice.user_id
    where notice.event_type not in ('system', 'qualification_approved', 'payroll_rejected', 'invoice_paid') and not (
      coalesce(preference.push_enabled, true) and case notice.event_type
        when 'communication_reply' then coalesce(preference.communication_replies, true)
        when 'document_added' then coalesce(preference.document_added, true)
        when 'training_created' then coalesce(preference.training_created, true)
        when 'issue_updated' then coalesce(preference.issue_updates, true)
        when 'vehicle_note_added' then true
        when 'failed_inspection' then true
        when 'task_due' then true
        else false
      end
    )
  ) disabled
  where job.notification_id = disabled.id and job.status = 'pending';

  return query
  with candidates as (
    select job.id from public.push_notification_jobs job
    where job.status = 'pending' and job.next_attempt_at <= now() and job.attempts < 5
    order by job.created_at for update skip locked
    limit greatest(1, least(coalesce(p_limit, 100), 100))
  ), claimed as (
    update public.push_notification_jobs job
    set status = 'processing', attempts = job.attempts + 1, locked_at = now(), last_error = null
    from candidates where job.id = candidates.id returning job.*
  )
  select claimed.id, notice.id, notice.user_id, notice.event_type, notice.title,
    notice.body, notice.path, notice.group_key, notice.entity_id,
    (select count(*) from public.user_notifications unread
      join public.company_members member on member.company_id = unread.company_id and member.user_id = unread.user_id
      where unread.user_id = notice.user_id and unread.read_at is null
        and (member.role in ('owner', 'admin', 'accounting')
          or unread.event_type in ('communication_reply', 'training_created', 'qualification_approved', 'payroll_rejected', 'invoice_paid')
          or (member.role = 'shop_tech' and unread.event_type = 'task_due'))),
    claimed.attempts
  from claimed join public.user_notifications notice on notice.id = claimed.notification_id;
end;
$$;
revoke all on function public.claim_push_notification_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_push_notification_jobs(integer) to service_role;

create or replace function public.notify_paid_invoice()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'paid' and old.status = 'submitted' then
    perform public.create_user_notification(new.company_id, new.created_by, new.paid_by, 'invoice_paid', 'system', new.id,
      'Invoice paid', 'Invoice ' || coalesce(nullif(btrim(new.invoice_number), ''), 'without a number') || ' was marked paid.', '/invoices',
      'invoice:' || new.id::text, 'invoice-paid:' || new.id::text);
  end if;
  return new;
end $$;
revoke all on function public.notify_paid_invoice() from public, anon, authenticated;
create trigger invoice_forms_paid_notification after update of status on public.invoice_forms
for each row execute function public.notify_paid_invoice();

commit;
