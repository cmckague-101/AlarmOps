-- Invoice due dates and paid status. Only adds columns and rules; existing rows
-- are not rewritten. A missing due date reads as 30 days after the invoice date
-- in the apps, so older invoices still show as unpaid or overdue.
-- * Creators may set due_date while the invoice is a draft.
-- * Owners and accounting (finance processors) may mark a submitted invoice paid.
--   Paid invoices are read only and cannot be deleted.
-- Offline sync is unchanged: offline saves never set due_date, and a paid
-- invoice is reported to devices as already submitted.
begin;

-- Replace the status checks created inline by 20261104000100.
do $$
declare item record;
begin
  for item in
    select conname from pg_constraint
    where conrelid = 'public.invoice_forms'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) ilike '%status%')
  loop
    execute format('alter table public.invoice_forms drop constraint %I', item.conname);
  end loop;
end $$;

alter table public.invoice_forms
  add column due_date date,
  add column paid_at timestamptz,
  add column paid_by uuid references public.profiles(user_id) on delete set null,
  add column paid_by_name text check (paid_by_name is null or char_length(paid_by_name) between 1 and 160),
  add constraint invoice_forms_status_check check (status in ('draft', 'submitted', 'paid')),
  add constraint invoice_forms_submission_check check (
    (status = 'draft' and submitted_at is null) or (status <> 'draft' and submitted_at is not null)
  ),
  add constraint invoice_forms_paid_check check (
    (status = 'paid' and paid_at is not null) or (status <> 'paid' and paid_at is null and paid_by is null and paid_by_name is null)
  ),
  add constraint invoice_forms_due_date_check check (due_date is null or invoice_date is null or due_date >= invoice_date);

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
      if new.status <> 'paid' or not public.is_company_finance_processor(old.company_id, auth.uid()) then
        raise exception 'Submitted invoice is read only' using errcode = '42501';
      end if;
      -- Marking paid changes nothing else on the invoice.
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
    if old.created_by <> auth.uid() then raise exception 'Only creator can edit draft invoice' using errcode = '42501'; end if;
    new.company_id := old.company_id; new.created_by := old.created_by; new.created_by_name := old.created_by_name;
    new.paid_at := null; new.paid_by := null; new.paid_by_name := null;
    if new.status = 'submitted' then new.submitted_at := now();
    elsif new.status <> 'draft' then raise exception 'Invalid invoice status';
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

create policy "finance processors mark invoices paid" on public.invoice_forms for update to authenticated
using (status = 'submitted' and public.is_company_finance_processor(company_id, (select auth.uid())))
with check (public.is_company_finance_processor(company_id, (select auth.uid())));

-- Paid invoices are kept: no one deletes them.
alter policy "creators and managers delete invoices" on public.invoice_forms
using (
  (created_by = (select auth.uid()) and status = 'draft')
  or (status = 'submitted' and public.is_company_finance_processor(company_id, (select auth.uid())))
);

-- Creators keep their files once an invoice leaves draft, including after it is paid.
alter policy "users remove permitted invoice files" on storage.objects
using (
  bucket_id = 'invoice-files' and (
    public.is_company_finance_processor(((storage.foldername(name))[1])::uuid, (select auth.uid()))
    or ((storage.foldername(name))[2] = (select auth.uid())::text and not exists (
      select 1 from public.invoice_forms form where form.attachment->>'storagePath' = name and form.status <> 'draft'
    ))
  )
);

commit;
