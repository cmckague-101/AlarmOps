-- Offline fleet actions for crew roles (fire_fighter, shop_tech), through the
-- same verified sync endpoints as managers but with a field allowlist:
-- * vehicles: status/assignedTo/assignedFire only — the existing role trigger
--   (enforce_normalized_vehicle_changes) still decides which transitions are
--   allowed (claim a Ready vehicle, release one's own, change/clear one's own
--   fire) against the CURRENT row;
-- * issues: append-only `updates` only — the member issue trigger still
--   requires the reporter's own issue and exactly one own note per write.
-- Members may read verified vehicle/issue records and inventory pages they can
-- already read online. Conflict review, history inspection and approval stay
-- owner/admin only; submitter outcome reads already allow current members.
begin;

create or replace function public.fleet_sync_submitter_allowed(company uuid, actor uuid)
returns boolean language sql stable set search_path = '' as $$
  select public.is_company_owner(company, actor) or exists (select 1 from public.company_members m
    where m.company_id = company and m.user_id = actor and m.role in ('fire_fighter','shop_tech'));
$$;
create or replace function public.fleet_sync_reader_allowed(company uuid, actor uuid)
returns boolean language sql stable set search_path = '' as $$
  select public.fleet_sync_submitter_allowed(company, actor);
$$;
create or replace function public.validate_fleet_sync_submitter_patch(company uuid, actor uuid, entity text, patch jsonb)
returns void language plpgsql stable set search_path = '' as $$
begin
  if public.is_company_owner(company, actor) then return; end if;
  if (entity = 'vehicle' and exists (select 1 from jsonb_object_keys(patch) k where k not in ('status','assignedTo','assignedFire')))
    or (entity = 'issue' and exists (select 1 from jsonb_object_keys(patch) k where k <> 'updates'))
    or entity not in ('vehicle','issue') then
    raise exception 'This role can only claim/release vehicles or add issue notes offline' using errcode = '42501';
  end if;
end;
$$;
commit;
