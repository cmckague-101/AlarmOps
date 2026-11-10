-- Paid voice add-on; enabled only by staff SQL. No audio or transcripts stored.
begin;
alter table public.companies add column assistant_voice_enabled boolean not null default false;
create table public.assistant_voice_usage (
 id bigint generated always as identity primary key,
 company_id uuid not null references public.companies(id) on delete cascade,
 user_id uuid not null references public.profiles(user_id) on delete cascade,
 kind text not null check (kind in ('stt','tts')),
 created_at timestamptz not null default now()
);
create index assistant_voice_company_created_idx on public.assistant_voice_usage(company_id,created_at desc);
create index assistant_voice_user_created_idx on public.assistant_voice_usage(user_id,created_at desc);
alter table public.assistant_voice_usage enable row level security;
revoke all on public.assistant_voice_usage from public,anon,authenticated;
create function public.claim_assistant_voice(company uuid, actor uuid, kind text)
returns text language plpgsql volatile security definer set search_path = '' as $$
begin
 if kind not in ('stt','tts') or kind is null then raise exception 'Invalid voice kind'; end if;
 if not exists(select 1 from public.company_members m where m.company_id=company and m.user_id=actor) then return 'disabled'; end if;
 if not coalesce((select c.assistant_enabled and c.assistant_voice_enabled from public.companies c where c.id=company),false) then return 'disabled'; end if;
 -- Lock both scopes: a person may belong to multiple companies.
 perform pg_advisory_xact_lock(hashtextextended('assistant_voice_user:'||actor::text,0));
 perform pg_advisory_xact_lock(hashtextextended('assistant_voice_company:'||company::text,0));
 if (select count(*) from public.assistant_voice_usage u where u.user_id=actor and u.created_at>now()-interval '24 hours')>=200
 or (select count(*) from public.assistant_voice_usage u where u.company_id=company and u.created_at>now()-interval '24 hours')>=2000 then return 'limit'; end if;
 insert into public.assistant_voice_usage(company_id,user_id,kind) values(company,actor,kind);
 return 'ok';
end; $$;
revoke all on function public.claim_assistant_voice(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_assistant_voice(uuid,uuid,text) to service_role;
commit;
