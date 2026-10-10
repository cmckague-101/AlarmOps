create or replace function public.update_company_member_details(
  target_company_id uuid,
  target_user_id uuid,
  member_name text,
  member_email text,
  member_phone text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  normalized_name text := trim(coalesce(member_name, ''));
  normalized_email text := lower(trim(coalesce(member_email, '')));
  normalized_phone text := trim(coalesce(member_phone, ''));
  updated_data jsonb;
  next_version bigint;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.is_company_owner(target_company_id, actor_id) then
    raise exception 'Company management access required' using errcode = '42501';
  end if;
  if char_length(normalized_name) not between 1 and 120 then
    raise exception 'Crew member name must be between 1 and 120 characters' using errcode = '22023';
  end if;
  if char_length(normalized_email) > 254 or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;
  if char_length(normalized_phone) > 30 then
    raise exception 'Phone number must be 30 characters or fewer' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.fleet_crew
    where company_id = target_company_id
      and record_id <> target_user_id
      and lower(data->>'email') = normalized_email
  ) then
    raise exception 'This email is already used by another crew member' using errcode = '23505';
  end if;

  update public.fleet_crew
  set data = data || jsonb_build_object(
        'name', normalized_name,
        'email', normalized_email,
        'phone', normalized_phone
      ),
      version = version + 1,
      updated_by = actor_id
  where company_id = target_company_id and record_id = target_user_id
  returning data, version into updated_data, next_version;

  if updated_data is null then
    raise exception 'Crew member not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('member', updated_data, 'version', next_version);
end;
$$;

revoke all on function public.update_company_member_details(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.update_company_member_details(uuid, uuid, text, text, text) to authenticated;
