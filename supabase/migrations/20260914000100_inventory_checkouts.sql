-- Crew inventory checkout and owner-controlled check-in.
create table public.company_inventory_checkouts (
  company_id uuid not null,
  item_id uuid not null,
  user_id uuid not null,
  user_name text not null,
  quantity integer not null check (quantity between 1 and 999999),
  checked_out_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, item_id, user_id),
  foreign key (company_id, item_id) references public.company_inventory_items(company_id, id) on delete cascade,
  foreign key (company_id, user_id) references public.company_members(company_id, user_id) on delete cascade
);
create index company_inventory_checkouts_item_idx on public.company_inventory_checkouts (company_id, item_id);

alter table public.company_inventory_checkouts enable row level security;
create policy "members read inventory checkouts" on public.company_inventory_checkouts for select to authenticated
using (public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id));
revoke all on public.company_inventory_checkouts from anon, authenticated;
grant select on public.company_inventory_checkouts to authenticated;

create or replace function public.checkout_inventory_item(target_item_id uuid, checkout_quantity integer)
returns public.company_inventory_checkouts
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_item public.company_inventory_items;
  borrower_name text;
  checked_out integer;
  result public.company_inventory_checkouts;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if checkout_quantity is null or checkout_quantity < 1 then raise exception 'Checkout quantity must be at least 1' using errcode = '22023'; end if;

  select * into target_item from public.company_inventory_items where id = target_item_id for update;
  if not found then raise exception 'Inventory item not found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.company_members
    where company_id = target_item.company_id and user_id = auth.uid() and role = 'member'
  ) then raise exception 'Crew access required' using errcode = '42501'; end if;

  select coalesce(sum(quantity), 0) into checked_out
  from public.company_inventory_checkouts
  where company_id = target_item.company_id and item_id = target_item.id;
  if checked_out + checkout_quantity > target_item.quantity then
    raise exception 'Only % units are available', target_item.quantity - checked_out using errcode = '22023';
  end if;

  select coalesce(nullif(trim(full_name), ''), 'Crew member') into borrower_name
  from public.profiles where user_id = auth.uid();
  insert into public.company_inventory_checkouts (company_id, item_id, user_id, user_name, quantity)
  values (target_item.company_id, target_item.id, auth.uid(), borrower_name, checkout_quantity)
  on conflict (company_id, item_id, user_id) do update
  set quantity = public.company_inventory_checkouts.quantity + excluded.quantity, updated_at = now()
  returning * into result;
  return result;
end;
$$;

create or replace function public.checkin_inventory_item(target_item_id uuid, borrower_user_id uuid, checkin_quantity integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_checkout public.company_inventory_checkouts;
  remaining integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if checkin_quantity is null or checkin_quantity < 1 then raise exception 'Check-in quantity must be at least 1' using errcode = '22023'; end if;

  select * into target_checkout from public.company_inventory_checkouts
  where item_id = target_item_id and user_id = borrower_user_id for update;
  if not found then raise exception 'Checkout not found' using errcode = 'P0002'; end if;
  if not public.is_company_owner(target_checkout.company_id, auth.uid())
    and not public.has_system_admin_company_access(target_checkout.company_id) then
    raise exception 'Company owner access required' using errcode = '42501';
  end if;
  if checkin_quantity > target_checkout.quantity then
    raise exception 'Only % units are checked out', target_checkout.quantity using errcode = '22023';
  end if;

  remaining := target_checkout.quantity - checkin_quantity;
  if remaining = 0 then
    delete from public.company_inventory_checkouts
    where company_id = target_checkout.company_id and item_id = target_item_id and user_id = borrower_user_id;
  else
    update public.company_inventory_checkouts set quantity = remaining, updated_at = now()
    where company_id = target_checkout.company_id and item_id = target_item_id and user_id = borrower_user_id;
  end if;
  return remaining;
end;
$$;

revoke all on function public.checkout_inventory_item(uuid, integer) from public, anon;
revoke all on function public.checkin_inventory_item(uuid, uuid, integer) from public, anon;
grant execute on function public.checkout_inventory_item(uuid, integer) to authenticated;
grant execute on function public.checkin_inventory_item(uuid, uuid, integer) to authenticated;

-- Total stock cannot be reduced below units currently checked out.
create or replace function public.attribute_company_inventory_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare checked_out integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.is_company_owner(new.company_id, auth.uid()) and not public.has_system_admin_company_access(new.company_id) then
    raise exception 'Company owner access required' using errcode = '42501';
  end if;
  new.name := trim(new.name);
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    select coalesce(sum(quantity), 0) into checked_out from public.company_inventory_checkouts
    where company_id = new.company_id and item_id = new.id;
    if new.quantity < checked_out then
      raise exception 'Quantity cannot be less than % checked-out units', checked_out using errcode = '22023';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

alter publication supabase_realtime add table public.company_inventory_checkouts;
