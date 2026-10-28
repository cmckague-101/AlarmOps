-- Private Crew Chat: owners/admins may mark a new thread private. Only company
-- managers (owners, admins and audited system admins) can read a private
-- thread, its replies and reply to it; crew never see it, are never notified
-- of it, and it is left out of their offline downloads (which read under RLS).
-- Offline `thread.create` accepts an optional boolean `isPrivate`. The offline
-- download keeps its exact columns: installed apps reject unknown columns.
begin;

alter table public.communication_threads add column is_private boolean not null default false;

create function public.can_access_communication_thread(target_company_id uuid, target_thread_id uuid, target_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.communication_threads thread
    where thread.company_id = target_company_id and thread.id = target_thread_id
      and (not thread.is_private or public.is_company_owner(target_company_id, target_user_id))
  );
$$;
revoke all on function public.can_access_communication_thread(uuid, uuid, uuid) from public, anon;
grant execute on function public.can_access_communication_thread(uuid, uuid, uuid) to authenticated;

drop policy if exists "company reads communication threads" on public.communication_threads;
create policy "company reads communication threads" on public.communication_threads for select to authenticated
using (
  (public.is_company_member(company_id, (select auth.uid())) or public.has_system_admin_company_access(company_id))
  and (not is_private or public.is_company_owner(company_id, (select auth.uid())))
);

drop policy if exists "company reads communication replies" on public.communication_replies;
create policy "company reads communication replies" on public.communication_replies for select to authenticated
using (
  (public.is_company_member(company_id, (select auth.uid())) or public.has_system_admin_company_access(company_id))
  and public.can_access_communication_thread(company_id, thread_id, (select auth.uid()))
);

drop policy if exists "company creates communication replies" on public.communication_replies;
create policy "company creates communication replies" on public.communication_replies for insert to authenticated
with check (
  (public.is_company_member(company_id, (select auth.uid())) or public.has_system_admin_company_access(company_id))
  and created_by = (select auth.uid())
  and public.can_access_communication_thread(company_id, thread_id, (select auth.uid()))
);

drop policy if exists "users create own communication state" on public.communication_reads;
create policy "users create own communication state" on public.communication_reads for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (public.is_company_member(company_id, (select auth.uid())) or public.has_system_admin_company_access(company_id))
  and public.can_access_communication_thread(company_id, thread_id, (select auth.uid()))
);

drop policy if exists "users update own communication state" on public.communication_reads;
create policy "users update own communication state" on public.communication_reads for update to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and (public.is_company_member(company_id, (select auth.uid())) or public.has_system_admin_company_access(company_id))
  and public.can_access_communication_thread(company_id, thread_id, (select auth.uid()))
);

-- New private threads notify only the other owners/admins.
create or replace function public.notify_communication_thread_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_id uuid;
  actor_name text := coalesce(public.notification_actor_name(new.created_by), new.created_by_name, 'FireOps user');
begin
  for recipient_id in
    select member.user_id
    from public.company_members member
    where member.company_id = new.company_id
      and member.user_id <> new.created_by
      and (not new.is_private or member.role in ('owner', 'admin'))
  loop
    perform public.create_user_notification(
      new.company_id, recipient_id, new.created_by,
      'communication_reply', 'communication', new.id,
      'New Crew Chat: ' || new.subject,
      actor_name || ' started a new ' || case when new.is_private then 'private ' else '' end || 'Crew Chat.',
      '/communication/' || new.id::text,
      'communication:' || new.id::text,
      'communication-thread-created:' || new.id::text
    );
  end loop;
  return new;
end;
$$;
revoke all on function public.notify_communication_thread_created() from public, anon, authenticated;

-- Replies to a private thread never notify someone who can no longer read it.
create or replace function public.notify_communication_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  thread_record public.communication_threads;
  recipient_id uuid;
  actor_name text := coalesce(public.notification_actor_name(new.created_by), new.created_by_name, 'FireOps user');
begin
  select * into thread_record from public.communication_threads
  where company_id = new.company_id and id = new.thread_id;

  for recipient_id in
    select distinct candidate.user_id from (
      select thread_record.created_by as user_id
      union all
      select reply.created_by from public.communication_replies reply
        where reply.company_id = new.company_id and reply.thread_id = new.thread_id
      union all
      select member.user_id from public.company_members member
        where member.company_id = new.company_id and member.role = 'owner'
    ) candidate
    where candidate.user_id is not null and candidate.user_id <> new.created_by
      and (not thread_record.is_private or exists (
        select 1 from public.company_members member
        where member.company_id = new.company_id and member.user_id = candidate.user_id and member.role in ('owner', 'admin')
      ))
  loop
    perform public.create_user_notification(
      new.company_id, recipient_id, new.created_by,
      'communication_reply', 'communication', new.thread_id,
      'Reply: ' || thread_record.subject,
      actor_name || ' replied: ' || new.body,
      '/communication/' || new.thread_id::text,
      'communication:' || new.thread_id::text,
      'communication-reply:' || new.id::text
    );
  end loop;
  return new;
end;
$$;
revoke all on function public.notify_communication_reply() from public, anon, authenticated;

grant create on schema public to fireops_sync_writer;
create or replace function public.user_sync_apply_communication_thread(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
begin
  if coalesce((select array_agg(k order by k collate "C") from jsonb_object_keys(payload) k), array[]::text[]) not in (array['description','subject'], array['description','isPrivate','subject'])
    or jsonb_typeof(payload -> 'subject') <> 'string' or char_length(btrim(payload ->> 'subject')) not between 1 and 160
    or jsonb_typeof(payload -> 'description') <> 'string' or char_length(btrim(payload ->> 'description')) not between 1 and 5000
    or (payload ? 'isPrivate' and jsonb_typeof(payload -> 'isPrivate') <> 'boolean') then
    raise exception 'Invalid Crew Chat thread' using errcode = '22023';
  end if;
  begin
    insert into public.communication_threads (id, company_id, subject, description, is_private, created_by, created_by_name, created_by_role)
      values (record_uuid, company, btrim(payload ->> 'subject'), btrim(payload ->> 'description'), coalesce((payload ->> 'isPrivate')::boolean, false), actor, '', 'owner');
  exception when unique_violation then
    raise exception 'This thread identity was already used' using errcode = '23505';
  end;
  return '{}'::jsonb;
end;
$$;
alter function public.user_sync_apply_communication_thread(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
revoke create on schema public from fireops_sync_writer;
commit;
