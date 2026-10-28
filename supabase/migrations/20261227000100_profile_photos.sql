-- Each user may upload a photo of themselves from Settings. Photos live in a
-- private bucket under the user's own id folder; coworkers in any shared
-- company may read them so the photo can be shown alongside their name.
begin;

alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles drop constraint if exists profiles_avatar_path_owner_check;
alter table public.profiles add constraint profiles_avatar_path_owner_check
  check (avatar_path is null or avatar_path like user_id::text || '/%');
grant update (avatar_path) on public.profiles to authenticated;

create or replace function public.shares_company(first_user uuid, second_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.company_members a
    join public.company_members b on b.company_id = a.company_id
    where a.user_id = first_user and b.user_id = second_user
  );
$$;
revoke all on function public.shares_company(uuid, uuid) from public;
grant execute on function public.shares_company(uuid, uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-photos',
  'profile-photos',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "users read permitted profile photos" on storage.objects;
create policy "users read permitted profile photos" on storage.objects
for select to authenticated
using (
  bucket_id = 'profile-photos'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then (storage.foldername(name))[1] = auth.uid()::text
      or public.shares_company(((storage.foldername(name))[1])::uuid, auth.uid())
    else false
  end
);

drop policy if exists "users upload own profile photos" on storage.objects;
create policy "users upload own profile photos" on storage.objects
for insert to authenticated
with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users remove own profile photos" on storage.objects;
create policy "users remove own profile photos" on storage.objects
for delete to authenticated
using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);

commit;
