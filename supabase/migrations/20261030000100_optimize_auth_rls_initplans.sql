-- Evaluate auth.uid() once per statement instead of once per candidate row.

alter policy "authorized roles add fleet issues" on public.fleet_issues
with check (
  updated_by = (select auth.uid())
  and (
    public.is_company_owner(fleet_issues.company_id, (select auth.uid()))
    or exists (
      select 1
      from public.company_members member
      where member.company_id = fleet_issues.company_id
        and member.user_id = (select auth.uid())
        and member.role = 'shop_tech'
    )
  )
);

alter policy "company managers create communication threads" on public.communication_threads
with check (
  public.is_company_owner(company_id, (select auth.uid()))
  and created_by = (select auth.uid())
);

alter policy "owners delete communication threads" on public.communication_threads
using (
  public.is_company_owner(company_id, (select auth.uid()))
  or public.has_system_admin_company_access(company_id)
);

alter policy "company managers delete communication replies" on public.communication_replies
using (public.is_company_owner(company_id, (select auth.uid())));

alter policy "users read permitted invoices" on public.company_invoices
using (
  public.has_system_admin_company_access(company_id)
  or public.is_company_billing_owner(company_id, (select auth.uid()))
  or (
    public.is_company_member(company_id, (select auth.uid()))
    and uploaded_by = (select auth.uid())
  )
);

alter policy "owners update company invoices" on public.company_invoices
using (public.is_company_billing_owner(company_id, (select auth.uid())))
with check (public.is_company_billing_owner(company_id, (select auth.uid())));

alter policy "owners delete company invoices" on public.company_invoices
using (public.is_company_billing_owner(company_id, (select auth.uid())));

alter policy "users read permitted payroll" on public.company_payroll
using (
  public.has_system_admin_company_access(company_id)
  or public.is_company_billing_owner(company_id, (select auth.uid()))
  or (
    public.is_company_member(company_id, (select auth.uid()))
    and uploaded_by = (select auth.uid())
  )
);

alter policy "owners update company payroll" on public.company_payroll
using (public.is_company_billing_owner(company_id, (select auth.uid())))
with check (public.is_company_billing_owner(company_id, (select auth.uid())));

alter policy "owners delete company payroll" on public.company_payroll
using (public.is_company_billing_owner(company_id, (select auth.uid())));

alter policy "authorized users read vehicle notes" on public.vehicle_notes
using (public.can_access_vehicle_notes(company_id, (select auth.uid())));

alter policy "authorized users create vehicle notes" on public.vehicle_notes
with check (
  public.can_access_vehicle_notes(company_id, (select auth.uid()))
  and created_by = (select auth.uid())
  and exists (
    select 1
    from public.fleet_vehicles vehicle
    where vehicle.company_id = vehicle_notes.company_id
      and vehicle.record_id = vehicle_notes.vehicle_id
  )
);

alter policy "authorized users update vehicle notes" on public.vehicle_notes
using (public.can_access_vehicle_notes(company_id, (select auth.uid())))
with check (public.can_access_vehicle_notes(company_id, (select auth.uid())));

alter policy "authorized users delete vehicle notes" on public.vehicle_notes
using (public.can_access_vehicle_notes(company_id, (select auth.uid())));

alter policy "users read permitted payroll" on public.payroll_forms
using (
  public.is_company_owner(company_id, (select auth.uid()))
  or public.has_system_admin_company_access(company_id)
  or created_by = (select auth.uid())
);

alter policy "members create payroll drafts" on public.payroll_forms
with check (
  public.is_company_member(company_id, (select auth.uid()))
  and created_by = (select auth.uid())
);

alter policy "creators and managers update payroll" on public.payroll_forms
using (
  created_by = (select auth.uid())
  or public.is_company_owner(company_id, (select auth.uid()))
  or public.has_system_admin_company_access(company_id)
)
with check (
  created_by = (select auth.uid())
  or public.is_company_owner(company_id, (select auth.uid()))
  or public.has_system_admin_company_access(company_id)
);

alter policy "creators and managers delete payroll forms" on public.payroll_forms
using (
  (created_by = (select auth.uid()) and status = 'draft')
  or public.is_company_owner(company_id, (select auth.uid()))
);
