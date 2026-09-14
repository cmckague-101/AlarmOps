-- A single permissive policy per role/action avoids evaluating several policy
-- trees for every query. Each replacement preserves the OR semantics of the
-- policies it supersedes.

-- Companies: members or system administrators may read.
drop policy if exists "members read company" on public.companies;
drop policy if exists "admins read all companies" on public.companies;
create policy "authenticated read companies" on public.companies
for select to authenticated using (
  public.is_company_member(id, (select auth.uid()))
  or public.is_system_admin()
);

-- Fleet state: members or administrators with scoped company access may read
-- and write. Writers must attribute the change to themselves.
drop policy if exists "members read fleet state" on public.fleet_state;
drop policy if exists "scoped admins read fleet state" on public.fleet_state;
create policy "authorized users read fleet state" on public.fleet_state
for select to authenticated using (
  public.is_company_member(company_id, (select auth.uid()))
  or public.has_system_admin_company_access(company_id)
);

drop policy if exists "members create fleet state" on public.fleet_state;
drop policy if exists "scoped admins create fleet state" on public.fleet_state;
create policy "authorized users create fleet state" on public.fleet_state
for insert to authenticated with check (
  (
    public.is_company_member(company_id, (select auth.uid()))
    or public.has_system_admin_company_access(company_id)
  )
  and updated_by = (select auth.uid())
);

drop policy if exists "members update fleet state" on public.fleet_state;
drop policy if exists "scoped admins update fleet state" on public.fleet_state;
create policy "authorized users update fleet state" on public.fleet_state
for update to authenticated using (
  public.is_company_member(company_id, (select auth.uid()))
  or public.has_system_admin_company_access(company_id)
) with check (
  (
    public.is_company_member(company_id, (select auth.uid()))
    or public.has_system_admin_company_access(company_id)
  )
  and updated_by = (select auth.uid())
);

-- Inventory: members may read, including owners, plus administrators with
-- scoped company access.
drop policy if exists "owners read inventory" on public.company_inventory_items;
drop policy if exists "members read company inventory" on public.company_inventory_items;
create policy "authorized users read company inventory" on public.company_inventory_items
for select to authenticated using (
  public.is_company_member(company_id, (select auth.uid()))
  or public.is_company_owner(company_id, (select auth.uid()))
  or public.has_system_admin_company_access(company_id)
);

-- Qualification cards: crew may read their own requests; owners and scoped
-- administrators may read all requests for the company.
drop policy if exists "crew read own qualification card requests" on public.qualification_card_requests;
drop policy if exists "owners read company qualification card requests" on public.qualification_card_requests;
create policy "authorized users read qualification card requests"
on public.qualification_card_requests
for select to authenticated using (
  (
    crew_user_id = (select auth.uid())
    and public.is_company_member(company_id, (select auth.uid()))
  )
  or public.is_company_owner(company_id, (select auth.uid()))
  or public.has_system_admin_company_access(company_id)
);
