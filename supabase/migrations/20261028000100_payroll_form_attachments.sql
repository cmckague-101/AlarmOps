-- Attach one image or PDF to a digital payroll form.
alter table public.payroll_forms
  add column attachment jsonb;

alter table public.payroll_forms
  add constraint payroll_forms_attachment_shape check (
    attachment is null or (
      jsonb_typeof(attachment) = 'object'
      and jsonb_typeof(attachment->'name') = 'string'
      and char_length(attachment->>'name') between 1 and 255
      and jsonb_typeof(attachment->'mimeType') = 'string'
      and attachment->>'mimeType' in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf')
      and jsonb_typeof(attachment->'byteSize') = 'number'
      and (attachment->>'byteSize')::bigint between 1 and 10485760
      and jsonb_typeof(attachment->'storagePath') = 'string'
      and attachment->>'storagePath' ~ ('^' || company_id::text || '/' || created_by::text || '/forms/' || id::text || '/[^/]+$')
      and attachment = jsonb_build_object(
        'name', attachment->'name',
        'mimeType', attachment->'mimeType',
        'byteSize', attachment->'byteSize',
        'storagePath', attachment->'storagePath'
      )
    )
  );

create or replace function public.protect_payroll_form()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.created_by <> auth.uid() or not public.is_company_member(new.company_id, auth.uid()) then
      raise exception 'Company membership required' using errcode = '42501';
    end if;
    new.status := 'draft'; new.submitted_at := null; new.approved_at := null; new.approved_by := null;
    return new;
  end if;

  if old.status = 'approved' then raise exception 'Approved payroll is read only' using errcode = '42501'; end if;
  if old.status = 'pending' then
    if not (public.is_company_owner(old.company_id, auth.uid()) or public.has_system_admin_company_access(old.company_id))
       or new.status <> 'approved' then
      raise exception 'Submitted payroll is read only' using errcode = '42501';
    end if;
    new.company_id := old.company_id; new.created_by := old.created_by; new.created_by_name := old.created_by_name;
    new.engine_number := old.engine_number; new.incidents := old.incidents; new.attachment := old.attachment; new.rows := old.rows;
    new.submitted_at := old.submitted_at; new.approved_at := now(); new.approved_by := auth.uid();
    return new;
  end if;

  if old.created_by <> auth.uid() then raise exception 'Only creator can edit draft payroll' using errcode = '42501'; end if;
  new.company_id := old.company_id; new.created_by := old.created_by; new.created_by_name := old.created_by_name;
  if new.status = 'pending' then new.submitted_at := now();
  elsif new.status <> 'draft' then raise exception 'Invalid payroll status';
  end if;
  return new;
end $$;

-- Once submitted, creator cannot remove attachment behind immutable payroll record.
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
    and not exists (select 1 from public.company_payroll payroll where payroll.storage_path = name)
    and not exists (
      select 1 from public.payroll_forms form
      where form.attachment->>'storagePath' = name and form.status <> 'draft'
    )
    else false
  end
);

-- Company managers can view and clean up digital form attachments without gaining access
-- to separately uploaded payroll documents, whose paths do not include /forms/.
create policy "managers read digital payroll attachments" on storage.objects
for select to authenticated
using (
  bucket_id = 'payroll-files'
  and (storage.foldername(name))[3] = 'forms'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then public.is_company_owner(((storage.foldername(name))[1])::uuid, auth.uid())
    else false
  end
);
create policy "managers remove digital payroll attachments" on storage.objects
for delete to authenticated
using (
  bucket_id = 'payroll-files'
  and (storage.foldername(name))[3] = 'forms'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then public.is_company_owner(((storage.foldername(name))[1])::uuid, auth.uid())
    else false
  end
);
