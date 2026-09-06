-- Immutable company expense receipts. Crew can access their own; owners can access all.

create table public.company_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  amount_cents bigint not null check (amount_cents between 1 and 100000000),
  original_file_name text not null check (char_length(trim(original_file_name)) between 1 and 255),
  mime_type text not null,
  byte_size bigint not null check (byte_size between 1 and 10485760),
  storage_path text not null unique,
  uploaded_by uuid not null references public.profiles(user_id) on delete restrict,
  uploaded_by_name text not null,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);

create index company_receipts_company_created_idx
  on public.company_receipts (company_id, created_at desc);
create index company_receipts_uploader_created_idx
  on public.company_receipts (company_id, uploaded_by, created_at desc);

create or replace function public.attribute_company_receipt()
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
  new.created_at := now();
  return new;
end;
$$;
revoke all on function public.attribute_company_receipt() from public, anon, authenticated;

create trigger company_receipts_attribution
before insert on public.company_receipts
for each row execute function public.attribute_company_receipt();

alter table public.company_receipts enable row level security;

create policy "users read permitted receipts" on public.company_receipts
for select to authenticated
using (
  public.has_system_admin_company_access(company_id)
  or public.is_company_owner(company_id, auth.uid())
  or (public.is_company_member(company_id, auth.uid()) and uploaded_by = auth.uid())
);

create policy "members create own receipts" on public.company_receipts
for insert to authenticated
with check (
  (public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id))
  and uploaded_by = auth.uid()
);

revoke all on public.company_receipts from anon;
grant select, insert on public.company_receipts to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipt-files',
  'receipt-files',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "users read permitted receipt files" on storage.objects
for select to authenticated
using (
  bucket_id = 'receipt-files'
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

create policy "members upload own receipt files" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'receipt-files'
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

-- Uploaders may remove an orphan only from their own folder. Saved receipt rows remain immutable.
create policy "uploaders remove own receipt files" on storage.objects
for delete to authenticated
using (
  bucket_id = 'receipt-files'
  and (storage.foldername(name))[2] = auth.uid()::text
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then (
      public.is_company_member(((storage.foldername(name))[1])::uuid, auth.uid())
      or public.has_system_admin_company_access(((storage.foldername(name))[1])::uuid)
    )
    and not exists (
      select 1 from public.company_receipts receipt where receipt.storage_path = name
    )
    else false
  end
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'company_receipts'
  ) then
    alter publication supabase_realtime add table public.company_receipts;
  end if;
end $$;
