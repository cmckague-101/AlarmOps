-- Dashboard layout is private to each user and follows them across devices.
create table public.dashboard_preferences (
  user_id uuid primary key default auth.uid() references public.profiles(user_id) on delete cascade,
  items jsonb not null default '{}'::jsonb check (jsonb_typeof(items) = 'object')
);
alter table public.dashboard_preferences enable row level security;
create policy "users read own dashboard preferences" on public.dashboard_preferences
  for select to authenticated using (user_id = (select auth.uid()));
create policy "users create own dashboard preferences" on public.dashboard_preferences
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "users update own dashboard preferences" on public.dashboard_preferences
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.dashboard_preferences from anon, authenticated;
grant select, insert, update on public.dashboard_preferences to authenticated;
grant all on public.dashboard_preferences to service_role;
