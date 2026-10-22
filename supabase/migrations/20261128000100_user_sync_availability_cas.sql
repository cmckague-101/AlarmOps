-- Online availability writers do not take the user-command advisory lock.
-- Check the captured base in the mutation itself, under the row lock, rather
-- than reading it before an unconditional UPSERT. Preserve the existing RPC,
-- executor ownership, ACLs, RLS and immutable receipt/retry contract.
begin;

-- Also repair registries created by the earlier development version of 20261127.
-- This is global dispatch configuration, not tenant data; only trusted executors
-- have SELECT. No client grants or registry write access are added.
alter table public.user_sync_commands enable row level security;
drop policy if exists "sync executors read command registry" on public.user_sync_commands;
create policy "sync executors read command registry" on public.user_sync_commands
  for select to fireops_sync_writer, service_role using (true);

create or replace function public.user_sync_apply_availability(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare changed_rows bigint;
begin
  if (select array_agg(k order by k collate "C") from jsonb_object_keys(payload) k) is distinct from array['available','base']
    or jsonb_typeof(payload -> 'available') <> 'boolean' or jsonb_typeof(payload -> 'base') not in ('boolean','null') then
    raise exception 'Invalid availability' using errcode = '22023';
  end if;
  if payload -> 'base' = 'null'::jsonb then
    -- Only a missing base may create a row. A concurrent insert must either
    -- have the same requested value or be kept, never overwritten.
    insert into public.crew_availability (company_id, user_id, available, updated_at)
      values (company, actor, (payload ->> 'available')::boolean, statement_timestamp())
      on conflict (company_id, user_id) do update
        set available = excluded.available, updated_at = excluded.updated_at
        where public.crew_availability.available = excluded.available;
  else
    -- UPDATE rechecks this predicate after waiting for a concurrent writer.
    -- A deleted row remains missing; an old non-null base cannot recreate it.
    update public.crew_availability a
      set available = (payload ->> 'available')::boolean, updated_at = statement_timestamp()
      where a.company_id = company and a.user_id = actor
        and (a.available = (payload ->> 'base')::boolean or a.available = (payload ->> 'available')::boolean);
  end if;
  get diagnostics changed_rows = row_count;
  if changed_rows = 0 then return jsonb_build_object('keptCurrent', true); end if;
  return '{}'::jsonb;
end;
$$;

commit;
