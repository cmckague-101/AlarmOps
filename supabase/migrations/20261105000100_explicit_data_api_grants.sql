-- Existing projects retain their old grants; fresh databases no longer receive
-- automatic Data API access. Apply the missing grants to both deployment paths.
-- Keep RLS, column restrictions, RPC-only writes, and backend-only tables intact.
grant select on public.profiles, public.companies, public.company_members to authenticated;
grant select, delete on public.push_tokens to authenticated;
grant delete on public.communication_threads to authenticated;

-- Only the table operations currently used by trusted Edge Functions.
grant select on public.profiles, public.companies, public.system_admins,
  public.system_admin_company_access to service_role;
grant select, insert, delete on public.company_members to service_role;
grant select, update on public.fleet_vehicles to service_role;
grant select, insert, delete on public.fleet_crew to service_role;
grant select on public.fleet_state, public.fleet_issues, public.fleet_activities to service_role;
grant update (updated_by) on public.fleet_state, public.fleet_crew,
  public.fleet_issues, public.fleet_activities to service_role;
