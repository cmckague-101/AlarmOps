create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  device_name text,
  app_version text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_tokens_user_id_idx
  on public.push_tokens (user_id)
  where enabled;

alter table public.push_tokens enable row level security;

grant select, delete on public.push_tokens to authenticated;

create policy "Users can read their own push tokens"
  on public.push_tokens
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can delete their own push tokens"
  on public.push_tokens
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- One device token belongs to only one user. Re-registering after an account
-- change safely transfers ownership to the currently authenticated user.
create or replace function public.register_push_token(
  p_expo_push_token text,
  p_platform text,
  p_device_name text default null,
  p_app_version text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_expo_push_token is null
     or not (
       p_expo_push_token like 'ExponentPushToken[%]'
       or p_expo_push_token like 'ExpoPushToken[%]'
     ) then
    raise exception 'Invalid Expo push token';
  end if;

  if p_platform not in ('ios', 'android') then
    raise exception 'Invalid mobile platform';
  end if;

  insert into public.push_tokens (
    user_id,
    expo_push_token,
    platform,
    device_name,
    app_version,
    enabled,
    last_seen_at
  )
  values (
    current_user_id,
    p_expo_push_token,
    p_platform,
    p_device_name,
    p_app_version,
    true,
    now()
  )
  on conflict (expo_push_token) do update
  set user_id = excluded.user_id,
      platform = excluded.platform,
      device_name = excluded.device_name,
      app_version = excluded.app_version,
      enabled = true,
      last_seen_at = now();
end;
$$;

create or replace function public.unregister_push_token(p_expo_push_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tokens
  where user_id = auth.uid()
    and expo_push_token = p_expo_push_token;
$$;

revoke all on function public.register_push_token(text, text, text, text) from public;
revoke all on function public.unregister_push_token(text) from public;
grant execute on function public.register_push_token(text, text, text, text) to authenticated;
grant execute on function public.unregister_push_token(text) to authenticated;
