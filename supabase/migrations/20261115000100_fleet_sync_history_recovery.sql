-- Recover audit from older mobile builds without replaying an unknown business
-- operation. Existing submission and exact original request hash are mandatory.
begin;
grant create on schema public to fireops_sync_writer;
create function public.backfill_fleet_sync_device_history(operation jsonb,device_history jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  company uuid;
  op_id uuid;
  record_uuid uuid;
  entity text;
  submitted public.fleet_sync_submissions%rowtype;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  company := (operation->>'companyId')::uuid;
  if company is null or not public.is_company_owner(company,actor) then raise exception 'Company manager access required' using errcode='42501'; end if;
  op_id := (operation->>'operationId')::uuid;record_uuid := (operation->>'entityId')::uuid;entity := operation->>'entityType';
  if op_id is null or record_uuid is null or entity is null or entity not in ('vehicle','issue') or (operation#>>'{provenance,userId}')::uuid is distinct from actor then
    raise exception 'Invalid history recovery identity' using errcode='22023';
  end if;
  -- Match submission/review lock ordering. Never invoke the applying endpoint
  -- until this exact authenticated operation is proven already submitted.
  perform public.lock_fleet_sync_review(company,entity,record_uuid);
  perform pg_advisory_xact_lock(hashtextextended(company::text||':'||actor::text||':'||op_id::text,0));
  select * into submitted from public.fleet_sync_submissions s where s.company_id=company and s.actor_user_id=actor and s.operation_id=op_id for key share;
  if not found then raise exception 'Original submission unavailable; business operation was not replayed' using errcode='55000'; end if;
  if submitted.entity_type<>entity or submitted.record_id<>record_uuid or submitted.request_sha256<>sha256(convert_to(operation::text,'UTF8')) then
    raise exception 'Recovery request differs from original submission' using errcode='22023';
  end if;
  return public.sync_fleet_update_with_history(operation,device_history);
end;
$$;
alter function public.backfill_fleet_sync_device_history(jsonb,jsonb) owner to fireops_sync_writer;
revoke all on function public.backfill_fleet_sync_device_history(jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.backfill_fleet_sync_device_history(jsonb,jsonb) to authenticated;
revoke create on schema public from fireops_sync_writer;
commit;
