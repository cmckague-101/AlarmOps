-- Verified download of the caller's own user-domain data for offline display:
-- personal tasks (current task roles only), own availability and dashboard
-- layout, in ONE statement (one database snapshot) with the receipt watermark.
-- The device shows this snapshot, then its own receipts newer than the
-- watermark, then pending commands. The shared per-user lock waits for the
-- caller's in-flight sync_user_command transactions, so every receipt at or
-- below the watermark is reflected in the snapshot.
-- Denied task access returns tasks = null ("not available"), never an empty
-- list that a device could mistake for deletions.
begin;

grant create on schema public to fireops_sync_writer;
create function public.get_user_sync_snapshot(target_company_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  result jsonb;
begin
  if actor is null or target_company_id is null or not public.is_company_member(target_company_id, actor) then
    raise exception 'Company membership required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('user-sync-user:' || actor::text, 0));
  select jsonb_build_object(
    'schemaVersion', 1, 'companyId', target_company_id, 'userId', actor, 'serverRequestAt', statement_timestamp(),
    'receiptWatermark', coalesce((select max(r.sequence) from public.user_sync_receipts r where r.user_id = actor), 0)::text,
    'tasks', case when m.role in ('owner','admin','shop_tech') then
      (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'subject', t.subject, 'description', t.description, 'dueDate', t.due_date::text)
        order by t.due_date, t.created_at, t.id), '[]'::jsonb)
        from public.personal_tasks t where t.company_id = target_company_id and t.user_id = actor) end,
    'availability', (select a.available from public.crew_availability a where a.company_id = target_company_id and a.user_id = actor),
    'dashboard', coalesce((select p.items from public.dashboard_preferences p where p.user_id = actor), '{}'::jsonb))
    into result from public.company_members m where m.company_id = target_company_id and m.user_id = actor;
  if result is null then raise exception 'Company membership required' using errcode = '42501'; end if;
  if jsonb_typeof(result -> 'tasks') = 'array' and jsonb_array_length(result -> 'tasks') > 1000 then
    raise exception 'Too many personal tasks to download' using errcode = '54000';
  end if;
  return result;
end;
$$;
alter function public.get_user_sync_snapshot(uuid) owner to fireops_sync_writer;
revoke all on function public.get_user_sync_snapshot(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_user_sync_snapshot(uuid) to authenticated;
revoke create on schema public from fireops_sync_writer;
commit;
