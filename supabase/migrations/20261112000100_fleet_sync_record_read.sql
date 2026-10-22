-- Authoritative, uncached POST RPC for mobile acknowledgment reconciliation.
-- A missing row is a deletion only if the private revision ledger proves it.
begin;
grant create on schema public to fireops_sync_writer;
create function public.get_fleet_sync_record(target_company_id uuid, entity_type text, record_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  table_name text := case entity_type when 'vehicle' then 'fleet_vehicles' when 'issue' then 'fleet_issues' end;
  collection_name text := case entity_type when 'vehicle' then 'vehicles' when 'issue' then 'issues' end;
  current_data jsonb;
  current_version bigint;
  deleted boolean;
begin
  if auth.uid() is null or not public.fleet_sync_reader_allowed(target_company_id,auth.uid()) then
    raise exception 'Company manager access required' using errcode = '42501';
  end if;
  if target_company_id is null or record_id is null or table_name is null then
    raise exception 'Unsupported sync record identity' using errcode = '22023';
  end if;
  perform public.lock_fleet_sync_review(target_company_id,entity_type,record_id);
  execute format('select data,version from public.%I where company_id=$1 and record_id=$2 for update',table_name)
    into current_data,current_version using target_company_id,record_id;
  if current_data is null then
    select r.version,r.deleted into current_version,deleted from public.fleet_sync_revisions r
      where r.company_id=target_company_id and r.collection=collection_name and r.record_id=get_fleet_sync_record.record_id
      order by r.version desc limit 1;
    if deleted is distinct from true then raise exception 'Record is unavailable' using errcode = '42501'; end if;
  end if;
  return jsonb_build_object('revision',current_version::text,'record',current_data);
end;
$$;
alter function public.get_fleet_sync_record(uuid,text,uuid) owner to fireops_sync_writer;
revoke all on function public.get_fleet_sync_record(uuid,text,uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_fleet_sync_record(uuid,text,uuid) to authenticated;
revoke create on schema public from fireops_sync_writer;
commit;
