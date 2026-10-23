-- Verified offline downloads of company lists the caller can already read:
-- inventory, training, payroll, invoices, receipts, Crew Chat and the caller's
-- own notification inbox (latest 500) and preferences. Each section is read in
-- ONE statement (one database snapshot) under the existing row-level security
-- (the non-bypass sync writer), with exactly the columns the mobile stores load
-- online, plus the caller's user-receipt watermark taken under the shared
-- per-user lock (as get_user_sync_snapshot), so the device knows which of its
-- own applied commands the download already reflects.
-- A section over 5000 rows (Crew Chat: 10000) is refused (54000) rather than
-- silently truncated. Only the notification inbox is a bounded recent window,
-- like the online inbox (which shows the latest 100).
begin;

grant create on schema public to fireops_sync_writer;
create function public.get_company_sync_snapshot(target_company_id uuid, section text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  tables jsonb;
  total int;
begin
  if actor is null or target_company_id is null or not public.is_company_member(target_company_id, actor) then
    raise exception 'Company membership required' using errcode = '42501';
  end if;
  if section is null or section not in ('inventory','training','payroll','invoices','receipts','crew_chat','notifications') then
    raise exception 'Unsupported download section' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('user-sync-user:' || actor::text, 0));
  tables := case section
    when 'inventory' then jsonb_build_object(
      'company_inventory_items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'quantity', i.quantity, 'created_at', i.created_at, 'updated_at', i.updated_at) order by i.name, i.id), '[]'::jsonb)
        from public.company_inventory_items i where i.company_id = target_company_id),
      'company_inventory_checkouts', (select coalesce(jsonb_agg(jsonb_build_object('item_id', c.item_id, 'user_id', c.user_id, 'user_name', c.user_name, 'quantity', c.quantity, 'checked_out_at', c.checked_out_at, 'updated_at', c.updated_at) order by c.item_id, c.user_id), '[]'::jsonb)
        from public.company_inventory_checkouts c where c.company_id = target_company_id))
    when 'training' then jsonb_build_object(
      'company_trainings', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'course_code', t.course_code, 'course_title', t.course_title, 'starts_at', t.starts_at, 'location', t.location,
          'instructor', t.instructor, 'capacity', t.capacity, 'course_information', t.course_information, 'created_at', t.created_at, 'updated_at', t.updated_at) order by t.starts_at, t.id), '[]'::jsonb)
        from public.company_trainings t where t.company_id = target_company_id),
      'company_training_signups', (select coalesce(jsonb_agg(jsonb_build_object('training_id', s.training_id, 'user_id', s.user_id, 'user_name', s.user_name, 'signed_up_at', s.signed_up_at) order by s.training_id, s.user_id), '[]'::jsonb)
        from public.company_training_signups s where s.company_id = target_company_id),
      'company_training_reads', (select coalesce(jsonb_agg(jsonb_build_object('training_id', r.training_id, 'viewed_at', r.viewed_at) order by r.training_id), '[]'::jsonb)
        from public.company_training_reads r where r.company_id = target_company_id and r.user_id = actor))
    when 'payroll' then jsonb_build_object(
      'payroll_forms', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'company_id', f.company_id, 'created_by', f.created_by, 'created_by_name', f.created_by_name,
          'engine_number', f.engine_number, 'incidents', f.incidents, 'attachment', f.attachment, 'rows', f.rows, 'status', f.status, 'submitted_at', f.submitted_at,
          'approved_at', f.approved_at, 'approved_by', f.approved_by, 'rejection_notes', f.rejection_notes, 'rejected_at', f.rejected_at, 'rejected_by', f.rejected_by,
          'created_at', f.created_at, 'updated_at', f.updated_at) order by f.created_at desc, f.id), '[]'::jsonb)
        from public.payroll_forms f where f.company_id = target_company_id))
    when 'invoices' then jsonb_build_object(
      'invoice_forms', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'company_id', f.company_id, 'created_by', f.created_by, 'created_by_name', f.created_by_name,
          'invoice_number', f.invoice_number, 'invoice_date', f.invoice_date, 'invoice_amount', f.invoice_amount, 'customer_id', f.customer_id, 'attachment', f.attachment,
          'status', f.status, 'submitted_at', f.submitted_at, 'created_at', f.created_at, 'updated_at', f.updated_at) order by f.created_at desc, f.id), '[]'::jsonb)
        from public.invoice_forms f where f.company_id = target_company_id),
      'invoice_customers', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'company_id', c.company_id, 'name', c.name, 'created_at', c.created_at, 'updated_at', c.updated_at) order by c.name, c.id), '[]'::jsonb)
        from public.invoice_customers c where c.company_id = target_company_id))
    when 'crew_chat' then jsonb_build_object(
      'communication_threads', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'subject', t.subject, 'description', t.description, 'created_by', t.created_by,
          'created_by_name', t.created_by_name, 'created_by_role', t.created_by_role, 'created_at', t.created_at) order by t.created_at desc, t.id), '[]'::jsonb)
        from public.communication_threads t where t.company_id = target_company_id),
      'communication_replies', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'thread_id', r.thread_id, 'body', r.body, 'created_by', r.created_by,
          'created_by_name', r.created_by_name, 'created_at', r.created_at) order by r.created_at, r.id), '[]'::jsonb)
        from public.communication_replies r where r.company_id = target_company_id),
      'communication_reads', (select coalesce(jsonb_agg(jsonb_build_object('thread_id', r.thread_id, 'seen_at', r.seen_at) order by r.thread_id), '[]'::jsonb)
        from public.communication_reads r where r.company_id = target_company_id and r.user_id = actor))
    when 'notifications' then jsonb_build_object(
      'user_notifications', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'event_type', n.event_type, 'entity_type', n.entity_type, 'entity_id', n.entity_id,
          'title', n.title, 'body', n.body, 'path', n.path, 'group_key', n.group_key, 'read_at', n.read_at, 'created_at', n.created_at) order by n.created_at desc, n.id), '[]'::jsonb)
        from (select * from public.user_notifications n where n.company_id = target_company_id and n.user_id = actor order by n.created_at desc, n.id limit 500) n),
      'notification_preferences', (select coalesce(jsonb_agg(jsonb_build_object('push_enabled', p.push_enabled, 'communication_replies', p.communication_replies,
          'document_added', p.document_added, 'training_created', p.training_created, 'issue_updates', p.issue_updates)), '[]'::jsonb)
        from public.notification_preferences p where p.company_id = target_company_id and p.user_id = actor))
    else jsonb_build_object(
      'company_receipts', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'amount_cents', r.amount_cents, 'original_file_name', r.original_file_name,
          'mime_type', r.mime_type, 'byte_size', r.byte_size, 'storage_path', r.storage_path, 'uploaded_by', r.uploaded_by, 'uploaded_by_name', r.uploaded_by_name,
          'created_at', r.created_at) order by r.created_at desc, r.id), '[]'::jsonb)
        from public.company_receipts r where r.company_id = target_company_id))
  end;
  select coalesce(sum(jsonb_array_length(value)), 0) into total from jsonb_each(tables);
  if total > (case section when 'crew_chat' then 10000 else 5000 end) then raise exception 'Too many records to download for offline use' using errcode = '54000'; end if;
  return jsonb_build_object('schemaVersion', 1, 'section', section, 'companyId', target_company_id, 'userId', actor,
    'serverRequestAt', statement_timestamp(),
    'receiptWatermark', coalesce((select max(r.sequence) from public.user_sync_receipts r where r.user_id = actor), 0)::text,
    'tables', tables);
end;
$$;
alter function public.get_company_sync_snapshot(uuid, text) owner to fireops_sync_writer;
revoke all on function public.get_company_sync_snapshot(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.get_company_sync_snapshot(uuid, text) to authenticated;
revoke create on schema public from fireops_sync_writer;
commit;
