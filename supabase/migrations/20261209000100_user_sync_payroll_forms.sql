-- Offline payroll form drafts and submission through the user command registry.
-- A payroll form is edited only by its creator while it is a draft or returned
-- (rejected); the existing protect trigger and RLS still enforce that.
-- * payroll_form (entity ID = form ID, chosen on the device):
--   - `form.save` {engineNumber?, incidents?, rows?}: creates the caller's draft
--     if it does not exist yet, otherwise merges the given fields over the
--     current form; later arrival wins per field (the creator's own form).
--     The attachment is never changed offline. Nothing changes and the device
--     keeps its edits when the form was already submitted (`already_submitted`),
--     was deleted after this user's device created or saved it
--     (`form_deleted`), or another draft is already in progress (`other_draft`).
--   - `form.submit` {}: sends a draft or returned form for approval (status
--     pending, through the trigger, which notifies managers). An already
--     submitted form is a no-op; a deleted form returns `form_deleted`.
-- Approve, reject, mark paid, delete and attachments remain online-only.
begin;

insert into public.user_sync_commands values ('payroll_form','form.save',false),('payroll_form','form.submit',false);

grant create on schema public to fireops_sync_writer;
create function public.user_sync_state_payroll_form(company uuid, actor uuid, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', f.id, 'status', f.status, 'engineNumber', f.engine_number, 'incidents', f.incidents,
      'rows', f.rows, 'submittedAt', f.submitted_at, 'updatedAt', f.updated_at)
    from public.payroll_forms f where f.id = record_uuid and f.company_id = company and f.created_by = actor;
$$;
create function public.user_sync_apply_payroll_form(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  current_status text;
  day jsonb;
  author text;
  violated text;
begin
  if command = 'form.save' then
    if payload = '{}'::jsonb or exists (select 1 from jsonb_object_keys(payload) k where k not in ('engineNumber','incidents','rows'))
      or (payload ? 'engineNumber' and (jsonb_typeof(payload -> 'engineNumber') <> 'string' or char_length(payload ->> 'engineNumber') > 160))
      or (payload ? 'incidents' and (jsonb_typeof(payload -> 'incidents') <> 'string' or char_length(payload ->> 'incidents') > 500))
      or (payload ? 'rows' and (jsonb_typeof(payload -> 'rows') <> 'array' or jsonb_array_length(payload -> 'rows') <> 21)) then
      raise exception 'Invalid payroll form' using errcode = '22023';
    end if;
    for day in select value from jsonb_array_elements(coalesce(payload -> 'rows', '[]'::jsonb)) loop
      if jsonb_typeof(day) <> 'object'
        or (select array_agg(k order by k collate "C") from jsonb_object_keys(day) k) is distinct from array['crewIds','date','hoursWorked','notes']
        or jsonb_typeof(day -> 'date') <> 'string' or day ->> 'date' !~ '^(\d{4}-\d{2}-\d{2})?$'
        or jsonb_typeof(day -> 'hoursWorked') <> 'number' or (day ->> 'hoursWorked')::numeric < 0
        or jsonb_typeof(day -> 'notes') <> 'string' or char_length(day ->> 'notes') > 2000
        or jsonb_typeof(day -> 'crewIds') <> 'array' or jsonb_array_length(day -> 'crewIds') > 200
        or exists (select 1 from jsonb_array_elements(day -> 'crewIds') c where jsonb_typeof(c) <> 'string'
          or c #>> '{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
        raise exception 'Invalid payroll day' using errcode = '22023';
      end if;
      if day ->> 'date' <> '' then perform (day ->> 'date')::date; end if;
    end loop;
  elsif payload <> '{}'::jsonb then
    raise exception 'Invalid payroll submission' using errcode = '22023';
  end if;

  select f.status into current_status from public.payroll_forms f
    where f.id = record_uuid and f.company_id = company and f.created_by = actor for update;
  if not found then
    -- Never recreate a form this user's device already saw on the server.
    if command = 'form.submit' or exists (select 1 from public.user_sync_receipts r where r.user_id = actor and r.company_id = company
        and r.entity_type = 'payroll_form' and r.entity_id = record_uuid and r.result -> 'record' <> 'null'::jsonb) then
      return jsonb_build_object('notApplied', 'form_deleted');
    end if;
    select coalesce(nullif(btrim(p.full_name), ''), 'Crew member') into author from public.profiles p where p.user_id = actor;
    begin
      insert into public.payroll_forms (id, company_id, created_by, created_by_name, engine_number, incidents, rows)
        values (record_uuid, company, actor, left(coalesce(author, 'Crew member'), 160), coalesce(payload ->> 'engineNumber', ''),
          coalesce(payload ->> 'incidents', ''), coalesce(payload -> 'rows', (select jsonb_agg(jsonb_build_object('date', '', 'hoursWorked', 0, 'crewIds', '[]'::jsonb, 'notes', ''))
            from generate_series(1, 21))));
    exception when unique_violation then
      get stacked diagnostics violated = constraint_name;
      if violated = 'payroll_forms_pkey' then
        raise exception 'This payroll form identity was already used' using errcode = '23505';
      end if;
      return jsonb_build_object('notApplied', 'other_draft');
    end;
    return '{}'::jsonb;
  end if;

  if current_status not in ('draft', 'rejected') then
    return case when command = 'form.submit' then '{}'::jsonb else jsonb_build_object('notApplied', 'already_submitted') end;
  end if;
  if command = 'form.submit' then
    update public.payroll_forms f set status = 'pending' where f.id = record_uuid;
  else
    update public.payroll_forms f set
      engine_number = coalesce(payload ->> 'engineNumber', f.engine_number),
      incidents = coalesce(payload ->> 'incidents', f.incidents),
      rows = coalesce(payload -> 'rows', f.rows)
      where f.id = record_uuid;
  end if;
  return '{}'::jsonb;
end;
$$;
alter function public.user_sync_state_payroll_form(uuid, uuid, uuid) owner to fireops_sync_writer;
alter function public.user_sync_apply_payroll_form(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
revoke all on function public.user_sync_state_payroll_form(uuid, uuid, uuid), public.user_sync_apply_payroll_form(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke create on schema public from fireops_sync_writer;
commit;
