-- Company owners can correct receipt metadata and remove receipts and their files.

create policy "owners update company receipts" on public.company_receipts
for update to authenticated
using (
  public.is_company_owner(company_id, auth.uid())
  or public.has_system_admin_company_access(company_id)
)
with check (
  public.is_company_owner(company_id, auth.uid())
  or public.has_system_admin_company_access(company_id)
);

create policy "owners delete company receipts" on public.company_receipts
for delete to authenticated
using (
  public.is_company_owner(company_id, auth.uid())
  or public.has_system_admin_company_access(company_id)
);

grant update (name, amount_cents) on public.company_receipts to authenticated;
grant delete on public.company_receipts to authenticated;

create policy "owners remove company receipt files" on storage.objects
for delete to authenticated
using (
  bucket_id = 'receipt-files'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then public.is_company_owner(((storage.foldername(name))[1])::uuid, auth.uid())
      or public.has_system_admin_company_access(((storage.foldername(name))[1])::uuid)
    else false
  end
);
