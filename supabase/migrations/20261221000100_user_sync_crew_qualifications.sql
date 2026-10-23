-- Offline self-service qualification records (the caller's own crew record),
-- through the user command registry, without files: crew qualification files
-- have no device-storage decision yet, so offline changes never add, change or
-- remove an attachment. Each command calls the existing self-service function
-- (same validation and attribution as online). Edits and deletes follow the
-- decided policy: they apply only if the entry still equals what the device saw
-- (otherwise notApplied 'changed_elsewhere'; already gone: delete no-op, edit
-- 'record_deleted').
-- * crew_credential (entity = credential ID): credential.add {credential},
--   credential.update {credential, base}, credential.delete {base}
-- * crew_experience (entity = experience ID): experience.add {experience},
--   experience.update {experience, base}, experience.delete {base}
-- * annual_record (self only): annual.set {record, base: record seen or null}
-- License and DOT medical credentials require a photo, so they cannot be added
-- offline (the existing function refuses them without one).
begin;

insert into public.user_sync_commands values
  ('crew_credential','credential.add',false),('crew_credential','credential.update',false),('crew_credential','credential.delete',false),
  ('crew_experience','experience.add',false),('crew_experience','experience.update',false),('crew_experience','experience.delete',false),
  ('annual_record','annual.set',true);

grant create on schema public to fireops_sync_writer;
create function public.user_sync_own_crew_entry(company uuid, actor uuid, field text, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$
  select e from public.fleet_crew c cross join lateral jsonb_array_elements(case when jsonb_typeof(c.data -> field) = 'array' then c.data -> field else '[]'::jsonb end) e
    where c.company_id = company and c.record_id = actor and e ->> 'id' = record_uuid::text limit 1;
$$;
create function public.user_sync_state_crew_credential(company uuid, actor uuid, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$ select public.user_sync_own_crew_entry(company, actor, 'credentials', record_uuid) $$;
create function public.user_sync_state_crew_experience(company uuid, actor uuid, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$ select public.user_sync_own_crew_entry(company, actor, 'experiences', record_uuid) $$;
create function public.user_sync_state_annual_record(company uuid, actor uuid, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', actor, 'record', c.data -> 'annualRecord') from public.fleet_crew c where c.company_id = company and c.record_id = actor;
$$;

create function public.user_sync_apply_crew_entry(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb, field text, key text)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  action text := split_part(command, '.', 2);
  entry jsonb := payload -> key;
  current jsonb := public.user_sync_own_crew_entry(company, actor, field, record_uuid);
begin
  if (action = 'add' and (select array_agg(k) from jsonb_object_keys(payload) k) is distinct from array[key])
    or (action = 'update' and (select array_agg(k order by k collate "C") from jsonb_object_keys(payload) k) is distinct from array['base', key])
    or (action = 'delete' and (select array_agg(k) from jsonb_object_keys(payload) k) is distinct from array['base'])
    or (action <> 'delete' and (jsonb_typeof(entry) <> 'object' or entry ->> 'id' is distinct from record_uuid::text))
    or (action <> 'add' and (jsonb_typeof(payload -> 'base') <> 'object' or payload -> 'base' ->> 'id' is distinct from record_uuid::text))
    -- No attachment changes offline: a new entry has no file; an edit keeps the file it had.
    or (action = 'add' and entry ? 'file')
    or (action = 'update' and (entry -> 'file') is distinct from (payload -> 'base' -> 'file')) then
    raise exception 'Invalid qualification change' using errcode = '22023';
  end if;
  if action = 'add' then
    if current is not null then
      if current = entry then return '{}'::jsonb; end if;
      raise exception 'This qualification identity was already used' using errcode = '23505';
    end if;
    if field = 'credentials' then perform public.add_my_crew_credential(company, entry); else perform public.add_my_crew_experience(company, entry); end if;
    return '{}'::jsonb;
  end if;
  if current is null then return case when action = 'delete' then '{}'::jsonb else jsonb_build_object('notApplied', 'record_deleted') end; end if;
  if current is distinct from payload -> 'base' then return jsonb_build_object('notApplied', 'changed_elsewhere'); end if;
  if action = 'delete' then
    if field = 'credentials' then perform public.delete_my_crew_credential(company, record_uuid::text); else perform public.delete_my_crew_experience(company, record_uuid::text); end if;
  elsif field = 'credentials' then perform public.update_my_crew_credential(company, entry);
  else perform public.update_my_crew_experience(company, entry);
  end if;
  return '{}'::jsonb;
end;
$$;
create function public.user_sync_apply_crew_credential(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language sql volatile set search_path = '' as $$ select public.user_sync_apply_crew_entry(company, actor, record_uuid, command, payload, 'credentials', 'credential') $$;
create function public.user_sync_apply_crew_experience(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language sql volatile set search_path = '' as $$ select public.user_sync_apply_crew_entry(company, actor, record_uuid, command, payload, 'experiences', 'experience') $$;
create function public.user_sync_apply_annual_record(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
begin
  if (select array_agg(k order by k collate "C") from jsonb_object_keys(payload) k) is distinct from array['base','record']
    or jsonb_typeof(payload -> 'record') <> 'object' or jsonb_typeof(payload -> 'base') not in ('object','null') then
    raise exception 'Invalid annual qualification record' using errcode = '22023';
  end if;
  if (select c.data -> 'annualRecord' from public.fleet_crew c where c.company_id = company and c.record_id = actor) is distinct from
    (case when payload -> 'base' = 'null'::jsonb then null else payload -> 'base' end) then
    return jsonb_build_object('notApplied', 'changed_elsewhere');
  end if;
  perform public.update_my_annual_qualification_record(company, payload -> 'record');
  return '{}'::jsonb;
end;
$$;
alter function public.user_sync_own_crew_entry(uuid, uuid, text, uuid) owner to fireops_sync_writer;
alter function public.user_sync_state_crew_credential(uuid, uuid, uuid) owner to fireops_sync_writer;
alter function public.user_sync_state_crew_experience(uuid, uuid, uuid) owner to fireops_sync_writer;
alter function public.user_sync_state_annual_record(uuid, uuid, uuid) owner to fireops_sync_writer;
alter function public.user_sync_apply_crew_entry(uuid, uuid, uuid, text, jsonb, text, text) owner to fireops_sync_writer;
alter function public.user_sync_apply_crew_credential(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
alter function public.user_sync_apply_crew_experience(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
alter function public.user_sync_apply_annual_record(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
revoke all on function public.user_sync_own_crew_entry(uuid, uuid, text, uuid), public.user_sync_state_crew_credential(uuid, uuid, uuid),
  public.user_sync_state_crew_experience(uuid, uuid, uuid), public.user_sync_state_annual_record(uuid, uuid, uuid),
  public.user_sync_apply_crew_entry(uuid, uuid, uuid, text, jsonb, text, text), public.user_sync_apply_crew_credential(uuid, uuid, uuid, text, jsonb),
  public.user_sync_apply_crew_experience(uuid, uuid, uuid, text, jsonb), public.user_sync_apply_annual_record(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke create on schema public from fireops_sync_writer;
commit;
