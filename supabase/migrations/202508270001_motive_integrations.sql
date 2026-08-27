-- Motive credentials stay server-only. Edge Functions encrypt and access this table
-- through service-role credentials; browser clients receive connection metadata only.
create table public.company_motive_integrations (
  company_id uuid primary key references public.companies(id) on delete cascade,
  encrypted_api_key text not null,
  encryption_iv text not null,
  key_last_four text not null check (char_length(key_last_four) = 4),
  connected_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(user_id)
);

alter table public.company_motive_integrations enable row level security;
revoke all on public.company_motive_integrations from public, anon, authenticated;
grant all on public.company_motive_integrations to service_role;

create trigger company_motive_integrations_touch_updated_at
before update on public.company_motive_integrations
for each row execute function public.touch_updated_at();

comment on table public.company_motive_integrations is
  'Server-only encrypted Motive API credentials. Never expose encrypted values to browser clients.';
