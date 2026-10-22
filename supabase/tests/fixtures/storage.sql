-- Minimal Supabase Storage metadata boundary for embedded PostgreSQL tests.
-- It exercises storage.objects RLS only: no Storage API, byte transfer, upsert
-- header semantics or service implementation. Validate on real Supabase too.
create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean not null default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,
  owner_id text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket_id, name)
);
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare parts text[] := string_to_array(name, '/');
begin return parts[1:array_length(parts, 1) - 1]; end;
$$;
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.buckets to authenticated, service_role;
