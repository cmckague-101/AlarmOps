-- Inventory quantity is on-hand (available) stock, not a catalog total.
-- * Checking out n units lowers company_inventory_items.quantity by n and adds
--   to the borrower's checkout row; checking in n units raises it by n and
--   lowers/removes the checkout row. Checkout rows stay the who-has-what record.
-- * Managers edit on-hand stock directly; it is no longer floored at the units
--   checked out (offline item.update no longer returns 'below_checked_out').
-- * Total for display = quantity + sum(checkouts).
-- * Existing rows are converted once: quantity := quantity - checked out.
--   Their updated_at moves, so offline stock edits queued against the old
--   meaning return 'changed_elsewhere' instead of applying.
-- Stock moves update the item row from crew checkouts, so the item trigger
-- lets a transaction-local 'fireops.inventory_stock_move' flag (set only by
-- these security definer functions) skip its manager check. Crew still cannot
-- update items directly: the RLS update policy is manager-only.
begin;

create or replace function public.attribute_company_inventory_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('fireops.inventory_stock_move', true), '') <> 'on' then
    if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
    if not public.is_company_owner(new.company_id, auth.uid()) and not public.has_system_admin_company_access(new.company_id) then
      raise exception 'Company owner access required' using errcode = '42501';
    end if;
  end if;
  new.name := trim(new.name);
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.attribute_company_inventory_item() from public, anon, authenticated;

-- Moves on-hand stock for one item by delta; the caller holds the item row lock.
create function public.move_inventory_stock(target_company_id uuid, target_item_id uuid, delta integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare on_hand integer;
begin
  perform set_config('fireops.inventory_stock_move', 'on', true);
  update public.company_inventory_items i set quantity = i.quantity + delta
    where i.company_id = target_company_id and i.id = target_item_id
    returning i.quantity into on_hand;
  perform set_config('fireops.inventory_stock_move', 'off', true);
  return on_hand;
end;
$$;
revoke all on function public.move_inventory_stock(uuid, uuid, integer) from public, anon, authenticated, service_role;

-- One-time conversion from total to on-hand.
select set_config('fireops.inventory_stock_move', 'on', true);
update public.company_inventory_items i set quantity = greatest(0, i.quantity - c.checked_out)
  from (select company_id, item_id, sum(quantity)::integer checked_out from public.company_inventory_checkouts group by company_id, item_id) c
  where c.company_id = i.company_id and c.item_id = i.id;
select set_config('fireops.inventory_stock_move', 'off', true);

-- Checkout (online and offline): limited by on-hand stock, which it lowers.
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
  if not exists (select 1 from public.company_members m where m.company_id = target_item.company_id and m.user_id = actor and m.role in ('fire_fighter','shop_tech','accounting')) then
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

-- Check-in (online, and offline via return.checkin): returns units to on-hand stock.
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
  if not public.is_company_owner(target_checkout.company_id, auth.uid())
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
revoke all on function public.checkin_inventory_item(uuid, uuid, integer) from public, anon;
grant execute on function public.checkin_inventory_item(uuid, uuid, integer) to authenticated;

-- Offline manager edits: on-hand stock is no longer floored at checked-out units.
grant create on schema public to fireops_sync_writer;
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
  begin
    update public.company_inventory_items i set name = coalesce(btrim(payload ->> 'name'), i.name), quantity = coalesce((payload ->> 'quantity')::int, i.quantity)
      where i.id = record_uuid and i.company_id = company;
  exception when unique_violation then
    return jsonb_build_object('notApplied', 'name_taken');
  end;
  return '{}'::jsonb;
end;
$$;
alter function public.user_sync_apply_inventory_item(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
revoke all on function public.user_sync_apply_inventory_item(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke create on schema public from fireops_sync_writer;

commit;
