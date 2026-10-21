-- Manager review for the existing scalar-detail adapter. No client writes to
-- decisions/outcomes, no automatic restoration, and no feature UI enabled here.
begin;

-- Preserve the original upload acknowledgment even when review later accepts it.
alter table public.fleet_sync_submissions add column initial_result jsonb;
update public.fleet_sync_submissions set initial_result = result;
alter table public.fleet_sync_submissions alter column initial_result set not null;
create function public.preserve_fleet_sync_initial_result()
returns trigger language plpgsql set search_path = '' as $$
begin new.initial_result := new.result; return new; end;
$$;
revoke all on function public.preserve_fleet_sync_initial_result() from public, anon, authenticated, service_role;
create trigger preserve_initial_result before insert on public.fleet_sync_submissions
  for each row execute function public.preserve_fleet_sync_initial_result();
grant update(result) on public.fleet_sync_submissions to fireops_sync_writer;
create policy "sync writer accepts reviewed submissions" on public.fleet_sync_submissions
  for update to fireops_sync_writer using (public.is_company_owner(company_id, (select auth.uid())))
  with check (public.is_company_owner(company_id, (select auth.uid())));
grant update(state) on public.fleet_sync_conflicts to fireops_sync_writer;
create policy "sync writer closes reviewed conflicts" on public.fleet_sync_conflicts
  for update to fireops_sync_writer using (public.is_company_owner(company_id, (select auth.uid())))
  with check (public.is_company_owner(company_id, (select auth.uid())));

create table public.fleet_sync_decisions (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  reviewer_user_id uuid not null,
  reviewer_name text,
  request_id uuid not null,
  request_sha256 bytea not null check (octet_length(request_sha256) = 32),
  entity_type text not null check (entity_type in ('vehicle','issue')),
  record_id uuid not null,
  review_token text not null,
  candidate_ids uuid[] not null,
  choices jsonb not null,
  field_sources jsonb not null,
  before_revision bigint not null,
  after_revision bigint not null,
  applied_revision bigint,
  before_record jsonb,
  after_record jsonb,
  decided_at timestamptz not null,
  result jsonb not null,
  unique(company_id, reviewer_user_id, request_id)
);
create unique index fleet_sync_decisions_revision_idx on public.fleet_sync_decisions(company_id, entity_type, record_id, applied_revision)
  where applied_revision is not null;
alter table public.fleet_sync_decisions enable row level security;
revoke all on public.fleet_sync_decisions from public, anon, authenticated, service_role;
grant select on public.fleet_sync_decisions to authenticated, service_role;
grant select, insert on public.fleet_sync_decisions to fireops_sync_writer;
create policy "managers read sync decision audit" on public.fleet_sync_decisions
  for select to authenticated using (public.is_company_owner(company_id, (select auth.uid())));
create policy "sync writer records own decision" on public.fleet_sync_decisions
  for insert to fireops_sync_writer with check (
    reviewer_user_id = (select auth.uid()) and public.is_company_owner(company_id, (select auth.uid()))
  );

-- Outcomes contain no record values, so a submitter who is still a member can
-- learn the decision even after demotion. Canonical data requires fresh RLS reads.
create table public.fleet_sync_outcomes (
  company_id uuid not null,
  actor_user_id uuid not null,
  operation_id uuid not null,
  conflict_id uuid not null references public.fleet_sync_conflicts(id) on delete cascade,
  decision_id uuid not null references public.fleet_sync_decisions(id) on delete cascade,
  outcome text not null check (outcome in ('kept','partially_kept','not_selected')),
  kept_fields text[] not null,
  discarded_fields text[] not null,
  revision bigint not null,
  decided_at timestamptz not null,
  primary key(company_id, actor_user_id, operation_id),
  foreign key(company_id, actor_user_id, operation_id)
    references public.fleet_sync_submissions(company_id, actor_user_id, operation_id) on delete cascade
);
alter table public.fleet_sync_outcomes enable row level security;
revoke all on public.fleet_sync_outcomes from public, anon, authenticated, service_role;
grant select on public.fleet_sync_outcomes to authenticated, service_role;
grant select, insert on public.fleet_sync_outcomes to fireops_sync_writer;
create policy "members read own sync outcomes or manage company outcomes" on public.fleet_sync_outcomes
  for select to authenticated using (
    public.is_company_owner(company_id, (select auth.uid()))
    or (actor_user_id = (select auth.uid()) and public.is_company_member(company_id, (select auth.uid())))
  );
create policy "sync writer records managed outcome" on public.fleet_sync_outcomes
  for insert to fireops_sync_writer with check (public.is_company_owner(company_id, (select auth.uid())));

-- Record-group locking is always BEFORE a live row lock. The wrapper below
-- brings submissions into this order, preventing submit-vs-approve deadlocks.
create function public.lock_fleet_sync_review(company uuid, entity text, record_uuid uuid)
returns void language sql volatile set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('fleet-review:v1:' || company::text || ':' || entity || ':' || record_uuid::text, 0));
$$;
revoke all on function public.lock_fleet_sync_review(uuid,text,uuid) from public, anon, authenticated, service_role;
grant execute on function public.lock_fleet_sync_review(uuid,text,uuid) to fireops_sync_writer;

create function public.fleet_sync_field_provenance(company uuid, entity text, record_uuid uuid, revision_number bigint, field_names text[])
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_object_agg(fields.key,
    case when decision.field_sources ? fields.key then decision.field_sources -> fields.key || jsonb_build_object(
      'revision',latest.version::text,'approvedBy',decision.reviewer_user_id,'approvedByName',decision.reviewer_name,'approvedAt',decision.decided_at)
    else jsonb_build_object(
      'userId',latest.actor_user_id,'actorName',coalesce(submission.actor_name,profile.full_name),
      'revision',latest.version::text,'origin',latest.origin,
      'serverRecordedAt',case when latest.origin <> 'baseline' then latest.recorded_at end,
      'savedAt',submission.saved_at,'deviceId',submission.device_id,'connectivity',coalesce(submission.connectivity,'unknown')) end
  ), '{}'::jsonb)
  from unnest(field_names) fields(key)
  left join lateral (
    select r.* from public.fleet_sync_revisions r where r.company_id = company
      and r.collection = case entity when 'vehicle' then 'vehicles' when 'issue' then 'issues' end
      and r.record_id = record_uuid and r.version <= revision_number and fields.key = any(r.changed_fields)
      order by r.version desc limit 1
  ) latest on true
  left join public.fleet_sync_submissions submission on submission.company_id = company and submission.entity_type = entity
    and submission.record_id = record_uuid and submission.applied_revision = latest.version
  left join public.fleet_sync_decisions decision on decision.company_id = company and decision.entity_type = entity
    and decision.record_id = record_uuid and decision.applied_revision = latest.version
  left join public.profiles profile on profile.user_id = latest.actor_user_id;
$$;
revoke all on function public.fleet_sync_field_provenance(uuid,text,uuid,bigint,text[]) from public, anon, authenticated, service_role;
grant execute on function public.fleet_sync_field_provenance(uuid,text,uuid,bigint,text[]) to fireops_sync_writer;

create function public.prepare_fleet_sync_conflict()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform public.lock_fleet_sync_review(new.company_id,new.entity_type,new.record_id);
  new.current_provenance := public.fleet_sync_field_provenance(new.company_id,new.entity_type,new.record_id,new.current_revision,
    array(select jsonb_object_keys(new.base_record || coalesce(new.current_record,'{}'::jsonb) || new.proposed_record)));
  return new;
end;
$$;
revoke all on function public.prepare_fleet_sync_conflict() from public, anon, authenticated, service_role;
create trigger prepare_conflict before insert on public.fleet_sync_conflicts for each row execute function public.prepare_fleet_sync_conflict();

-- Retain the previous validated implementation privately; do not bypass or alter
-- its request hash, original operation, field allowlists or dependency checks.
alter function public.sync_fleet_update(jsonb) rename to sync_fleet_update_internal;
revoke all on function public.sync_fleet_update_internal(jsonb) from public, anon, authenticated, service_role;
grant create on schema public to fireops_sync_writer;
create function public.sync_fleet_update(operation jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare company uuid; entity text; record_uuid uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(operation) is distinct from 'object' then raise exception 'Invalid sync operation' using errcode = '22023'; end if;
  company := (operation ->> 'companyId')::uuid; entity := operation ->> 'entityType'; record_uuid := (operation ->> 'entityId')::uuid;
  if company is null or record_uuid is null or entity is null or entity not in ('vehicle','issue') then
    raise exception 'Unsupported sync identity/entity' using errcode = '22023';
  end if;
  if not public.is_company_owner(company,auth.uid()) then raise exception 'Company manager access required' using errcode = '42501'; end if;
  perform public.lock_fleet_sync_review(company,entity,record_uuid);
  return public.sync_fleet_update_internal(operation);
end;
$$;
alter function public.sync_fleet_update(jsonb) owner to fireops_sync_writer;
revoke all on function public.sync_fleet_update(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.sync_fleet_update(jsonb) to authenticated;

-- Fresh review state, invoked only by the authorized public RPCs below. Every
-- touched field needs a choice, so independent pending edits cannot disappear.
create function public.fleet_sync_review_state(company uuid, entity text, record_uuid uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare
  table_name text := case entity when 'vehicle' then 'fleet_vehicles' when 'issue' then 'fleet_issues' end;
  current_data jsonb; current_version bigint; deleted boolean;
  candidates jsonb; fields jsonb := '{}'::jsonb; item record; key_name text;
  options jsonb; snapshot jsonb; field_names text[];
begin
  if table_name is null then raise exception 'Unsupported sync entity' using errcode = '22023'; end if;
  perform public.lock_fleet_sync_review(company,entity,record_uuid);
  execute format('select data,version from public.%I where company_id=$1 and record_id=$2 for update',table_name)
    into current_data,current_version using company,record_uuid;
  if current_data is null then
    select r.version,r.deleted into current_version,deleted from public.fleet_sync_revisions r
      where r.company_id=company and r.record_id=record_uuid and r.collection=case entity when 'vehicle' then 'vehicles' else 'issues' end
      order by r.version desc limit 1;
    if deleted is distinct from true then raise exception 'Record is unavailable' using errcode = '42501'; end if;
  end if;
  select jsonb_agg(jsonb_build_object('id',c.id,'operationId',c.operation_id,'baseRevision',c.base_revision::text,
    'currentRevision',c.current_revision::text,'baseRecord',c.base_record,'currentRecord',c.current_record,
    'proposedRecord',c.proposed_record,'reason',c.reason,'fieldConflicts',c.field_conflicts,
    'lifecycleChanged',exists(select 1 from public.fleet_sync_revisions r where r.company_id=company and r.record_id=record_uuid
      and r.collection=case entity when 'vehicle' then 'vehicles' else 'issues' end and r.version>c.base_revision and r.deleted),
    'provenance',c.provenance,'receivedAt',c.received_at) order by c.id) into candidates
    from public.fleet_sync_conflicts c where c.company_id=company and c.entity_type=entity and c.record_id=record_uuid and c.state='pending';
  if candidates is null then raise exception 'No pending conflicts' using errcode = '55000'; end if;
  for key_name in select distinct keys.key from jsonb_array_elements(candidates) candidate
    cross join lateral jsonb_object_keys((candidate -> 'baseRecord') || (candidate -> 'proposedRecord')) keys(key)
    where candidate -> 'baseRecord' -> keys.key is distinct from candidate -> 'proposedRecord' -> keys.key order by keys.key
  loop
    options := '[]'::jsonb;
    for item in select value from jsonb_array_elements(candidates) loop
      if item.value -> 'baseRecord' -> key_name is distinct from item.value -> 'proposedRecord' -> key_name then
        options := options || jsonb_build_array(jsonb_build_object('source',item.value ->> 'id',
          'value',case when item.value -> 'proposedRecord' ? key_name then jsonb_build_object('present',true,'value',item.value -> 'proposedRecord' -> key_name) else jsonb_build_object('present',false) end,
          'provenance',(item.value -> 'provenance') || jsonb_build_object('serverRecordedAt',item.value -> 'receivedAt','origin','reviewed_submission')));
      end if;
    end loop;
    fields := fields || jsonb_build_object(key_name,jsonb_build_object(
      'current',case when current_data ? key_name then jsonb_build_object('present',true,'value',current_data -> key_name) else jsonb_build_object('present',false) end,
      'options',options));
  end loop;
  field_names := array(select jsonb_object_keys(coalesce(current_data,'{}'::jsonb) || fields));
  snapshot := jsonb_build_object('companyId',company,'entityType',entity,'entityId',record_uuid,
    'currentRevision',current_version::text,'currentRecord',current_data,'candidates',candidates,'fields',fields,
    'currentProvenance',public.fleet_sync_field_provenance(company,entity,record_uuid,current_version,field_names));
  return snapshot || jsonb_build_object('reviewToken',encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'));
end;
$$;
revoke all on function public.fleet_sync_review_state(uuid,text,uuid) from public, anon, authenticated, service_role;
grant execute on function public.fleet_sync_review_state(uuid,text,uuid) to fireops_sync_writer;

create function public.get_fleet_sync_review(target_company_id uuid, entity_type text, record_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_company_owner(target_company_id,auth.uid()) then
    raise exception 'Company manager access required' using errcode = '42501';
  end if;
  if target_company_id is null or record_id is null or entity_type is null or entity_type not in ('vehicle','issue') then
    raise exception 'Invalid review identity' using errcode = '22023';
  end if;
  return public.fleet_sync_review_state(target_company_id,entity_type,record_id);
end;
$$;
alter function public.get_fleet_sync_review(uuid,text,uuid) owner to fireops_sync_writer;
revoke all on function public.get_fleet_sync_review(uuid,text,uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_fleet_sync_review(uuid,text,uuid) to authenticated;

create function public.approve_fleet_sync_review(request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); company uuid; entity text; record_uuid uuid; request_uuid uuid;
  request_hash bytea; previous public.fleet_sync_decisions%rowtype;
  snapshot jsonb; choices jsonb; current_data jsonb; approved jsonb; before_version bigint; after_version bigint;
  sources jsonb := '{}'::jsonb; source text; option_value jsonb; selected_provenance jsonb;
  key_name text; candidate jsonb; field_name text; kept text[]; discarded text[]; outcome text;
  allowed text[]; value_text text;
  outcomes jsonb := '[]'::jsonb; decision_uuid uuid := gen_random_uuid(); decision_time timestamptz;
  candidate_ids uuid[]; actor_label text; table_name text; collection_name text; applied_version bigint; result jsonb;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(request) is distinct from 'object' or octet_length(request::text)>65536 then raise exception 'Invalid review request' using errcode = '22023'; end if;
  if (select count(*) from jsonb_object_keys(request))<>6 or not request ?& array['requestId','companyId','entityType','entityId','reviewToken','choices'] then
    raise exception 'Invalid review request shape' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(array['requestId','companyId','entityType','entityId','reviewToken']) identity_field(key)
    where jsonb_typeof(request -> identity_field.key) is distinct from 'string') then raise exception 'Invalid review identity/token type' using errcode = '22023'; end if;
  company := (request ->> 'companyId')::uuid; entity := request ->> 'entityType'; record_uuid := (request ->> 'entityId')::uuid; request_uuid := (request ->> 'requestId')::uuid;
  if company is null or record_uuid is null or request_uuid is null or entity is null or entity not in ('vehicle','issue') then raise exception 'Invalid review identity' using errcode = '22023'; end if;
  if not public.is_company_owner(company,actor) then raise exception 'Company manager access required' using errcode = '42501'; end if;
  choices := request -> 'choices';
  if jsonb_typeof(choices) is distinct from 'object' or jsonb_typeof(request -> 'reviewToken') is distinct from 'string' then raise exception 'Invalid review choices/token' using errcode = '22023'; end if;
  request_hash := sha256(convert_to(request::text,'UTF8'));
  perform pg_advisory_xact_lock(hashtextextended('fleet-decision:v1:' || company::text || ':' || actor::text || ':' || request_uuid::text,0));
  select * into previous from public.fleet_sync_decisions d where d.company_id=company and d.reviewer_user_id=actor and d.request_id=request_uuid;
  if found then
    if previous.request_sha256<>request_hash then raise exception 'Review request ID was reused for different work' using errcode = '22023'; end if;
    return previous.result;
  end if;
  -- Distinguish a stale competing approval from an initial request with no work.
  perform public.lock_fleet_sync_review(company,entity,record_uuid);
  if not exists (select 1 from public.fleet_sync_conflicts c where c.company_id=company and c.entity_type=entity and c.record_id=record_uuid and c.state='pending') then
    raise exception 'Review changed; refresh required' using errcode = 'PT409';
  end if;
  snapshot := public.fleet_sync_review_state(company,entity,record_uuid);
  if request ->> 'reviewToken' is distinct from snapshot ->> 'reviewToken' then raise exception 'Review changed; refresh required' using errcode = 'PT409'; end if;
  if exists (select 1 from jsonb_object_keys(snapshot -> 'fields') field where not choices ? field)
    or exists (select 1 from jsonb_object_keys(choices) field where not (snapshot -> 'fields') ? field) then
    raise exception 'Select a source for every affected field, and no others' using errcode = '22023';
  end if;
  current_data := snapshot -> 'currentRecord';
  if current_data = 'null'::jsonb then current_data := null; end if;
  approved := current_data;
  before_version := (snapshot ->> 'currentRevision')::bigint;
  after_version := before_version;
  allowed := case entity when 'vehicle' then array['unit','type','year','make','model','vin','plate','notes'] else array['title','description','priority'] end;
  for key_name in select jsonb_object_keys(choices) order by 1 loop
    if key_name <> all(allowed) then raise exception 'Field requires a different review adapter' using errcode = '22023'; end if;
    if jsonb_typeof(choices -> key_name) is distinct from 'string' then raise exception 'A choice must identify its source' using errcode = '22023'; end if;
    source := choices ->> key_name;
    if source='current' then
      option_value := snapshot -> 'fields' -> key_name -> 'current';
      selected_provenance := snapshot -> 'currentProvenance' -> key_name;
    else
      if current_data is null then raise exception 'Restoring deleted records requires a dedicated workflow; keep the deletion' using errcode = '22023'; end if;
      select entry -> 'value',entry -> 'provenance' into option_value,selected_provenance
        from jsonb_array_elements(snapshot -> 'fields' -> key_name -> 'options') entry where entry ->> 'source'=source;
      if option_value is null then raise exception 'Choice does not identify an offered candidate field' using errcode = '22023'; end if;
      -- Revalidate selected values under this adapter's current rules, not just
      -- the rules that admitted a potentially old candidate.
      value_text := option_value ->> 'value';
      if option_value -> 'present'='false'::jsonb then
        if key_name not in ('vin','plate','notes') then raise exception 'Required detail field cannot be removed' using errcode = '22023'; end if;
      elsif key_name='year' then
        if jsonb_typeof(option_value -> 'value') is distinct from 'number' or value_text !~ '^[0-9]{4}$' then raise exception 'Invalid vehicle year' using errcode = '22023'; end if;
      else
        if jsonb_typeof(option_value -> 'value') is distinct from 'string'
          or char_length(value_text) > (case when key_name in ('notes','description') then 10000 else 200 end) then raise exception 'Invalid detail field value' using errcode = '22023'; end if;
        if key_name in ('unit','type','make','model','title') and btrim(value_text)='' then raise exception 'Detail field cannot be blank' using errcode = '22023'; end if;
        if key_name='priority' and value_text not in ('Low','Medium','High','Critical') then raise exception 'Invalid issue priority' using errcode = '22023'; end if;
      end if;
    end if;
    if approved is not null then
      approved := case when option_value -> 'present'='true'::jsonb then jsonb_set(approved,array[key_name],option_value -> 'value',true) else approved-key_name end;
    end if;
    sources := sources || jsonb_build_object(key_name,coalesce(selected_provenance,'{}'::jsonb) || jsonb_build_object('source',source));
  end loop;
  decision_time := clock_timestamp();
  table_name := case entity when 'vehicle' then 'fleet_vehicles' else 'fleet_issues' end;
  collection_name := case entity when 'vehicle' then 'vehicles' else 'issues' end;
  if approved is distinct from current_data then
    perform public.apply_fleet_changes(company,jsonb_build_array(jsonb_build_object(
      'collection',collection_name,'recordId',record_uuid,'event','update','expectedVersion',before_version,'data',approved)));
    execute format('select data,version from public.%I where company_id=$1 and record_id=$2',table_name)
      into approved,after_version using company,record_uuid;
    applied_version := after_version;
  end if;
  for candidate in select value from jsonb_array_elements(snapshot -> 'candidates') loop
    kept := '{}'; discarded := '{}';
    for field_name in select keys.key from jsonb_object_keys((candidate -> 'baseRecord') || (candidate -> 'proposedRecord')) keys(key)
      where candidate -> 'baseRecord' -> keys.key is distinct from candidate -> 'proposedRecord' -> keys.key order by keys.key
    loop
      if approved is not null and approved -> field_name is not distinct from candidate -> 'proposedRecord' -> field_name then kept := array_append(kept,field_name);
      else discarded := array_append(discarded,field_name); end if;
    end loop;
    outcome := case when cardinality(discarded)=0 and approved is not null then 'kept' when cardinality(kept)>0 then 'partially_kept' else 'not_selected' end;
    outcomes := outcomes || jsonb_build_array(jsonb_build_object('conflictId',candidate ->> 'id','operationId',candidate ->> 'operationId',
      'userId',candidate -> 'provenance' ->> 'userId','outcome',outcome,'keptFields',to_jsonb(kept),'discardedFields',to_jsonb(discarded)));
  end loop;
  candidate_ids := array(select (entry ->> 'id')::uuid from jsonb_array_elements(snapshot -> 'candidates') entry order by entry ->> 'id');
  select nullif(full_name,'') into actor_label from public.profiles where user_id=actor;
  result := jsonb_build_object('kind','resolved','decisionId',decision_uuid,'decidedAt',decision_time,'revision',after_version::text,'record',approved,'outcomes',outcomes);
  insert into public.fleet_sync_decisions(id,company_id,reviewer_user_id,reviewer_name,request_id,request_sha256,entity_type,record_id,
    review_token,candidate_ids,choices,field_sources,before_revision,after_revision,applied_revision,before_record,after_record,decided_at,result)
    values(decision_uuid,company,actor,actor_label,request_uuid,request_hash,entity,record_uuid,snapshot ->> 'reviewToken',candidate_ids,
      choices,sources,before_version,after_version,applied_version,current_data,approved,decision_time,result);
  for candidate in select value from jsonb_array_elements(outcomes) loop
    insert into public.fleet_sync_outcomes(company_id,actor_user_id,operation_id,conflict_id,decision_id,outcome,kept_fields,discarded_fields,revision,decided_at)
      values(company,(candidate ->> 'userId')::uuid,(candidate ->> 'operationId')::uuid,(candidate ->> 'conflictId')::uuid,decision_uuid,
        candidate ->> 'outcome',array(select jsonb_array_elements_text(candidate -> 'keptFields')),
        array(select jsonb_array_elements_text(candidate -> 'discardedFields')),after_version,decision_time);
    if candidate ->> 'outcome'='kept' then
      -- This makes existing dependency checks accept fully kept parents. The
      -- original receipt and provenance stay intact; partial/rejected work blocks.
      update public.fleet_sync_submissions s set result=jsonb_build_object('kind','applied','receivedAt',decision_time,'revision',after_version::text,'record',approved)
        where s.company_id=company and s.actor_user_id=(candidate ->> 'userId')::uuid and s.operation_id=(candidate ->> 'operationId')::uuid;
    end if;
  end loop;
  update public.fleet_sync_conflicts c set state='resolved' where c.company_id=company and c.id=any(candidate_ids) and c.state='pending';
  return result;
end;
$$;
alter function public.approve_fleet_sync_review(jsonb) owner to fireops_sync_writer;
revoke all on function public.approve_fleet_sync_review(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.approve_fleet_sync_review(jsonb) to authenticated;

create function public.get_fleet_sync_outcome(target_company_id uuid, operation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or not (public.is_company_member(target_company_id,auth.uid()) or public.is_company_owner(target_company_id,auth.uid())) then
    raise exception 'Company access required' using errcode = '42501';
  end if;
  select jsonb_build_object('kind','reviewed','decisionId',o.decision_id,'conflictId',o.conflict_id,'operationId',o.operation_id,
    'decidedAt',o.decided_at,'outcome',o.outcome,'keptFields',to_jsonb(o.kept_fields),'discardedFields',to_jsonb(o.discarded_fields),'revision',o.revision::text)
    into result from public.fleet_sync_outcomes o where o.company_id=target_company_id and o.actor_user_id=auth.uid() and o.operation_id=get_fleet_sync_outcome.operation_id;
  return result;
end;
$$;
alter function public.get_fleet_sync_outcome(uuid,uuid) owner to fireops_sync_writer;
revoke all on function public.get_fleet_sync_outcome(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_fleet_sync_outcome(uuid,uuid) to authenticated;
revoke create on schema public from fireops_sync_writer;

commit;
