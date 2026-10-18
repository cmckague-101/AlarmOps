-- In-app feedback submitted by authenticated company users.
create table public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  submitted_by uuid not null default auth.uid() references public.profiles(user_id) on delete cascade,
  category text not null check (category in ('idea', 'issue', 'other')),
  message text not null check (char_length(trim(message)) between 1 and 5000),
  source text not null check (source in ('web', 'ios', 'android')),
  created_at timestamptz not null default now()
);

create index app_feedback_created_at_idx on public.app_feedback(created_at desc);
create index app_feedback_company_created_at_idx on public.app_feedback(company_id, created_at desc);

alter table public.app_feedback enable row level security;

create policy "company users submit app feedback" on public.app_feedback
for insert to authenticated
with check (
  submitted_by = (select auth.uid())
  and (
    public.is_company_member(company_id, (select auth.uid()))
    or public.has_system_admin_company_access(company_id)
  )
);

create policy "system admins read app feedback" on public.app_feedback
for select to authenticated
using (public.is_system_admin());

grant select, insert on public.app_feedback to authenticated;
