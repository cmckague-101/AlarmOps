-- Accounting role: processes payroll and invoices, otherwise crew-level access.
-- Payroll and invoice processing (review, approve/reject, mark paid, manage
-- invoice customers, read every submission) moves from owner/admin to
-- owner/accounting. Admins keep crew-level payroll/invoice access: they still
-- submit and read their own forms.
begin;

alter table public.company_members drop constraint if exists company_members_role_check;
alter table public.company_members add constraint company_members_role_check
  check (role in ('owner', 'admin', 'shop_tech', 'fire_fighter', 'accounting'));
alter table public.communication_threads drop constraint if exists communication_threads_created_by_role_check;
alter table public.communication_threads add constraint communication_threads_created_by_role_check
  check (created_by_role in ('owner', 'admin', 'shop_tech', 'fire_fighter', 'accounting'));

create or replace function public.is_company_finance_processor(target_company_id uuid, target_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_system_admin_company_access(target_company_id) or exists (
    select 1 from public.company_members
    where company_id = target_company_id and user_id = target_user_id and role in ('owner', 'accounting')
  );
$$;
revoke all on function public.is_company_finance_processor(uuid, uuid) from public, anon;
grant execute on function public.is_company_finance_processor(uuid, uuid) to authenticated;

-- Only guards the legacy company_invoices/company_payroll documents and their files.
create or replace function public.is_company_billing_owner(target_company_id uuid, target_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_company_finance_processor(target_company_id, target_user_id);
$$;

create or replace function public.update_company_member_role(
  target_company_id uuid, target_user_id uuid, new_role text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := auth.uid(); next_version bigint;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.is_company_owner(target_company_id, actor_id) then
    raise exception 'Company management access required' using errcode = '42501';
  end if;
  if new_role not in ('admin', 'shop_tech', 'fire_fighter', 'accounting') then
    raise exception 'Invalid company role' using errcode = '22023';
  end if;
  if not exists (select 1 from public.company_members where company_id=target_company_id and user_id=target_user_id and role<>'owner') then
    raise exception 'Crew member not found' using errcode = 'P0002';
  end if;
  update public.company_members set role=new_role where company_id=target_company_id and user_id=target_user_id;
  update public.fleet_crew set data=jsonb_set(data,'{role}',to_jsonb(new_role)), version=version+1, updated_by=actor_id
    where company_id=target_company_id and record_id=target_user_id returning version into next_version;
  return jsonb_build_object('role',new_role,'version',next_version);
end;
$$;

-- Accounting is crew for fleet actions and gear checkout.
create or replace function public.fleet_sync_submitter_allowed(company uuid, actor uuid)
returns boolean language sql stable set search_path = '' as $$
  select public.is_company_owner(company, actor) or exists (select 1 from public.company_members m
    where m.company_id = company and m.user_id = actor and m.role in ('fire_fighter','shop_tech','accounting'));
$$;

create or replace function public.inventory_checkout_core(target_company_id uuid, target_item_id uuid, checkout_quantity integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  target_item public.company_inventory_items;
  borrower_name text;
  checked_out integer;
  held integer;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if checkout_quantity is null or checkout_quantity < 1 or checkout_quantity > 999999 then
    raise exception 'Checkout quantity must be between 1 and 999999' using errcode = '22023';
  end if;
  select * into target_item from public.company_inventory_items
    where id = target_item_id and (target_company_id is null or company_id = target_company_id) for update;
  if not found then return jsonb_build_object('kind', 'item_deleted'); end if;
  if not exists (select 1 from public.company_members m where m.company_id = target_item.company_id and m.user_id = actor and m.role in ('fire_fighter','shop_tech','accounting')) then
    raise exception 'Crew access required' using errcode = '42501';
  end if;
  select coalesce(sum(c.quantity), 0) into checked_out from public.company_inventory_checkouts c
    where c.company_id = target_item.company_id and c.item_id = target_item.id;
  if checked_out + checkout_quantity > target_item.quantity then
    return jsonb_build_object('kind', 'insufficient_stock', 'available', target_item.quantity - checked_out);
  end if;
  select coalesce(nullif(trim(p.full_name), ''), 'Crew member') into borrower_name from public.profiles p where p.user_id = actor;
  insert into public.company_inventory_checkouts (company_id, item_id, user_id, user_name, quantity)
    values (target_item.company_id, target_item.id, actor, borrower_name, checkout_quantity)
    on conflict (company_id, item_id, user_id) do update
      set quantity = public.company_inventory_checkouts.quantity + excluded.quantity, updated_at = now()
    returning quantity into held;
  return jsonb_build_object('kind', 'applied', 'checkedOut', held);
end;
$$;

-- Payroll forms ---------------------------------------------------------------
alter policy "users read permitted payroll" on public.payroll_forms
using (
  public.is_company_finance_processor(company_id, (select auth.uid()))
  or created_by = (select auth.uid())
);
alter policy "creators and managers update payroll" on public.payroll_forms
using (
  created_by = (select auth.uid())
  or public.is_company_finance_processor(company_id, (select auth.uid()))
)
with check (
  created_by = (select auth.uid())
  or public.is_company_finance_processor(company_id, (select auth.uid()))
);
alter policy "creators and managers delete payroll forms" on public.payroll_forms
using (
  (created_by = (select auth.uid()) and status in ('draft', 'rejected'))
  or public.is_company_finance_processor(company_id, (select auth.uid()))
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
    if not public.is_company_finance_processor(old.company_id, auth.uid()) or new.status <> 'paid' then
      raise exception 'Approved payroll is read only' using errcode = '42501';
    end if;
    new.company_id := old.company_id; new.created_by := old.created_by; new.created_by_name := old.created_by_name;
    new.engine_number := old.engine_number; new.incidents := old.incidents; new.attachment := old.attachment; new.rows := old.rows;
    new.submitted_at := old.submitted_at; new.approved_at := old.approved_at; new.approved_by := old.approved_by;
    new.rejection_notes := old.rejection_notes; new.rejected_at := old.rejected_at; new.rejected_by := old.rejected_by;
    return new;
  end if;

  if old.status = 'pending' then
    if not public.is_company_finance_processor(old.company_id, auth.uid()) or new.status not in ('approved', 'rejected') then
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
    for manager in select user_id from public.company_members where company_id = new.company_id and role in ('owner', 'accounting') loop
      perform public.create_user_notification(new.company_id, manager.user_id, new.created_by, 'system', 'system', new.id,
        'Payroll awaiting approval', new.created_by_name || ' submitted payroll for approval.', '/payroll',
        'payroll:' || new.id::text, 'payroll-pending:' || new.id::text || ':' || extract(epoch from new.submitted_at)::text);
    end loop;
  end if;
  return new;
end $$;

grant create on schema public to fireops_sync_writer;
create or replace function public.user_sync_apply_payroll_review(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare current public.payroll_forms;
begin
  if (command = 'review.reject' and ((select array_agg(k order by k collate "C") from jsonb_object_keys(payload) k) is distinct from array['base','notes']
      or jsonb_typeof(payload -> 'notes') <> 'string' or char_length(btrim(payload ->> 'notes')) not between 1 and 1000))
    or (command <> 'review.reject' and (select array_agg(k) from jsonb_object_keys(payload) k) is distinct from array['base']) then
    raise exception 'Invalid payroll review' using errcode = '22023';
  end if;
  if not public.is_company_finance_processor(company, actor) then raise exception 'Payroll processing access required' using errcode = '42501'; end if;
  select * into current from public.payroll_forms f where f.id = record_uuid and f.company_id = company for update;
  if not found then return jsonb_build_object('notApplied', 'record_deleted'); end if;
  if not public.user_sync_base_matches(company, actor, 'payroll_review', record_uuid, public.user_sync_normalize_base(payload -> 'base'),
      public.user_sync_timestamp_base(current.updated_at), public.user_sync_state_payroll_review(company, actor, record_uuid)) then
    return jsonb_build_object('notApplied', 'changed_elsewhere');
  end if;
  if (command in ('review.approve','review.reject') and current.status <> 'pending') or (command = 'review.mark_paid' and current.status <> 'approved') then
    return jsonb_build_object('notApplied', 'changed_elsewhere');
  end if;
  update public.payroll_forms f set status = case command when 'review.approve' then 'approved' when 'review.reject' then 'rejected' else 'paid' end,
    rejection_notes = case when command = 'review.reject' then btrim(payload ->> 'notes') else f.rejection_notes end
    where f.id = record_uuid and f.company_id = company;
  return '{}'::jsonb;
end;
$$;
alter function public.user_sync_apply_payroll_review(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
revoke all on function public.user_sync_apply_payroll_review(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke create on schema public from fireops_sync_writer;

-- Invoices --------------------------------------------------------------------
alter policy "managers create invoice customers" on public.invoice_customers
with check (public.is_company_finance_processor(company_id, (select auth.uid())));
alter policy "managers update invoice customers" on public.invoice_customers
using (public.is_company_finance_processor(company_id, (select auth.uid())))
with check (public.is_company_finance_processor(company_id, (select auth.uid())));
alter policy "managers delete invoice customers" on public.invoice_customers
using (public.is_company_finance_processor(company_id, (select auth.uid())));
alter policy "users read permitted invoices" on public.invoice_forms
using (created_by = (select auth.uid()) or public.is_company_finance_processor(company_id, (select auth.uid())));
alter policy "creators and managers delete invoices" on public.invoice_forms
using ((created_by = (select auth.uid()) and status = 'draft') or public.is_company_finance_processor(company_id, (select auth.uid())));

create or replace function public.notify_submitted_invoice()
returns trigger language plpgsql security definer set search_path = '' as $$
declare manager record;
begin
  if new.status = 'submitted' and old.status = 'draft' then
    for manager in select user_id from public.company_members where company_id = new.company_id and role in ('owner', 'accounting') loop
      perform public.create_user_notification(new.company_id, manager.user_id, new.created_by, 'system', 'system', new.id,
        'Invoice submitted', new.created_by_name || ' submitted invoice ' || new.invoice_number || '.', '/invoices',
        'invoice:' || new.id::text, 'invoice-submitted:' || new.id::text);
    end loop;
  end if;
  return new;
end $$;

-- Payroll and invoice files -----------------------------------------------------
alter policy "managers read digital payroll attachments" on storage.objects
using (
  bucket_id = 'payroll-files'
  and (storage.foldername(name))[3] = 'forms'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then public.is_company_finance_processor(((storage.foldername(name))[1])::uuid, (select auth.uid()))
    else false
  end
);
alter policy "managers remove digital payroll attachments" on storage.objects
using (
  bucket_id = 'payroll-files'
  and (storage.foldername(name))[3] = 'forms'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then public.is_company_finance_processor(((storage.foldername(name))[1])::uuid, (select auth.uid()))
    else false
  end
);
alter policy "users read permitted invoice files" on storage.objects
using (
  bucket_id = 'invoice-files' and (
    (storage.foldername(name))[2] = (select auth.uid())::text
    or public.is_company_finance_processor(((storage.foldername(name))[1])::uuid, (select auth.uid()))
  )
);
alter policy "users remove permitted invoice files" on storage.objects
using (
  bucket_id = 'invoice-files' and (
    public.is_company_finance_processor(((storage.foldername(name))[1])::uuid, (select auth.uid()))
    or ((storage.foldername(name))[2] = (select auth.uid())::text and not exists (
      select 1 from public.invoice_forms form where form.attachment->>'storagePath' = name and form.status = 'submitted'
    ))
  )
);

-- Notifications -----------------------------------------------------------------
-- Accounting inboxes receive crew notifications plus payroll and invoice submissions.
create or replace function public.create_user_notification(
  target_company_id uuid,
  target_user_id uuid,
  actor_id uuid,
  notification_event_type text,
  notification_entity_type text,
  notification_entity_id uuid,
  notification_title text,
  notification_body text,
  notification_path text,
  notification_group_key text,
  notification_dedupe_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  notification_id uuid;
  preferences public.notification_preferences;
  push_allowed boolean;
  target_role text;
begin
  if target_user_id is null or target_user_id = actor_id then return null; end if;

  select member.role into target_role
  from public.company_members member
  where member.company_id = target_company_id
    and member.user_id = target_user_id;

  if target_role is null then return null; end if;

  -- Older qualification RPCs emitted this as a generic system event.
  if notification_event_type = 'system'
     and notification_dedupe_key like 'qualification-card-approved:%' then
    notification_event_type := 'qualification_approved';
  end if;

  if target_role not in ('owner', 'admin')
     and notification_event_type not in ('communication_reply', 'training_created', 'qualification_approved')
     and not (
       target_role = 'shop_tech'
       and notification_event_type in ('vehicle_note_added', 'failed_inspection')
     )
     and not (
       target_role = 'accounting'
       and notification_event_type = 'system'
       and (notification_dedupe_key like 'payroll-pending:%' or notification_dedupe_key like 'invoice-submitted:%')
     ) then
    return null;
  end if;

  insert into public.user_notifications (
    company_id, user_id, actor_user_id, event_type, entity_type, entity_id,
    title, body, path, group_key, dedupe_key
  ) values (
    target_company_id, target_user_id, actor_id, notification_event_type,
    notification_entity_type, notification_entity_id,
    left(notification_title, 180), left(notification_body, 500),
    notification_path, notification_group_key, notification_dedupe_key
  )
  on conflict (user_id, dedupe_key) do nothing
  returning id into notification_id;

  if notification_id is null then return null; end if;

  select * into preferences
  from public.notification_preferences
  where company_id = target_company_id and user_id = target_user_id;

  push_allowed := notification_event_type in ('system', 'qualification_approved') or (
    coalesce(preferences.push_enabled, true) and case notification_event_type
      when 'communication_reply' then coalesce(preferences.communication_replies, true)
      when 'document_added' then coalesce(preferences.document_added, true)
      when 'training_created' then coalesce(preferences.training_created, true)
      when 'issue_updated' then coalesce(preferences.issue_updates, true)
      when 'vehicle_note_added' then true
      when 'failed_inspection' then true
      else false
    end
  );

  if push_allowed then
    insert into public.push_notification_jobs (notification_id) values (notification_id);
  end if;
  return notification_id;
end;
$$;
revoke all on function public.create_user_notification(uuid, uuid, uuid, text, text, uuid, text, text, text, text, text)
  from public, anon, authenticated;

commit;
