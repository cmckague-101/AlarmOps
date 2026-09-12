-- Private invoice and payroll document archives.
-- Immutable company expense invoices. Crew can access their own; owners can access all.

create table public.company_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  original_file_name text not null check (char_length(trim(original_file_name)) between 1 and 255),
  mime_type text not null,
  byte_size bigint not null check (byte_size between 1 and 10485760),
  storage_path text not null unique,
  uploaded_by uuid not null references public.profiles(user_id) on delete restrict,
  uploaded_by_name text not null,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);

create index company_invoices_company_created_idx
  on public.company_invoices (company_id, created_at desc);
create index company_invoices_uploader_created_idx
  on public.company_invoices (company_id, uploaded_by, created_at desc);

create or replace function public.attribute_company_invoices()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare actor_name text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.is_company_member(new.company_id, auth.uid())
    and not public.has_system_admin_company_access(new.company_id)
  then
    raise exception 'Company access required' using errcode = '42501';
  end if;

  select nullif(trim(full_name), '') into actor_name
  from public.profiles where user_id = auth.uid();

  new.uploaded_by := auth.uid();
  new.uploaded_by_name := coalesce(actor_name, 'Crew member');
  if split_part(new.storage_path, '/', 1) <> new.company_id::text
    or split_part(new.storage_path, '/', 2) <> auth.uid()::text then
    raise exception 'File must belong to uploader' using errcode = '42501';
  end if;
  new.created_at := now();
  return new;
end;
$$;
revoke all on function public.attribute_company_invoices() from public, anon, authenticated;

create trigger company_invoices_attribution
before insert on public.company_invoices
for each row execute function public.attribute_company_invoices();

alter table public.company_invoices enable row level security;

create policy "users read permitted invoices" on public.company_invoices
for select to authenticated
using (
  public.has_system_admin_company_access(company_id)
  or public.is_company_owner(company_id, auth.uid())
  or (public.is_company_member(company_id, auth.uid()) and uploaded_by = auth.uid())
);

create policy "members create own invoices" on public.company_invoices
for insert to authenticated
with check (
  (public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id))
  and uploaded_by = auth.uid()
);

revoke all on public.company_invoices from anon;
grant select, insert on public.company_invoices to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'invoices-files',
  'invoices-files',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "users read permitted invoices files" on storage.objects
for select to authenticated
using (
  bucket_id = 'invoices-files'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then public.has_system_admin_company_access(((storage.foldername(name))[1])::uuid)
      or public.is_company_owner(((storage.foldername(name))[1])::uuid, auth.uid())
      or (
        public.is_company_member(((storage.foldername(name))[1])::uuid, auth.uid())
        and (storage.foldername(name))[2] = auth.uid()::text
      )
    else false
  end
);

create policy "members upload own invoices files" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'invoices-files'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then (
      public.is_company_member(((storage.foldername(name))[1])::uuid, auth.uid())
      or public.has_system_admin_company_access(((storage.foldername(name))[1])::uuid)
    )
    and (storage.foldername(name))[2] = auth.uid()::text
    else false
  end
);

-- Uploaders may remove an orphan only from their own folder. Saved invoices rows remain immutable.
create policy "uploaders remove own invoices files" on storage.objects
for delete to authenticated
using (
  bucket_id = 'invoices-files'
  and (storage.foldername(name))[2] = auth.uid()::text
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then (
      public.is_company_member(((storage.foldername(name))[1])::uuid, auth.uid())
      or public.has_system_admin_company_access(((storage.foldername(name))[1])::uuid)
    )
    and not exists (
      select 1 from public.company_invoices invoices where invoices.storage_path = name
    )
    else false
  end
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'company_invoices'
  ) then
    alter publication supabase_realtime add table public.company_invoices;
  end if;
end $$;

-- Company owners can correct invoices metadata and remove invoices and their files.

create policy "owners update company invoices" on public.company_invoices
for update to authenticated
using (
  public.is_company_owner(company_id, auth.uid())
  or public.has_system_admin_company_access(company_id)
)
with check (
  public.is_company_owner(company_id, auth.uid())
  or public.has_system_admin_company_access(company_id)
);

create policy "owners delete company invoices" on public.company_invoices
for delete to authenticated
using (
  public.is_company_owner(company_id, auth.uid())
  or public.has_system_admin_company_access(company_id)
);

grant update (name) on public.company_invoices to authenticated;
grant delete on public.company_invoices to authenticated;

create policy "owners remove company invoices files" on storage.objects
for delete to authenticated
using (
  bucket_id = 'invoices-files'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then public.is_company_owner(((storage.foldername(name))[1])::uuid, auth.uid())
      or public.has_system_admin_company_access(((storage.foldername(name))[1])::uuid)
    else false
  end
);
-- Immutable company expense payroll. Crew can access their own; owners can access all.

create table public.company_payroll (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  original_file_name text not null check (char_length(trim(original_file_name)) between 1 and 255),
  mime_type text not null,
  byte_size bigint not null check (byte_size between 1 and 10485760),
  storage_path text not null unique,
  uploaded_by uuid not null references public.profiles(user_id) on delete restrict,
  uploaded_by_name text not null,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);

create index company_payroll_company_created_idx
  on public.company_payroll (company_id, created_at desc);
create index company_payroll_uploader_created_idx
  on public.company_payroll (company_id, uploaded_by, created_at desc);

create or replace function public.attribute_company_payroll()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare actor_name text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.is_company_member(new.company_id, auth.uid())
    and not public.has_system_admin_company_access(new.company_id)
  then
    raise exception 'Company access required' using errcode = '42501';
  end if;

  select nullif(trim(full_name), '') into actor_name
  from public.profiles where user_id = auth.uid();

  new.uploaded_by := auth.uid();
  new.uploaded_by_name := coalesce(actor_name, 'Crew member');
  if split_part(new.storage_path, '/', 1) <> new.company_id::text
    or split_part(new.storage_path, '/', 2) <> auth.uid()::text then
    raise exception 'File must belong to uploader' using errcode = '42501';
  end if;
  new.created_at := now();
  return new;
end;
$$;
revoke all on function public.attribute_company_payroll() from public, anon, authenticated;

create trigger company_payroll_attribution
before insert on public.company_payroll
for each row execute function public.attribute_company_payroll();

alter table public.company_payroll enable row level security;

create policy "users read permitted payroll" on public.company_payroll
for select to authenticated
using (
  public.has_system_admin_company_access(company_id)
  or public.is_company_owner(company_id, auth.uid())
  or (public.is_company_member(company_id, auth.uid()) and uploaded_by = auth.uid())
);

create policy "members create own payroll" on public.company_payroll
for insert to authenticated
with check (
  (public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id))
  and uploaded_by = auth.uid()
);

revoke all on public.company_payroll from anon;
grant select, insert on public.company_payroll to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payroll-files',
  'payroll-files',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "users read permitted payroll files" on storage.objects
for select to authenticated
using (
  bucket_id = 'payroll-files'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then public.has_system_admin_company_access(((storage.foldername(name))[1])::uuid)
      or public.is_company_owner(((storage.foldername(name))[1])::uuid, auth.uid())
      or (
        public.is_company_member(((storage.foldername(name))[1])::uuid, auth.uid())
        and (storage.foldername(name))[2] = auth.uid()::text
      )
    else false
  end
);

create policy "members upload own payroll files" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'payroll-files'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then (
      public.is_company_member(((storage.foldername(name))[1])::uuid, auth.uid())
      or public.has_system_admin_company_access(((storage.foldername(name))[1])::uuid)
    )
    and (storage.foldername(name))[2] = auth.uid()::text
    else false
  end
);

-- Uploaders may remove an orphan only from their own folder. Saved payroll rows remain immutable.
create policy "uploaders remove own payroll files" on storage.objects
for delete to authenticated
using (
  bucket_id = 'payroll-files'
  and (storage.foldername(name))[2] = auth.uid()::text
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then (
      public.is_company_member(((storage.foldername(name))[1])::uuid, auth.uid())
      or public.has_system_admin_company_access(((storage.foldername(name))[1])::uuid)
    )
    and not exists (
      select 1 from public.company_payroll payroll where payroll.storage_path = name
    )
    else false
  end
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'company_payroll'
  ) then
    alter publication supabase_realtime add table public.company_payroll;
  end if;
end $$;

-- Company owners can correct payroll metadata and remove payroll and their files.

create policy "owners update company payroll" on public.company_payroll
for update to authenticated
using (
  public.is_company_owner(company_id, auth.uid())
  or public.has_system_admin_company_access(company_id)
)
with check (
  public.is_company_owner(company_id, auth.uid())
  or public.has_system_admin_company_access(company_id)
);

create policy "owners delete company payroll" on public.company_payroll
for delete to authenticated
using (
  public.is_company_owner(company_id, auth.uid())
  or public.has_system_admin_company_access(company_id)
);

grant update (name) on public.company_payroll to authenticated;
grant delete on public.company_payroll to authenticated;

create policy "owners remove company payroll files" on storage.objects
for delete to authenticated
using (
  bucket_id = 'payroll-files'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then public.is_company_owner(((storage.foldername(name))[1])::uuid, auth.uid())
      or public.has_system_admin_company_access(((storage.foldername(name))[1])::uuid)
    else false
  end
);
