-- Offline edits and deletes of shared records, through the user command registry.
-- Decided policy (product owner, 2026-10-23): a change applies only if nobody
-- changed the record since the device downloaded it; otherwise the current
-- server value is kept, nothing changes, and the device keeps its change and is
-- told (notApplied 'changed_elsewhere'). A delete applies only to an unchanged
-- record; an already deleted record is a no-op for deletes and
-- notApplied 'record_deleted' for edits. Roles, triggers and side effects are
-- the existing ones (the sync writer is non-bypass), so only users who may make
-- the change online can make it offline.
--
-- Every edit/delete payload carries `base`, what the device last saw:
--   {"updatedAt": "<server timestamp>"} (receipts: {"name","amountCents","storagePath"}), or
--   {"afterOperation": "<operation ID>"}: this user's own earlier command for
--   the same record; it matches only if that command applied and the record
--   still equals the state its receipt recorded (chained offline edits).
-- Commands:
-- * training: training.update {base, values...}, training.delete {base}
-- * inventory_item: item.update {base, name?, quantity?} (quantity below the
--   units checked out returns notApplied 'below_checked_out'), item.delete {base}
-- * inventory_return (entity = item): return.checkin {base, userId, quantity}
--   (base = that borrower's checkout updatedAt)
-- * receipt: receipt.update {base, name?, amountCents?}, receipt.delete {base}
--   (the device removes the stored file after the delete applies)
-- * vehicle_note: note.update {base, subject, body}, note.delete {base}
-- * communication_reply: reply.delete {} (replies are never edited)
-- * payroll_review (entity = form): review.approve {base}, review.reject
--   {base, notes}, review.mark_paid {base}
-- Existing state functions for training, inventory items, receipts, vehicle
-- notes and replies are widened to every record the caller may read (they no
-- longer filter by creator) and include updatedAt where the table has one.
begin;

insert into public.user_sync_commands values
  ('training','training.update',false),('training','training.delete',false),
  ('inventory_item','item.update',false),('inventory_item','item.delete',false),
  ('inventory_return','return.checkin',false),
  ('receipt','receipt.update',false),('receipt','receipt.delete',false),
  ('vehicle_note','note.update',false),('vehicle_note','note.delete',false),
  ('communication_reply','reply.delete',false),
  ('payroll_review','review.approve',false),('payroll_review','review.reject',false),('payroll_review','review.mark_paid',false);

grant create on schema public to fireops_sync_writer;

-- True when `base` matches the current record: an exact server timestamp, the
-- exact current values given by the adapter, or this user's own earlier applied
-- command whose recorded state still equals the current state.
create function public.user_sync_base_matches(company uuid, actor uuid, entity text, record_uuid uuid, base jsonb, current_version jsonb, current_state jsonb)
returns boolean language plpgsql stable set search_path = '' as $$
declare previous jsonb;
begin
  if jsonb_typeof(base) <> 'object' then raise exception 'Invalid change base' using errcode = '22023'; end if;
  if base ? 'afterOperation' then
    if (select count(*) from jsonb_object_keys(base)) <> 1 or base ->> 'afterOperation' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Invalid change base' using errcode = '22023';
    end if;
    select r.result into previous from public.user_sync_receipts r where r.company_id = company and r.user_id = actor
      and r.operation_id = (base ->> 'afterOperation')::uuid and r.entity_type = entity and r.entity_id = record_uuid;
    return previous is not null and previous ->> 'kind' = 'applied' and not previous ? 'notApplied' and not previous ? 'keptCurrent'
      and previous -> 'record' is not distinct from current_state;
  end if;
  return base = current_version;
end;
$$;
create function public.user_sync_timestamp_base(value timestamptz)
returns jsonb language sql immutable set search_path = '' as $$ select jsonb_build_object('updatedAt', value) $$;
-- Normalizes a device {"updatedAt": "..."} base to the server's JSON form so equal instants compare equal.
create function public.user_sync_normalize_base(base jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(base) = 'object' and base ? 'updatedAt' then
    if (select count(*) from jsonb_object_keys(base)) <> 1 or jsonb_typeof(base -> 'updatedAt') <> 'string'
      or base ->> 'updatedAt' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}(:?\d{2})?)$' then
      raise exception 'Invalid change base' using errcode = '22023';
    end if;
    return jsonb_build_object('updatedAt', (base ->> 'updatedAt')::timestamptz);
  end if;
  if jsonb_typeof(base) is distinct from 'object' or not base ? 'afterOperation' then raise exception 'Invalid change base' using errcode = '22023'; end if;
  return base;
end;
$$;

-- Training ------------------------------------------------------------------
create or replace function public.user_sync_state_training(company uuid, actor uuid, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', t.id, 'courseCode', t.course_code, 'courseTitle', t.course_title, 'startsAt', t.starts_at, 'location', t.location,
      'instructor', t.instructor, 'capacity', t.capacity, 'courseInformation', t.course_information, 'createdAt', t.created_at, 'updatedAt', t.updated_at)
    from public.company_trainings t where t.id = record_uuid and t.company_id = company;
$$;
create or replace function public.user_sync_apply_training(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  current public.company_trainings;
  values_ jsonb := payload - 'base';
begin
  if command in ('training.create','training.update') then
    if (select array_agg(k order by k collate "C") from jsonb_object_keys(values_) k)
        is distinct from array['capacity','courseCode','courseInformation','courseTitle','instructor','location','startsAt']
      or (command = 'training.create' and payload ? 'base') or (command = 'training.update' and not payload ? 'base')
      or jsonb_typeof(values_ -> 'courseCode') <> 'string' or char_length(btrim(values_ ->> 'courseCode')) not between 1 and 80
      or jsonb_typeof(values_ -> 'courseTitle') <> 'string' or char_length(btrim(values_ ->> 'courseTitle')) not between 1 and 200
      or jsonb_typeof(values_ -> 'location') <> 'string' or char_length(btrim(values_ ->> 'location')) not between 1 and 300
      or jsonb_typeof(values_ -> 'instructor') <> 'string' or char_length(btrim(values_ ->> 'instructor')) not between 1 and 160
      or jsonb_typeof(values_ -> 'courseInformation') <> 'string' or char_length(values_ ->> 'courseInformation') > 5000
      or jsonb_typeof(values_ -> 'capacity') <> 'number' or values_ ->> 'capacity' !~ '^[1-9][0-9]{0,4}$' or (values_ ->> 'capacity')::int > 10000
      or jsonb_typeof(values_ -> 'startsAt') <> 'string' or values_ ->> 'startsAt' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then
      raise exception 'Invalid training' using errcode = '22023';
    end if;
  elsif (select array_agg(k) from jsonb_object_keys(payload) k) is distinct from array['base'] then
    raise exception 'Invalid training delete' using errcode = '22023';
  end if;
  if command = 'training.create' then
    begin
      insert into public.company_trainings (id, company_id, course_code, course_title, starts_at, location, instructor, capacity, course_information)
        values (record_uuid, company, btrim(values_ ->> 'courseCode'), btrim(values_ ->> 'courseTitle'), (values_ ->> 'startsAt')::timestamptz,
          btrim(values_ ->> 'location'), btrim(values_ ->> 'instructor'), (values_ ->> 'capacity')::int, values_ ->> 'courseInformation');
    exception when unique_violation then
      raise exception 'This training identity was already used' using errcode = '23505';
    end;
    return '{}'::jsonb;
  end if;
  if not (public.is_company_owner(company, actor) or public.has_system_admin_company_access(company)) then
    raise exception 'Company owner access required' using errcode = '42501';
  end if;
  select * into current from public.company_trainings t where t.id = record_uuid and t.company_id = company for update;
  if not found then return case when command = 'training.delete' then '{}'::jsonb else jsonb_build_object('notApplied', 'record_deleted') end; end if;
  if not public.user_sync_base_matches(company, actor, 'training', record_uuid, public.user_sync_normalize_base(payload -> 'base'),
      public.user_sync_timestamp_base(current.updated_at), public.user_sync_state_training(company, actor, record_uuid)) then
    return jsonb_build_object('notApplied', 'changed_elsewhere');
  end if;
  if command = 'training.delete' then
    delete from public.company_trainings t where t.id = record_uuid and t.company_id = company;
  else
    update public.company_trainings t set course_code = btrim(values_ ->> 'courseCode'), course_title = btrim(values_ ->> 'courseTitle'),
      starts_at = (values_ ->> 'startsAt')::timestamptz, location = btrim(values_ ->> 'location'), instructor = btrim(values_ ->> 'instructor'),
      capacity = (values_ ->> 'capacity')::int, course_information = values_ ->> 'courseInformation'
      where t.id = record_uuid and t.company_id = company;
  end if;
  return '{}'::jsonb;
end;
$$;

-- Inventory items and check-in ---------------------------------------------
create or replace function public.user_sync_state_inventory_item(company uuid, actor uuid, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', i.id, 'name', i.name, 'quantity', i.quantity, 'createdAt', i.created_at, 'updatedAt', i.updated_at) from public.company_inventory_items i
    where i.id = record_uuid and i.company_id = company;
$$;
create or replace function public.user_sync_apply_inventory_item(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  violated text;
  current public.company_inventory_items;
  checked_out int;
begin
  if command = 'item.create' then
    if (select array_agg(k order by k collate "C") from jsonb_object_keys(payload) k) is distinct from array['name','quantity']
      or jsonb_typeof(payload -> 'name') <> 'string' or char_length(btrim(payload ->> 'name')) not between 1 and 160
      or jsonb_typeof(payload -> 'quantity') <> 'number' or payload ->> 'quantity' !~ '^(0|[1-9][0-9]{0,5})$' then
      raise exception 'Invalid inventory item' using errcode = '22023';
    end if;
    begin
      insert into public.company_inventory_items (id, company_id, name, quantity)
        values (record_uuid, company, btrim(payload ->> 'name'), (payload ->> 'quantity')::int);
    exception when unique_violation then
      get stacked diagnostics violated = constraint_name;
      if violated = 'company_inventory_items_company_id_name_key' then return jsonb_build_object('notApplied', 'name_taken'); end if;
      raise exception 'This inventory item identity was already used' using errcode = '23505';
    end;
    return '{}'::jsonb;
  end if;
  if not payload ? 'base' or exists (select 1 from jsonb_object_keys(payload) k where k not in ('base','name','quantity'))
    or (command = 'item.delete' and (payload ? 'name' or payload ? 'quantity'))
    or (command = 'item.update' and not (payload ? 'name' or payload ? 'quantity'))
    or (payload ? 'name' and (jsonb_typeof(payload -> 'name') <> 'string' or char_length(btrim(payload ->> 'name')) not between 1 and 160))
    or (payload ? 'quantity' and (jsonb_typeof(payload -> 'quantity') <> 'number' or payload ->> 'quantity' !~ '^(0|[1-9][0-9]{0,5})$')) then
    raise exception 'Invalid inventory change' using errcode = '22023';
  end if;
  if not (public.is_company_owner(company, actor) or public.has_system_admin_company_access(company)) then
    raise exception 'Company owner access required' using errcode = '42501';
  end if;
  select * into current from public.company_inventory_items i where i.id = record_uuid and i.company_id = company for update;
  if not found then return case when command = 'item.delete' then '{}'::jsonb else jsonb_build_object('notApplied', 'record_deleted') end; end if;
  if not public.user_sync_base_matches(company, actor, 'inventory_item', record_uuid, public.user_sync_normalize_base(payload -> 'base'),
      public.user_sync_timestamp_base(current.updated_at), public.user_sync_state_inventory_item(company, actor, record_uuid)) then
    return jsonb_build_object('notApplied', 'changed_elsewhere');
  end if;
  if command = 'item.delete' then
    delete from public.company_inventory_items i where i.id = record_uuid and i.company_id = company;
    return '{}'::jsonb;
  end if;
  if payload ? 'quantity' then
    select coalesce(sum(c.quantity), 0) into checked_out from public.company_inventory_checkouts c where c.company_id = company and c.item_id = record_uuid;
    if (payload ->> 'quantity')::int < checked_out then return jsonb_build_object('notApplied', 'below_checked_out'); end if;
  end if;
  begin
    update public.company_inventory_items i set name = coalesce(btrim(payload ->> 'name'), i.name), quantity = coalesce((payload ->> 'quantity')::int, i.quantity)
      where i.id = record_uuid and i.company_id = company;
  exception when unique_violation then
    return jsonb_build_object('notApplied', 'name_taken');
  end;
  return '{}'::jsonb;
end;
$$;
create function public.user_sync_state_inventory_return(company uuid, actor uuid, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', i.id, 'checkouts', coalesce((select jsonb_object_agg(c.user_id, jsonb_build_object('quantity', c.quantity, 'updatedAt', c.updated_at))
      from public.company_inventory_checkouts c where c.company_id = company and c.item_id = i.id), '{}'::jsonb))
    from public.company_inventory_items i where i.id = record_uuid and i.company_id = company;
$$;
create function public.user_sync_apply_inventory_return(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  checkout public.company_inventory_checkouts;
begin
  if (select array_agg(k order by k collate "C") from jsonb_object_keys(payload) k) is distinct from array['base','quantity','userId']
    or jsonb_typeof(payload -> 'userId') <> 'string' or payload ->> 'userId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(payload -> 'quantity') <> 'number' or payload ->> 'quantity' !~ '^[1-9][0-9]{0,5}$' then
    raise exception 'Invalid check-in' using errcode = '22023';
  end if;
  if not public.is_company_owner(company, actor) then raise exception 'Company owner access required' using errcode = '42501'; end if;
  -- The item row lock orders this with checkouts of the same item (checkout rows are read-only here).
  perform 1 from public.company_inventory_items i where i.id = record_uuid and i.company_id = company for update;
  select * into checkout from public.company_inventory_checkouts c
    where c.company_id = company and c.item_id = record_uuid and c.user_id = (payload ->> 'userId')::uuid;
  if not found then return jsonb_build_object('notApplied', 'record_deleted'); end if;
  if not public.user_sync_base_matches(company, actor, 'inventory_return', record_uuid, public.user_sync_normalize_base(payload -> 'base'),
      public.user_sync_timestamp_base(checkout.updated_at), public.user_sync_state_inventory_return(company, actor, record_uuid)) then
    return jsonb_build_object('notApplied', 'changed_elsewhere');
  end if;
  if (payload ->> 'quantity')::int > checkout.quantity then return jsonb_build_object('notApplied', 'changed_elsewhere'); end if;
  perform public.checkin_inventory_item(record_uuid, (payload ->> 'userId')::uuid, (payload ->> 'quantity')::int);
  return '{}'::jsonb;
end;
$$;

-- Receipts -----------------------------------------------------------------
create or replace function public.user_sync_state_receipt(company uuid, actor uuid, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'name', r.name, 'amountCents', r.amount_cents, 'storagePath', r.storage_path, 'createdAt', r.created_at)
    from public.company_receipts r where r.id = record_uuid and r.company_id = company;
$$;
create function public.user_sync_apply_receipt_change(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare current public.company_receipts;
begin
  if not payload ? 'base' or exists (select 1 from jsonb_object_keys(payload) k where k not in ('base','name','amountCents'))
    or (command = 'receipt.delete' and (payload ? 'name' or payload ? 'amountCents'))
    or (command = 'receipt.update' and not (payload ? 'name' or payload ? 'amountCents'))
    or (payload ? 'name' and (jsonb_typeof(payload -> 'name') <> 'string' or char_length(btrim(payload ->> 'name')) not between 1 and 160))
    or (payload ? 'amountCents' and (jsonb_typeof(payload -> 'amountCents') <> 'number' or payload ->> 'amountCents' !~ '^[1-9][0-9]{0,8}$' or (payload ->> 'amountCents')::bigint > 100000000))
    or jsonb_typeof(payload -> 'base') <> 'object'
    or (not payload -> 'base' ? 'afterOperation' and (select array_agg(k order by k collate "C") from jsonb_object_keys(payload -> 'base') k) is distinct from array['amountCents','name','storagePath']) then
    raise exception 'Invalid receipt change' using errcode = '22023';
  end if;
  if not public.is_company_owner(company, actor) then raise exception 'Company owner access required' using errcode = '42501'; end if;
  select * into current from public.company_receipts r where r.id = record_uuid and r.company_id = company for update;
  if not found then return case when command = 'receipt.delete' then '{}'::jsonb else jsonb_build_object('notApplied', 'record_deleted') end; end if;
  if not public.user_sync_base_matches(company, actor, 'receipt', record_uuid, payload -> 'base',
      jsonb_build_object('name', current.name, 'amountCents', current.amount_cents, 'storagePath', current.storage_path),
      public.user_sync_state_receipt(company, actor, record_uuid)) then
    return jsonb_build_object('notApplied', 'changed_elsewhere');
  end if;
  if command = 'receipt.delete' then
    delete from public.company_receipts r where r.id = record_uuid and r.company_id = company;
  else
    update public.company_receipts r set name = coalesce(btrim(payload ->> 'name'), r.name), amount_cents = coalesce((payload ->> 'amountCents')::bigint, r.amount_cents)
      where r.id = record_uuid and r.company_id = company;
  end if;
  return '{}'::jsonb;
end;
$$;
-- Route the new receipt commands; receipt.create keeps its original adapter.
alter function public.user_sync_apply_receipt(uuid, uuid, uuid, text, jsonb) rename to user_sync_apply_receipt_create;
create function public.user_sync_apply_receipt(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
begin
  if command = 'receipt.create' then return public.user_sync_apply_receipt_create(company, actor, record_uuid, command, payload); end if;
  return public.user_sync_apply_receipt_change(company, actor, record_uuid, command, payload);
end;
$$;

-- Vehicle notes --------------------------------------------------------------
create or replace function public.user_sync_state_vehicle_note(company uuid, actor uuid, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', n.id, 'vehicleId', n.vehicle_id, 'subject', n.subject, 'body', n.body, 'createdAt', n.created_at, 'updatedAt', n.updated_at)
    from public.vehicle_notes n where n.id = record_uuid and n.company_id = company;
$$;
alter function public.user_sync_apply_vehicle_note(uuid, uuid, uuid, text, jsonb) rename to user_sync_apply_vehicle_note_create;
create function public.user_sync_apply_vehicle_note(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare current public.vehicle_notes;
begin
  if command = 'note.create' then return public.user_sync_apply_vehicle_note_create(company, actor, record_uuid, command, payload); end if;
  if not payload ? 'base' or exists (select 1 from jsonb_object_keys(payload) k where k not in ('base','subject','body'))
    or (command = 'note.delete' and (payload ? 'subject' or payload ? 'body'))
    or (command = 'note.update' and not (payload ? 'subject' and payload ? 'body'))
    or (payload ? 'subject' and (jsonb_typeof(payload -> 'subject') <> 'string' or char_length(btrim(payload ->> 'subject')) not between 1 and 160))
    or (payload ? 'body' and (jsonb_typeof(payload -> 'body') <> 'string' or char_length(btrim(payload ->> 'body')) not between 1 and 5000)) then
    raise exception 'Invalid vehicle note change' using errcode = '22023';
  end if;
  if not public.can_access_vehicle_notes(company, actor) then raise exception 'Vehicle note access required' using errcode = '42501'; end if;
  select * into current from public.vehicle_notes n where n.id = record_uuid and n.company_id = company for update;
  if not found then return case when command = 'note.delete' then '{}'::jsonb else jsonb_build_object('notApplied', 'record_deleted') end; end if;
  if not public.user_sync_base_matches(company, actor, 'vehicle_note', record_uuid, public.user_sync_normalize_base(payload -> 'base'),
      public.user_sync_timestamp_base(current.updated_at), public.user_sync_state_vehicle_note(company, actor, record_uuid)) then
    return jsonb_build_object('notApplied', 'changed_elsewhere');
  end if;
  if command = 'note.delete' then
    delete from public.vehicle_notes n where n.id = record_uuid and n.company_id = company;
    if not found then raise exception 'Vehicle note access required' using errcode = '42501'; end if;
  else
    update public.vehicle_notes n set subject = btrim(payload ->> 'subject'), body = btrim(payload ->> 'body') where n.id = record_uuid and n.company_id = company;
    if not found then raise exception 'Vehicle note access required' using errcode = '42501'; end if;
  end if;
  return '{}'::jsonb;
end;
$$;

-- Crew Chat reply deletes (managers) ----------------------------------------
create or replace function public.user_sync_state_communication_reply(company uuid, actor uuid, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'threadId', r.thread_id, 'body', r.body, 'createdAt', r.created_at) from public.communication_replies r
    where r.id = record_uuid and r.company_id = company;
$$;
alter function public.user_sync_apply_communication_reply(uuid, uuid, uuid, text, jsonb) rename to user_sync_apply_communication_reply_create;
create function public.user_sync_apply_communication_reply(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
begin
  if command = 'reply.create' then return public.user_sync_apply_communication_reply_create(company, actor, record_uuid, command, payload); end if;
  if payload <> '{}'::jsonb then raise exception 'Invalid reply delete' using errcode = '22023'; end if;
  if not public.is_company_owner(company, actor) then raise exception 'Company owner access required' using errcode = '42501'; end if;
  delete from public.communication_replies r where r.id = record_uuid and r.company_id = company;
  return '{}'::jsonb;
end;
$$;

-- Payroll approval, rejection and payment (managers) ------------------------
create function public.user_sync_state_payroll_review(company uuid, actor uuid, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', f.id, 'status', f.status, 'rejectionNotes', f.rejection_notes, 'updatedAt', f.updated_at)
    from public.payroll_forms f where f.id = record_uuid and f.company_id = company;
$$;
create function public.user_sync_apply_payroll_review(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare current public.payroll_forms;
begin
  if (command = 'review.reject' and ((select array_agg(k order by k collate "C") from jsonb_object_keys(payload) k) is distinct from array['base','notes']
      or jsonb_typeof(payload -> 'notes') <> 'string' or char_length(btrim(payload ->> 'notes')) not between 1 and 1000))
    or (command <> 'review.reject' and (select array_agg(k) from jsonb_object_keys(payload) k) is distinct from array['base']) then
    raise exception 'Invalid payroll review' using errcode = '22023';
  end if;
  if not public.is_company_owner(company, actor) then raise exception 'Company owner access required' using errcode = '42501'; end if;
  select * into current from public.payroll_forms f where f.id = record_uuid and f.company_id = company for update;
  if not found then return jsonb_build_object('notApplied', 'record_deleted'); end if;
  if not public.user_sync_base_matches(company, actor, 'payroll_review', record_uuid, public.user_sync_normalize_base(payload -> 'base'),
      public.user_sync_timestamp_base(current.updated_at), public.user_sync_state_payroll_review(company, actor, record_uuid)) then
    return jsonb_build_object('notApplied', 'changed_elsewhere');
  end if;
  if (command in ('review.approve','review.reject') and current.status <> 'pending') or (command = 'review.mark_paid' and current.status <> 'approved') then
    return jsonb_build_object('notApplied', 'changed_elsewhere');
  end if;
  update public.payroll_forms f set status = case command when 'review.approve' then 'approved' when 'review.reject' then 'rejected' else 'paid' end,
    rejection_notes = case when command = 'review.reject' then btrim(payload ->> 'notes') else f.rejection_notes end
    where f.id = record_uuid and f.company_id = company;
  return '{}'::jsonb;
end;
$$;

alter function public.user_sync_base_matches(uuid, uuid, text, uuid, jsonb, jsonb, jsonb) owner to fireops_sync_writer;
alter function public.user_sync_timestamp_base(timestamptz) owner to fireops_sync_writer;
alter function public.user_sync_normalize_base(jsonb) owner to fireops_sync_writer;
alter function public.user_sync_state_inventory_return(uuid, uuid, uuid) owner to fireops_sync_writer;
alter function public.user_sync_apply_inventory_return(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
alter function public.user_sync_apply_receipt_change(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
alter function public.user_sync_apply_receipt(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
alter function public.user_sync_apply_vehicle_note(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
alter function public.user_sync_apply_communication_reply(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
alter function public.user_sync_state_payroll_review(uuid, uuid, uuid) owner to fireops_sync_writer;
alter function public.user_sync_apply_payroll_review(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
revoke all on function public.user_sync_base_matches(uuid, uuid, text, uuid, jsonb, jsonb, jsonb), public.user_sync_timestamp_base(timestamptz),
  public.user_sync_normalize_base(jsonb), public.user_sync_state_inventory_return(uuid, uuid, uuid), public.user_sync_apply_inventory_return(uuid, uuid, uuid, text, jsonb),
  public.user_sync_apply_receipt_change(uuid, uuid, uuid, text, jsonb), public.user_sync_apply_receipt(uuid, uuid, uuid, text, jsonb),
  public.user_sync_apply_vehicle_note(uuid, uuid, uuid, text, jsonb), public.user_sync_apply_communication_reply(uuid, uuid, uuid, text, jsonb),
  public.user_sync_state_payroll_review(uuid, uuid, uuid), public.user_sync_apply_payroll_review(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke create on schema public from fireops_sync_writer;
commit;
