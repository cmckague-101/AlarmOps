-- Persistent notification inbox, user push preferences, event queue, and delivery tracking.

create table public.notification_preferences (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  push_enabled boolean not null default true,
  communication_replies boolean not null default true,
  document_added boolean not null default true,
  training_created boolean not null default true,
  vehicle_assigned boolean not null default true,
  issue_updates boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create table public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  actor_user_id uuid references public.profiles(user_id) on delete set null,
  event_type text not null check (event_type in (
    'communication_reply', 'document_added', 'training_created',
    'vehicle_assigned', 'issue_updated', 'system'
  )),
  entity_type text not null check (entity_type in ('communication', 'document', 'training', 'vehicle', 'issue', 'system')),
  entity_id uuid,
  title text not null check (char_length(title) between 1 and 180),
  body text not null check (char_length(body) between 1 and 500),
  path text not null check (path ~ '^/[^/]'),
  group_key text not null check (char_length(group_key) between 1 and 220),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 300),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create index user_notifications_user_created_idx
  on public.user_notifications (user_id, created_at desc);
create index user_notifications_user_unread_idx
  on public.user_notifications (user_id, created_at desc)
  where read_at is null;

create table public.push_notification_jobs (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null unique references public.user_notifications(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'skipped', 'failed')),
  attempts integer not null default 0 check (attempts between 0 and 20),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index push_notification_jobs_ready_idx
  on public.push_notification_jobs (next_attempt_at, created_at)
  where status = 'pending';

create table public.push_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.push_notification_jobs(id) on delete cascade,
  push_token_id uuid references public.push_tokens(id) on delete set null,
  expo_push_token text not null,
  expo_ticket_id text,
  status text not null check (status in ('ticketed', 'delivered', 'error')),
  error_code text,
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, expo_push_token)
);

create index push_notification_deliveries_receipt_idx
  on public.push_notification_deliveries (created_at)
  where status = 'ticketed' and expo_ticket_id is not null;

create trigger notification_preferences_touch_updated_at
  before update on public.notification_preferences
  for each row execute function public.touch_updated_at();
create trigger push_notification_jobs_touch_updated_at
  before update on public.push_notification_jobs
  for each row execute function public.touch_updated_at();
create trigger push_notification_deliveries_touch_updated_at
  before update on public.push_notification_deliveries
  for each row execute function public.touch_updated_at();

alter table public.notification_preferences enable row level security;
alter table public.user_notifications enable row level security;
alter table public.push_notification_jobs enable row level security;
alter table public.push_notification_deliveries enable row level security;

create policy "users read own notification preferences"
  on public.notification_preferences for select to authenticated
  using (user_id = auth.uid() and (public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id)));
create policy "users create own notification preferences"
  on public.notification_preferences for insert to authenticated
  with check (user_id = auth.uid() and (public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id)));
create policy "users update own notification preferences"
  on public.notification_preferences for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and (public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id)));

create policy "users read own notifications"
  on public.user_notifications for select to authenticated
  using (user_id = auth.uid() and (public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id)));
create policy "users mark own notifications read"
  on public.user_notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and (public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id)));

revoke all on public.notification_preferences, public.user_notifications,
  public.push_notification_jobs, public.push_notification_deliveries from anon, authenticated;
grant select, insert, update on public.notification_preferences to authenticated;
grant select on public.user_notifications to authenticated;
grant update (read_at) on public.user_notifications to authenticated;

-- Inserts inbox rows for every recipient. Push preferences only control queueing;
-- disabled pushes remain visible in inbox. System events bypass push preferences.
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
begin
  if target_user_id is null or target_user_id = actor_id then return null; end if;
  if not exists (
    select 1 from public.company_members
    where company_id = target_company_id and user_id = target_user_id
  ) then return null; end if;

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

create or replace function public.notification_actor_name(actor_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(trim(full_name), ''), 'FireOps user')
  from public.profiles where user_id = actor_id;
$$;
revoke all on function public.notification_actor_name(uuid) from public, anon, authenticated;

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
create trigger communication_reply_notifications
  after insert on public.communication_replies
  for each row execute function public.notify_communication_reply();

create or replace function public.notify_document_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_id uuid;
  actor_name text := coalesce(public.notification_actor_name(new.created_by), 'FireOps user');
begin
  for recipient_id in
    select user_id from public.company_members
    where company_id = new.company_id and user_id <> new.created_by
  loop
    perform public.create_user_notification(
      new.company_id, recipient_id, new.created_by,
      'document_added', 'document', new.id,
      'New document: ' || new.name,
      actor_name || ' added a company document.',
      '/documents', 'document:' || new.id::text,
      'document-added:' || new.id::text
    );
  end loop;
  return new;
end;
$$;
revoke all on function public.notify_document_added() from public, anon, authenticated;
create trigger company_document_added_notifications
  after insert on public.company_documents
  for each row execute function public.notify_document_added();

create or replace function public.notify_training_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_id uuid;
  actor_name text := coalesce(public.notification_actor_name(new.created_by), 'FireOps user');
  schedule_text text;
begin
  schedule_text := new.course_code || ' · ' || to_char(new.starts_at at time zone 'UTC', 'Mon DD, YYYY at HH12:MI AM') || ' UTC · ' || new.location;
  for recipient_id in
    select user_id from public.company_members
    where company_id = new.company_id and user_id <> new.created_by
  loop
    perform public.create_user_notification(
      new.company_id, recipient_id, new.created_by,
      'training_created', 'training', new.id,
      'New training: ' || new.course_title,
      schedule_text, '/training/' || new.id::text,
      'training:' || new.id::text, 'training-created:' || new.id::text
    );
  end loop;
  return new;
end;
$$;
revoke all on function public.notify_training_created() from public, anon, authenticated;
create trigger company_training_created_notifications
  after insert on public.company_trainings
  for each row execute function public.notify_training_created();

create or replace function public.notify_vehicle_assigned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_id uuid;
  assigned_user_id uuid;
  assigned_name text;
  vehicle_name text := coalesce(nullif(new.data ->> 'unit', ''), nullif(new.data ->> 'name', ''), 'Vehicle');
begin
  if coalesce(new.data ->> 'assignedTo', '') = ''
     or (tg_op = 'UPDATE' and coalesce(old.data ->> 'assignedTo', '') = new.data ->> 'assignedTo') then
    return new;
  end if;
  begin assigned_user_id := (new.data ->> 'assignedTo')::uuid;
  exception when invalid_text_representation then return new;
  end;
  assigned_name := coalesce(public.notification_actor_name(assigned_user_id), 'crew member');

  for recipient_id in
    select distinct candidate.user_id from (
      select assigned_user_id as user_id
      union all
      select member.user_id from public.company_members member
        where member.company_id = new.company_id and member.role = 'owner'
    ) candidate
    where candidate.user_id is not null and candidate.user_id <> new.updated_by
  loop
    perform public.create_user_notification(
      new.company_id, recipient_id, new.updated_by,
      'vehicle_assigned', 'vehicle', new.record_id,
      'Vehicle assigned: ' || vehicle_name,
      vehicle_name || ' was assigned to ' || assigned_name || '.',
      '/vehicle/' || new.record_id::text,
      'vehicle:' || new.record_id::text,
      'vehicle-assigned:' || new.record_id::text || ':' || new.version::text
    );
  end loop;
  return new;
end;
$$;
revoke all on function public.notify_vehicle_assigned() from public, anon, authenticated;
create trigger fleet_vehicle_assignment_notifications
  after insert or update on public.fleet_vehicles
  for each row execute function public.notify_vehicle_assigned();

create or replace function public.notify_issue_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_id uuid;
  creator_id uuid;
  assigned_user_id uuid;
  assigned_user_text text;
  vehicle_id uuid;
  old_update_count integer := case when jsonb_typeof(old.data -> 'updates') = 'array' then jsonb_array_length(old.data -> 'updates') else 0 end;
  new_update_count integer := case when jsonb_typeof(new.data -> 'updates') = 'array' then jsonb_array_length(new.data -> 'updates') else 0 end;
  status_changed boolean := coalesce(old.data ->> 'status', 'Open') <> coalesce(new.data ->> 'status', 'Open');
  update_added boolean := new_update_count > old_update_count;
  latest_update jsonb;
  issue_title text := coalesce(nullif(new.data ->> 'title', ''), 'Fleet issue');
  vehicle_name text := 'vehicle';
  actor_name text := coalesce(public.notification_actor_name(new.updated_by), 'FireOps user');
  message_title text;
  message_body text;
begin
  if not status_changed and not update_added then return new; end if;

  begin creator_id := nullif(new.data ->> 'createdById', '')::uuid;
  exception when invalid_text_representation then creator_id := null;
  end;

  begin vehicle_id := nullif(new.data ->> 'vehicleId', '')::uuid;
  exception when invalid_text_representation then vehicle_id := null;
  end;
  select coalesce(nullif(vehicle.data ->> 'unit', ''), nullif(vehicle.data ->> 'name', ''), 'vehicle'),
         nullif(vehicle.data ->> 'assignedTo', '')
    into vehicle_name, assigned_user_text
  from public.fleet_vehicles vehicle
  where vehicle.company_id = new.company_id and vehicle.record_id = vehicle_id;
  vehicle_name := coalesce(vehicle_name, 'vehicle');
  begin assigned_user_id := assigned_user_text::uuid;
  exception when invalid_text_representation then assigned_user_id := null;
  end;

  if update_added then latest_update := new.data -> 'updates' -> 0; end if;
  if status_changed then
    message_title := case when new.data ->> 'status' = 'Resolved'
      then 'Issue resolved: ' || issue_title
      else 'Issue reopened: ' || issue_title end;
    message_body := actor_name || case when new.data ->> 'status' = 'Resolved'
      then ' resolved the issue for ' else ' reopened the issue for ' end || vehicle_name || '.';
  else
    message_title := 'Issue updated: ' || issue_title;
    message_body := actor_name || ': ' || coalesce(nullif(latest_update ->> 'text', ''), 'A progress update was added.');
  end if;

  for recipient_id in
    select distinct candidate.user_id from (
      select creator_id as user_id
      union all select assigned_user_id
      union all
      select member.user_id from public.company_members member
        where member.company_id = new.company_id and member.role = 'owner'
    ) candidate
    where candidate.user_id is not null and candidate.user_id <> new.updated_by
  loop
    perform public.create_user_notification(
      new.company_id, recipient_id, new.updated_by,
      'issue_updated', 'issue', new.record_id,
      message_title, message_body,
      '/issue/' || new.record_id::text,
      'issue:' || new.record_id::text,
      'issue-updated:' || new.record_id::text || ':' || new.version::text
    );
  end loop;
  return new;
end;
$$;
revoke all on function public.notify_issue_updated() from public, anon, authenticated;
create trigger fleet_issue_update_notifications
  after update on public.fleet_issues
  for each row execute function public.notify_issue_updated();

-- Service-role-only atomic queue claim. Expired locks retry; five failed claims stop.
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
    where notice.event_type <> 'system' and not (
      coalesce(preference.push_enabled, true) and case notice.event_type
        when 'communication_reply' then coalesce(preference.communication_replies, true)
        when 'document_added' then coalesce(preference.document_added, true)
        when 'training_created' then coalesce(preference.training_created, true)
        when 'vehicle_assigned' then coalesce(preference.vehicle_assigned, true)
        when 'issue_updated' then coalesce(preference.issue_updates, true)
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
      where unread.user_id = notice.user_id and unread.read_at is null
        and exists (select 1 from public.company_members member
          where member.company_id = unread.company_id and member.user_id = unread.user_id)),
    claimed.attempts
  from claimed join public.user_notifications notice on notice.id = claimed.notification_id;
end;
$$;
revoke all on function public.claim_push_notification_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_push_notification_jobs(integer) to service_role;

-- Keep server-only queue data inaccessible even if future broad grants are added.
revoke all on public.push_notification_jobs, public.push_notification_deliveries from public, anon, authenticated;
grant select, insert, update on public.push_notification_jobs, public.push_notification_deliveries to service_role;
grant select, update on public.push_tokens to service_role;

-- Realtime keeps inbox and preference controls synchronized across devices.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_notifications'
  ) then alter publication supabase_realtime add table public.user_notifications; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notification_preferences'
  ) then alter publication supabase_realtime add table public.notification_preferences; end if;
end $$;
