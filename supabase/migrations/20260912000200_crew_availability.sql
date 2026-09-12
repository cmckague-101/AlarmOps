-- Availability is separate from membership and vehicle assignment status.
create table public.crew_availability (
  company_id uuid not null,
  user_id uuid not null,
  available boolean not null,
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id),
  foreign key (company_id, user_id) references public.company_members(company_id, user_id) on delete cascade
);
alter table public.crew_availability enable row level security;
create policy "members read crew availability" on public.crew_availability for select to authenticated
using (public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id));
create policy "crew and owners set availability" on public.crew_availability for insert to authenticated
with check (public.is_company_member(company_id, auth.uid()) and (user_id = auth.uid() or public.is_company_owner(company_id, auth.uid())));
create policy "crew and owners update availability" on public.crew_availability for update to authenticated
using (public.is_company_member(company_id, auth.uid()) and (user_id = auth.uid() or public.is_company_owner(company_id, auth.uid())))
with check (public.is_company_member(company_id, auth.uid()) and (user_id = auth.uid() or public.is_company_owner(company_id, auth.uid())));
grant select, insert on public.crew_availability to authenticated;
grant update on public.crew_availability to authenticated;
alter publication supabase_realtime add table public.crew_availability;

-- Crew can inspect gear; existing owner-only write policies remain in force.
create policy "members read company inventory" on public.company_inventory_items for select to authenticated
using (public.is_company_member(company_id, auth.uid()));
