-- Server-only encrypted credentials for QuickBooks, Manitou, SedonaOffice, Motive, and Verizon Connect.
-- Authenticated clients cannot read this table. The integration-vault function returns masked last-four values.

create table public.company_integration_credentials (
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null check (provider in ('quickbooks', 'manitou', 'sedona', 'motive', 'verizon_connect')),
  status text not null check (status in ('connected', 'disconnected', 'error')),
  public_config jsonb not null default '{}'::jsonb,
  encrypted_secrets jsonb not null default '[]'::jsonb,
  updated_by uuid,
  updated_by_name text not null default '',
  updated_at timestamptz not null default now(),
  last_tested_at timestamptz,
  last_test_ok boolean,
  last_test_message text,
  primary key (company_id, provider)
);

alter table public.company_integration_credentials enable row level security;
revoke all on public.company_integration_credentials from public, anon, authenticated;
grant all on public.company_integration_credentials to service_role;

comment on table public.company_integration_credentials is
  'Server-only AES-GCM integration credentials. Clients receive masked last-four values from integration-vault, never ciphertext or secrets.';
