-- Per-day CTR (crew time report / shift ticket) photos on payroll rows.
-- rows[].ctr is null or an image attachment shaped like payroll_forms.attachment,
-- stored in payroll-files under <company>/<creator>/forms/<form id>/. The key is
-- optional so rows saved before this change, and offline saves queued by older
-- mobile builds, stay valid. CTR photos are optional on submit.
begin;

-- One CTR attachment: null, or the same shape as the form attachment, images only.
create function public.payroll_ctr_valid(ctr jsonb, company uuid, creator uuid, form uuid)
returns boolean language sql immutable set search_path = '' as $$
  select ctr is null or jsonb_typeof(ctr) = 'null' or (
    jsonb_typeof(ctr) = 'object'
    and jsonb_typeof(ctr -> 'name') = 'string'
    and char_length(ctr ->> 'name') between 1 and 255
    and jsonb_typeof(ctr -> 'mimeType') = 'string'
    and ctr ->> 'mimeType' in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')
    and jsonb_typeof(ctr -> 'byteSize') = 'number'
    and (ctr ->> 'byteSize')::numeric between 1 and 10485760
    and jsonb_typeof(ctr -> 'storagePath') = 'string'
    and ctr ->> 'storagePath' ~ ('^' || company::text || '/' || creator::text || '/forms/' || form::text || '/[^/]+$')
    and ctr = jsonb_build_object('name', ctr -> 'name', 'mimeType', ctr -> 'mimeType',
      'byteSize', ctr -> 'byteSize', 'storagePath', ctr -> 'storagePath')
  );
$$;

create function public.payroll_rows_ctr_valid(rows jsonb, company uuid, creator uuid, form uuid)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(rows) <> 'array' or not exists (
    select 1 from jsonb_array_elements(rows) day
    where jsonb_typeof(day) = 'object' and not public.payroll_ctr_valid(day -> 'ctr', company, creator, form)
  );
$$;

-- Online saves write rows directly, so the table enforces the CTR shape and path too.
alter table public.payroll_forms
  add constraint payroll_forms_rows_ctr_shape check (public.payroll_rows_ctr_valid(rows, company_id, created_by, id));

-- Offline saves: accept day objects with or without ctr (20261209000100 otherwise unchanged).
grant create on schema public to fireops_sync_writer;
create or replace function public.user_sync_apply_payroll_form(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  current_status text;
  day jsonb;
  author text;
  violated text;
  day_keys text[];
begin
  if command = 'form.save' then
    if payload = '{}'::jsonb or exists (select 1 from jsonb_object_keys(payload) k where k not in ('engineNumber','incidents','rows'))
      or (payload ? 'engineNumber' and (jsonb_typeof(payload -> 'engineNumber') <> 'string' or char_length(payload ->> 'engineNumber') > 160))
      or (payload ? 'incidents' and (jsonb_typeof(payload -> 'incidents') <> 'string' or char_length(payload ->> 'incidents') > 500))
      or (payload ? 'rows' and (jsonb_typeof(payload -> 'rows') <> 'array' or jsonb_array_length(payload -> 'rows') <> 21)) then
      raise exception 'Invalid payroll form' using errcode = '22023';
    end if;
    for day in select value from jsonb_array_elements(coalesce(payload -> 'rows', '[]'::jsonb)) loop
      day_keys := case when jsonb_typeof(day) = 'object' then (select array_agg(k order by k collate "C") from jsonb_object_keys(day) k) end;
      if jsonb_typeof(day) <> 'object'
        or (day_keys is distinct from array['crewIds','date','hoursWorked','notes'] and day_keys is distinct from array['crewIds','ctr','date','hoursWorked','notes'])
        or jsonb_typeof(day -> 'date') <> 'string' or day ->> 'date' !~ '^(\d{4}-\d{2}-\d{2})?$'
        or jsonb_typeof(day -> 'hoursWorked') <> 'number' or (day ->> 'hoursWorked')::numeric < 0
        or jsonb_typeof(day -> 'notes') <> 'string' or char_length(day ->> 'notes') > 2000
        or jsonb_typeof(day -> 'crewIds') <> 'array' or jsonb_array_length(day -> 'crewIds') > 200
        or exists (select 1 from jsonb_array_elements(day -> 'crewIds') c where jsonb_typeof(c) <> 'string'
          or c #>> '{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
        raise exception 'Invalid payroll day' using errcode = '22023';
      end if;
      if not public.payroll_ctr_valid(day -> 'ctr', company, actor, record_uuid) then
        raise exception 'Invalid payroll CTR photo' using errcode = '22023';
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
          coalesce(payload ->> 'incidents', ''), coalesce(payload -> 'rows', (select jsonb_agg(jsonb_build_object('date', '', 'hoursWorked', 0, 'crewIds', '[]'::jsonb, 'notes', '', 'ctr', null))
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
alter function public.user_sync_apply_payroll_form(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
revoke all on function public.user_sync_apply_payroll_form(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke create on schema public from fireops_sync_writer;

-- Latest definition (20261211000100), also keeping CTR photos of submitted forms.
drop policy if exists "uploaders remove own payroll files" on storage.objects;
create policy "uploaders remove own payroll files" on storage.objects
for delete to authenticated
using (
  bucket_id = 'payroll-files'
  and (storage.foldername(name))[2] = auth.uid()::text
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then (
      public.is_company_member(((storage.foldername(name))[1])::uuid, auth.uid())
      or public.has_system_admin_company_access(((storage.foldername(name))[1])::uuid)
    )
    and not exists (select 1 from public.company_payroll payroll where payroll.storage_path = objects.name)
    and not exists (
      select 1 from public.payroll_forms form
      where form.status not in ('draft', 'rejected')
        and (
          form.attachment->>'storagePath' = objects.name
          or exists (select 1 from jsonb_array_elements(form.rows) day where day->'ctr'->>'storagePath' = objects.name)
        )
    )
    else false
  end
);
commit;
