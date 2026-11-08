-- Fleet Service: next oil change reminders.
-- A vehicle's next oil change (free text, e.g. "45,000 mi or 250 hrs") and its
-- due date (YYYY-MM-DD) are stored in fleet_vehicles.data as nextOilChange and
-- nextOilChangeDue. Shop techs log repairs in Service, so they may change those
-- two fields (and nothing else). From 9 AM local time on the due date (or right
-- away when a past date is saved), every shop tech in the company gets one
-- 'oil_change_due' notification per vehicle and due date, pushed unless push is
-- turned off. Owners and admins see it as a Command Center alert instead.
--
-- enforce_normalized_vehicle_changes is the 20261016000100 version with only the
-- shop tech oil change rule added. claim_push_notification_jobs is the
-- 20270103000100 version with only oil_change_due added.
begin;

-- Parsed due date, or null when missing or not a real YYYY-MM-DD date.
create or replace function public.vehicle_oil_change_due_date(vehicle jsonb)
returns date language plpgsql immutable set search_path = '' as $$
declare
  value text := vehicle ->> 'nextOilChangeDue';
begin
  if jsonb_typeof(vehicle -> 'nextOilChangeDue') is distinct from 'string'
    or value !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  return value::date;
exception when others then
  return null;
end;
$$;
-- Pure parser; the validation trigger runs as the writing user.
revoke all on function public.vehicle_oil_change_due_date(jsonb) from public, anon;
grant execute on function public.vehicle_oil_change_due_date(jsonb) to authenticated, service_role;

-- Applies to every writer, including owners and the fleet sync functions.
-- Only checks a field when it is added or changed.
create or replace function public.validate_vehicle_oil_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.data ? 'nextOilChange'
    and (tg_op = 'INSERT' or new.data -> 'nextOilChange' is distinct from old.data -> 'nextOilChange')
    and (jsonb_typeof(new.data -> 'nextOilChange') <> 'string' or char_length(new.data ->> 'nextOilChange') > 120)
  then
    raise exception 'Next oil change must be text of 120 characters or fewer' using errcode = '22023';
  end if;
  if new.data ? 'nextOilChangeDue'
    and (tg_op = 'INSERT' or new.data -> 'nextOilChangeDue' is distinct from old.data -> 'nextOilChangeDue')
    and public.vehicle_oil_change_due_date(new.data) is null
  then
    raise exception 'Oil change due date must be a YYYY-MM-DD date' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_vehicle_oil_change() from public, anon, authenticated;
create trigger fleet_vehicles_validate_oil_change before insert or update on public.fleet_vehicles
for each row execute function public.validate_vehicle_oil_change();

create or replace function public.enforce_normalized_vehicle_changes()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  old_inspections jsonb := coalesce(old.data -> 'inspections', '[]'::jsonb);
  new_inspections jsonb := coalesce(new.data -> 'inspections', '[]'::jsonb);
begin
  if actor_id is null
    or public.is_company_owner(new.company_id, actor_id)
    or public.has_system_admin_company_access(new.company_id)
  then
    return new;
  end if;

  select member.role into actor_role
  from public.company_members member
  where member.company_id = new.company_id and member.user_id = actor_id;

  -- Claim a ready, unassigned vehicle.
  if old.data - 'assignedTo' - 'status' = new.data - 'assignedTo' - 'status' and (
    coalesce(old.data ->> 'assignedTo', '') = ''
    and btrim(old.data ->> 'status') = 'Ready'
    and new.data ->> 'assignedTo' = actor_id::text
    and btrim(new.data ->> 'status') = 'Assigned'
  ) then
    return new;
  end if;

  -- Release own vehicle. Fire assignment must be cleared with it.
  if old.data - 'assignedTo' - 'status' - 'assignedFire' = new.data - 'assignedTo' - 'status' - 'assignedFire' and (
    old.data ->> 'assignedTo' = actor_id::text
    and btrim(old.data ->> 'status') = 'Assigned'
    and coalesce(new.data ->> 'assignedTo', '') = ''
    and btrim(new.data ->> 'status') = 'Ready'
    and not (new.data ? 'assignedFire')
  ) then
    return new;
  end if;

  -- Join, change, or leave a fire using vehicle assigned to actor.
  if old.data - 'assignedFire' - 'status' = new.data - 'assignedFire' - 'status' and (
    old.data ->> 'assignedTo' = actor_id::text
    and new.data ->> 'assignedTo' = actor_id::text
    and btrim(new.data ->> 'status') = 'Assigned'
  ) then
    return new;
  end if;

  -- Shop techs may add one inspection without changing vehicle details.
  if actor_role = 'shop_tech'
    and old.data - 'inspections' = new.data - 'inspections'
    and jsonb_typeof(old_inspections) = 'array'
    and jsonb_typeof(new_inspections) = 'array'
    and jsonb_array_length(new_inspections) = jsonb_array_length(old_inspections) + 1
    and new_inspections - 0 = old_inspections
    and new_inspections -> 0 ->> 'inspectorId' = actor_id::text
  then
    return new;
  end if;

  -- Shop techs may set or clear the next oil change and its due date (Service).
  if actor_role = 'shop_tech'
    and old.data - 'nextOilChange' - 'nextOilChangeDue' = new.data - 'nextOilChange' - 'nextOilChangeDue'
  then
    return new;
  end if;

  raise exception 'This role cannot make the requested vehicle change' using errcode = '42501';
end;
$$;
revoke all on function public.enforce_normalized_vehicle_changes() from public, anon, authenticated;

alter table public.user_notifications drop constraint user_notifications_event_type_check;
alter table public.user_notifications add constraint user_notifications_event_type_check check (event_type in (
  'communication_reply', 'document_added', 'training_created', 'issue_updated',
  'qualification_approved', 'vehicle_note_added', 'failed_inspection', 'payroll_rejected', 'invoice_paid', 'task_due',
  'oil_change_due', 'system'
));

create index fleet_vehicles_oil_change_due_idx on public.fleet_vehicles ((data ->> 'nextOilChangeDue'))
  where data ? 'nextOilChangeDue';

-- Called by the push dispatcher every minute. Uses the shop tech's saved
-- reminder timezone (set from Task List), or Pacific time until one is saved.
-- Dedupe per vehicle, due date and recipient: a new due date reminds again.
create or replace function public.enqueue_due_oil_change_reminders(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = '' as $$
declare
  reminder record;
  notice_id uuid;
  queued integer := 0;
begin
  for reminder in
    select v.company_id, v.record_id, due.value as due_date, m.user_id,
      coalesce(nullif(btrim(v.data ->> 'unit'), ''), 'Vehicle') as unit,
      nullif(btrim(v.data ->> 'nextOilChange'), '') as target,
      coalesce(p.push_enabled, true) as push_enabled
    from public.fleet_vehicles v
    cross join lateral (select public.vehicle_oil_change_due_date(v.data) as value) due
    join public.company_members m on m.company_id = v.company_id and m.role = 'shop_tech'
    left join public.notification_preferences p on p.company_id = v.company_id and p.user_id = m.user_id
    where v.data ? 'nextOilChangeDue'
      and due.value is not null
      and due.value <= (p_now at time zone 'UTC')::date + 1
      and (due.value + time '09:00') at time zone coalesce(p.task_reminder_timezone, 'America/Los_Angeles') <= p_now
      and not exists (select 1 from public.user_notifications n where n.user_id = m.user_id
        and n.dedupe_key = 'oil-change-due:' || v.record_id || ':' || due.value)
    order by due.value, v.record_id, m.user_id
    limit 1000
  loop
    insert into public.user_notifications(company_id, user_id, event_type, entity_type, entity_id,
      title, body, path, group_key, dedupe_key)
    values (reminder.company_id, reminder.user_id, 'oil_change_due', 'vehicle', reminder.record_id,
      left(reminder.unit || ' needs an oil change', 180),
      left('Oil change due ' || to_char(reminder.due_date, 'Mon FMDD, YYYY')
        || coalesce(' · ' || reminder.target, '') || '. Open Service to update it.', 500),
      '/vehicle-notes/' || reminder.record_id, 'oil-change:' || reminder.record_id,
      'oil-change-due:' || reminder.record_id || ':' || reminder.due_date)
    on conflict (user_id, dedupe_key) do nothing returning id into notice_id;
    if notice_id is not null then
      queued := queued + 1;
      if reminder.push_enabled then
        insert into public.push_notification_jobs(notification_id) values (notice_id);
      end if;
    end if;
  end loop;
  return queued;
end;
$$;
revoke all on function public.enqueue_due_oil_change_reminders(timestamptz) from public, anon, authenticated;
grant execute on function public.enqueue_due_oil_change_reminders(timestamptz) to service_role;

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

  -- A cleared or changed due date, a deleted vehicle or role loss cancels too.
  update public.push_notification_jobs job
  set status = 'skipped', locked_at = null, last_error = 'Oil change rescheduled, cleared or unavailable'
  from public.user_notifications notice
  where job.notification_id = notice.id and job.status = 'pending' and notice.event_type = 'oil_change_due'
    and not exists (
      select 1 from public.fleet_vehicles v
      join public.company_members m on m.company_id = v.company_id and m.user_id = notice.user_id
        and m.role = 'shop_tech'
      where v.company_id = notice.company_id and v.record_id = notice.entity_id
        and notice.dedupe_key = 'oil-change-due:' || v.record_id || ':' || public.vehicle_oil_change_due_date(v.data)
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
        when 'oil_change_due' then true
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
          or (member.role = 'shop_tech' and unread.event_type in ('task_due', 'oil_change_due')))),
    claimed.attempts
  from claimed join public.user_notifications notice on notice.id = claimed.notification_id;
end;
$$;
revoke all on function public.claim_push_notification_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_push_notification_jobs(integer) to service_role;

commit;
