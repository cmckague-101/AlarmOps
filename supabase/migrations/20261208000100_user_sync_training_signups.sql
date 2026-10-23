-- Offline training sign-up and cancel through the user command registry.
-- Decided policy (product owner): a sign-up that arrives after the class filled
-- is rejected as full and kept on the device; capacity is never exceeded.
-- * training_signup (entity ID = training ID, so one user's join/cancel for a
--   training apply in device order):
--   - `signup.join`: signs the caller up through the existing insert trigger,
--     which checks capacity under the training row lock, and RLS. Already signed up is a no-op. A full
--     class returns notApplied = 'course_full'; a deleted training returns
--     notApplied = 'training_deleted'. Nothing changes in either case.
--   - `signup.cancel`: removes the caller's own sign-up if present.
begin;

insert into public.user_sync_commands values ('training_signup','signup.join',false),('training_signup','signup.cancel',false);

grant create on schema public to fireops_sync_writer;
create function public.user_sync_state_training_signup(company uuid, actor uuid, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', t.id, 'signedUp', exists (select 1 from public.company_training_signups s
      where s.company_id = company and s.training_id = t.id and s.user_id = actor))
    from public.company_trainings t where t.company_id = company and t.id = record_uuid;
$$;
create function public.user_sync_apply_training_signup(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
begin
  if payload <> '{}'::jsonb then raise exception 'Invalid training sign-up' using errcode = '22023'; end if;
  if command = 'signup.cancel' then
    delete from public.company_training_signups s where s.company_id = company and s.training_id = record_uuid and s.user_id = actor;
    return '{}'::jsonb;
  end if;
  if not exists (select 1 from public.company_trainings t where t.company_id = company and t.id = record_uuid) then
    return jsonb_build_object('notApplied', 'training_deleted');
  end if;
  if exists (select 1 from public.company_training_signups s where s.company_id = company and s.training_id = record_uuid and s.user_id = actor) then
    return '{}'::jsonb;
  end if;
  -- The existing insert trigger checks capacity under the training row lock
  -- (crew cannot take that lock through RLS here); map its refusals.
  begin
    insert into public.company_training_signups (company_id, training_id, user_id, user_name) values (company, record_uuid, actor, '');
  exception
    when check_violation then return jsonb_build_object('notApplied', 'course_full');
    when no_data_found then return jsonb_build_object('notApplied', 'training_deleted');
  end;
  return '{}'::jsonb;
end;
$$;
alter function public.user_sync_state_training_signup(uuid, uuid, uuid) owner to fireops_sync_writer;
alter function public.user_sync_apply_training_signup(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
revoke all on function public.user_sync_state_training_signup(uuid, uuid, uuid), public.user_sync_apply_training_signup(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke create on schema public from fireops_sync_writer;
commit;
