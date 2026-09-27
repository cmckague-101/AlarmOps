-- Remove employee signatures, source company details from settings, and let owners choose card position text.

alter table public.qualification_card_requests alter column employee_signature drop not null;

drop function if exists public.submit_qualification_card_request(uuid,jsonb,jsonb,text);
create function public.submit_qualification_card_request(target_company_id uuid,primary_qualification_id text,photo_path text)
returns public.qualification_card_requests
language plpgsql security definer set search_path=''
as $$
declare
  result public.qualification_card_requests;
  actor_name text;
  company_phone text;
  company_home_base text;
begin
  if not public.is_company_member(target_company_id,auth.uid()) then raise exception 'Company membership required' using errcode='42501'; end if;
  if length(trim(coalesce(primary_qualification_id,''))) not between 1 and 200 then raise exception 'Qualification card position is invalid'; end if;
  if photo_path is null or photo_path not like target_company_id::text||'/'||auth.uid()::text||'/%' or length(photo_path)>500 then raise exception 'Qualification card photo is invalid'; end if;

  select coalesce(phone,''),coalesce(location,'') into company_phone,company_home_base
    from public.companies where id=target_company_id;
  update public.qualification_card_requests set status='superseded'
    where company_id=target_company_id and crew_user_id=auth.uid() and status='pending';
  actor_name:=coalesce(public.notification_actor_name(auth.uid()),'Crew member');
  insert into public.qualification_card_requests(company_id,crew_user_id,crew_name,card_data,photo_path)
    values(target_company_id,auth.uid(),actor_name,jsonb_build_object(
      'companyPhone',company_phone,
      'homeBase',company_home_base,
      'primaryQualificationId',trim(primary_qualification_id)
    ),photo_path)
    returning * into result;
  perform public.create_user_notification(target_company_id,member.user_id,auth.uid(),'system','system',result.id,
    'Qualification card approval requested',actor_name||' submitted an incident qualification card for approval.',
    '/qualifications/card?request='||result.id::text,'qualification-card:'||result.id::text,'qualification-card-submitted:'||result.id::text)
    from public.company_members member where member.company_id=target_company_id and member.role='owner';
  return result;
end;
$$;
revoke all on function public.submit_qualification_card_request(uuid,text,text) from public,anon;
grant execute on function public.submit_qualification_card_request(uuid,text,text) to authenticated;

drop function if exists public.approve_qualification_card_request(uuid,jsonb);
create function public.approve_qualification_card_request(request_id uuid,certifying_signature jsonb,qualified_position text)
returns public.qualification_card_requests
language plpgsql security definer set search_path=''
as $$
declare result public.qualification_card_requests; certifying_owner_name text;
begin
  select * into result from public.qualification_card_requests where id=request_id for update;
  if result.id is null then raise exception 'Qualification card request not found' using errcode='P0002'; end if;
  if not (public.is_company_owner(result.company_id,auth.uid()) or public.has_system_admin_company_access(result.company_id)) then raise exception 'Company owner access required' using errcode='42501'; end if;
  if result.status<>'pending' then raise exception 'Qualification card request is no longer pending'; end if;
  if not public.valid_signature(certifying_signature) then raise exception 'Certifying signature is required'; end if;
  if length(trim(coalesce(qualified_position,''))) not between 1 and 120 then raise exception 'Qualified position is required'; end if;
  certifying_owner_name:=coalesce(public.notification_actor_name(auth.uid()),'Company owner');
  update public.profiles set signature_data=certifying_signature where user_id=auth.uid();
  update public.qualification_card_requests set
    status='approved',
    card_data=jsonb_set(card_data,'{cardPosition}',to_jsonb(trim(qualified_position)),true),
    owner_signature=certifying_signature,
    owner_user_id=auth.uid(),
    owner_name=certifying_owner_name,
    approved_at=now()
    where id=request_id returning * into result;
  perform public.create_user_notification(result.company_id,result.crew_user_id,auth.uid(),'system','system',result.id,
    'Qualification card approved',certifying_owner_name||' approved your incident qualification card. It is ready to export.',
    '/qualifications/card','qualification-card:'||result.id::text,'qualification-card-approved:'||result.id::text);
  return result;
end;
$$;
revoke all on function public.approve_qualification_card_request(uuid,jsonb,text) from public,anon;
grant execute on function public.approve_qualification_card_request(uuid,jsonb,text) to authenticated;
