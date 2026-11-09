-- Invoice photo auto-fill.
-- * Reuses the receipt auto-fill switch (companies.receipt_autofill_enabled):
--   a company with receipt auto-fill also gets invoice auto-fill.
-- * Shares the receipt daily caps (200 per person, 2,000 per company in any
--   rolling 24 hours): both kinds are logged in receipt_autofill_usage, now
--   tagged with `kind` so billing review can tell them apart. Existing rows are
--   receipts.
-- * claim_invoice_autofill(company, actor): called by the invoice-autofill edge
--   function (service role only) before each vision request. Everyone who can
--   create an invoice (any company member) may claim. The function never writes
--   an invoice; the app fills the creator's draft for review.
-- * Every company member may add invoice customers (a scanned customer that is
--   not in the list can be added by whoever is filling the invoice). Renaming
--   and deleting customers stay with owners and accounting.
begin;

alter table public.receipt_autofill_usage
  add column kind text not null default 'receipt' check (kind in ('receipt', 'invoice'));

create or replace function public.claim_invoice_autofill(company uuid, actor uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.company_members m where m.company_id = company and m.user_id = actor) then
    return 'not_member';
  end if;
  if not coalesce((select c.receipt_autofill_enabled from public.companies c where c.id = company), false) then
    return 'disabled';
  end if;
  -- Same lock and counts as claim_receipt_autofill, so receipts and invoices share one budget.
  perform pg_advisory_xact_lock(hashtextextended('receipt_autofill:' || company::text, 0));
  if (select count(*) from public.receipt_autofill_usage u where u.user_id = actor and u.created_at > now() - interval '24 hours') >= 200
    or (select count(*) from public.receipt_autofill_usage u where u.company_id = company and u.created_at > now() - interval '24 hours') >= 2000 then
    return 'limit';
  end if;
  insert into public.receipt_autofill_usage (company_id, user_id, kind) values (company, actor, 'invoice');
  return 'ok';
end;
$$;
revoke all on function public.claim_invoice_autofill(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_invoice_autofill(uuid, uuid) to service_role;

drop policy "managers create invoice customers" on public.invoice_customers;
create policy "members create invoice customers" on public.invoice_customers for insert to authenticated
with check (public.is_company_member(company_id, (select auth.uid())) or public.is_company_finance_processor(company_id, (select auth.uid())));

commit;
