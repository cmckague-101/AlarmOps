-- Add assignable company roles. Admins share owner management permissions, except billing.

alter table public.company_members drop constraint if exists company_members_role_check;
update public.company_members set role = 'fire_fighter' where role = 'member';
alter table public.company_members add constraint company_members_role_check
  check (role in ('owner', 'admin', 'shop_tech', 'fire_fighter'));

update public.fleet_crew
set data = jsonb_set(data, '{role}', '"fire_fighter"'::jsonb), version = version + 1
where data ->> 'role' = 'member';

alter table public.communication_threads drop constraint if exists communication_threads_created_by_role_check;
update public.communication_threads set created_by_role = 'fire_fighter' where created_by_role = 'member';
alter table public.communication_threads add constraint communication_threads_created_by_role_check
  check (created_by_role in ('owner', 'admin', 'shop_tech', 'fire_fighter'));

-- Existing owner policies and RPC guards become company-management policies.
create or replace function public.is_company_owner(target_company_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_system_admin_company_access(target_company_id) or exists (
    select 1 from public.company_members
    where company_id = target_company_id and user_id = target_user_id and role in ('owner', 'admin')
  );
$$;

-- Billing remains restricted to actual owners (and audited system admins).
create or replace function public.is_company_billing_owner(target_company_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_system_admin_company_access(target_company_id) or exists (
    select 1 from public.company_members
    where company_id = target_company_id and user_id = target_user_id and role = 'owner'
  );
$$;
revoke all on function public.is_company_billing_owner(uuid, uuid) from public, anon;
grant execute on function public.is_company_billing_owner(uuid, uuid) to authenticated;

-- Keep admin invoice/payroll access equivalent to normal crew access.
drop policy if exists "users read permitted invoices" on public.company_invoices;
create policy "users read permitted invoices" on public.company_invoices for select to authenticated using (
  public.has_system_admin_company_access(company_id)
  or public.is_company_billing_owner(company_id, auth.uid())
  or (public.is_company_member(company_id, auth.uid()) and uploaded_by = auth.uid())
);
drop policy if exists "owners update company invoices" on public.company_invoices;
create policy "owners update company invoices" on public.company_invoices for update to authenticated
using (public.is_company_billing_owner(company_id, auth.uid()))
with check (public.is_company_billing_owner(company_id, auth.uid()));
drop policy if exists "owners delete company invoices" on public.company_invoices;
create policy "owners delete company invoices" on public.company_invoices for delete to authenticated
using (public.is_company_billing_owner(company_id, auth.uid()));

drop policy if exists "users read permitted payroll" on public.company_payroll;
create policy "users read permitted payroll" on public.company_payroll for select to authenticated using (
  public.has_system_admin_company_access(company_id)
  or public.is_company_billing_owner(company_id, auth.uid())
  or (public.is_company_member(company_id, auth.uid()) and uploaded_by = auth.uid())
);
drop policy if exists "owners update company payroll" on public.company_payroll;
create policy "owners update company payroll" on public.company_payroll for update to authenticated
using (public.is_company_billing_owner(company_id, auth.uid()))
with check (public.is_company_billing_owner(company_id, auth.uid()));
drop policy if exists "owners delete company payroll" on public.company_payroll;
create policy "owners delete company payroll" on public.company_payroll for delete to authenticated
using (public.is_company_billing_owner(company_id, auth.uid()));

drop policy if exists "users read permitted invoices files" on storage.objects;
create policy "users read permitted invoices files" on storage.objects for select to authenticated using (
  bucket_id = 'invoices-files' and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then public.is_company_billing_owner(((storage.foldername(name))[1])::uuid, auth.uid())
      or (public.is_company_member(((storage.foldername(name))[1])::uuid, auth.uid()) and (storage.foldername(name))[2] = auth.uid()::text)
    else false end
);
drop policy if exists "owners remove company invoices files" on storage.objects;
create policy "owners remove company invoices files" on storage.objects for delete to authenticated using (
  bucket_id = 'invoices-files' and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then public.is_company_billing_owner(((storage.foldername(name))[1])::uuid, auth.uid()) else false end
);
drop policy if exists "users read permitted payroll files" on storage.objects;
create policy "users read permitted payroll files" on storage.objects for select to authenticated using (
  bucket_id = 'payroll-files' and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then public.is_company_billing_owner(((storage.foldername(name))[1])::uuid, auth.uid())
      or (public.is_company_member(((storage.foldername(name))[1])::uuid, auth.uid()) and (storage.foldername(name))[2] = auth.uid()::text)
    else false end
);
drop policy if exists "owners remove company payroll files" on storage.objects;
create policy "owners remove company payroll files" on storage.objects for delete to authenticated using (
  bucket_id = 'payroll-files' and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then public.is_company_billing_owner(((storage.foldername(name))[1])::uuid, auth.uid()) else false end
);

create or replace function public.attribute_company_communication()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor_name text; actor_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.is_company_member(new.company_id,auth.uid()) and not public.has_system_admin_company_access(new.company_id) then
    raise exception 'Company access required' using errcode = '42501';
  end if;
  select profile.full_name into actor_name from public.profiles profile where profile.user_id=auth.uid();
  new.created_by:=auth.uid(); new.created_by_name:=coalesce(nullif(trim(actor_name),''),'FireOps user');
  if tg_table_name='communication_threads' then
    select role into actor_role from public.company_members where company_id=new.company_id and user_id=auth.uid();
    new.created_by_role:=coalesce(actor_role,'owner');
  end if;
  return new;
end;
$$;

create or replace function public.update_company_member_role(
  target_company_id uuid, target_user_id uuid, new_role text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := auth.uid(); next_version bigint;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.is_company_owner(target_company_id, actor_id) then
    raise exception 'Company management access required' using errcode = '42501';
  end if;
  if new_role not in ('admin', 'shop_tech', 'fire_fighter') then
    raise exception 'Invalid company role' using errcode = '22023';
  end if;
  if not exists (select 1 from public.company_members where company_id=target_company_id and user_id=target_user_id and role<>'owner') then
    raise exception 'Crew member not found' using errcode = 'P0002';
  end if;
  update public.company_members set role=new_role where company_id=target_company_id and user_id=target_user_id;
  update public.fleet_crew set data=jsonb_set(data,'{role}',to_jsonb(new_role)), version=version+1, updated_by=actor_id
    where company_id=target_company_id and record_id=target_user_id returning version into next_version;
  return jsonb_build_object('role',new_role,'version',next_version);
end;
$$;
revoke all on function public.update_company_member_role(uuid, uuid, text) from public, anon;
grant execute on function public.update_company_member_role(uuid, uuid, text) to authenticated;

create or replace function public.update_company_profile(target_company_id uuid,company_name text,company_phone text,company_location text,company_logo_path text)
returns public.companies language plpgsql security definer set search_path = '' as $$
declare result public.companies; normalized_name text:=trim(company_name); normalized_phone text:=trim(company_phone); normalized_location text:=trim(company_location); normalized_logo_path text:=nullif(trim(company_logo_path),'');
begin
  if not public.is_company_owner(target_company_id,auth.uid()) then raise exception 'Company management access required' using errcode = '42501'; end if;
  if char_length(normalized_name) not between 2 and 120 then raise exception 'Company name must be between 2 and 120 characters' using errcode = '22023'; end if;
  if char_length(normalized_phone)>40 then raise exception 'Phone number must be 40 characters or fewer' using errcode = '22023'; end if;
  if char_length(normalized_location)>160 then raise exception 'Location must be 160 characters or fewer' using errcode = '22023'; end if;
  if normalized_logo_path is not null and normalized_logo_path !~ ('^'||target_company_id::text||'/[0-9a-f-]+/[^/]+$') then raise exception 'Company logo path is invalid' using errcode = '22023'; end if;
  update public.companies set name=normalized_name,phone=normalized_phone,location=normalized_location,logo_path=normalized_logo_path where id=target_company_id returning * into result;
  if result.id is null then raise exception 'Company not found' using errcode = 'P0002'; end if;
  return result;
end;
$$;

create or replace function public.company_crew_seats_used(target_company_id uuid)
returns integer language plpgsql stable security definer set search_path = '' as $$
declare seats_used integer;
begin
  if auth.uid() is null or (not public.is_company_member(target_company_id,auth.uid()) and not public.is_system_admin()) then
    raise exception 'Company access required' using errcode = '42501';
  end if;
  select count(*) into seats_used from (
    select user_id as seat_id from public.company_members where company_id=target_company_id and role<>'owner'
    union select record_id as seat_id from public.fleet_crew where company_id=target_company_id and data->>'role'<>'owner'
  ) occupied;
  return seats_used;
end;
$$;

create or replace function public.enforce_company_crew_invite_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare invite_limit integer; seats_used integer; target_company_id uuid; target_user_id uuid; target_role text;
begin
  if tg_table_name='company_members' then target_company_id:=new.company_id;target_user_id:=new.user_id;target_role:=new.role;
  else target_company_id:=new.company_id;target_user_id:=new.record_id;target_role:=new.data->>'role'; end if;
  if target_role='owner' then return new; end if;
  select crew_invite_limit into invite_limit from public.companies where id=target_company_id for update;
  if invite_limit is null then raise exception 'Company not found' using errcode = 'P0002'; end if;
  if exists (
    select 1 from public.company_members where company_id=target_company_id and user_id=target_user_id and role<>'owner'
    union all select 1 from public.fleet_crew where company_id=target_company_id and record_id=target_user_id and data->>'role'<>'owner'
  ) then return new; end if;
  select count(*) into seats_used from (
    select user_id as seat_id from public.company_members where company_id=target_company_id and role<>'owner'
    union select record_id as seat_id from public.fleet_crew where company_id=target_company_id and data->>'role'<>'owner'
  ) occupied;
  if seats_used>=invite_limit then raise exception 'Company crew invite limit reached' using errcode = '23514'; end if;
  return new;
end;
$$;

create or replace function public.has_pending_company_invite()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.fleet_crew crew join public.company_members membership
      on membership.company_id=crew.company_id and membership.user_id=crew.record_id and membership.role<>'owner'
    where crew.record_id=auth.uid() and crew.data->>'status'='Invited'
  );
$$;

create or replace function public.complete_company_invite()
returns integer language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); member_name text; activated_count integer;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select full_name into member_name from public.profiles where user_id=actor_id;
  update public.fleet_crew crew set data=crew.data||jsonb_build_object('status','Active','name',coalesce(nullif(trim(member_name),''),crew.data->>'name'),'joinedAt',current_date::text), version=crew.version+1, updated_by=actor_id
  where crew.record_id=actor_id and crew.data->>'status'='Invited' and exists (
    select 1 from public.company_members membership where membership.company_id=crew.company_id and membership.user_id=actor_id and membership.role<>'owner'
  );
  get diagnostics activated_count = row_count; return activated_count;
end;
$$;
