-- Offline Crew Chat replies through the user command registry (sync_user_command).
-- * communication_reply: `reply.create` inserts one reply with the device's
--   client UUID into a thread still visible to the caller. Existing RLS,
--   attribution (author/name from the caller's JWT) and notification triggers
--   apply unchanged; the receipt makes the insert, and so its notifications,
--   happen once. created_at is server receipt time, so the reply appears where
--   it actually joined the conversation; the device time stays in the receipt.
--   A thread deleted meanwhile reports notApplied = 'thread_deleted' and
--   creates nothing; the text stays on the device. A reused reply identity
--   with different content fails with 23505.
begin;

insert into public.user_sync_commands values ('communication_reply','reply.create',false);

grant create on schema public to fireops_sync_writer;
create function public.user_sync_state_communication_reply(company uuid, actor uuid, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'threadId', r.thread_id, 'body', r.body, 'createdAt', r.created_at) from public.communication_replies r
    where r.id = record_uuid and r.company_id = company and r.created_by = actor;
$$;
create function public.user_sync_apply_communication_reply(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare existing public.communication_replies;
begin
  if (select array_agg(k order by k collate "C") from jsonb_object_keys(payload) k) is distinct from array['body','threadId']
    or jsonb_typeof(payload -> 'threadId') is distinct from 'string'
    or payload ->> 'threadId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(payload -> 'body') is distinct from 'string' or char_length(btrim(payload ->> 'body')) not between 1 and 5000 then
    raise exception 'Invalid Crew Chat reply' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('communication-reply:' || record_uuid::text, 0));
  -- Any row with this ID, visible or not, means the identity is already used.
  if exists (select 1 from public.communication_replies r where r.id = record_uuid) then
    select * into existing from public.communication_replies r where r.id = record_uuid and r.company_id = company and r.created_by = actor;
    if existing.id is null or existing.thread_id <> (payload ->> 'threadId')::uuid or existing.body <> btrim(payload ->> 'body') then
      raise exception 'This reply identity was already used' using errcode = '23505';
    end if;
    return '{}'::jsonb;
  end if;
  if not exists (select 1 from public.communication_threads t where t.company_id = company and t.id = (payload ->> 'threadId')::uuid) then
    return jsonb_build_object('notApplied', 'thread_deleted');
  end if;
  insert into public.communication_replies (id, company_id, thread_id, body)
    values (record_uuid, company, (payload ->> 'threadId')::uuid, btrim(payload ->> 'body'));
  return '{}'::jsonb;
end;
$$;
alter function public.user_sync_state_communication_reply(uuid, uuid, uuid) owner to fireops_sync_writer;
alter function public.user_sync_apply_communication_reply(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
revoke all on function public.user_sync_state_communication_reply(uuid, uuid, uuid), public.user_sync_apply_communication_reply(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke create on schema public from fireops_sync_writer;
commit;
