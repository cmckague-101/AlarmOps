-- Crew members maintain one current annual qualification record on their own crew record.
create or replace function public.update_my_annual_qualification_record(
  target_company_id uuid,
  annual_record jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  updated_record jsonb;
  field_name text;
  field_value text;
begin
  if actor_id is null or not public.is_company_member(target_company_id, actor_id) then
    raise exception 'Company membership required' using errcode = '42501';
  end if;

  foreach field_name in array array['rt130CompletionDate','rt130CurrencyDate','wctCompletionDate','wctCurrencyDate'] loop
    field_value := annual_record ->> field_name;
    if field_value is null or field_value !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Invalid annual qualification record' using errcode = '22023';
    end if;
    begin
      perform field_value::date;
    exception when others then
      raise exception 'Invalid annual qualification record' using errcode = '22023';
    end;
  end loop;

  update public.fleet_crew
  set data = data || jsonb_build_object('annualRecord', annual_record),
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

revoke all on function public.update_my_annual_qualification_record(uuid,jsonb) from public,anon;
grant execute on function public.update_my_annual_qualification_record(uuid,jsonb) to authenticated;
