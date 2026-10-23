-- Gear checkout for crew, online and offline, through one stock check.
-- * Fixes checkout_inventory_item: it still required the retired 'member'
--   role (renamed to fire_fighter in 20261013000100), so no one could check
--   out. Crew roles fire_fighter and shop_tech may check out; owners/admins
--   manage stock and check items back in, as the apps already show.
-- * Offline: `inventory_checkout` / `checkout.add` on the user command registry,
--   entity ID = item ID so one user's checkouts of an item apply in device
--   order. Stock is checked when the command arrives: never exceeded. A
--   shortfall returns notApplied = 'insufficient_stock' and changes nothing;
--   a deleted item returns notApplied = 'item_deleted'. The request stays on the
--   device either way (decided policy: reject and keep).
begin;

-- Shared stock check for the CURRENT caller (auth.uid()); never another user.
create function public.inventory_checkout_core(target_company_id uuid, target_item_id uuid, checkout_quantity integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  target_item public.company_inventory_items;
  borrower_name text;
  checked_out integer;
  held integer;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if checkout_quantity is null or checkout_quantity < 1 or checkout_quantity > 999999 then
    raise exception 'Checkout quantity must be between 1 and 999999' using errcode = '22023';
  end if;
  select * into target_item from public.company_inventory_items
    where id = target_item_id and (target_company_id is null or company_id = target_company_id) for update;
  if not found then return jsonb_build_object('kind', 'item_deleted'); end if;
  if not exists (select 1 from public.company_members m where m.company_id = target_item.company_id and m.user_id = actor and m.role in ('fire_fighter','shop_tech')) then
    raise exception 'Crew access required' using errcode = '42501';
  end if;
  select coalesce(sum(c.quantity), 0) into checked_out from public.company_inventory_checkouts c
    where c.company_id = target_item.company_id and c.item_id = target_item.id;
  if checked_out + checkout_quantity > target_item.quantity then
    return jsonb_build_object('kind', 'insufficient_stock', 'available', target_item.quantity - checked_out);
  end if;
  select coalesce(nullif(trim(p.full_name), ''), 'Crew member') into borrower_name from public.profiles p where p.user_id = actor;
  insert into public.company_inventory_checkouts (company_id, item_id, user_id, user_name, quantity)
    values (target_item.company_id, target_item.id, actor, borrower_name, checkout_quantity)
    on conflict (company_id, item_id, user_id) do update
      set quantity = public.company_inventory_checkouts.quantity + excluded.quantity, updated_at = now()
    returning quantity into held;
  return jsonb_build_object('kind', 'applied', 'checkedOut', held);
end;
$$;
revoke all on function public.inventory_checkout_core(uuid, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.inventory_checkout_core(uuid, uuid, integer) to fireops_sync_writer;

-- Online contract unchanged apart from the role fix: errors on shortfall/missing.
create or replace function public.checkout_inventory_item(target_item_id uuid, checkout_quantity integer)
returns public.company_inventory_checkouts
language plpgsql security definer set search_path = '' as $$
declare outcome jsonb; result public.company_inventory_checkouts;
begin
  outcome := public.inventory_checkout_core(null, target_item_id, checkout_quantity);
  if outcome ->> 'kind' = 'item_deleted' then raise exception 'Inventory item not found' using errcode = 'P0002'; end if;
  if outcome ->> 'kind' = 'insufficient_stock' then
    raise exception 'Only % units are available', (outcome ->> 'available')::integer using errcode = '22023';
  end if;
  select * into result from public.company_inventory_checkouts c where c.item_id = target_item_id and c.user_id = auth.uid();
  return result;
end;
$$;

insert into public.user_sync_commands values ('inventory_checkout','checkout.add',false);

grant create on schema public to fireops_sync_writer;
create function public.user_sync_state_inventory_checkout(company uuid, actor uuid, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', i.id, 'checkedOut', coalesce((select c.quantity from public.company_inventory_checkouts c
      where c.company_id = company and c.item_id = i.id and c.user_id = actor), 0))
    from public.company_inventory_items i where i.company_id = company and i.id = record_uuid;
$$;
create function public.user_sync_apply_inventory_checkout(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare outcome jsonb;
begin
  if (select array_agg(k) from jsonb_object_keys(payload) k) is distinct from array['quantity']
    or jsonb_typeof(payload -> 'quantity') is distinct from 'number' or (payload ->> 'quantity') !~ '^[1-9][0-9]{0,5}$' then
    raise exception 'Invalid checkout' using errcode = '22023';
  end if;
  outcome := public.inventory_checkout_core(company, record_uuid, (payload ->> 'quantity')::integer);
  if outcome ->> 'kind' = 'applied' then return '{}'::jsonb; end if;
  return jsonb_build_object('notApplied', outcome ->> 'kind');
end;
$$;
alter function public.user_sync_state_inventory_checkout(uuid, uuid, uuid) owner to fireops_sync_writer;
alter function public.user_sync_apply_inventory_checkout(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
revoke all on function public.user_sync_state_inventory_checkout(uuid, uuid, uuid), public.user_sync_apply_inventory_checkout(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke create on schema public from fireops_sync_writer;
commit;
