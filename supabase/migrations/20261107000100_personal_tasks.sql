-- Personal tasks are private, including from other company managers.
create table public.personal_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(user_id) on delete cascade,
  subject text not null check (char_length(trim(subject)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 5000),
  due_date date not null,
  created_at timestamptz not null default now()
);
create index personal_tasks_user_due_idx on public.personal_tasks(company_id, user_id, due_date, created_at);
alter table public.personal_tasks enable row level security;

create policy "eligible users read own tasks" on public.personal_tasks
for select to authenticated using (
  user_id = (select auth.uid()) and exists (
    select 1 from public.company_members m
    where m.company_id = personal_tasks.company_id and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin', 'shop_tech')
  )
);
create policy "eligible users create own tasks" on public.personal_tasks
for insert to authenticated with check (
  user_id = (select auth.uid()) and exists (
    select 1 from public.company_members m
    where m.company_id = personal_tasks.company_id and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin', 'shop_tech')
  )
);
-- Completing a task deletes it; completed-task history is intentionally not stored.
create policy "eligible users remove own tasks" on public.personal_tasks
for delete to authenticated using (
  user_id = (select auth.uid()) and exists (
    select 1 from public.company_members m
    where m.company_id = personal_tasks.company_id and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin', 'shop_tech')
  )
);
revoke all on public.personal_tasks from anon, authenticated;
grant select, insert, delete on public.personal_tasks to authenticated;
grant all on public.personal_tasks to service_role;
