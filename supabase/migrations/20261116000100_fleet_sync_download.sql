-- Stateless verified inventory pages. A revision fingerprint, not wall-clock
-- ordering or an allocating sequence, fences concurrent/uncommitted writers.
begin;
create index fleet_sync_latest_download_idx on public.fleet_sync_revisions(company_id,collection,record_id,version desc) where collection in ('vehicles','issues');
grant create on schema public to fireops_sync_writer;
create function public.download_fleet_sync_page(target_company_id uuid,expected_snapshot text default null,record_cursor jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  cursor_collection text;
  cursor_id uuid;
  response jsonb;
  page jsonb;
begin
  if auth.uid() is null or target_company_id is null or not public.fleet_sync_reader_allowed(target_company_id,auth.uid()) then raise exception 'Company manager access required' using errcode='42501'; end if;
  if expected_snapshot is not null and expected_snapshot !~ '^[0-9a-f]{64}$' then raise exception 'Invalid inventory fingerprint' using errcode='22023'; end if;
  if record_cursor is not null then
    if expected_snapshot is null or jsonb_typeof(record_cursor) is distinct from 'object' then raise exception 'Inventory cursor needs its fingerprint' using errcode='22023'; end if;
    cursor_collection := case record_cursor->>'entityType' when 'vehicle' then 'vehicles' when 'issue' then 'issues' end;
    cursor_id := (record_cursor->>'entityId')::uuid;
    if cursor_collection is null or cursor_id is null then raise exception 'Invalid inventory cursor' using errcode='22023'; end if;
  end if;
  -- All row contents, ledger proofs, counts, token and page share ONE SQL
  -- snapshot. A live row hidden by RLS is unavailability, never a deletion.
  with access_check as materialized (select public.fleet_sync_reader_allowed(target_company_id,auth.uid()) as allowed), latest as materialized (
    select distinct on (r.collection,r.record_id) r.* from public.fleet_sync_revisions r
      where r.company_id=target_company_id and r.collection in ('vehicles','issues')
        -- Crew can read only issues they reported; their inventory covers vehicles only.
        and (r.collection='vehicles' or public.is_company_owner(target_company_id,auth.uid()))
      order by r.collection,r.record_id,r.version desc
  ), verified as materialized (
    select l.*,case l.collection when 'vehicles' then v.data else i.data end as data,
      case l.collection when 'vehicles' then v.version else i.version end as live_version
      from latest l left join public.fleet_vehicles v on l.collection='vehicles' and v.company_id=l.company_id and v.record_id=l.record_id
      left join public.fleet_issues i on l.collection='issues' and i.company_id=l.company_id and i.record_id=l.record_id
  ), inventory as (
    select encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(collection,record_id,version::text,deleted,encode(data_sha256,'hex')) order by collection,record_id),'[]'::jsonb)::text,'UTF8')),'hex') as token,
      count(*)::int as total,count(*) filter(where not deleted and collection='vehicles')::int as vehicles,
      count(*) filter(where not deleted and collection='issues')::int as issues,
      coalesce(bool_or(case when deleted then data is not null else data is null or live_version is distinct from version or data->>'id' is distinct from record_id::text or sha256(convert_to(data::text,'UTF8')) is distinct from data_sha256 end),false) as invalid
      from verified
  ), selected as (
    select * from verified where record_cursor is null or (collection,record_id)>(cursor_collection,cursor_id)
      order by collection,record_id limit 26
  )
  select jsonb_build_object('companyId',target_company_id,'snapshotToken',inventory.token,'total',inventory.total,'vehicles',inventory.vehicles,'issues',inventory.issues,
    'serverRequestAt',statement_timestamp(),'authorized',(select allowed from access_check),'invalid',inventory.invalid
      or exists(select 1 from public.fleet_vehicles v where v.company_id=target_company_id and not exists(select 1 from latest l where l.collection='vehicles' and l.record_id=v.record_id))
      or (public.is_company_owner(target_company_id,auth.uid()) and exists(select 1 from public.fleet_issues i where i.company_id=target_company_id and not exists(select 1 from latest l where l.collection='issues' and l.record_id=i.record_id))),
    'records',coalesce((select jsonb_agg(jsonb_build_object('entityType',case collection when 'vehicles' then 'vehicle' else 'issue' end,'entityId',record_id,'revision',version::text,'record',case when deleted then null else data end) order by collection,record_id) from selected),'[]'::jsonb))
    into response from inventory;
  if (response->>'authorized')::boolean is distinct from true or (response->>'invalid')::boolean then raise exception 'Inventory contains unavailable or inconsistent records' using errcode='42501'; end if;
  if expected_snapshot is not null and expected_snapshot<>response->>'snapshotToken' then raise exception 'Fleet changed during download; restart inventory scan' using errcode='PT409'; end if;
  page := response->'records';
  if jsonb_array_length(page)>25 then
    response := response||jsonb_build_object('nextCursor',jsonb_build_object('entityType',page#>>'{24,entityType}','entityId',page#>>'{24,entityId}'),'records',page-25);
  else response := response||jsonb_build_object('nextCursor',null); end if;
  return response-'invalid'-'authorized';
end;
$$;
alter function public.download_fleet_sync_page(uuid,text,jsonb) owner to fireops_sync_writer;
revoke all on function public.download_fleet_sync_page(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.download_fleet_sync_page(uuid,text,jsonb) to authenticated;
revoke create on schema public from fireops_sync_writer;
commit;
