-- FireOps Assistant chat (text only; voice is a later change).
-- * companies.assistant_enabled: paid add-on, turned on per company by FireOps
--   staff with SQL (no app setting). Every member of an enabled company gets
--   the assistant. Members can read the flag; nobody can change it through the
--   Data API.
-- * assistant_chat_usage: one row per allowed chat message, for billing review.
--   Not readable by app users.
-- * claim_assistant_chat(company, actor): called by the assistant-chat edge
--   function (service role only) before each Grok request. Caps protect the
--   shared API key: 100 messages per person and 1,000 per company in any rolling
--   24 hours. The assistant only reads company data with the caller's own
--   session (RLS) and never writes; drafts open in the app for the user to
--   review and submit. Chat history stays on the user's device.
begin;

alter table public.companies
  add column assistant_enabled boolean not null default false;

create table public.assistant_chat_usage (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default now()
);
create index assistant_chat_usage_company_created_idx on public.assistant_chat_usage (company_id, created_at desc);
create index assistant_chat_usage_user_created_idx on public.assistant_chat_usage (user_id, created_at desc);
alter table public.assistant_chat_usage enable row level security;
revoke all on public.assistant_chat_usage from public, anon, authenticated;

create or replace function public.claim_assistant_chat(company uuid, actor uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.company_members m where m.company_id = company and m.user_id = actor) then
    return 'not_member';
  end if;
  if not coalesce((select c.assistant_enabled from public.companies c where c.id = company), false) then
    return 'disabled';
  end if;
  -- Serialize claims per company so parallel messages cannot pass the caps together.
  perform pg_advisory_xact_lock(hashtextextended('assistant_chat:' || company::text, 0));
  if (select count(*) from public.assistant_chat_usage u where u.user_id = actor and u.created_at > now() - interval '24 hours') >= 100
    or (select count(*) from public.assistant_chat_usage u where u.company_id = company and u.created_at > now() - interval '24 hours') >= 1000 then
    return 'limit';
  end if;
  insert into public.assistant_chat_usage (company_id, user_id) values (company, actor);
  return 'ok';
end;
$$;
revoke all on function public.claim_assistant_chat(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_assistant_chat(uuid, uuid) to service_role;

commit;
