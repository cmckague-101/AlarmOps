-- Digital payroll forms replace payroll file uploads. Submitted forms are immutable.
create table public.payroll_forms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_by_name text not null check (char_length(created_by_name) between 1 and 160),
  engine_number text not null default '' check (char_length(engine_number) <= 160),
  incidents text not null default '' check (char_length(incidents) <= 500),
  rows jsonb not null check (jsonb_typeof(rows) = 'array' and jsonb_array_length(rows) = 21),
  status text not null default 'draft' check (status in ('draft', 'pending', 'approved')),
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'draft' and submitted_at is null) or (status <> 'draft' and submitted_at is not null)),
  check ((status = 'approved' and approved_at is not null and approved_by is not null) or (status <> 'approved' and approved_at is null and approved_by is null))
);

create unique index payroll_forms_one_draft_per_user on public.payroll_forms(company_id, created_by) where status = 'draft';
create index payroll_forms_company_year_status on public.payroll_forms(company_id, created_at desc, status);

create or replace function public.protect_payroll_form()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.created_by <> auth.uid() or not public.is_company_member(new.company_id, auth.uid()) then
      raise exception 'Company membership required' using errcode = '42501';
    end if;
    new.status := 'draft'; new.submitted_at := null; new.approved_at := null; new.approved_by := null;
    return new;
  end if;

  if old.status = 'approved' then raise exception 'Approved payroll is read only' using errcode = '42501'; end if;
  if old.status = 'pending' then
    if not (public.is_company_owner(old.company_id, auth.uid()) or public.has_system_admin_company_access(old.company_id))
       or new.status <> 'approved' then
      raise exception 'Submitted payroll is read only' using errcode = '42501';
    end if;
    new.company_id := old.company_id; new.created_by := old.created_by; new.created_by_name := old.created_by_name;
    new.engine_number := old.engine_number; new.incidents := old.incidents; new.rows := old.rows;
    new.submitted_at := old.submitted_at; new.approved_at := now(); new.approved_by := auth.uid();
    return new;
  end if;

  if old.created_by <> auth.uid() then raise exception 'Only creator can edit draft payroll' using errcode = '42501'; end if;
  new.company_id := old.company_id; new.created_by := old.created_by; new.created_by_name := old.created_by_name;
  if new.status = 'pending' then new.submitted_at := now();
  elsif new.status <> 'draft' then raise exception 'Invalid payroll status';
  end if;
  return new;
end $$;

create trigger payroll_forms_protect before insert or update on public.payroll_forms
for each row execute function public.protect_payroll_form();
create trigger payroll_forms_touch before update on public.payroll_forms
for each row execute function public.touch_updated_at();

alter table public.payroll_forms enable row level security;
create policy "users read permitted payroll" on public.payroll_forms for select to authenticated using (
  public.is_company_owner(company_id, auth.uid()) or public.has_system_admin_company_access(company_id) or created_by = auth.uid()
);
create policy "members create payroll drafts" on public.payroll_forms for insert to authenticated with check (
  public.is_company_member(company_id, auth.uid()) and created_by = auth.uid()
);
create policy "creators and managers update payroll" on public.payroll_forms for update to authenticated using (
  created_by = auth.uid() or public.is_company_owner(company_id, auth.uid()) or public.has_system_admin_company_access(company_id)
) with check (
  created_by = auth.uid() or public.is_company_owner(company_id, auth.uid()) or public.has_system_admin_company_access(company_id)
);
revoke all on public.payroll_forms from anon, authenticated;
grant select, insert, update on public.payroll_forms to authenticated;

create or replace function public.notify_pending_payroll()
returns trigger language plpgsql security definer set search_path = '' as $$
declare manager record;
begin
  if new.status = 'pending' and old.status = 'draft' then
    for manager in select user_id from public.company_members where company_id = new.company_id and role in ('owner', 'admin') loop
      perform public.create_user_notification(new.company_id, manager.user_id, new.created_by, 'system', 'system', new.id,
        'Payroll awaiting approval', new.created_by_name || ' submitted payroll for approval.', '/payroll',
        'payroll:' || new.id::text, 'payroll-pending:' || new.id::text);
    end loop;
  end if;
  return new;
end $$;
create trigger payroll_forms_pending_notification after update of status on public.payroll_forms
for each row execute function public.notify_pending_payroll();

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.payroll_forms;
  end if;
exception when duplicate_object then null; end $$;
