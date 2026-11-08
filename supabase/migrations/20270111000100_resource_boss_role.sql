-- Resource Boss role: inter-roster resource boss, crew-level everywhere except
-- inventory, the shop board and fleet dispatch. Decided with the client (2026-11-08):
-- * Assigned by owners and admins only (update_company_member_role, unchanged gate).
-- * Inventory: add/edit/delete items, check gear back in for anyone (online and
--   offline), check out gear like crew; every member already reads all checkouts.
-- * Shop board: a shop writer like owners, admins and shop techs (is_shop_writer;
--   the shop Edge Functions check the same roles).
-- * Fleet: opens issues and adds inspections like shop techs, reads/writes vehicle
--   notes, and changes status, crew assignment and fire assignment of any vehicle
--   (online trigger and offline fleet sync). Vehicle details, adds and deletes stay
--   owner/admin.
-- * No change: crew roster/qualification review, Crew Chat moderation, tasks,
--   audit log, settings and finance processing stay owner/admin (or accounting);
--   notifications stay crew-level (create_user_notification treats every role
--   other than owner/admin as crew).
-- Every redefined function below is main's latest definition (file noted above it)
-- with only the role check changed.
begin;

alter table public.company_members drop constraint if exists company_members_role_check;
alter table public.company_members add constraint company_members_role_check
  check (role in ('owner', 'admin', 'shop_tech', 'fire_fighter', 'accounting', 'resource_boss'));
alter table public.communication_threads drop constraint if exists communication_threads_created_by_role_check;
alter table public.communication_threads add constraint communication_threads_created_by_role_check
  check (created_by_role in ('owner', 'admin', 'shop_tech', 'fire_fighter', 'accounting', 'resource_boss'));

-- Roles ----------------------------------------------------------------------
-- Latest: 20261225000100_accounting_role.sql
create or replace function public.update_company_member_role(
  target_company_id uuid, target_user_id uuid, new_role text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := auth.uid(); next_version bigint;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.is_company_owner(target_company_id, actor_id) then
    raise exception 'Company management access required' using errcode = '42501';
  end if;
  if new_role not in ('admin', 'shop_tech', 'fire_fighter', 'accounting', 'resource_boss') then
    raise exception 'Invalid company role' using errcode = '22023';
  end if;
  if not exists (select 1 from public.company_members where company_id=target_company_id and user_id=target_user_id and role<>'owner') then
    raise exception 'Crew member not found' using errcode = 'P0002';
  end if;
  update public.company_members set role=new_role where company_id=target_company_id and user_id=target_user_id;
  update public.fleet_crew set data=jsonb_set(data,'{role}',to_jsonb(new_role)), version=version+1, updated_by=actor_id
    where company_id=target_company_id and record_id=target_user_id returning version into next_version;
  return jsonb_build_object('role',new_role,'version',next_version);
end;
$$;

-- Inventory ------------------------------------------------------------------
-- Owners, admins (and scoped system admins, through is_company_owner) and resource bosses.
create or replace function public.can_manage_inventory(target_company_id uuid, target_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_company_owner(target_company_id, target_user_id) or exists (
    select 1 from public.company_members
    where company_id = target_company_id and user_id = target_user_id and role = 'resource_boss'
  );
$$;
revoke all on function public.can_manage_inventory(uuid, uuid) from public, anon;
grant execute on function public.can_manage_inventory(uuid, uuid) to authenticated;

alter policy "owners create inventory" on public.company_inventory_items
with check (public.can_manage_inventory(company_id, (select auth.uid())) and created_by = (select auth.uid()));
alter policy "owners update inventory" on public.company_inventory_items
using (public.can_manage_inventory(company_id, (select auth.uid())))
with check (public.can_manage_inventory(company_id, (select auth.uid())));
alter policy "owners delete inventory" on public.company_inventory_items
using (public.can_manage_inventory(company_id, (select auth.uid())));

-- Latest: 20270109000100_inventory_on_hand_quantity.sql
create or replace function public.attribute_company_inventory_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('fireops.inventory_stock_move', true), '') <> 'on' then
    if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
    if not public.can_manage_inventory(new.company_id, auth.uid()) and not public.has_system_admin_company_access(new.company_id) then
      raise exception 'Company owner access required' using errcode = '42501';
    end if;
  end if;
  new.name := trim(new.name);
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  new.updated_at := now();
  return new;
end;
$$;
-- Latest: 20270109000100_inventory_on_hand_quantity.sql
create or replace function public.checkin_inventory_item(target_item_id uuid, borrower_user_id uuid, checkin_quantity integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_item public.company_inventory_items;
  target_checkout public.company_inventory_checkouts;
  remaining integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if checkin_quantity is null or checkin_quantity < 1 then raise exception 'Check-in quantity must be at least 1' using errcode = '22023'; end if;

  select * into target_item from public.company_inventory_items where id = target_item_id for update;
  if not found then raise exception 'Checkout not found' using errcode = 'P0002'; end if;
  select * into target_checkout from public.company_inventory_checkouts
  where company_id = target_item.company_id and item_id = target_item_id and user_id = borrower_user_id for update;
  if not found then raise exception 'Checkout not found' using errcode = 'P0002'; end if;
  if not public.can_manage_inventory(target_checkout.company_id, auth.uid())
    and not public.has_system_admin_company_access(target_checkout.company_id) then
    raise exception 'Company owner access required' using errcode = '42501';
  end if;
  if checkin_quantity > target_checkout.quantity then
    raise exception 'Only % units are checked out', target_checkout.quantity using errcode = '22023';
  end if;
  if target_item.quantity + checkin_quantity > 999999 then
    raise exception 'On-hand stock cannot exceed 999,999 units' using errcode = '22023';
  end if;

  remaining := target_checkout.quantity - checkin_quantity;
  if remaining = 0 then
    delete from public.company_inventory_checkouts
    where company_id = target_checkout.company_id and item_id = target_item_id and user_id = borrower_user_id;
  else
    update public.company_inventory_checkouts set quantity = remaining, updated_at = now()
    where company_id = target_checkout.company_id and item_id = target_item_id and user_id = borrower_user_id;
  end if;
  perform public.move_inventory_stock(target_checkout.company_id, target_item_id, checkin_quantity);
  return remaining;
end;
$$;
-- Latest: 20270109000100_inventory_on_hand_quantity.sql
create or replace function public.inventory_checkout_core(target_company_id uuid, target_item_id uuid, checkout_quantity integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  target_item public.company_inventory_items;
  borrower_name text;
  held integer;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if checkout_quantity is null or checkout_quantity < 1 or checkout_quantity > 999999 then
    raise exception 'Checkout quantity must be between 1 and 999999' using errcode = '22023';
  end if;
  select * into target_item from public.company_inventory_items
    where id = target_item_id and (target_company_id is null or company_id = target_company_id) for update;
  if not found then return jsonb_build_object('kind', 'item_deleted'); end if;
  if not exists (select 1 from public.company_members m where m.company_id = target_item.company_id and m.user_id = actor and m.role in ('fire_fighter','shop_tech','accounting','resource_boss')) then
    raise exception 'Crew access required' using errcode = '42501';
  end if;
  if checkout_quantity > target_item.quantity then
    return jsonb_build_object('kind', 'insufficient_stock', 'available', target_item.quantity);
  end if;
  select coalesce(nullif(trim(p.full_name), ''), 'Crew member') into borrower_name from public.profiles p where p.user_id = actor;
  insert into public.company_inventory_checkouts (company_id, item_id, user_id, user_name, quantity)
    values (target_item.company_id, target_item.id, actor, borrower_name, checkout_quantity)
    on conflict (company_id, item_id, user_id) do update
      set quantity = public.company_inventory_checkouts.quantity + excluded.quantity, updated_at = now()
    returning quantity into held;
  perform public.move_inventory_stock(target_item.company_id, target_item.id, -checkout_quantity);
  return jsonb_build_object('kind', 'applied', 'checkedOut', held);
end;
$$;
grant create on schema public to fireops_sync_writer;
-- Latest: 20270109000100_inventory_on_hand_quantity.sql
create or replace function public.user_sync_apply_inventory_item(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  violated text;
  current public.company_inventory_items;
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
  if not (public.can_manage_inventory(company, actor) or public.has_system_admin_company_access(company)) then
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
  begin
    update public.company_inventory_items i set name = coalesce(btrim(payload ->> 'name'), i.name), quantity = coalesce((payload ->> 'quantity')::int, i.quantity)
      where i.id = record_uuid and i.company_id = company;
  exception when unique_violation then
    return jsonb_build_object('notApplied', 'name_taken');
  end;
  return '{}'::jsonb;
end;
$$;
-- Latest: 20261219000100_user_sync_guarded_edits.sql
create or replace function public.user_sync_apply_inventory_return(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  checkout public.company_inventory_checkouts;
begin
  if (select array_agg(k order by k collate "C") from jsonb_object_keys(payload) k) is distinct from array['base','quantity','userId']
    or jsonb_typeof(payload -> 'userId') <> 'string' or payload ->> 'userId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(payload -> 'quantity') <> 'number' or payload ->> 'quantity' !~ '^[1-9][0-9]{0,5}$' then
    raise exception 'Invalid check-in' using errcode = '22023';
  end if;
  if not public.can_manage_inventory(company, actor) then raise exception 'Company owner access required' using errcode = '42501'; end if;
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

-- Fleet ----------------------------------------------------------------------
-- Latest: 20261214000100_fleet_sync_vehicle_create.sql
create or replace function public.sync_fleet_create(operation jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  company uuid;
  operation_uuid uuid;
  record_uuid uuid;
  provenance jsonb := operation -> 'provenance';
  issue_data jsonb := operation -> 'mutation' -> 'record';
  entity text := operation ->> 'entityType';
  activity uuid := gen_random_uuid();
  collection_name text := case operation ->> 'entityType' when 'vehicle' then 'vehicles' else 'issues' end;
  device_time timestamptz;
  request_hash bytea;
  previous public.fleet_sync_submissions;
  actor_label text;
  current_version bigint;
  receipt_time timestamptz := statement_timestamp();
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(operation) is distinct from 'object' or octet_length(operation::text) > 1048576
    or operation -> 'schemaVersion' is distinct from '1'::jsonb
    or (select array_agg(k order by k collate "C") from jsonb_object_keys(operation) k)
      is distinct from array['companyId','dependsOn','entityId','entityType','mutation','operationId','provenance','schemaVersion']
    or operation ->> 'entityType' is null or operation ->> 'entityType' not in ('issue','vehicle')
    or operation -> 'dependsOn' is distinct from '[]'::jsonb
    or jsonb_typeof(operation -> 'mutation') is distinct from 'object'
    or (select array_agg(k order by k collate "C") from jsonb_object_keys(operation -> 'mutation') k) is distinct from array['kind','record']
    or operation -> 'mutation' ->> 'kind' is distinct from 'create' then
    raise exception 'Only single issue or vehicle creates are supported' using errcode = '22023';
  end if;
  company := (operation ->> 'companyId')::uuid; operation_uuid := (operation ->> 'operationId')::uuid; record_uuid := (operation ->> 'entityId')::uuid;
  if entity = 'vehicle' and not public.is_company_owner(company, actor) then
    raise exception 'Only owners and admins can add vehicles' using errcode = '42501';
  end if;
  if entity = 'issue' and not (public.is_company_owner(company, actor) or exists (select 1 from public.company_members m where m.company_id = company and m.user_id = actor and m.role in ('shop_tech', 'resource_boss'))) then
    raise exception 'This role cannot report issues' using errcode = '42501';
  end if;
  if jsonb_typeof(provenance) is distinct from 'object'
    or (select array_agg(k order by k collate "C") from jsonb_object_keys(provenance) k) is distinct from array['connectivity','deviceId','savedAt','userId']
    or provenance ->> 'userId' is distinct from actor::text
    or jsonb_typeof(provenance -> 'deviceId') is distinct from 'string' or char_length(btrim(provenance ->> 'deviceId')) not between 1 and 200
    or jsonb_typeof(provenance -> 'savedAt') is distinct from 'string' or provenance ->> 'savedAt' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$'
    or provenance ->> 'connectivity' is null or provenance ->> 'connectivity' not in ('online','offline','unknown') then
    raise exception 'Invalid or misattributed sync provenance' using errcode = '22023';
  end if;
  device_time := (provenance ->> 'savedAt')::timestamptz;
  if entity = 'vehicle' then
    -- A new vehicle starts Ready or Out of service, unassigned, with no files,
    -- documents or inspections (those are added by their own adapters later).
    if jsonb_typeof(issue_data) is distinct from 'object'
      or (select array_agg(k order by k collate "C") from jsonb_object_keys(issue_data) k)
        is distinct from array['createdAt','id','make','model','notes','plate','status','type','unit','vin','year']
      or issue_data ->> 'id' is distinct from record_uuid::text
      or exists (select 1 from unnest(array['unit','type','make','model']) f where jsonb_typeof(issue_data -> f) <> 'string' or btrim(issue_data ->> f) = '' or char_length(issue_data ->> f) > 200)
      or exists (select 1 from unnest(array['vin','plate']) f where jsonb_typeof(issue_data -> f) <> 'string' or char_length(issue_data ->> f) > 200)
      or jsonb_typeof(issue_data -> 'notes') <> 'string' or char_length(issue_data ->> 'notes') > 10000
      or jsonb_typeof(issue_data -> 'year') <> 'number' or issue_data ->> 'year' !~ '^[0-9]{4}$'
      or issue_data ->> 'status' is null or issue_data ->> 'status' not in ('Ready','Out of service')
      or jsonb_typeof(issue_data -> 'createdAt') <> 'string' or issue_data ->> 'createdAt' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then
      raise exception 'Invalid new vehicle' using errcode = '22023';
    end if;
  else
    if jsonb_typeof(issue_data) is distinct from 'object'
      or (select array_agg(k order by k collate "C") from jsonb_object_keys(issue_data) k)
        is distinct from array['createdAt','createdBy','createdById','description','id','priority','status','title','updates','vehicleId']
      or issue_data ->> 'id' is distinct from record_uuid::text or issue_data ->> 'createdById' is distinct from actor::text
      or issue_data ->> 'vehicleId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(issue_data -> 'title') <> 'string' or btrim(issue_data ->> 'title') = '' or char_length(issue_data ->> 'title') > 200
      or jsonb_typeof(issue_data -> 'description') <> 'string' or btrim(issue_data ->> 'description') = '' or char_length(issue_data ->> 'description') > 10000
      or issue_data ->> 'priority' is null or issue_data ->> 'priority' not in ('Low','Medium','High','Critical')
      or issue_data -> 'status' is distinct from '"Open"'::jsonb or issue_data -> 'updates' is distinct from '[]'::jsonb
      or jsonb_typeof(issue_data -> 'createdBy') <> 'string' or char_length(issue_data ->> 'createdBy') not between 1 and 200
      or jsonb_typeof(issue_data -> 'createdAt') <> 'string' or issue_data ->> 'createdAt' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then
      raise exception 'Invalid new issue' using errcode = '22023';
    end if;
  end if;
  perform (issue_data ->> 'createdAt')::timestamptz;
  request_hash := sha256(convert_to(operation::text, 'UTF8'));
  perform public.lock_fleet_sync_review(company, entity, record_uuid);
  perform pg_advisory_xact_lock(hashtextextended(company::text || ':' || actor::text || ':' || operation_uuid::text, 0));
  select * into previous from public.fleet_sync_submissions s where s.company_id = company and s.actor_user_id = actor and s.operation_id = operation_uuid;
  if found then
    if previous.request_sha256 <> request_hash then raise exception 'Operation ID was reused for different work' using errcode = '22023'; end if;
    return previous.result;
  end if;
  if exists (select 1 from public.fleet_sync_revisions r where r.company_id = company and r.collection = collection_name and r.record_id = record_uuid)
    or exists (select 1 from public.fleet_issues i where i.company_id = company and i.record_id = record_uuid)
    or exists (select 1 from public.fleet_vehicles v where v.company_id = company and v.record_id = record_uuid) then
    raise exception 'This record identity was already used' using errcode = '23505';
  end if;
  select nullif(full_name, '') into actor_label from public.profiles where user_id = actor;
  if entity = 'vehicle' then
    -- Same activity entry the online add writes, plus device-reported provenance.
    perform public.apply_fleet_changes(company, jsonb_build_array(
      jsonb_build_object('collection', 'vehicles', 'recordId', record_uuid, 'event', 'insert', 'data', issue_data),
      jsonb_build_object('collection', 'activities', 'event', 'insert', 'recordId', activity, 'data', jsonb_build_object(
        'id', activity, 'action', (issue_data ->> 'unit') || ' added to fleet',
        'detail', 'Vehicle record created · Synced from a device change saved ' || (provenance ->> 'connectivity') || ' at ' || (provenance ->> 'savedAt') || ' (device-reported)',
        'createdBy', coalesce(actor_label, 'Company user'), 'createdById', actor, 'createdAt', to_jsonb(receipt_time) #>> '{}',
        'targetType', 'vehicle', 'targetId', record_uuid, 'tone', 'complete'))));
    select v.version into current_version from public.fleet_vehicles v where v.company_id = company and v.record_id = record_uuid;
  else
    if not exists (select 1 from public.fleet_vehicles v where v.company_id = company and v.record_id = (issue_data ->> 'vehicleId')::uuid) then
      raise exception 'The vehicle is unavailable or was deleted' using errcode = '22023';
    end if;
    perform public.apply_fleet_changes(company, jsonb_build_array(jsonb_build_object('collection', 'issues', 'recordId', record_uuid, 'event', 'insert', 'data', issue_data)));
    select i.version into current_version from public.fleet_issues i where i.company_id = company and i.record_id = record_uuid;
  end if;
  result := jsonb_build_object('kind', 'applied', 'receivedAt', receipt_time, 'revision', current_version::text, 'record', issue_data);
  insert into public.fleet_sync_submissions
    (company_id, actor_user_id, operation_id, entity_type, record_id, request_sha256, actor_name, device_id, saved_at, connectivity, received_at, applied_revision, result)
    values (company, actor, operation_uuid, entity, record_uuid, request_hash, actor_label, provenance ->> 'deviceId', device_time, provenance ->> 'connectivity', receipt_time, current_version, result);
  return result;
end;
$$;
revoke create on schema public from fireops_sync_writer;

-- Latest: 20270108000100_vehicle_oil_change_due.sql
create or replace function public.enforce_normalized_vehicle_changes()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  old_inspections jsonb := coalesce(old.data -> 'inspections', '[]'::jsonb);
  new_inspections jsonb := coalesce(new.data -> 'inspections', '[]'::jsonb);
begin
  if actor_id is null
    or public.is_company_owner(new.company_id, actor_id)
    or public.has_system_admin_company_access(new.company_id)
  then
    return new;
  end if;

  select member.role into actor_role
  from public.company_members member
  where member.company_id = new.company_id and member.user_id = actor_id;

  -- Claim a ready, unassigned vehicle.
  if old.data - 'assignedTo' - 'status' = new.data - 'assignedTo' - 'status' and (
    coalesce(old.data ->> 'assignedTo', '') = ''
    and btrim(old.data ->> 'status') = 'Ready'
    and new.data ->> 'assignedTo' = actor_id::text
    and btrim(new.data ->> 'status') = 'Assigned'
  ) then
    return new;
  end if;

  -- Release own vehicle. Fire assignment must be cleared with it.
  if old.data - 'assignedTo' - 'status' - 'assignedFire' = new.data - 'assignedTo' - 'status' - 'assignedFire' and (
    old.data ->> 'assignedTo' = actor_id::text
    and btrim(old.data ->> 'status') = 'Assigned'
    and coalesce(new.data ->> 'assignedTo', '') = ''
    and btrim(new.data ->> 'status') = 'Ready'
    and not (new.data ? 'assignedFire')
  ) then
    return new;
  end if;

  -- Join, change, or leave a fire using vehicle assigned to actor.
  if old.data - 'assignedFire' - 'status' = new.data - 'assignedFire' - 'status' and (
    old.data ->> 'assignedTo' = actor_id::text
    and new.data ->> 'assignedTo' = actor_id::text
    and btrim(new.data ->> 'status') = 'Assigned'
  ) then
    return new;
  end if;

  -- Resource bosses dispatch any vehicle: status, crew assignment and fire assignment only.
  if actor_role = 'resource_boss'
    and old.data - 'assignedTo' - 'status' - 'assignedFire' = new.data - 'assignedTo' - 'status' - 'assignedFire'
  then
    return new;
  end if;

  -- Shop techs and resource bosses may add one inspection without changing vehicle details.
  if actor_role in ('shop_tech', 'resource_boss')
    and old.data - 'inspections' = new.data - 'inspections'
    and jsonb_typeof(old_inspections) = 'array'
    and jsonb_typeof(new_inspections) = 'array'
    and jsonb_array_length(new_inspections) = jsonb_array_length(old_inspections) + 1
    and new_inspections - 0 = old_inspections
    and new_inspections -> 0 ->> 'inspectorId' = actor_id::text
  then
    return new;
  end if;

  -- Shop techs may set or clear the next oil change and its due date (Service).
  if actor_role = 'shop_tech'
    and old.data - 'nextOilChange' - 'nextOilChangeDue' = new.data - 'nextOilChange' - 'nextOilChangeDue'
  then
    return new;
  end if;

  raise exception 'This role cannot make the requested vehicle change' using errcode = '42501';
end;
$$;
-- Latest: 20261213000100_fleet_sync_issue_status_with_note.sql
create or replace function public.validate_fleet_sync_submitter_patch(company uuid, actor uuid, entity text, patch jsonb)
returns void language plpgsql stable set search_path = '' as $$
declare
  shop_tech boolean := exists (select 1 from public.company_members m where m.company_id = company and m.user_id = actor and m.role in ('shop_tech', 'resource_boss'));
begin
  if public.is_company_owner(company, actor) then return; end if;
  if entity = 'vehicle' and shop_tech and patch ? 'inspections' then return; end if; -- alone; role trigger checks the rest
  if (entity = 'vehicle' and exists (select 1 from jsonb_object_keys(patch) k where k not in ('status','assignedTo','assignedFire')))
    or (entity = 'issue' and (exists (select 1 from jsonb_object_keys(patch) k where k not in ('updates','status','resolvedAt')) or not patch ? 'updates'))
    or entity not in ('vehicle','issue') then
    raise exception 'This role can only claim/release vehicles, add issue notes (optionally resolving/reopening) or (shop techs and resource bosses) add inspections offline' using errcode = '42501';
  end if;
end;
$$;
-- Latest: 20261225000100_accounting_role.sql
create or replace function public.fleet_sync_submitter_allowed(company uuid, actor uuid)
returns boolean language sql stable set search_path = '' as $$
  select public.is_company_owner(company, actor) or exists (select 1 from public.company_members m
    where m.company_id = company and m.user_id = actor and m.role in ('fire_fighter','shop_tech','accounting','resource_boss'));
$$;
-- Latest: 20261125000100_fleet_sync_shop_tech_photos.sql
create or replace function public.fleet_sync_attachment_user_allowed(company uuid, actor uuid)
returns boolean language sql stable set search_path = '' as $$
  select public.is_company_owner(company, actor) or exists (select 1 from public.company_members m
    where m.company_id = company and m.user_id = actor and m.role in ('shop_tech', 'resource_boss'));
$$;
-- Latest: 20261014000100_vehicle_notes.sql
create or replace function public.can_access_vehicle_notes(target_company_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_system_admin_company_access(target_company_id) or exists (
    select 1 from public.company_members
    where company_id = target_company_id
      and user_id = target_user_id
      and role in ('owner', 'admin', 'shop_tech', 'resource_boss')
  );
$$;
alter policy "authorized roles add fleet issues" on public.fleet_issues
with check (
  updated_by = (select auth.uid())
  and (
    public.is_company_owner(fleet_issues.company_id, (select auth.uid()))
    or exists (
      select 1
      from public.company_members member
      where member.company_id = fleet_issues.company_id
        and member.user_id = (select auth.uid())
        and member.role in ('shop_tech', 'resource_boss')
    )
  )
);

-- Shop board -----------------------------------------------------------------
-- Latest: 20270110000100_shop_fleet_repairs.sql
create or replace function public.is_shop_writer(target_company_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_system_admin_company_access(target_company_id) or exists (
    select 1 from public.company_members
    where company_id = target_company_id
      and user_id = target_user_id
      and role in ('owner', 'admin', 'resource_boss', 'shop_tech')
  );
$$;
commit;
