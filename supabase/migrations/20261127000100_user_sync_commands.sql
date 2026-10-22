-- Offline commands for data owned by ONE user (no manager review; private data
-- is never exposed to reviewers):
-- * personal_task: `task.create` (client-generated ID) and `task.complete`
--   (completing deletes the task, as online). Creates never conflict; completing
--   an absent task is a no-op. A command whose dependencies were not applied by
--   this user is refused, so a completion can never precede its create.
-- * availability: `availability.set` for the caller only, applied only if the
--   current value still equals the device's base; otherwise the current value
--   is KEPT and the receipt says so (an owner may have changed it meanwhile).
-- * dashboard: `dashboard.set` merges changed keys over the current layout;
--   later arrival wins per key (the same user's own preference).
-- Receipts are idempotent per user/company/operation; revisions are the receipt
-- sequence, read back by get_user_sync_state for reconciliation.
begin;

create table public.user_sync_receipts (
  sequence bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null,
  operation_id uuid not null,
  entity_type text not null check (entity_type in ('personal_task','availability','dashboard')),
  entity_id uuid not null,
  request_sha256 bytea not null check (octet_length(request_sha256) = 32),
  device_id text not null,
  saved_at timestamptz not null,
  connectivity text not null check (connectivity in ('online','offline','unknown')),
  received_at timestamptz not null default statement_timestamp(),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  unique (company_id, user_id, operation_id)
);
create index user_sync_receipts_entity_idx on public.user_sync_receipts(user_id, entity_type, entity_id, sequence desc);
alter table public.user_sync_receipts enable row level security;
revoke all on public.user_sync_receipts from public, anon, authenticated, service_role;
grant select on public.user_sync_receipts to service_role;
grant select, insert on public.user_sync_receipts to fireops_sync_writer;
grant usage on sequence public.user_sync_receipts_sequence_seq to fireops_sync_writer;
create policy "sync writer reads own user receipts" on public.user_sync_receipts
  for select to fireops_sync_writer using (user_id = (select auth.uid()));
create policy "sync writer records own user receipts" on public.user_sync_receipts
  for insert to fireops_sync_writer with check (user_id = (select auth.uid()));

grant create on schema public to fireops_sync_writer;
create function public.user_sync_state(company uuid, actor uuid, entity text, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$
  select case entity
    when 'personal_task' then (select jsonb_build_object('id', t.id, 'subject', t.subject, 'description', t.description, 'dueDate', t.due_date::text)
      from public.personal_tasks t where t.id = record_uuid and t.company_id = company and t.user_id = actor)
    when 'availability' then (select jsonb_build_object('id', a.user_id, 'available', a.available)
      from public.crew_availability a where a.company_id = company and a.user_id = record_uuid)
    when 'dashboard' then (select jsonb_build_object('id', p.user_id, 'items', p.items) from public.dashboard_preferences p where p.user_id = actor)
  end;
$$;

create function public.sync_user_command(operation jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  company uuid;
  operation_uuid uuid;
  record_uuid uuid;
  entity text := operation ->> 'entityType';
  command text := operation -> 'mutation' ->> 'command';
  payload jsonb := operation -> 'mutation' -> 'payload';
  provenance jsonb := operation -> 'provenance';
  request_hash bytea;
  previous public.user_sync_receipts;
  current_state jsonb;
  revision bigint;
  result jsonb;
  kept boolean := false;
  dependency text;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(operation) is distinct from 'object' or octet_length(operation::text) > 262144
    or operation -> 'schemaVersion' is distinct from '1'::jsonb
    or (select array_agg(k order by k collate "C") from jsonb_object_keys(operation) k)
      is distinct from array['companyId','dependsOn','entityId','entityType','mutation','operationId','provenance','schemaVersion']
    or jsonb_typeof(operation -> 'mutation') is distinct from 'object'
    or (select array_agg(k order by k collate "C") from jsonb_object_keys(operation -> 'mutation') k) is distinct from array['command','kind','payload']
    or operation -> 'mutation' ->> 'kind' is distinct from 'command' or jsonb_typeof(payload) is distinct from 'object'
    or jsonb_typeof(operation -> 'dependsOn') is distinct from 'array' or jsonb_array_length(operation -> 'dependsOn') > 100
    or (entity, command) not in (('personal_task','task.create'),('personal_task','task.complete'),('availability','availability.set'),('dashboard','dashboard.set')) then
    raise exception 'Unsupported user sync command' using errcode = '22023';
  end if;
  company := (operation ->> 'companyId')::uuid; operation_uuid := (operation ->> 'operationId')::uuid; record_uuid := (operation ->> 'entityId')::uuid;
  if not public.is_company_member(company, actor) then raise exception 'Company membership required' using errcode = '42501'; end if;
  if jsonb_typeof(provenance) is distinct from 'object'
    or (select array_agg(k order by k collate "C") from jsonb_object_keys(provenance) k) is distinct from array['connectivity','deviceId','savedAt','userId']
    or provenance ->> 'userId' is distinct from actor::text
    or jsonb_typeof(provenance -> 'deviceId') is distinct from 'string' or char_length(btrim(provenance ->> 'deviceId')) not between 1 and 200
    or jsonb_typeof(provenance -> 'savedAt') is distinct from 'string' or provenance ->> 'savedAt' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$'
    or provenance ->> 'connectivity' is null or provenance ->> 'connectivity' not in ('online','offline','unknown') then
    raise exception 'Invalid or misattributed sync provenance' using errcode = '22023';
  end if;
  perform (provenance ->> 'savedAt')::timestamptz;
  -- Availability/dashboard commands only ever target the caller.
  if entity in ('availability','dashboard') and record_uuid <> actor then raise exception 'Only your own settings can sync offline' using errcode = '42501'; end if;
  request_hash := sha256(convert_to(operation::text, 'UTF8'));
  perform pg_advisory_xact_lock(hashtextextended('user-sync:' || actor::text || ':' || entity || ':' || record_uuid::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(company::text || ':' || actor::text || ':' || operation_uuid::text, 0));
  select * into previous from public.user_sync_receipts r where r.company_id = company and r.user_id = actor and r.operation_id = operation_uuid;
  if found then
    if previous.request_sha256 <> request_hash then raise exception 'Operation ID was reused for different work' using errcode = '22023'; end if;
    return previous.result;
  end if;
  for dependency in select value #>> '{}' from jsonb_array_elements(operation -> 'dependsOn') loop
    if not exists (select 1 from public.user_sync_receipts r where r.company_id = company and r.user_id = actor and r.operation_id::text = dependency) then
      raise exception 'An earlier device change has not synced yet' using errcode = '55000';
    end if;
  end loop;

  if command = 'task.create' then
    if (select array_agg(k order by k collate "C") from jsonb_object_keys(payload) k) is distinct from array['description','dueDate','subject']
      or jsonb_typeof(payload -> 'subject') <> 'string' or char_length(btrim(payload ->> 'subject')) not between 1 and 200
      or jsonb_typeof(payload -> 'description') <> 'string' or char_length(payload ->> 'description') > 5000
      or jsonb_typeof(payload -> 'dueDate') <> 'string' or payload ->> 'dueDate' !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Invalid task' using errcode = '22023';
    end if;
    perform (payload ->> 'dueDate')::date;
    current_state := public.user_sync_state(company, actor, entity, record_uuid);
    if current_state is null then
      if exists (select 1 from public.personal_tasks t where t.id = record_uuid) then raise exception 'This task identity was already used' using errcode = '23505'; end if;
      insert into public.personal_tasks (id, company_id, user_id, subject, description, due_date)
        values (record_uuid, company, actor, btrim(payload ->> 'subject'), btrim(payload ->> 'description'), (payload ->> 'dueDate')::date);
    elsif current_state - 'id' <> jsonb_build_object('subject', btrim(payload ->> 'subject'), 'description', btrim(payload ->> 'description'), 'dueDate', payload ->> 'dueDate') then
      raise exception 'This task identity was already used' using errcode = '23505';
    end if;
  elsif command = 'task.complete' then
    if payload <> '{}'::jsonb then raise exception 'Invalid task completion' using errcode = '22023'; end if;
    delete from public.personal_tasks t where t.id = record_uuid and t.company_id = company and t.user_id = actor;
  elsif command = 'availability.set' then
    if (select array_agg(k order by k collate "C") from jsonb_object_keys(payload) k) is distinct from array['available','base']
      or jsonb_typeof(payload -> 'available') <> 'boolean' or jsonb_typeof(payload -> 'base') not in ('boolean','null') then
      raise exception 'Invalid availability' using errcode = '22023';
    end if;
    current_state := public.user_sync_state(company, actor, entity, record_uuid);
    if (current_state -> 'available') is distinct from (case when payload -> 'base' = 'null'::jsonb then null else payload -> 'base' end)
      and (current_state -> 'available') is distinct from payload -> 'available' then
      kept := true; -- someone else changed it since the device's base
    else
      insert into public.crew_availability (company_id, user_id, available, updated_at)
        values (company, actor, (payload ->> 'available')::boolean, statement_timestamp())
        on conflict (company_id, user_id) do update set available = excluded.available, updated_at = excluded.updated_at;
    end if;
  else -- dashboard.set
    if (select array_agg(k) from jsonb_object_keys(payload) k) is distinct from array['changes'] or jsonb_typeof(payload -> 'changes') <> 'object'
      or (select count(*) from jsonb_object_keys(payload -> 'changes')) not between 1 and 100
      or exists (select 1 from jsonb_object_keys(payload -> 'changes') k where char_length(k) not between 1 and 100)
      or octet_length((payload -> 'changes')::text) > 65536 then
      raise exception 'Invalid dashboard preferences' using errcode = '22023';
    end if;
    insert into public.dashboard_preferences (user_id, items)
      values (actor, coalesce((select jsonb_object_agg(c.key, c.value) from jsonb_each(payload -> 'changes') c where c.value <> 'null'::jsonb), '{}'::jsonb))
      on conflict (user_id) do update set items = (
        select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(public.dashboard_preferences.items || (payload -> 'changes')) e where e.value <> 'null'::jsonb);
  end if;

  revision := nextval('public.user_sync_receipts_sequence_seq');
  result := jsonb_build_object('kind', 'applied', 'receivedAt', statement_timestamp(), 'revision', revision::text,
    'record', public.user_sync_state(company, actor, entity, record_uuid)) || case when kept then jsonb_build_object('keptCurrent', true) else '{}'::jsonb end;
  insert into public.user_sync_receipts (sequence, company_id, user_id, operation_id, entity_type, entity_id, request_sha256, device_id, saved_at, connectivity, result)
    values (revision, company, actor, operation_uuid, entity, record_uuid, request_hash, provenance ->> 'deviceId', (provenance ->> 'savedAt')::timestamptz, provenance ->> 'connectivity', result);
  return result;
end;
$$;

-- Canonical read for reconciliation: own data only; revision = latest receipt.
create function public.get_user_sync_state(target_company_id uuid, entity_type text, record_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); latest bigint;
begin
  if actor is null or not public.is_company_member(target_company_id, actor) then raise exception 'Company membership required' using errcode = '42501'; end if;
  if entity_type not in ('personal_task','availability','dashboard') then raise exception 'Unsupported user sync entity' using errcode = '22023'; end if;
  if entity_type in ('availability','dashboard') and record_id <> actor then raise exception 'Only your own settings are available' using errcode = '42501'; end if;
  select max(r.sequence) into latest from public.user_sync_receipts r where r.user_id = actor and r.entity_type = get_user_sync_state.entity_type and r.entity_id = record_id;
  return jsonb_build_object('revision', coalesce(latest, 1)::text, 'record', public.user_sync_state(target_company_id, actor, entity_type, record_id));
end;
$$;
alter function public.user_sync_state(uuid, uuid, text, uuid) owner to fireops_sync_writer;
alter function public.sync_user_command(jsonb) owner to fireops_sync_writer;
alter function public.get_user_sync_state(uuid, text, uuid) owner to fireops_sync_writer;
revoke all on function public.user_sync_state(uuid, uuid, text, uuid), public.sync_user_command(jsonb), public.get_user_sync_state(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.sync_user_command(jsonb), public.get_user_sync_state(uuid, text, uuid) to authenticated;
revoke create on schema public from fireops_sync_writer;
commit;
