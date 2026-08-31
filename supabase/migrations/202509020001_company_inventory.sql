-- Owner-only company inventory counts.

create table public.company_inventory_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  quantity integer not null default 0 check (quantity between 0 and 999999),
  created_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name),
  unique (company_id, id)
);

create index company_inventory_items_company_name_idx on public.company_inventory_items (company_id, name);

create or replace function public.attribute_company_inventory_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.is_company_owner(new.company_id, auth.uid()) and not public.has_system_admin_company_access(new.company_id) then
    raise exception 'Company owner access required' using errcode = '42501';
  end if;
  new.name := trim(new.name);
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.attribute_company_inventory_item() from public, anon, authenticated;

create trigger company_inventory_items_attribution before insert or update on public.company_inventory_items
for each row execute function public.attribute_company_inventory_item();

alter table public.company_inventory_items enable row level security;

create policy "owners read inventory" on public.company_inventory_items for select to authenticated
using (public.is_company_owner(company_id, auth.uid()) or public.has_system_admin_company_access(company_id));
create policy "owners create inventory" on public.company_inventory_items for insert to authenticated
with check ((public.is_company_owner(company_id, auth.uid()) or public.has_system_admin_company_access(company_id)) and created_by = auth.uid());
create policy "owners update inventory" on public.company_inventory_items for update to authenticated
using (public.is_company_owner(company_id, auth.uid()) or public.has_system_admin_company_access(company_id))
with check (public.is_company_owner(company_id, auth.uid()) or public.has_system_admin_company_access(company_id));
create policy "owners delete inventory" on public.company_inventory_items for delete to authenticated
using (public.is_company_owner(company_id, auth.uid()) or public.has_system_admin_company_access(company_id));

revoke all on public.company_inventory_items from anon;
grant select, insert, update, delete on public.company_inventory_items to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'company_inventory_items') then
    alter publication supabase_realtime add table public.company_inventory_items;
  end if;
end $$;
