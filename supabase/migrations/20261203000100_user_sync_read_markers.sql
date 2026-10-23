-- Offline read markers through the user command registry (sync_user_command).
-- Both only move forward and only touch the caller's own rows; existing RLS
-- (as the non-bypass sync writer) still authorizes every read and write.
-- * notification: `notification.read` marks the caller's own notification read
--   once, at server receipt time (the device time stays in the receipt). A
--   missing or no longer visible notification is a no-op with a null record.
-- * communication_read: `communication.seen` raises the caller's seen marker
--   for a visible thread to `seenThrough`: the newest server timestamp the
--   device actually displayed. Replies posted while the device was offline stay
--   unread. The marker never moves backwards or past server receipt time.
begin;

insert into public.user_sync_commands values
  ('notification','notification.read',false),('communication_read','communication.seen',false);

grant create on schema public to fireops_sync_writer;
create function public.user_sync_state_notification(company uuid, actor uuid, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', n.id, 'readAt', n.read_at) from public.user_notifications n
    where n.id = record_uuid and n.company_id = company and n.user_id = actor;
$$;
create function public.user_sync_apply_notification(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
begin
  if payload <> '{}'::jsonb then raise exception 'Invalid notification read' using errcode = '22023'; end if;
  update public.user_notifications n set read_at = statement_timestamp()
    where n.id = record_uuid and n.company_id = company and n.user_id = actor and n.read_at is null;
  return '{}'::jsonb;
end;
$$;
create function public.user_sync_state_communication_read(company uuid, actor uuid, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', t.id, 'seenAt', r.seen_at) from public.communication_threads t
    left join public.communication_reads r on r.company_id = t.company_id and r.thread_id = t.id and r.user_id = actor
    where t.company_id = company and t.id = record_uuid;
$$;
create function public.user_sync_apply_communication_read(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare seen timestamptz;
begin
  if (select array_agg(k) from jsonb_object_keys(payload) k) is distinct from array['seenThrough']
    or jsonb_typeof(payload -> 'seenThrough') is distinct from 'string'
    or payload ->> 'seenThrough' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then
    raise exception 'Invalid communication seen marker' using errcode = '22023';
  end if;
  seen := least((payload ->> 'seenThrough')::timestamptz, statement_timestamp());
  -- A deleted or hidden thread is a no-op, never an error or recreated state.
  if not exists (select 1 from public.communication_threads t where t.company_id = company and t.id = record_uuid) then return '{}'::jsonb; end if;
  insert into public.communication_reads (company_id, thread_id, user_id, seen_at) values (company, record_uuid, actor, seen)
    on conflict (company_id, thread_id, user_id) do update set seen_at = greatest(public.communication_reads.seen_at, excluded.seen_at);
  return '{}'::jsonb;
end;
$$;
alter function public.user_sync_state_notification(uuid, uuid, uuid) owner to fireops_sync_writer;
alter function public.user_sync_apply_notification(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
alter function public.user_sync_state_communication_read(uuid, uuid, uuid) owner to fireops_sync_writer;
alter function public.user_sync_apply_communication_read(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
revoke all on function public.user_sync_state_notification(uuid, uuid, uuid), public.user_sync_apply_notification(uuid, uuid, uuid, text, jsonb),
  public.user_sync_state_communication_read(uuid, uuid, uuid), public.user_sync_apply_communication_read(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke create on schema public from fireops_sync_writer;
commit;
