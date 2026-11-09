-- Navigation reshuffle: the incident map is a Dashboard card and Shop is a
-- Quick Action, and people can hide either from dashboard customization.
-- Accept the two new keys (and raise the per-request key cap to match).
begin;

create or replace function public.validate_dashboard_preference_changes(changes jsonb)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(changes) is distinct from 'object' then raise exception 'Invalid dashboard changes' using errcode = '22023'; end if;
  if (select count(*) from jsonb_object_keys(changes)) not between 1 and 18
    or exists (select 1 from jsonb_each(changes) e where e.key not in
      ('greeting','incidents','personnel','resources','attention','currentIssues','currentPicture','incidentMap','availability','tasks','inspections','shop','inventory','payroll','receipts','invoices','nationalFireActivity','recentActivity')
      or jsonb_typeof(e.value) not in ('boolean','null')) then
    raise exception 'Invalid dashboard changes' using errcode = '22023';
  end if;
end;
$$;
alter function public.validate_dashboard_preference_changes(jsonb) owner to fireops_sync_writer;
revoke all on function public.validate_dashboard_preference_changes(jsonb) from public, anon, authenticated, service_role;

commit;
