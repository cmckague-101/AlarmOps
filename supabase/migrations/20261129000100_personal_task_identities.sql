-- Tasks remain private and completing still removes their content. Retain ONLY
-- opaque UUIDs, without company/user/content/times, to prevent a delayed create
-- or a different operation ID from resurrecting completed work. UUID retirement
-- survives company/profile deletion; it is not completed-task content history.
begin;

-- Serialize the backfill/trigger installation with every task writer and receipt
-- writer. Lock tasks first, matching commands' business-row-before-receipt order.
lock table public.personal_tasks in share row exclusive mode;
lock table public.user_sync_receipts in share row exclusive mode;

create table public.personal_task_identities (id uuid primary key);
alter table public.personal_task_identities enable row level security;
revoke all on public.personal_task_identities from public, anon, authenticated, service_role;
grant select on public.personal_task_identities to service_role;
grant select, insert on public.personal_task_identities to fireops_sync_writer;
create policy "sync executor reads opaque task identities" on public.personal_task_identities
  for select to fireops_sync_writer, service_role using (true);
create policy "sync executor reserves opaque task identities" on public.personal_task_identities
  for insert to fireops_sync_writer with check (true);

-- Receipts also retire IDs mentioned by successful absent-task completions.
-- This records no assertion that such a task existed, nor who owned it.
-- Already-deleted legacy IDs absent from BOTH sources cannot be reconstructed.
insert into public.personal_task_identities (id)
  select id from public.personal_tasks
  union select entity_id from public.user_sync_receipts where entity_type = 'personal_task';

grant create on schema public to fireops_sync_writer;
create function public.reserve_personal_task_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if (new.id, new.company_id, new.user_id) is distinct from (old.id, old.company_id, old.user_id) then
      raise exception 'Personal task identity and ownership are immutable' using errcode = '42501';
    end if;
  else
    -- No ON CONFLICT fallback: a retired identity must never become a new row.
    insert into public.personal_task_identities (id) values (new.id);
  end if;
  return new;
end;
$$;
alter function public.reserve_personal_task_identity() owner to fireops_sync_writer;
revoke all on function public.reserve_personal_task_identity() from public, anon, authenticated, service_role;
-- AFTER INSERT lets normal RLS/constraints authorize the task first. Any
-- retirement collision still rolls back the inserted row and all side effects.
create trigger reserve_personal_task_identity after insert on public.personal_tasks
  for each row execute function public.reserve_personal_task_identity();
create trigger guard_personal_task_ownership before update on public.personal_tasks
  for each row execute function public.reserve_personal_task_identity();

create function public.retire_personal_task_command_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.personal_task_identities (id) values (new.entity_id) on conflict do nothing;
  return new;
end;
$$;
alter function public.retire_personal_task_command_identity() owner to fireops_sync_writer;
revoke all on function public.retire_personal_task_command_identity() from public, anon, authenticated, service_role;
create trigger retire_personal_task_command_identity after insert on public.user_sync_receipts
  for each row when (new.entity_type = 'personal_task') execute function public.retire_personal_task_command_identity();
revoke create on schema public from fireops_sync_writer;

-- DELETE RLS silently filters rows for ineligible members. Prevent a forbidden
-- absent-task completion from receiving a receipt/retiring an ID, and prevent
-- cached task receipts from bypassing a subsequent task-role revocation.
drop policy "sync writer reads own user receipts" on public.user_sync_receipts;
create policy "sync writer reads own user receipts" on public.user_sync_receipts
  for select to fireops_sync_writer using (user_id = (select auth.uid()) and
    (entity_type <> 'personal_task' or exists (select 1 from public.company_members m
      where m.company_id = user_sync_receipts.company_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin','shop_tech'))));
drop policy "sync writer records own user receipts" on public.user_sync_receipts;
create policy "sync writer records own user receipts" on public.user_sync_receipts
  for insert to fireops_sync_writer with check (user_id = (select auth.uid()) and
    (entity_type <> 'personal_task' or exists (select 1 from public.company_members m
      where m.company_id = user_sync_receipts.company_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin','shop_tech'))));

-- Permission denial must not be returned as a canonical deletion.
create or replace function public.user_sync_state_personal_task(company uuid, actor uuid, record_uuid uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if actor is distinct from auth.uid() or not exists (select 1 from public.company_members m
      where m.company_id = company and m.user_id = actor and m.role in ('owner','admin','shop_tech')) then
    raise exception 'Current personal-task access required' using errcode = '42501';
  end if;
  select jsonb_build_object('id', t.id, 'subject', t.subject, 'description', t.description, 'dueDate', t.due_date::text)
    into result from public.personal_tasks t where t.id = record_uuid and t.company_id = company and t.user_id = actor;
  return result;
end;
$$;

create function public.guard_personal_task_identities()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Personal task identity retirement is append-only' using errcode = '42501';
end;
$$;
revoke all on function public.guard_personal_task_identities() from public, anon, authenticated, service_role;
create trigger guard_personal_task_identities before update or delete on public.personal_task_identities
  for each row execute function public.guard_personal_task_identities();

commit;
