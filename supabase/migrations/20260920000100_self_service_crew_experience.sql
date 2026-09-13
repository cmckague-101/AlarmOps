-- Crew members can add incident experience to their own qualification record.
create or replace function public.add_my_crew_experience(
  target_company_id uuid,
  experience jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  updated_record jsonb;
  attachment_path text := experience #>> '{file,path}';
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.is_company_member(target_company_id, actor_id) then
    raise exception 'Company membership required' using errcode = '42501';
  end if;
  if nullif(btrim(experience ->> 'id'), '') is null
    or nullif(btrim(experience ->> 'incident'), '') is null
    or nullif(btrim(experience ->> 'position'), '') is null
    or nullif(btrim(experience ->> 'days'), '') is null then
    raise exception 'Invalid incident experience' using errcode = '22023';
  end if;
  if attachment_path is not null
    and attachment_path not like target_company_id::text || '/' || actor_id::text || '/%' then
    raise exception 'Invalid experience attachment' using errcode = '22023';
  end if;

  update public.fleet_crew
  set data = data || jsonb_build_object(
        'experiences', coalesce(data -> 'experiences', '[]'::jsonb) || jsonb_build_array(experience)
      ),
      version = version + 1,
      updated_by = actor_id
  where company_id = target_company_id and record_id = actor_id
  returning data into updated_record;

  if updated_record is null then
    raise exception 'Crew record not found' using errcode = 'P0002';
  end if;
  return updated_record;
end;
$$;

revoke all on function public.add_my_crew_experience(uuid, jsonb) from public, anon;
grant execute on function public.add_my_crew_experience(uuid, jsonb) to authenticated;
