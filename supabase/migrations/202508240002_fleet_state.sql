create table public.fleet_state (
  company_id uuid primary key references public.companies(id) on delete cascade,
  data jsonb not null default '{"vehicles":[],"issues":[],"crew":[],"activities":[]}'::jsonb,
  updated_by uuid not null references public.profiles(user_id),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(data -> 'vehicles') = 'array'),
  check (jsonb_typeof(data -> 'issues') = 'array'),
  check (jsonb_typeof(data -> 'crew') = 'array'),
  check (jsonb_typeof(data -> 'activities') = 'array')
);

create trigger fleet_state_touch_updated_at before update on public.fleet_state
for each row execute function public.touch_updated_at();

alter table public.fleet_state enable row level security;

create policy "members read fleet state" on public.fleet_state
for select to authenticated
using (public.is_company_member(company_id, auth.uid()));

create policy "members create fleet state" on public.fleet_state
for insert to authenticated
with check (
  public.is_company_member(company_id, auth.uid())
  and updated_by = auth.uid()
);

create policy "members update fleet state" on public.fleet_state
for update to authenticated
using (public.is_company_member(company_id, auth.uid()))
with check (
  public.is_company_member(company_id, auth.uid())
  and updated_by = auth.uid()
);

revoke all on public.fleet_state from anon;
grant select, insert, update on public.fleet_state to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fleet-files',
  'fleet-files',
  false,
  8388608,
  array['image/jpeg','image/png','image/webp','image/gif','application/pdf']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "company members read fleet files" on storage.objects
for select to authenticated
using (
  bucket_id = 'fleet-files'
  and public.is_company_member(((storage.foldername(name))[1])::uuid, auth.uid())
);

create policy "company members upload fleet files" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'fleet-files'
  and public.is_company_member(((storage.foldername(name))[1])::uuid, auth.uid())
  and (storage.foldername(name))[2] = auth.uid()::text
);

create policy "uploaders delete own fleet files" on storage.objects
for delete to authenticated
using (
  bucket_id = 'fleet-files'
  and public.is_company_member(((storage.foldername(name))[1])::uuid, auth.uid())
  and (storage.foldername(name))[2] = auth.uid()::text
);
