-- Repair projects where the role migration was recorded but the original
-- owner/member check constraint remained in place.

alter table public.company_members drop constraint if exists company_members_role_check;
update public.company_members set role = 'fire_fighter' where role = 'member';
alter table public.company_members add constraint company_members_role_check
  check (role in ('owner', 'admin', 'shop_tech', 'fire_fighter'));
