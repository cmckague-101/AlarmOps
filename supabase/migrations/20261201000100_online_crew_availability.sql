-- Value-CAS online availability with authenticated actor/target scope and exact
-- retry receipts. Same conditional mutation as native own-availability commands.
begin;

-- Quiesce old direct writers, with parents before the availability child.
lock table public.companies in share row exclusive mode;
lock table public.company_members in share row exclusive mode;
lock table public.crew_availability in share row exclusive mode;

create table public.crew_availability_receipts (
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_id uuid not null,
  request_id uuid not null,
  target_user_id uuid not null,
  request jsonb not null check (jsonb_typeof(request) = 'object'),
  previous_available boolean,
  received_at timestamptz not null default statement_timestamp(),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  primary key (company_id, actor_id, request_id)
);
alter table public.crew_availability_receipts enable row level security;
revoke all on public.crew_availability_receipts from public, anon, authenticated, service_role;
grant select on public.crew_availability_receipts to service_role;
grant select, insert on public.crew_availability_receipts to fireops_sync_writer;
create policy "sync executor reads own availability receipts" on public.crew_availability_receipts
  for select to fireops_sync_writer using (actor_id = (select auth.uid()));
create policy "sync executor records own availability receipts" on public.crew_availability_receipts
  for insert to fireops_sync_writer with check (actor_id = (select auth.uid()));
revoke insert, update, delete on public.crew_availability from authenticated, service_role;
grant select on public.crew_availability to service_role;
grant select, insert, update on public.crew_availability to fireops_sync_writer;

grant create on schema public to fireops_sync_writer;
create function public.apply_crew_availability_cas(company uuid, target_user uuid, payload jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare changed_rows bigint;
begin
  if jsonb_typeof(payload) is distinct from 'object' or (select array_agg(k order by k collate "C") from jsonb_object_keys(payload) k) is distinct from array['available','base']
    or jsonb_typeof(payload -> 'available') <> 'boolean' or jsonb_typeof(payload -> 'base') not in ('boolean','null') then
    raise exception 'Invalid availability' using errcode = '22023';
  end if;
  if payload -> 'base' = 'null'::jsonb then
    insert into public.crew_availability (company_id, user_id, available, updated_at)
      values (company, target_user, (payload ->> 'available')::boolean, statement_timestamp())
      on conflict (company_id, user_id) do update set available = excluded.available, updated_at = excluded.updated_at
        where public.crew_availability.available = excluded.available;
  else
    update public.crew_availability a
      set available = (payload ->> 'available')::boolean, updated_at = statement_timestamp()
      where a.company_id = company and a.user_id = target_user
        and (a.available = (payload ->> 'base')::boolean or a.available = (payload ->> 'available')::boolean);
  end if;
  get diagnostics changed_rows = row_count;
  return case when changed_rows = 0 then jsonb_build_object('keptCurrent',true) else '{}'::jsonb end;
end;
$$;
alter function public.apply_crew_availability_cas(uuid, uuid, jsonb) owner to fireops_sync_writer;
revoke all on function public.apply_crew_availability_cas(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
create or replace function public.user_sync_apply_availability(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
begin
  return public.apply_crew_availability_cas(company,actor,payload);
end;
$$;

create function public.get_crew_availability(target_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null or target_company_id is null or not (public.is_company_member(target_company_id,actor) or public.has_system_admin_company_access(target_company_id)) then
    raise exception 'Current availability read access required' using errcode = '42501';
  end if;
  return jsonb_build_object('companyId',target_company_id,'actorId',actor,'statuses',coalesce(
    (select jsonb_object_agg(a.user_id::text,a.available) from public.crew_availability a where a.company_id=target_company_id),'{}'::jsonb));
end;
$$;
alter function public.get_crew_availability(uuid) owner to fireops_sync_writer;
revoke all on function public.get_crew_availability(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_crew_availability(uuid) to authenticated;

create function public.set_crew_availability_once(request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); company uuid; target_user uuid; request_uuid uuid; previous public.crew_availability_receipts; before_value boolean; current_value boolean; applied jsonb; result jsonb;
begin
  if actor is null or request ->> 'actorId' is distinct from actor::text then raise exception 'Availability account changed' using errcode = '42501'; end if;
  if jsonb_typeof(request) is distinct from 'object' or octet_length(request::text) > 16384
    or request -> 'schemaVersion' is distinct from '1'::jsonb
    or (select array_agg(k order by k collate "C") from jsonb_object_keys(request) k) is distinct from array['actorId','available','base','companyId','connectivity','requestId','savedAt','schemaVersion','userId']
    or jsonb_typeof(request -> 'companyId') is distinct from 'string' or jsonb_typeof(request -> 'userId') is distinct from 'string' or jsonb_typeof(request -> 'requestId') is distinct from 'string'
    or request ->> 'requestId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(request -> 'savedAt') is distinct from 'string' or request ->> 'savedAt' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$'
    or request ->> 'connectivity' is null or request ->> 'connectivity' not in ('online','offline','unknown') then raise exception 'Invalid availability request' using errcode = '22023'; end if;
  perform (request ->> 'savedAt')::timestamptz;
  company := (request ->> 'companyId')::uuid; target_user := (request ->> 'userId')::uuid; request_uuid := (request ->> 'requestId')::uuid;
  if not public.is_company_member(company,actor) or (actor <> target_user and not public.is_company_owner(company,actor)) then raise exception 'Current availability write access required' using errcode = '42501'; end if;
  -- Match native self-command record locking, even when an owner edits that user.
  perform pg_advisory_xact_lock(hashtextextended('user-sync:' || target_user::text || ':availability:' || target_user::text,0));
  perform pg_advisory_xact_lock(hashtextextended('availability-request:' || company::text || ':' || actor::text || ':' || request_uuid::text,0));
  if not public.is_company_member(company,actor) or (actor <> target_user and not public.is_company_owner(company,actor))
    or not exists (select 1 from public.company_members m where m.company_id=company and m.user_id=target_user) then
    raise exception 'Current availability write access required' using errcode = '42501';
  end if;
  select * into previous from public.crew_availability_receipts r where r.company_id=company and r.actor_id=actor and r.request_id=request_uuid;
  if found then
    if previous.request <> request then raise exception 'Availability request ID was reused' using errcode = '22023'; end if;
    return previous.result;
  end if;
  select a.available into before_value from public.crew_availability a where a.company_id=company and a.user_id=target_user;
  applied := public.apply_crew_availability_cas(company,target_user,jsonb_build_object('available',request -> 'available','base',request -> 'base'));
  if not public.is_company_member(company,actor) or (actor <> target_user and not public.is_company_owner(company,actor))
    or not exists (select 1 from public.company_members m where m.company_id=company and m.user_id=target_user) then raise exception 'Current availability write access required' using errcode = '42501'; end if;
  select a.available into current_value from public.crew_availability a where a.company_id=company and a.user_id=target_user;
  result := jsonb_build_object('kind',case when coalesce((applied ->> 'keptCurrent')::boolean,false) then 'kept_current' else 'applied' end,
    'companyId',company,'actorId',actor,'userId',target_user,'requestId',request_uuid,'available',current_value,'receivedAt',statement_timestamp());
  insert into public.crew_availability_receipts(company_id,actor_id,request_id,target_user_id,request,previous_available,result)
    values(company,actor,request_uuid,target_user,request,before_value,result);
  return result;
end;
$$;
alter function public.set_crew_availability_once(jsonb) owner to fireops_sync_writer;
revoke all on function public.set_crew_availability_once(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.set_crew_availability_once(jsonb) to authenticated;
revoke create on schema public from fireops_sync_writer;

create function public.guard_crew_availability_receipts()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' and pg_trigger_depth()>1 then return old; end if;
  raise exception 'Availability receipts are immutable' using errcode = '42501';
end;
$$;
revoke all on function public.guard_crew_availability_receipts() from public, anon, authenticated, service_role;
create trigger guard_crew_availability_receipts before update or delete on public.crew_availability_receipts
  for each row execute function public.guard_crew_availability_receipts();
commit;
