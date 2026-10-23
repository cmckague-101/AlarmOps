-- Offline feedback and notification preferences through the user command registry.
-- * feedback (entity ID = feedback ID chosen on the device): `feedback.send`
--   {category, message, source} inserts one app_feedback row as the caller
--   through the existing insert policy and source trigger. A reused ID is
--   refused. The sync writer may read back only the caller's own feedback
--   (ordinary clients still cannot).
-- * notification_preferences (self only): `preferences.set` {changes} with
--   boolean values for pushEnabled, communicationReplies, documentAdded,
--   trainingCreated, issueUpdates; merged per key over the current row (created
--   with defaults if missing); later arrival wins per key (the user's own
--   preference, like the dashboard layout).
begin;

insert into public.user_sync_commands values ('feedback','feedback.send',false),('notification_preferences','preferences.set',true);

create policy "sync writer reads own feedback" on public.app_feedback
  for select to fireops_sync_writer using (submitted_by = (select auth.uid()));

grant create on schema public to fireops_sync_writer;
create function public.user_sync_state_feedback(company uuid, actor uuid, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', f.id, 'createdAt', f.created_at) from public.app_feedback f
    where f.id = record_uuid and f.company_id = company and f.submitted_by = actor;
$$;
create function public.user_sync_apply_feedback(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
begin
  if (select array_agg(k order by k collate "C") from jsonb_object_keys(payload) k) is distinct from array['category','message','source']
    or payload ->> 'category' is null or payload ->> 'category' not in ('idea','issue','other') or jsonb_typeof(payload -> 'category') <> 'string'
    or jsonb_typeof(payload -> 'message') <> 'string' or char_length(btrim(payload ->> 'message')) not between 1 and 5000
    or payload ->> 'source' is null or payload ->> 'source' not in ('ios','android') or jsonb_typeof(payload -> 'source') <> 'string' then
    raise exception 'Invalid feedback' using errcode = '22023';
  end if;
  begin
    insert into public.app_feedback (id, company_id, submitted_by, category, message, source)
      values (record_uuid, company, actor, payload ->> 'category', btrim(payload ->> 'message'), payload ->> 'source');
  exception when unique_violation then
    raise exception 'This feedback identity was already used' using errcode = '23505';
  end;
  return '{}'::jsonb;
end;
$$;
create function public.user_sync_state_notification_preferences(company uuid, actor uuid, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce((select jsonb_build_object('pushEnabled', p.push_enabled, 'communicationReplies', p.communication_replies,
      'documentAdded', p.document_added, 'trainingCreated', p.training_created, 'issueUpdates', p.issue_updates)
    from public.notification_preferences p where p.company_id = company and p.user_id = actor),
    jsonb_build_object('pushEnabled', true, 'communicationReplies', true, 'documentAdded', true, 'trainingCreated', true, 'issueUpdates', true));
$$;
create function public.user_sync_apply_notification_preferences(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare changes jsonb := payload -> 'changes';
begin
  if (select array_agg(k) from jsonb_object_keys(payload) k) is distinct from array['changes'] or jsonb_typeof(changes) <> 'object' or changes = '{}'::jsonb
    or exists (select 1 from jsonb_each(changes) e where e.key not in ('pushEnabled','communicationReplies','documentAdded','trainingCreated','issueUpdates')
      or jsonb_typeof(e.value) <> 'boolean') then
    raise exception 'Invalid notification preferences' using errcode = '22023';
  end if;
  insert into public.notification_preferences (company_id, user_id) values (company, actor) on conflict (company_id, user_id) do nothing;
  update public.notification_preferences p set
    push_enabled = coalesce((changes ->> 'pushEnabled')::boolean, p.push_enabled),
    communication_replies = coalesce((changes ->> 'communicationReplies')::boolean, p.communication_replies),
    document_added = coalesce((changes ->> 'documentAdded')::boolean, p.document_added),
    training_created = coalesce((changes ->> 'trainingCreated')::boolean, p.training_created),
    issue_updates = coalesce((changes ->> 'issueUpdates')::boolean, p.issue_updates)
    where p.company_id = company and p.user_id = actor;
  return '{}'::jsonb;
end;
$$;
alter function public.user_sync_state_feedback(uuid, uuid, uuid) owner to fireops_sync_writer;
alter function public.user_sync_apply_feedback(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
alter function public.user_sync_state_notification_preferences(uuid, uuid, uuid) owner to fireops_sync_writer;
alter function public.user_sync_apply_notification_preferences(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
revoke all on function public.user_sync_state_feedback(uuid, uuid, uuid), public.user_sync_apply_feedback(uuid, uuid, uuid, text, jsonb),
  public.user_sync_state_notification_preferences(uuid, uuid, uuid), public.user_sync_apply_notification_preferences(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke create on schema public from fireops_sync_writer;
commit;
