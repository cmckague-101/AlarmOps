-- Crew members can delete credentials and incident experience from their own record.
create or replace function public.delete_my_crew_credential(target_company_id uuid, credential_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  updated_record jsonb;
begin
  if actor_id is null or not public.is_company_member(target_company_id, actor_id) then
    raise exception 'Company membership required' using errcode = '42501';
  end if;
  if nullif(btrim(credential_id), '') is null then
    raise exception 'Invalid credential' using errcode = '22023';
  end if;

  update public.fleet_crew
  set data = data || jsonb_build_object(
        'credentials',
        (select coalesce(jsonb_agg(item order by ordinal), '[]'::jsonb)
         from jsonb_array_elements(coalesce(data -> 'credentials', '[]'::jsonb)) with ordinality entries(item, ordinal)
         where item ->> 'id' is distinct from credential_id)
      ),
      version = version + 1,
      updated_by = actor_id
  where company_id = target_company_id
    and record_id = actor_id
    and exists (
      select 1 from jsonb_array_elements(coalesce(data -> 'credentials', '[]'::jsonb)) item
      where item ->> 'id' = credential_id
    )
  returning data into updated_record;

  if updated_record is null then
    raise exception 'Credential not found' using errcode = 'P0002';
  end if;
  return updated_record;
end;
$$;

create or replace function public.delete_my_crew_experience(target_company_id uuid, experience_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  updated_record jsonb;
begin
  if actor_id is null or not public.is_company_member(target_company_id, actor_id) then
    raise exception 'Company membership required' using errcode = '42501';
  end if;
  if nullif(btrim(experience_id), '') is null then
    raise exception 'Invalid incident experience' using errcode = '22023';
  end if;

  update public.fleet_crew
  set data = data || jsonb_build_object(
        'experiences',
        (select coalesce(jsonb_agg(item order by ordinal), '[]'::jsonb)
         from jsonb_array_elements(coalesce(data -> 'experiences', '[]'::jsonb)) with ordinality entries(item, ordinal)
         where item ->> 'id' is distinct from experience_id)
      ),
      version = version + 1,
      updated_by = actor_id
  where company_id = target_company_id
    and record_id = actor_id
    and exists (
      select 1 from jsonb_array_elements(coalesce(data -> 'experiences', '[]'::jsonb)) item
      where item ->> 'id' = experience_id
    )
  returning data into updated_record;

  if updated_record is null then
    raise exception 'Experience not found' using errcode = 'P0002';
  end if;
  return updated_record;
end;
$$;

revoke all on function public.delete_my_crew_credential(uuid, text) from public, anon;
revoke all on function public.delete_my_crew_experience(uuid, text) from public, anon;
grant execute on function public.delete_my_crew_credential(uuid, text) to authenticated;
grant execute on function public.delete_my_crew_experience(uuid, text) to authenticated;
