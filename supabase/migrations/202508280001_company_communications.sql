-- Company forum threads, replies, and per-user read state.

create table public.communication_threads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  subject text not null check (char_length(trim(subject)) between 1 and 160),
  description text not null check (char_length(trim(description)) between 1 and 5000),
  created_by uuid references public.profiles(user_id) on delete set null,
  created_by_name text not null,
  created_by_role text not null check (created_by_role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  unique (company_id, id)
);

create table public.communication_replies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  thread_id uuid not null,
  body text not null check (char_length(trim(body)) between 1 and 5000),
  created_by uuid references public.profiles(user_id) on delete set null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  foreign key (company_id, thread_id) references public.communication_threads(company_id, id) on delete cascade
);

create table public.communication_reads (
  company_id uuid not null references public.companies(id) on delete cascade,
  thread_id uuid not null,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (company_id, thread_id, user_id),
  foreign key (company_id, thread_id) references public.communication_threads(company_id, id) on delete cascade
);

create index communication_threads_company_created_idx on public.communication_threads (company_id, created_at desc);
create index communication_replies_thread_created_idx on public.communication_replies (company_id, thread_id, created_at);

create or replace function public.attribute_company_communication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare actor_name text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.is_company_member(new.company_id, auth.uid()) and not public.has_system_admin_company_access(new.company_id) then
    raise exception 'Company access required' using errcode = '42501';
  end if;
  select profile.full_name into actor_name from public.profiles profile where profile.user_id = auth.uid();
  new.created_by := auth.uid();
  new.created_by_name := coalesce(nullif(trim(actor_name), ''), 'FireOps user');
  if tg_table_name = 'communication_threads' then
    new.created_by_role := case when public.is_company_owner(new.company_id, auth.uid()) then 'owner' else 'member' end;
  end if;
  return new;
end;
$$;
revoke all on function public.attribute_company_communication() from public, anon, authenticated;

create trigger communication_threads_attribution before insert on public.communication_threads
for each row execute function public.attribute_company_communication();
create trigger communication_replies_attribution before insert on public.communication_replies
for each row execute function public.attribute_company_communication();

alter table public.communication_threads enable row level security;
alter table public.communication_replies enable row level security;
alter table public.communication_reads enable row level security;

create policy "company reads communication threads" on public.communication_threads for select to authenticated
using (public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id));
create policy "company creates communication threads" on public.communication_threads for insert to authenticated
with check ((public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id)) and created_by = auth.uid());

create policy "company reads communication replies" on public.communication_replies for select to authenticated
using (public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id));
create policy "company creates communication replies" on public.communication_replies for insert to authenticated
with check ((public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id)) and created_by = auth.uid());

create policy "users read own communication state" on public.communication_reads for select to authenticated
using (user_id = auth.uid() and (public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id)));
create policy "users create own communication state" on public.communication_reads for insert to authenticated
with check (user_id = auth.uid() and (public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id)));
create policy "users update own communication state" on public.communication_reads for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid() and (public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id)));

revoke all on public.communication_threads, public.communication_replies, public.communication_reads from anon;
grant select, insert on public.communication_threads, public.communication_replies to authenticated;
grant select, insert, update on public.communication_reads to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'communication_threads'
  ) then alter publication supabase_realtime add table public.communication_threads; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'communication_replies'
  ) then alter publication supabase_realtime add table public.communication_replies; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'communication_reads'
  ) then alter publication supabase_realtime add table public.communication_reads; end if;
end $$;
