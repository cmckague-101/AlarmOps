-- Company documents and per-user view state.

create table public.company_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  file_name text not null check (char_length(trim(file_name)) between 1 and 255),
  mime_type text not null,
  storage_path text not null unique,
  created_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id)
);

create table public.company_document_reads (
  company_id uuid not null references public.companies(id) on delete cascade,
  document_id uuid not null,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (company_id, document_id, user_id),
  foreign key (company_id, document_id) references public.company_documents(company_id, id) on delete cascade
);

create index company_documents_company_updated_idx on public.company_documents (company_id, updated_at desc);

create or replace function public.attribute_company_document()
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
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.attribute_company_document() from public, anon, authenticated;

create trigger company_documents_attribution before insert or update on public.company_documents
for each row execute function public.attribute_company_document();

alter table public.company_documents enable row level security;
alter table public.company_document_reads enable row level security;

create policy "company reads documents" on public.company_documents for select to authenticated
using (public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id));
create policy "owners create documents" on public.company_documents for insert to authenticated
with check ((public.is_company_owner(company_id, auth.uid()) or public.has_system_admin_company_access(company_id)) and created_by = auth.uid());
create policy "owners update documents" on public.company_documents for update to authenticated
using (public.is_company_owner(company_id, auth.uid()) or public.has_system_admin_company_access(company_id))
with check (public.is_company_owner(company_id, auth.uid()) or public.has_system_admin_company_access(company_id));
create policy "owners delete documents" on public.company_documents for delete to authenticated
using (public.is_company_owner(company_id, auth.uid()) or public.has_system_admin_company_access(company_id));

create policy "users read own document state" on public.company_document_reads for select to authenticated
using (user_id = auth.uid() and (public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id)));
create policy "users create own document state" on public.company_document_reads for insert to authenticated
with check (user_id = auth.uid() and (public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id)));
create policy "users update own document state" on public.company_document_reads for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid() and (public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id)));

revoke all on public.company_documents, public.company_document_reads from anon;
grant select, insert, update, delete on public.company_documents to authenticated;
grant select, insert, update on public.company_document_reads to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'company_documents'
  ) then alter publication supabase_realtime add table public.company_documents; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'company_document_reads'
  ) then alter publication supabase_realtime add table public.company_document_reads; end if;
end $$;
