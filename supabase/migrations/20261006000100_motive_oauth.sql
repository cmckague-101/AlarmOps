-- Replace legacy API-key authentication with company-scoped Motive OAuth credentials.
-- Existing API keys cannot be converted to OAuth credentials, so affected companies reconnect.
delete from public.company_motive_integrations;

alter table public.company_motive_integrations
  drop column encrypted_api_key,
  drop column encryption_iv,
  drop column key_last_four,
  add column encrypted_client_id text not null,
  add column client_id_iv text not null,
  add column encrypted_client_secret text not null,
  add column client_secret_iv text not null,
  add column client_id_last_four text not null check (char_length(client_id_last_four) = 4),
  add column encrypted_access_token text,
  add column access_token_iv text,
  add column encrypted_refresh_token text,
  add column refresh_token_iv text,
  add column token_expires_at timestamptz,
  add column scopes text not null default '',
  add column motive_company_id text,
  alter column connected_at drop not null,
  alter column connected_at drop default,
  alter column last_verified_at drop not null,
  alter column last_verified_at drop default,
  add constraint motive_access_token_pair check ((encrypted_access_token is null) = (access_token_iv is null)),
  add constraint motive_refresh_token_pair check ((encrypted_refresh_token is null) = (refresh_token_iv is null));

comment on table public.company_motive_integrations is
  'Server-only encrypted, company-scoped Motive OAuth credentials and tokens. Never expose encrypted values to clients.';

create table public.company_motive_oauth_states (
  state uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  return_to text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index company_motive_oauth_states_company_idx
  on public.company_motive_oauth_states(company_id);
create index company_motive_oauth_states_expiry_idx
  on public.company_motive_oauth_states(expires_at);

alter table public.company_motive_oauth_states enable row level security;
revoke all on public.company_motive_oauth_states from public, anon, authenticated;
grant all on public.company_motive_oauth_states to service_role;

comment on table public.company_motive_oauth_states is
  'Server-only, single-use Motive OAuth state records used to bind callbacks to a company and initiating owner.';
