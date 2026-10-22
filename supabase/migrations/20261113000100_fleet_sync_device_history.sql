-- Preserve device-reported continuation/rebase versions atomically with their
-- authenticated scalar submission. Device history is not canonical provenance
-- or a manager approval; current RLS and verified-base validation still apply.
begin;
create table public.fleet_sync_device_history (
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_user_id uuid not null,
  operation_id uuid not null,
  entity_type text not null check (entity_type in ('vehicle','issue')),
  record_id uuid not null,
  actor_name text,
  history_sha256 bytea not null check (octet_length(history_sha256)=32),
  device_history jsonb not null check (jsonb_typeof(device_history)='array'),
  received_at timestamptz not null default clock_timestamp(),
  primary key(company_id,actor_user_id,operation_id),
  foreign key(company_id,actor_user_id,operation_id) references public.fleet_sync_submissions(company_id,actor_user_id,operation_id) on delete cascade
);
alter table public.fleet_sync_device_history enable row level security;
revoke all on public.fleet_sync_device_history from public,anon,authenticated,service_role;
grant select on public.fleet_sync_device_history to authenticated,service_role;
grant select,insert on public.fleet_sync_device_history to fireops_sync_writer;
create policy "managers read device-reported sync history" on public.fleet_sync_device_history
  for select to authenticated using (public.is_company_owner(company_id,(select auth.uid())));
create policy "writer records own device-reported history" on public.fleet_sync_device_history
  for insert to fireops_sync_writer with check (actor_user_id=(select auth.uid()) and public.fleet_sync_submitter_allowed(company_id,(select auth.uid())));

grant create on schema public to fireops_sync_writer;
create function public.sync_fleet_update_with_history(operation jsonb, device_history jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  company uuid;
  op_id uuid;
  record_uuid uuid;
  entity text;
  digest bytea;
  existing bytea;
  item jsonb;
  snapshot jsonb;
  previous_after jsonb;
  old_proposal jsonb;
  new_proposal jsonb;
  merged jsonb;
  choices jsonb;
  key text;
  source text;
  wanted jsonb;
  actual jsonb;
  dependency text;
  result jsonb;
  actor_label text;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  company := (operation->>'companyId')::uuid;
  if company is null or not public.fleet_sync_submitter_allowed(company,actor) then raise exception 'Company manager access required' using errcode='42501'; end if;
  op_id := (operation->>'operationId')::uuid; record_uuid := (operation->>'entityId')::uuid; entity := operation->>'entityType';
  if op_id is null or record_uuid is null or entity not in ('vehicle','issue') or entity is null then raise exception 'Invalid history identity' using errcode='22023'; end if;
  if jsonb_typeof(device_history) is distinct from 'array' then raise exception 'Invalid device history' using errcode='22023'; end if;
  if jsonb_array_length(device_history) not between 1 and 100 or octet_length(device_history::text)+octet_length(operation::text)>4194304 then
    raise exception 'Device history is too large' using errcode='22023';
  end if;
  -- Same ordering as submission/review: record-group lock before operation lock.
  perform public.lock_fleet_sync_review(company,entity,record_uuid);
  perform pg_advisory_xact_lock(hashtextextended(company::text||':'||actor::text||':'||op_id::text,0));
  digest := sha256(convert_to(device_history::text,'UTF8'));
  select history_sha256 into existing from public.fleet_sync_device_history h where h.company_id=company and h.actor_user_id=actor and h.operation_id=op_id;
  if existing is not null then
    if existing<>digest then raise exception 'Device history changed for an existing operation' using errcode='22023'; end if;
    return public.sync_fleet_update(operation);
  end if;
  for item in select value from jsonb_array_elements(device_history) loop
    if jsonb_typeof(item) is distinct from 'object' or (select count(*) from jsonb_object_keys(item))<>4 or not item ?& array['before','after','reason','createdAt'] then
      raise exception 'Invalid device history entry' using errcode='22023';
    end if;
    if jsonb_typeof(item->'reason') is distinct from 'string' or jsonb_typeof(item->'createdAt') is distinct from 'string' or not isfinite((item->>'createdAt')::timestamptz) then
      raise exception 'Invalid device history metadata' using errcode='22023';
    end if;
    for snapshot in select value from jsonb_array_elements(jsonb_build_array(item->'before',item->'after')) loop
      if jsonb_typeof(snapshot) is distinct from 'object' or (select count(*) from jsonb_object_keys(snapshot))<>8
        or not snapshot ?& array['schemaVersion','operationId','companyId','entityType','entityId','provenance','dependsOn','mutation'] or snapshot->'schemaVersion' is distinct from '1'::jsonb
        or (snapshot->>'companyId')::uuid is distinct from company or (snapshot->>'operationId')::uuid is distinct from op_id
        or (snapshot->>'entityId')::uuid is distinct from record_uuid or snapshot->>'entityType' is distinct from entity
        or (snapshot#>>'{provenance,userId}')::uuid is distinct from actor or snapshot#>>'{mutation,kind}' is distinct from 'update'
        or snapshot#>>'{mutation,base,id}' is distinct from operation->>'entityId' then
        raise exception 'Device history scope/identity mismatch' using errcode='22023';
      end if;
      if jsonb_typeof(snapshot->'dependsOn') is distinct from 'array' then raise exception 'Invalid history dependencies' using errcode='22023'; end if;
      if jsonb_array_length(snapshot->'dependsOn')>1 then raise exception 'Unsupported history dependencies' using errcode='22023'; end if;
      for dependency in select value#>>'{}' from jsonb_array_elements(snapshot->'dependsOn') loop
        if not exists(select 1 from public.fleet_sync_submissions s where s.company_id=company and s.actor_user_id=actor and s.operation_id=dependency::uuid and s.entity_type=entity and s.record_id=record_uuid) then
          raise exception 'Unknown device history dependency' using errcode='22023';
        end if;
      end loop;
    end loop;
    if previous_after is not null and previous_after is distinct from item->'before' then raise exception 'Broken device history chain' using errcode='22023'; end if;
    if item#>'{before,provenance}' is distinct from item#>'{after,provenance}' then raise exception 'History cannot change original provenance' using errcode='22023'; end if;
    old_proposal := public.merge_fleet_sync_fields(item#>'{before,mutation,base}',item#>'{before,mutation,base}',item#>'{before,mutation,patch}')->'record';
    new_proposal := public.merge_fleet_sync_fields(item#>'{after,mutation,base}',item#>'{after,mutation,base}',item#>'{after,mutation,patch}')->'record';
    if exists(select 1 from jsonb_object_keys(item#>'{after,mutation,patch}') as fields(field) where not (item#>'{before,mutation,patch}') ? field) then raise exception 'History added an unreviewed field' using errcode='22023'; end if;
    if item->>'reason'='automatic_independent' then
      merged := public.merge_fleet_sync_fields(item#>'{before,mutation,base}',item#>'{after,mutation,base}',item#>'{before,mutation,patch}');
      if merged->>'kind' is distinct from 'merged' or merged->'record' is distinct from new_proposal
        or item#>'{before,dependsOn}' is distinct from item#>'{after,dependsOn}' then raise exception 'Invalid automatic rebase history' using errcode='22023'; end if;
    elsif left(item->>'reason',9)='explicit:' then
      choices := substring(item->>'reason' from 10)::jsonb;
      if jsonb_typeof(choices) is distinct from 'object' then raise exception 'Invalid local choices' using errcode='22023'; end if;
      if (select count(*) from jsonb_object_keys(choices))<>(select count(*) from jsonb_object_keys(item#>'{before,mutation,patch}')) or item#>'{after,dependsOn}' is distinct from '[]'::jsonb then raise exception 'Incomplete local choices' using errcode='22023'; end if;
      for key,source in select k,v#>>'{}' from jsonb_each(choices) as c(k,v) loop
        if not (item#>'{before,mutation,patch}') ? key or source not in ('current','saved') or source is null then raise exception 'Invalid local field choice' using errcode='22023'; end if;
        snapshot := case source when 'current' then item#>'{after,mutation,base}' else old_proposal end;
        wanted := case when snapshot ? key then jsonb_build_object('present',true,'value',snapshot->key) else '{"present":false}'::jsonb end;
        actual := case when new_proposal ? key then jsonb_build_object('present',true,'value',new_proposal->key) else '{"present":false}'::jsonb end;
        if wanted is distinct from actual then raise exception 'Local choice does not match proposed value' using errcode='22023'; end if;
      end loop;
    else raise exception 'Unknown device history reason' using errcode='22023';
    end if;
    previous_after := item->'after';
  end loop;
  if previous_after is distinct from operation then raise exception 'Final history does not match submitted operation' using errcode='22023'; end if;
  -- Business change/conflict, receipt and history either all commit or all roll back.
  result := public.sync_fleet_update(operation);
  select nullif(full_name,'') into actor_label from public.profiles where user_id=actor;
  insert into public.fleet_sync_device_history(company_id,actor_user_id,operation_id,entity_type,record_id,actor_name,history_sha256,device_history)
    values(company,actor,op_id,entity,record_uuid,actor_label,digest,device_history);
  return result;
end;
$$;
alter function public.sync_fleet_update_with_history(jsonb,jsonb) owner to fireops_sync_writer;
revoke all on function public.sync_fleet_update_with_history(jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sync_fleet_update_with_history(jsonb,jsonb) to authenticated;
revoke create on schema public from fireops_sync_writer;
commit;
