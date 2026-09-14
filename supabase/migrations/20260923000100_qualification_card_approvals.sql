-- Saved signatures and owner-approved incident qualification cards.

alter table public.profiles add column signature_data jsonb;
grant update (signature_data) on public.profiles to authenticated;

create table public.qualification_card_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  crew_user_id uuid not null references public.profiles(user_id) on delete cascade,
  crew_name text not null,
  card_data jsonb not null,
  photo_path text not null,
  employee_signature jsonb not null,
  owner_signature jsonb,
  owner_user_id uuid references public.profiles(user_id) on delete set null,
  owner_name text,
  status text not null default 'pending' check (status in ('pending','approved','superseded')),
  submitted_at timestamptz not null default now(),
  approved_at timestamptz,
  updated_at timestamptz not null default now()
);
create index qualification_card_requests_company_status_idx on public.qualification_card_requests(company_id,status,submitted_at desc);
create index qualification_card_requests_crew_idx on public.qualification_card_requests(company_id,crew_user_id,submitted_at desc);
create trigger qualification_card_requests_touch_updated_at before update on public.qualification_card_requests for each row execute function public.touch_updated_at();
alter table public.qualification_card_requests enable row level security;
create policy "crew read own qualification card requests" on public.qualification_card_requests for select to authenticated
  using (crew_user_id=auth.uid() and public.is_company_member(company_id,auth.uid()));
create policy "owners read company qualification card requests" on public.qualification_card_requests for select to authenticated
  using (public.is_company_owner(company_id,auth.uid()) or public.has_system_admin_company_access(company_id));
revoke all on public.qualification_card_requests from public,anon,authenticated;
grant select on public.qualification_card_requests to authenticated;

create or replace function public.valid_signature(signature jsonb)
returns boolean language sql immutable set search_path='' as $$
  select jsonb_typeof(signature)='object'
    and jsonb_typeof(signature->'strokes')='array'
    and jsonb_array_length(signature->'strokes') between 1 and 40
    and octet_length(signature::text) <= 100000
    and exists (
      select 1 from jsonb_array_elements(signature->'strokes') stroke
      where jsonb_typeof(stroke)='array' and jsonb_array_length(stroke)>1
    );
$$;
revoke all on function public.valid_signature(jsonb) from public,anon,authenticated;

create or replace function public.submit_qualification_card_request(target_company_id uuid,card_data jsonb,employee_signature jsonb,photo_path text)
returns public.qualification_card_requests
language plpgsql security definer set search_path=''
as $$
declare result public.qualification_card_requests; actor_name text;
begin
  if not public.is_company_member(target_company_id,auth.uid()) then raise exception 'Company membership required' using errcode='42501'; end if;
  if not public.valid_signature(employee_signature) then raise exception 'Employee signature is required'; end if;
  if jsonb_typeof(card_data)<>'object'
    or length(trim(coalesce(card_data->>'companyPhone',''))) not between 1 and 40
    or length(trim(coalesce(card_data->>'homeBase',''))) not between 1 and 160
    or length(trim(coalesce(card_data->>'primaryQualificationId',''))) not between 1 and 200
    then raise exception 'Qualification card details are invalid'; end if;
  if photo_path is null or photo_path not like target_company_id::text||'/'||auth.uid()::text||'/%' or length(photo_path)>500 then raise exception 'Qualification card photo is invalid'; end if;
  update public.qualification_card_requests set status='superseded'
    where company_id=target_company_id and crew_user_id=auth.uid() and status='pending';
  update public.profiles set signature_data=employee_signature where user_id=auth.uid();
  actor_name:=coalesce(public.notification_actor_name(auth.uid()),'Crew member');
  insert into public.qualification_card_requests(company_id,crew_user_id,crew_name,card_data,photo_path,employee_signature)
    values(target_company_id,auth.uid(),actor_name,jsonb_build_object('companyPhone',trim(card_data->>'companyPhone'),'homeBase',trim(card_data->>'homeBase'),'primaryQualificationId',card_data->>'primaryQualificationId'),photo_path,employee_signature)
    returning * into result;
  perform public.create_user_notification(target_company_id,member.user_id,auth.uid(),'system','system',result.id,
    'Qualification card approval requested',actor_name||' submitted an incident qualification card for approval.',
    '/qualifications/card?request='||result.id::text,'qualification-card:'||result.id::text,'qualification-card-submitted:'||result.id::text)
    from public.company_members member where member.company_id=target_company_id and member.role='owner';
  return result;
end;
$$;
revoke all on function public.submit_qualification_card_request(uuid,jsonb,jsonb,text) from public,anon;
grant execute on function public.submit_qualification_card_request(uuid,jsonb,jsonb,text) to authenticated;

create or replace function public.approve_qualification_card_request(request_id uuid,certifying_signature jsonb)
returns public.qualification_card_requests
language plpgsql security definer set search_path=''
as $$
declare result public.qualification_card_requests; owner_name text;
begin
  select * into result from public.qualification_card_requests where id=request_id for update;
  if result.id is null then raise exception 'Qualification card request not found' using errcode='P0002'; end if;
  if not (public.is_company_owner(result.company_id,auth.uid()) or public.has_system_admin_company_access(result.company_id)) then raise exception 'Company owner access required' using errcode='42501'; end if;
  if result.status<>'pending' then raise exception 'Qualification card request is no longer pending'; end if;
  if not public.valid_signature(certifying_signature) then raise exception 'Certifying signature is required'; end if;
  owner_name:=coalesce(public.notification_actor_name(auth.uid()),'Company owner');
  update public.profiles set signature_data=certifying_signature where user_id=auth.uid();
  update public.qualification_card_requests set status='approved',owner_signature=certifying_signature,owner_user_id=auth.uid(),owner_name=owner_name,approved_at=now()
    where id=request_id returning * into result;
  perform public.create_user_notification(result.company_id,result.crew_user_id,auth.uid(),'system','system',result.id,
    'Qualification card approved',owner_name||' approved your incident qualification card. It is ready to export.',
    '/qualifications/card','qualification-card:'||result.id::text,'qualification-card-approved:'||result.id::text);
  return result;
end;
$$;
revoke all on function public.approve_qualification_card_request(uuid,jsonb) from public,anon;
grant execute on function public.approve_qualification_card_request(uuid,jsonb) to authenticated;

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='qualification_card_requests') then
    alter publication supabase_realtime add table public.qualification_card_requests;
  end if;
end $$;
