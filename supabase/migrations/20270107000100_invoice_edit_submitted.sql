-- Edit unpaid submitted invoices (online only).
-- * The creator and finance processors (owners, accounting) may change a
--   submitted invoice's number, date, amount, customer, due date and attachment
--   while it stays submitted. Who created it and when it was submitted never change.
-- * Paid invoices stay read only; marking paid is unchanged.
-- * Offline sync still applies only drafts (`already_submitted` otherwise).
begin;

create or replace function public.protect_invoice_form()
returns trigger language plpgsql security definer set search_path = '' as $$
declare customer_company uuid;
begin
  if tg_op = 'INSERT' then
    if new.created_by <> auth.uid() or not public.is_company_member(new.company_id, auth.uid()) then
      raise exception 'Company membership required' using errcode = '42501';
    end if;
    new.status := 'draft'; new.submitted_at := null;
    new.paid_at := null; new.paid_by := null; new.paid_by_name := null;
  else
    if old.status = 'paid' then raise exception 'Paid invoice is read only' using errcode = '42501'; end if;
    if old.status = 'submitted' then
      if new.status = 'paid' then
        if not public.is_company_finance_processor(old.company_id, auth.uid()) then
          raise exception 'Submitted invoice is read only' using errcode = '42501';
        end if;
        new.company_id := old.company_id; new.created_by := old.created_by; new.created_by_name := old.created_by_name;
        new.invoice_number := old.invoice_number; new.invoice_date := old.invoice_date; new.invoice_amount := old.invoice_amount;
        new.customer_id := old.customer_id; new.attachment := old.attachment; new.due_date := old.due_date;
        new.submitted_at := old.submitted_at;
        new.paid_at := now(); new.paid_by := auth.uid();
        select left(coalesce(nullif(btrim(p.full_name), ''), 'Company user'), 160) into new.paid_by_name
          from public.profiles p where p.user_id = auth.uid();
        new.paid_by_name := coalesce(new.paid_by_name, 'Company user');
        return new;
      end if;
      if new.status <> 'submitted'
        or not (
          old.created_by = auth.uid()
          or public.is_company_finance_processor(old.company_id, auth.uid())
        ) then
        raise exception 'Submitted invoice is read only' using errcode = '42501';
      end if;
      new.company_id := old.company_id;
      new.created_by := old.created_by;
      new.created_by_name := old.created_by_name;
      new.submitted_at := old.submitted_at;
      new.paid_at := null; new.paid_by := null; new.paid_by_name := null;
    else
      if old.created_by <> auth.uid() then raise exception 'Only creator can edit draft invoice' using errcode = '42501'; end if;
      new.company_id := old.company_id; new.created_by := old.created_by; new.created_by_name := old.created_by_name;
      new.paid_at := null; new.paid_by := null; new.paid_by_name := null;
      if new.status = 'submitted' then new.submitted_at := now();
      elsif new.status <> 'draft' then raise exception 'Invalid invoice status';
      end if;
    end if;
  end if;
  if new.customer_id is not null then
    select company_id into customer_company from public.invoice_customers where id = new.customer_id;
    if customer_company is distinct from new.company_id then raise exception 'Customer must belong to company'; end if;
  end if;
  if new.status = 'submitted' and (nullif(trim(new.invoice_number), '') is null or new.invoice_date is null or new.invoice_amount <= 0 or new.customer_id is null) then
    raise exception 'Invoice number, date, positive amount, and customer are required';
  end if;
  return new;
end $$;

drop policy if exists "creators and finance edit submitted invoices" on public.invoice_forms;
create policy "creators and finance edit submitted invoices" on public.invoice_forms
for update to authenticated
using (
  status = 'submitted'
  and (
    created_by = (select auth.uid())
    or public.is_company_finance_processor(company_id, (select auth.uid()))
  )
)
with check (
  status = 'submitted'
  and (
    created_by = (select auth.uid())
    or public.is_company_finance_processor(company_id, (select auth.uid()))
  )
);

commit;
