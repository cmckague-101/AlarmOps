-- Offline creation of new company records by owners/admins, through the user
-- command registry. Each is one insert per device-chosen ID through the
-- existing attribution triggers, insert policies and side effects (crew
-- notifications for new threads/trainings), so the same roles as online may
-- create them. A reused ID is refused (23505); nothing is ever overwritten.
-- * communication_thread: `thread.create` {subject, description}
-- * training: `training.create` {courseCode, courseTitle, startsAt, location,
--   instructor, capacity, courseInformation}
-- * inventory_item: `item.create` {name, quantity}; an item name already used
--   in the company returns notApplied 'name_taken' and nothing is created.
-- Edits and deletes of these records stay online-only.
begin;

insert into public.user_sync_commands values
  ('communication_thread','thread.create',false),('training','training.create',false),('inventory_item','item.create',false);

grant create on schema public to fireops_sync_writer;
create function public.user_sync_state_communication_thread(company uuid, actor uuid, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', t.id, 'subject', t.subject, 'createdAt', t.created_at) from public.communication_threads t
    where t.id = record_uuid and t.company_id = company;
$$;
create function public.user_sync_apply_communication_thread(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
begin
  if (select array_agg(k order by k collate "C") from jsonb_object_keys(payload) k) is distinct from array['description','subject']
    or jsonb_typeof(payload -> 'subject') <> 'string' or char_length(btrim(payload ->> 'subject')) not between 1 and 160
    or jsonb_typeof(payload -> 'description') <> 'string' or char_length(btrim(payload ->> 'description')) not between 1 and 5000 then
    raise exception 'Invalid Crew Chat thread' using errcode = '22023';
  end if;
  begin
    insert into public.communication_threads (id, company_id, subject, description, created_by, created_by_name, created_by_role)
      values (record_uuid, company, btrim(payload ->> 'subject'), btrim(payload ->> 'description'), actor, '', 'owner');
  exception when unique_violation then
    raise exception 'This thread identity was already used' using errcode = '23505';
  end;
  return '{}'::jsonb;
end;
$$;
create function public.user_sync_state_training(company uuid, actor uuid, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', t.id, 'courseTitle', t.course_title, 'startsAt', t.starts_at, 'createdAt', t.created_at) from public.company_trainings t
    where t.id = record_uuid and t.company_id = company;
$$;
create function public.user_sync_apply_training(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
begin
  if (select array_agg(k order by k collate "C") from jsonb_object_keys(payload) k)
      is distinct from array['capacity','courseCode','courseInformation','courseTitle','instructor','location','startsAt']
    or jsonb_typeof(payload -> 'courseCode') <> 'string' or char_length(btrim(payload ->> 'courseCode')) not between 1 and 80
    or jsonb_typeof(payload -> 'courseTitle') <> 'string' or char_length(btrim(payload ->> 'courseTitle')) not between 1 and 200
    or jsonb_typeof(payload -> 'location') <> 'string' or char_length(btrim(payload ->> 'location')) not between 1 and 300
    or jsonb_typeof(payload -> 'instructor') <> 'string' or char_length(btrim(payload ->> 'instructor')) not between 1 and 160
    or jsonb_typeof(payload -> 'courseInformation') <> 'string' or char_length(payload ->> 'courseInformation') > 5000
    or jsonb_typeof(payload -> 'capacity') <> 'number' or payload ->> 'capacity' !~ '^[1-9][0-9]{0,4}$' or (payload ->> 'capacity')::int > 10000
    or jsonb_typeof(payload -> 'startsAt') <> 'string' or payload ->> 'startsAt' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then
    raise exception 'Invalid training' using errcode = '22023';
  end if;
  begin
    insert into public.company_trainings (id, company_id, course_code, course_title, starts_at, location, instructor, capacity, course_information)
      values (record_uuid, company, btrim(payload ->> 'courseCode'), btrim(payload ->> 'courseTitle'), (payload ->> 'startsAt')::timestamptz,
        btrim(payload ->> 'location'), btrim(payload ->> 'instructor'), (payload ->> 'capacity')::int, payload ->> 'courseInformation');
  exception when unique_violation then
    raise exception 'This training identity was already used' using errcode = '23505';
  end;
  return '{}'::jsonb;
end;
$$;
create function public.user_sync_state_inventory_item(company uuid, actor uuid, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', i.id, 'name', i.name, 'quantity', i.quantity, 'createdAt', i.created_at) from public.company_inventory_items i
    where i.id = record_uuid and i.company_id = company;
$$;
create function public.user_sync_apply_inventory_item(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare violated text;
begin
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
end;
$$;
alter function public.user_sync_state_communication_thread(uuid, uuid, uuid) owner to fireops_sync_writer;
alter function public.user_sync_apply_communication_thread(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
alter function public.user_sync_state_training(uuid, uuid, uuid) owner to fireops_sync_writer;
alter function public.user_sync_apply_training(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
alter function public.user_sync_state_inventory_item(uuid, uuid, uuid) owner to fireops_sync_writer;
alter function public.user_sync_apply_inventory_item(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
revoke all on function public.user_sync_state_communication_thread(uuid, uuid, uuid), public.user_sync_apply_communication_thread(uuid, uuid, uuid, text, jsonb),
  public.user_sync_state_training(uuid, uuid, uuid), public.user_sync_apply_training(uuid, uuid, uuid, text, jsonb),
  public.user_sync_state_inventory_item(uuid, uuid, uuid), public.user_sync_apply_inventory_item(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke create on schema public from fireops_sync_writer;
commit;
