-- Crew members can edit credentials and incident experience on their own record.
create or replace function public.update_my_crew_credential(target_company_id uuid, credential jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid(); updated_record jsonb;
  allowed_type text := credential ->> 'recordType'; attachment_path text := credential #>> '{file,path}';
begin
  if actor_id is null or not public.is_company_member(target_company_id, actor_id) then
    raise exception 'Company membership required' using errcode = '42501';
  end if;
  if allowed_type not in ('Training','Qualification','License','Task Book','Medical')
    or nullif(btrim(credential ->> 'id'),'') is null or nullif(btrim(credential ->> 'name'),'') is null
    or nullif(btrim(credential ->> 'courseCode'),'') is null or nullif(btrim(credential ->> 'completionDate'),'') is null
    or nullif(btrim(credential ->> 'provider'),'') is null then
    raise exception 'Invalid credential' using errcode = '22023';
  end if;
  if attachment_path is not null and attachment_path not like target_company_id::text || '/' || actor_id::text || '/%' then
    raise exception 'Invalid credential attachment' using errcode = '22023';
  end if;
  update public.fleet_crew set data = data || jsonb_build_object('credentials',
    (select coalesce(jsonb_agg(case when item ->> 'id' = credential ->> 'id' then credential else item end),'[]'::jsonb)
     from jsonb_array_elements(coalesce(data -> 'credentials','[]'::jsonb)) item)),
    version=version+1,updated_by=actor_id
  where company_id=target_company_id and record_id=actor_id
    and exists(select 1 from jsonb_array_elements(coalesce(data -> 'credentials','[]'::jsonb)) item where item ->> 'id'=credential ->> 'id')
  returning data into updated_record;
  if updated_record is null then raise exception 'Credential not found' using errcode = 'P0002'; end if;
  return updated_record;
end;$$;

create or replace function public.update_my_crew_experience(target_company_id uuid, experience jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid(); updated_record jsonb; attachment_path text := experience #>> '{file,path}';
begin
  if actor_id is null or not public.is_company_member(target_company_id, actor_id) then
    raise exception 'Company membership required' using errcode = '42501';
  end if;
  if nullif(btrim(experience ->> 'id'),'') is null or nullif(btrim(experience ->> 'incident'),'') is null
    or nullif(btrim(experience ->> 'position'),'') is null or nullif(btrim(experience ->> 'days'),'') is null then
    raise exception 'Invalid incident experience' using errcode = '22023';
  end if;
  if attachment_path is not null and attachment_path not like target_company_id::text || '/' || actor_id::text || '/%' then
    raise exception 'Invalid experience attachment' using errcode = '22023';
  end if;
  update public.fleet_crew set data = data || jsonb_build_object('experiences',
    (select coalesce(jsonb_agg(case when item ->> 'id' = experience ->> 'id' then experience else item end),'[]'::jsonb)
     from jsonb_array_elements(coalesce(data -> 'experiences','[]'::jsonb)) item)),
    version=version+1,updated_by=actor_id
  where company_id=target_company_id and record_id=actor_id
    and exists(select 1 from jsonb_array_elements(coalesce(data -> 'experiences','[]'::jsonb)) item where item ->> 'id'=experience ->> 'id')
  returning data into updated_record;
  if updated_record is null then raise exception 'Experience not found' using errcode = 'P0002'; end if;
  return updated_record;
end;$$;

revoke all on function public.update_my_crew_credential(uuid,jsonb) from public,anon;
revoke all on function public.update_my_crew_experience(uuid,jsonb) from public,anon;
grant execute on function public.update_my_crew_credential(uuid,jsonb) to authenticated;
grant execute on function public.update_my_crew_experience(uuid,jsonb) to authenticated;
