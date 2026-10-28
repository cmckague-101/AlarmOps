begin;

-- Saved from the task owner's device/browser. No guessed UTC reminders before
-- their first online Task List visit. IANA zones preserve daylight-saving rules.
alter table public.notification_preferences add column task_reminder_timezone text;
create index personal_tasks_reminder_due_idx on public.personal_tasks(due_date, id);

create or replace function public.set_task_reminder_timezone(
  target_company_id uuid, target_user_id uuid, timezone_name text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if target_user_id is distinct from auth.uid() or not exists (
    select 1 from public.company_members m where m.company_id = target_company_id
      and m.user_id = auth.uid() and m.role in ('owner', 'admin', 'shop_tech')
  ) then raise exception 'Task reminder access denied' using errcode = '42501'; end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = timezone_name) then
    raise exception 'Invalid reminder timezone' using errcode = '22023';
  end if;
  insert into public.notification_preferences(company_id, user_id, task_reminder_timezone)
  values (target_company_id, target_user_id, timezone_name)
  on conflict (company_id, user_id) do update
    set task_reminder_timezone = excluded.task_reminder_timezone
    where public.notification_preferences.task_reminder_timezone is distinct from excluded.task_reminder_timezone;
end;
$$;
revoke all on function public.set_task_reminder_timezone(uuid, uuid, text) from public, anon;
grant execute on function public.set_task_reminder_timezone(uuid, uuid, text) to authenticated;

-- Also protect direct preference writes, which remain RLS-scoped to their owner.
create or replace function public.validate_task_reminder_timezone()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.task_reminder_timezone is not null and not exists (
    select 1 from pg_catalog.pg_timezone_names where name = new.task_reminder_timezone
  ) then raise exception 'Invalid reminder timezone' using errcode = '22023'; end if;
  return new;
end;
$$;
create trigger notification_preferences_validate_task_timezone
before insert or update of task_reminder_timezone on public.notification_preferences
for each row execute function public.validate_task_reminder_timezone();

alter table public.user_notifications drop constraint user_notifications_event_type_check;
alter table public.user_notifications add constraint user_notifications_event_type_check check (event_type in (
  'communication_reply', 'document_added', 'training_created', 'issue_updated',
  'qualification_approved', 'vehicle_note_added', 'failed_inspection', 'payroll_rejected', 'task_due', 'system'
));
alter table public.user_notifications drop constraint user_notifications_entity_type_check;
alter table public.user_notifications add constraint user_notifications_entity_type_check check (
  entity_type in ('communication', 'document', 'training', 'vehicle', 'issue', 'task', 'system')
);

-- Called by the existing authenticated dispatcher every minute. Same-day catch-up
-- handles scheduler delays and tasks created/synced after 9 AM without a backlog
-- of historical overdue reminders. Dedupe persists even after task completion.
create or replace function public.enqueue_due_task_reminders(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = '' as $$
declare
  task record;
  notice_id uuid;
  queued integer := 0;
begin
  for task in
    select t.*, p.push_enabled
    from public.personal_tasks t
    join public.company_members m on m.company_id = t.company_id and m.user_id = t.user_id
      and m.role in ('owner', 'admin', 'shop_tech')
    join public.notification_preferences p on p.company_id = t.company_id and p.user_id = t.user_id
    where p.task_reminder_timezone is not null
      and t.due_date between (p_now at time zone 'UTC')::date - 1 and (p_now at time zone 'UTC')::date + 1
      and t.due_date = (p_now at time zone p.task_reminder_timezone)::date
      and (t.due_date + time '09:00') at time zone p.task_reminder_timezone <= p_now
      and not exists (select 1 from public.user_notifications n where n.user_id = t.user_id
        and n.dedupe_key = 'task-due:' || t.id || ':' || t.due_date)
    order by t.due_date, t.id
    limit 1000 for update of t skip locked
  loop
    insert into public.user_notifications(company_id, user_id, event_type, entity_type, entity_id,
      title, body, path, group_key, dedupe_key)
    values (task.company_id, task.user_id, 'task_due', 'task', task.id,
      left('Task due today: ' || task.subject, 180), 'Your task is due today. Open Task List to review or complete it.',
      '/tasks', 'task:' || task.id, 'task-due:' || task.id || ':' || task.due_date)
    on conflict (user_id, dedupe_key) do nothing returning id into notice_id;
    if notice_id is not null then
      queued := queued + 1;
      if task.push_enabled then
        insert into public.push_notification_jobs(notification_id) values (notice_id);
      end if;
    end if;
  end loop;
  return queued;
end;
$$;
revoke all on function public.enqueue_due_task_reminders(timestamptz) from public, anon, authenticated;
grant execute on function public.enqueue_due_task_reminders(timestamptz) to service_role;

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
    where notice.event_type not in ('system', 'qualification_approved', 'payroll_rejected') and not (
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
          or unread.event_type in ('communication_reply', 'training_created', 'qualification_approved', 'payroll_rejected')
          or (member.role = 'shop_tech' and unread.event_type = 'task_due'))),
    claimed.attempts
  from claimed join public.user_notifications notice on notice.id = claimed.notification_id;
end;
$$;
revoke all on function public.claim_push_notification_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_push_notification_jobs(integer) to service_role;

commit;
