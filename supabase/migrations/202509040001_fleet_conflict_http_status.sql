-- Report optimistic-lock conflicts as HTTP 409. SQLSTATE 40001 is reserved for
-- serialization failures and can cause database clients/observability to treat
-- expected application conflicts as retryable Postgres failures.
create or replace function public.apply_fleet_changes(target_company_id uuid, changes jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  change jsonb;
  table_name text;
  record_id uuid;
  event_name text;
  expected_version bigint;
  result_version bigint;
  results jsonb := '[]'::jsonb;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(changes) <> 'array' or jsonb_array_length(changes) > 500 then
    raise exception 'Invalid fleet change batch' using errcode = '22023';
  end if;

  for change in select value from jsonb_array_elements(changes) loop
    table_name := case change ->> 'collection'
      when 'vehicles' then 'fleet_vehicles'
      when 'issues' then 'fleet_issues'
      when 'crew' then 'fleet_crew'
      when 'activities' then 'fleet_activities'
      else null
    end;
    if table_name is null then raise exception 'Invalid fleet collection' using errcode = '22023'; end if;

    record_id := (change ->> 'recordId')::uuid;
    event_name := change ->> 'event';
    expected_version := nullif(change ->> 'expectedVersion', '')::bigint;

    if event_name = 'insert' then
      execute format(
        'insert into public.%I (company_id, record_id, data, version, updated_by) values ($1,$2,$3,1,$4) returning version',
        table_name
      ) into result_version using target_company_id, record_id, change -> 'data', actor_id;
    elsif event_name = 'update' and expected_version is not null then
      execute format(
        'update public.%I set data=$1, version=version+1, updated_by=$2 where company_id=$3 and record_id=$4 and version=$5 returning version',
        table_name
      ) into result_version using change -> 'data', actor_id, target_company_id, record_id, expected_version;
      if result_version is null then raise sqlstate 'PT409' using message = 'Record changed elsewhere'; end if;
    elsif event_name = 'delete' and expected_version is not null then
      execute format(
        'delete from public.%I where company_id=$1 and record_id=$2 and version=$3 returning version',
        table_name
      ) into result_version using target_company_id, record_id, expected_version;
      if result_version is null then raise sqlstate 'PT409' using message = 'Record changed elsewhere'; end if;
    else
      raise exception 'Invalid fleet change operation' using errcode = '22023';
    end if;

    results := results || jsonb_build_array(jsonb_build_object(
      'collection', change ->> 'collection',
      'recordId', record_id,
      'event', event_name,
      'version', result_version
    ));
    result_version := null;
  end loop;
  return results;
end;
$$;
