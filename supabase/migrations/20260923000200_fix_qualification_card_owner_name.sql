-- Avoid ambiguity between the owner_name column and the approval function variable.

create or replace function public.approve_qualification_card_request(request_id uuid,certifying_signature jsonb)
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
  certifying_owner_name:=coalesce(public.notification_actor_name(auth.uid()),'Company owner');
  update public.profiles set signature_data=certifying_signature where user_id=auth.uid();
  update public.qualification_card_requests set status='approved',owner_signature=certifying_signature,owner_user_id=auth.uid(),owner_name=certifying_owner_name,approved_at=now()
    where id=request_id returning * into result;
  perform public.create_user_notification(result.company_id,result.crew_user_id,auth.uid(),'system','system',result.id,
    'Qualification card approved',certifying_owner_name||' approved your incident qualification card. It is ready to export.',
    '/qualifications/card','qualification-card:'||result.id::text,'qualification-card-approved:'||result.id::text);
  return result;
end;
$$;
revoke all on function public.approve_qualification_card_request(uuid,jsonb) from public,anon;
grant execute on function public.approve_qualification_card_request(uuid,jsonb) to authenticated;
