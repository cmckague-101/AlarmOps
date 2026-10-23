-- Fix: uploader delete policies for receipt, invoice-document and payroll
-- files compared the saved row's storage_path with that row's own `name`
-- column (company_receipts, company_invoices and company_payroll all have one)
-- instead of the object's name. So the "file still referenced" check never
-- matched and uploaders could delete files behind saved, immutable records.
-- Same rules as before, with the object name qualified.
begin;

drop policy if exists "uploaders remove own receipt files" on storage.objects;
create policy "uploaders remove own receipt files" on storage.objects
for delete to authenticated
using (
  bucket_id = 'receipt-files'
  and (storage.foldername(name))[2] = auth.uid()::text
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then (
      public.is_company_member(((storage.foldername(name))[1])::uuid, auth.uid())
      or public.has_system_admin_company_access(((storage.foldername(name))[1])::uuid)
    )
    and not exists (select 1 from public.company_receipts receipt where receipt.storage_path = objects.name)
    else false
  end
);

drop policy if exists "uploaders remove own invoices files" on storage.objects;
create policy "uploaders remove own invoices files" on storage.objects
for delete to authenticated
using (
  bucket_id = 'invoices-files'
  and (storage.foldername(name))[2] = auth.uid()::text
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then (
      public.is_company_member(((storage.foldername(name))[1])::uuid, auth.uid())
      or public.has_system_admin_company_access(((storage.foldername(name))[1])::uuid)
    )
    and not exists (select 1 from public.company_invoices invoices where invoices.storage_path = objects.name)
    else false
  end
);

-- Latest definition (20261101000100) with both reference checks qualified.
drop policy if exists "uploaders remove own payroll files" on storage.objects;
create policy "uploaders remove own payroll files" on storage.objects
for delete to authenticated
using (
  bucket_id = 'payroll-files'
  and (storage.foldername(name))[2] = auth.uid()::text
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then (
      public.is_company_member(((storage.foldername(name))[1])::uuid, auth.uid())
      or public.has_system_admin_company_access(((storage.foldername(name))[1])::uuid)
    )
    and not exists (select 1 from public.company_payroll payroll where payroll.storage_path = objects.name)
    and not exists (
      select 1 from public.payroll_forms form
      where form.attachment->>'storagePath' = objects.name and form.status not in ('draft', 'rejected')
    )
    else false
  end
);
commit;
