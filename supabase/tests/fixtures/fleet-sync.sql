-- Minimal Supabase boundary for embedded PostgreSQL tests. Not a substitute for
-- running the entire migration chain against the deployment's Postgres version.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '');
$$;
grant usage on schema public, auth to authenticated, service_role, anon;
create table public.profiles (user_id uuid primary key, full_name text);
create table public.companies (id uuid primary key);
create table public.company_members (
  company_id uuid references public.companies(id) on delete cascade,
  user_id uuid references public.profiles(user_id), role text not null,
  primary key (company_id, user_id)
);
create function public.is_system_admin() returns boolean language sql stable as $$ select false; $$;
create function public.has_system_admin_company_access(uuid) returns boolean language sql stable as $$ select false; $$;
create function public.is_company_member(target_company_id uuid, target_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.company_members where company_id = target_company_id and user_id = target_user_id);
$$;
create function public.touch_updated_at() returns trigger language plpgsql as $$
  begin new.updated_at := now(); return new; end;
$$;

-- Observe a representative transactional side effect without loading the push
-- delivery subsystem. Retries must not emit another event; failures undo it.
create table public.sync_test_effects (id bigint generated always as identity, action text);
create function public.sync_test_effect() returns trigger language plpgsql security definer set search_path = '' as $$
  begin insert into public.sync_test_effects(action) values (tg_op); return null; end;
$$;
