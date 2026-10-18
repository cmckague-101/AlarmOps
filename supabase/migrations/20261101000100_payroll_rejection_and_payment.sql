-- Allow managers to reject payroll with notes, employees to revise and resubmit it,
-- and managers to mark approved payroll as paid.
alter table public.payroll_forms drop constraint if exists payroll_forms_status_check;
alter table public.payroll_forms drop constraint if exists payroll_forms_check;
alter table public.payroll_forms drop constraint if exists payroll_forms_check1;

alter table public.payroll_forms
  add column rejection_notes text,
  add column rejected_at timestamptz,
  add column rejected_by uuid references public.profiles(user_id) on delete set null,
  add constraint payroll_forms_status_check check (status in ('draft', 'pending', 'rejected', 'approved', 'paid')),
  add constraint payroll_forms_submission_check check (
    (status = 'draft' and submitted_at is null) or (status <> 'draft' and submitted_at is not null)
  ),
  add constraint payroll_forms_approval_check check (
    (status in ('approved', 'paid') and approved_at is not null and approved_by is not null)
    or (status not in ('approved', 'paid') and approved_at is null and approved_by is null)
  ),
  add constraint payroll_forms_rejection_check check (
    rejection_notes is null or char_length(trim(rejection_notes)) between 1 and 1000
  ),
  add constraint payroll_forms_rejected_metadata_check check (
    status <> 'rejected' or (rejection_notes is not null and rejected_at is not null and rejected_by is not null)
  );

create or replace function public.protect_payroll_form()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.created_by <> auth.uid() or not public.is_company_member(new.company_id, auth.uid()) then
      raise exception 'Company membership required' using errcode = '42501';
    end if;
    new.status := 'draft'; new.submitted_at := null; new.approved_at := null; new.approved_by := null;
    new.rejection_notes := null; new.rejected_at := null; new.rejected_by := null;
    return new;
  end if;

  if old.status = 'paid' then raise exception 'Paid payroll is read only' using errcode = '42501'; end if;

  if old.status = 'approved' then
    if not public.is_company_owner(old.company_id, auth.uid()) or new.status <> 'paid' then
      raise exception 'Approved payroll is read only' using errcode = '42501';
    end if;
    new.company_id := old.company_id; new.created_by := old.created_by; new.created_by_name := old.created_by_name;
    new.engine_number := old.engine_number; new.incidents := old.incidents; new.attachment := old.attachment; new.rows := old.rows;
    new.submitted_at := old.submitted_at; new.approved_at := old.approved_at; new.approved_by := old.approved_by;
    new.rejection_notes := old.rejection_notes; new.rejected_at := old.rejected_at; new.rejected_by := old.rejected_by;
    return new;
  end if;

  if old.status = 'pending' then
    if not public.is_company_owner(old.company_id, auth.uid()) or new.status not in ('approved', 'rejected') then
      raise exception 'Submitted payroll is read only' using errcode = '42501';
    end if;
    new.company_id := old.company_id; new.created_by := old.created_by; new.created_by_name := old.created_by_name;
    new.engine_number := old.engine_number; new.incidents := old.incidents; new.attachment := old.attachment; new.rows := old.rows;
    new.submitted_at := old.submitted_at;
    if new.status = 'approved' then
      new.approved_at := now(); new.approved_by := auth.uid();
      new.rejection_notes := old.rejection_notes; new.rejected_at := old.rejected_at; new.rejected_by := old.rejected_by;
    else
      if nullif(trim(new.rejection_notes), '') is null then raise exception 'Rejection notes are required'; end if;
      new.rejection_notes := trim(new.rejection_notes); new.rejected_at := now(); new.rejected_by := auth.uid();
      new.approved_at := null; new.approved_by := null;
    end if;
    return new;
  end if;

  if old.created_by <> auth.uid() then raise exception 'Only creator can edit in-progress payroll' using errcode = '42501'; end if;
  new.company_id := old.company_id; new.created_by := old.created_by; new.created_by_name := old.created_by_name;
  new.approved_at := null; new.approved_by := null;
  new.rejection_notes := old.rejection_notes; new.rejected_at := old.rejected_at; new.rejected_by := old.rejected_by;
  if new.status = 'pending' then new.submitted_at := now();
  elsif new.status = old.status and new.status in ('draft', 'rejected') then new.submitted_at := old.submitted_at;
  else raise exception 'Invalid payroll status';
  end if;
  return new;
end $$;

create or replace function public.notify_pending_payroll()
returns trigger language plpgsql security definer set search_path = '' as $$
declare manager record;
begin
  if new.status = 'pending' and old.status in ('draft', 'rejected') then
    for manager in select user_id from public.company_members where company_id = new.company_id and role in ('owner', 'admin') loop
      perform public.create_user_notification(new.company_id, manager.user_id, new.created_by, 'system', 'system', new.id,
        'Payroll awaiting approval', new.created_by_name || ' submitted payroll for approval.', '/payroll',
        'payroll:' || new.id::text, 'payroll-pending:' || new.id::text || ':' || extract(epoch from new.submitted_at)::text);
    end loop;
  end if;
  return new;
end $$;

create or replace function public.notify_rejected_payroll()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'rejected' and old.status = 'pending' then
    perform public.create_user_notification(new.company_id, new.created_by, auth.uid(), 'system', 'system', new.id,
      'Payroll needs changes', 'Your payroll was returned with notes: ' || new.rejection_notes, '/payroll',
      'payroll:' || new.id::text, 'payroll-rejected:' || new.id::text || ':' || extract(epoch from new.rejected_at)::text);
  end if;
  return new;
end $$;
revoke all on function public.notify_rejected_payroll() from public, anon, authenticated;
create trigger payroll_forms_rejected_notification after update of status on public.payroll_forms
for each row execute function public.notify_rejected_payroll();

-- Returned forms can be deleted and their attachments replaced by their creator.
drop policy if exists "creators and managers delete payroll forms" on public.payroll_forms;
create policy "creators and managers delete payroll forms" on public.payroll_forms
for delete to authenticated using (
  (created_by = auth.uid() and status in ('draft', 'rejected'))
  or public.is_company_owner(company_id, auth.uid())
);

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
      where form.attachment->>'storagePath' = name and form.status not in ('draft', 'rejected')
    )
    else false
  end
);
