-- Online-only, current-manager inspection. Device reports are not approval sources.
begin;
create index fleet_sync_device_history_record_idx on public.fleet_sync_device_history(company_id,entity_type,record_id,received_at desc,actor_user_id desc,operation_id desc);
create function public.list_fleet_sync_device_history(target_company_id uuid,target_entity_type text,target_record_id uuid,history_cursor jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  page jsonb;
  next_cursor jsonb := null;
  cursor_time timestamptz;
  cursor_actor uuid;
  cursor_operation uuid;
begin
  if auth.uid() is null or target_company_id is null or not public.is_company_owner(target_company_id,auth.uid()) then raise exception 'Company manager access required' using errcode='42501'; end if;
  if target_record_id is null or target_entity_type is null or target_entity_type not in ('vehicle','issue') then raise exception 'Unsupported history identity' using errcode='22023'; end if;
  if history_cursor is not null then
    if jsonb_typeof(history_cursor) is distinct from 'object' or not history_cursor ?& array['receivedAt','actorUserId','operationId'] then raise exception 'Invalid history cursor' using errcode='22023'; end if;
    cursor_time := (history_cursor->>'receivedAt')::timestamptz; cursor_actor := (history_cursor->>'actorUserId')::uuid; cursor_operation := (history_cursor->>'operationId')::uuid;
    if cursor_time is null or not isfinite(cursor_time) or cursor_actor is null or cursor_operation is null then raise exception 'Invalid history cursor' using errcode='22023'; end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('companyId',h.company_id,'entityType',h.entity_type,'entityId',h.record_id,
    'actorUserId',h.actor_user_id,'operationId',h.operation_id,'actorName',h.actor_name,'receivedAt',h.received_at)
    order by h.received_at desc,h.actor_user_id desc,h.operation_id desc),'[]'::jsonb) into page
  from (select * from public.fleet_sync_device_history d where d.company_id=target_company_id and d.entity_type=target_entity_type and d.record_id=target_record_id
    and (history_cursor is null or (d.received_at,d.actor_user_id,d.operation_id)<(cursor_time,cursor_actor,cursor_operation))
    order by d.received_at desc,d.actor_user_id desc,d.operation_id desc limit 21) h;
  if jsonb_array_length(page)>20 then
    next_cursor := jsonb_build_object('receivedAt',page#>>'{19,receivedAt}','actorUserId',page#>>'{19,actorUserId}','operationId',page#>>'{19,operationId}');
    page := page-20;
  end if;
  return jsonb_build_object('items',page,'nextCursor',next_cursor);
end;
$$;
revoke all on function public.list_fleet_sync_device_history(uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.list_fleet_sync_device_history(uuid,text,uuid,jsonb) to authenticated;

create function public.get_fleet_sync_device_history_report(target_company_id uuid,target_entity_type text,target_record_id uuid,submitter_id uuid,submitted_operation_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare report jsonb;
begin
  if auth.uid() is null or target_company_id is null or not public.is_company_owner(target_company_id,auth.uid()) then raise exception 'Company manager access required' using errcode='42501'; end if;
  if target_record_id is null or submitter_id is null or submitted_operation_id is null or target_entity_type is null or target_entity_type not in ('vehicle','issue') then raise exception 'Unsupported history identity' using errcode='22023'; end if;
  select jsonb_build_object('companyId',h.company_id,'entityType',h.entity_type,'entityId',h.record_id,'actorUserId',h.actor_user_id,
    'operationId',h.operation_id,'actorName',h.actor_name,'receivedAt',h.received_at,'deviceHistory',h.device_history) into report
    from public.fleet_sync_device_history h where h.company_id=target_company_id and h.entity_type=target_entity_type and h.record_id=target_record_id
      and h.actor_user_id=submitter_id and h.operation_id=submitted_operation_id;
  return report;
end;
$$;
revoke all on function public.get_fleet_sync_device_history_report(uuid,text,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_fleet_sync_device_history_report(uuid,text,uuid,uuid,uuid) to authenticated;
commit;
