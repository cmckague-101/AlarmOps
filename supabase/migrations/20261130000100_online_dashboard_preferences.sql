-- Online-only per-key preferences with immutable retry receipts. Native queued
-- commands use the same atomic merge helper. No browser queue/offline replay.
begin;

create table public.dashboard_preference_receipts (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  request_id uuid not null,
  request jsonb not null check (jsonb_typeof(request) = 'object'),
  previous_items jsonb not null check (jsonb_typeof(previous_items) = 'object'),
  received_at timestamptz not null default statement_timestamp(),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  primary key (user_id, request_id)
);
alter table public.dashboard_preference_receipts enable row level security;
revoke all on public.dashboard_preference_receipts from public, anon, authenticated, service_role;
grant select on public.dashboard_preference_receipts to service_role;
grant select, insert on public.dashboard_preference_receipts to fireops_sync_writer;
create policy "sync executor reads own dashboard receipts" on public.dashboard_preference_receipts
  for select to fireops_sync_writer using (user_id = (select auth.uid()));
create policy "sync executor records own dashboard receipts" on public.dashboard_preference_receipts
  for insert to fireops_sync_writer with check (user_id = (select auth.uid()));

-- Old whole-layout upserts must not bypass partial-update semantics. Existing
-- SELECT policies remain; only the non-bypass executor can mutate preferences.
revoke insert, update, delete on public.dashboard_preferences from authenticated, service_role;
grant select, insert, update on public.dashboard_preferences to fireops_sync_writer;

grant create on schema public to fireops_sync_writer;
create function public.validate_dashboard_preference_changes(changes jsonb)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(changes) is distinct from 'object' then raise exception 'Invalid dashboard changes' using errcode = '22023'; end if;
  if (select count(*) from jsonb_object_keys(changes)) not between 1 and 16
    or exists (select 1 from jsonb_each(changes) e where e.key not in
      ('greeting','incidents','personnel','resources','attention','currentIssues','currentPicture','availability','tasks','inspections','inventory','payroll','receipts','invoices','nationalFireActivity','recentActivity')
      or jsonb_typeof(e.value) not in ('boolean','null')) then
    raise exception 'Invalid dashboard changes' using errcode = '22023';
  end if;
end;
$$;
alter function public.validate_dashboard_preference_changes(jsonb) owner to fireops_sync_writer;
revoke all on function public.validate_dashboard_preference_changes(jsonb) from public, anon, authenticated, service_role;

create or replace function public.user_sync_apply_dashboard(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
begin
  if jsonb_typeof(payload) is distinct from 'object' or (select array_agg(k) from jsonb_object_keys(payload) k) is distinct from array['changes'] then
    raise exception 'Invalid dashboard preferences' using errcode = '22023';
  end if;
  perform public.validate_dashboard_preference_changes(payload -> 'changes');
  insert into public.dashboard_preferences (user_id, items)
    values (actor, coalesce((select jsonb_object_agg(c.key, c.value) from jsonb_each(payload -> 'changes') c where c.value <> 'null'::jsonb), '{}'::jsonb))
    on conflict (user_id) do update set items = (
      select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(public.dashboard_preferences.items || (payload -> 'changes')) e where e.value <> 'null'::jsonb);
  return '{}'::jsonb;
end;
$$;

create function public.set_dashboard_preferences_once(request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); request_uuid uuid; previous public.dashboard_preference_receipts; before_items jsonb; result jsonb;
begin
  if actor is null or request ->> 'userId' is distinct from actor::text or not exists (select 1 from public.profiles p where p.user_id = actor) then
    raise exception 'Current dashboard account required' using errcode = '42501';
  end if;
  if jsonb_typeof(request) is distinct from 'object' or octet_length(request::text) > 16384
    or request -> 'schemaVersion' is distinct from '1'::jsonb
    or (select array_agg(k order by k collate "C") from jsonb_object_keys(request) k) is distinct from array['changes','connectivity','requestId','savedAt','schemaVersion','userId']
    or jsonb_typeof(request -> 'requestId') is distinct from 'string'
    or request ->> 'requestId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(request -> 'savedAt') is distinct from 'string' or request ->> 'savedAt' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$'
    or request ->> 'connectivity' is null or request ->> 'connectivity' not in ('online','offline','unknown') then
    raise exception 'Invalid dashboard request' using errcode = '22023';
  end if;
  perform (request ->> 'savedAt')::timestamptz;
  perform public.validate_dashboard_preference_changes(request -> 'changes');
  request_uuid := (request ->> 'requestId')::uuid;
  -- Same lock and order as native dashboard commands, including audit preimage.
  perform pg_advisory_xact_lock(hashtextextended('user-sync:' || actor::text || ':dashboard:' || actor::text, 0));
  select * into previous from public.dashboard_preference_receipts r where r.user_id = actor and r.request_id = request_uuid;
  if found then
    if previous.request <> request then raise exception 'Dashboard request ID was reused' using errcode = '22023'; end if;
    return previous.result;
  end if;
  select p.items into before_items from public.dashboard_preferences p where p.user_id = actor;
  perform public.user_sync_apply_dashboard(null, actor, actor, 'dashboard.set', jsonb_build_object('changes', request -> 'changes'));
  result := jsonb_build_object('kind','applied','requestId',request_uuid,'userId',actor,'receivedAt',statement_timestamp(),
    'items',(select p.items from public.dashboard_preferences p where p.user_id = actor));
  insert into public.dashboard_preference_receipts(user_id,request_id,request,previous_items,result)
    values(actor,request_uuid,request,coalesce(before_items,'{}'::jsonb),result);
  return result;
end;
$$;
alter function public.set_dashboard_preferences_once(jsonb) owner to fireops_sync_writer;
revoke all on function public.set_dashboard_preferences_once(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.set_dashboard_preferences_once(jsonb) to authenticated;

create function public.get_dashboard_preferences()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null or not exists (select 1 from public.profiles p where p.user_id = actor) then raise exception 'Current dashboard account required' using errcode = '42501'; end if;
  return jsonb_build_object('userId',actor,'items',coalesce((select p.items from public.dashboard_preferences p where p.user_id = actor),'{}'::jsonb));
end;
$$;
alter function public.get_dashboard_preferences() owner to fireops_sync_writer;
revoke all on function public.get_dashboard_preferences() from public, anon, authenticated, service_role;
grant execute on function public.get_dashboard_preferences() to authenticated;
revoke create on schema public from fireops_sync_writer;

create function public.guard_dashboard_preference_receipts()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'Dashboard preference receipts are immutable' using errcode = '42501';
end;
$$;
revoke all on function public.guard_dashboard_preference_receipts() from public, anon, authenticated, service_role;
create trigger guard_dashboard_preference_receipts before update or delete on public.dashboard_preference_receipts
  for each row execute function public.guard_dashboard_preference_receipts();
commit;
