-- Shop techs may stage, verify and copy sync uploads so their offline
-- inspections can carry photos. Uses only the vehicle-file paths: vehicle
-- documents (attach) and conflict review stay owner/admin, and a shop tech's
-- copy can only be referenced by their own inspection (validated per proposer,
-- vehicle and role trigger). Firefighters still cannot upload sync files.
begin;
create or replace function public.fleet_sync_attachment_user_allowed(company uuid, actor uuid)
returns boolean language sql stable set search_path = '' as $$
  select public.is_company_owner(company, actor) or exists (select 1 from public.company_members m
    where m.company_id = company and m.user_id = actor and m.role = 'shop_tech');
$$;
commit;
