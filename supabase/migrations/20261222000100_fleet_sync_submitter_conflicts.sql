-- Fleet conflicts are resolved by the person who made the offline change, not by
-- owner/admin review (product owner decision, 2026-10-23). A conflicting change
-- still never overwrites anything automatically. The device warns its user, who
-- either cancels the change or submits it again on top of the current version.
-- Both start with withdraw_my_fleet_sync_conflict, which closes the user's own
-- pending conflict and records a "not_selected" outcome through the existing
-- decision/outcome audit, so devices finish the original change with the same
-- verified outcome path a manager decision used. "Submit again" is then an
-- ordinary new verified update from the current version (it can conflict again
-- if someone changes the record once more in between).
begin;

create policy "sync writer reads own conflicts" on public.fleet_sync_conflicts
  for select to fireops_sync_writer using (actor_user_id = (select auth.uid()));
create policy "sync writer withdraws own conflicts" on public.fleet_sync_conflicts
  for update to fireops_sync_writer using (actor_user_id = (select auth.uid()) and state = 'pending')
  with check (actor_user_id = (select auth.uid()));
create policy "sync writer records own withdrawal" on public.fleet_sync_decisions
  for insert to fireops_sync_writer with check (reviewer_user_id = (select auth.uid()) and result ->> 'kind' = 'withdrawn');
create policy "sync writer records own withdrawn outcome" on public.fleet_sync_outcomes
  for insert to fireops_sync_writer with check (actor_user_id = (select auth.uid()) and outcome = 'not_selected' and kept_fields = '{}');

grant create on schema public to fireops_sync_writer;
create function public.withdraw_my_fleet_sync_conflict(target_company_id uuid, operation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  conflict public.fleet_sync_conflicts;
  current_version bigint;
  current_data jsonb;
  discarded text[];
  decision uuid := gen_random_uuid();
  decided timestamptz := clock_timestamp();
  existing jsonb;
begin
  if actor is null or target_company_id is null or operation_id is null or not public.is_company_member(target_company_id, actor) then
    raise exception 'Company membership required' using errcode = '42501';
  end if;
  select * into conflict from public.fleet_sync_conflicts c
    where c.company_id = target_company_id and c.actor_user_id = actor and c.operation_id = withdraw_my_fleet_sync_conflict.operation_id;
  if not found then raise exception 'No conflict for this change' using errcode = 'P0002'; end if;
  -- Same record-group lock as submission and review, before any row lock.
  perform public.lock_fleet_sync_review(target_company_id, conflict.entity_type, conflict.record_id);
  select jsonb_build_object('kind','reviewed','decisionId',o.decision_id,'conflictId',o.conflict_id,'operationId',o.operation_id,
      'decidedAt',o.decided_at,'outcome',o.outcome,'keptFields',to_jsonb(o.kept_fields),'discardedFields',to_jsonb(o.discarded_fields),'revision',o.revision::text)
    into existing from public.fleet_sync_outcomes o
    where o.company_id = target_company_id and o.actor_user_id = actor and o.operation_id = withdraw_my_fleet_sync_conflict.operation_id;
  if existing is not null then return existing; end if; -- already decided or withdrawn: replay the outcome
  if conflict.entity_type = 'vehicle' then
    select v.version, v.data into current_version, current_data from public.fleet_vehicles v where v.company_id = target_company_id and v.record_id = conflict.record_id;
  else
    select i.version, i.data into current_version, current_data from public.fleet_issues i where i.company_id = target_company_id and i.record_id = conflict.record_id;
  end if;
  if current_version is null then
    select max(r.version) into current_version from public.fleet_sync_revisions r
      where r.company_id = target_company_id and r.collection = case conflict.entity_type when 'vehicle' then 'vehicles' else 'issues' end and r.record_id = conflict.record_id;
  end if;
  current_version := greatest(coalesce(current_version, conflict.current_revision), conflict.current_revision);
  select coalesce(array_agg(k order by k), '{}'::text[]) into discarded from jsonb_object_keys(conflict.base_record || conflict.proposed_record) k
    where conflict.base_record -> k is distinct from conflict.proposed_record -> k;
  insert into public.fleet_sync_decisions (id, company_id, reviewer_user_id, reviewer_name, request_id, request_sha256, entity_type, record_id, review_token,
      candidate_ids, choices, field_sources, before_revision, after_revision, applied_revision, before_record, after_record, decided_at, result)
    values (decision, target_company_id, actor, (select nullif(p.full_name, '') from public.profiles p where p.user_id = actor), gen_random_uuid(),
      sha256(convert_to('withdraw:' || conflict.id::text, 'UTF8')), conflict.entity_type, conflict.record_id, 'withdrawn-by-submitter',
      array[conflict.id], '{}'::jsonb, '{}'::jsonb, current_version, current_version, null, current_data, current_data, decided,
      jsonb_build_object('kind', 'withdrawn', 'conflictId', conflict.id));
  insert into public.fleet_sync_outcomes (company_id, actor_user_id, operation_id, conflict_id, decision_id, outcome, kept_fields, discarded_fields, revision, decided_at)
    values (target_company_id, actor, conflict.operation_id, conflict.id, decision, 'not_selected', '{}', discarded, current_version, decided);
  update public.fleet_sync_conflicts c set state = 'resolved' where c.id = conflict.id;
  return jsonb_build_object('kind','reviewed','decisionId',decision,'conflictId',conflict.id,'operationId',conflict.operation_id,
    'decidedAt',decided,'outcome','not_selected','keptFields','[]'::jsonb,'discardedFields',to_jsonb(discarded),'revision',current_version::text);
end;
$$;
alter function public.withdraw_my_fleet_sync_conflict(uuid, uuid) owner to fireops_sync_writer;
revoke all on function public.withdraw_my_fleet_sync_conflict(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.withdraw_my_fleet_sync_conflict(uuid, uuid) to authenticated;
revoke create on schema public from fireops_sync_writer;
commit;
