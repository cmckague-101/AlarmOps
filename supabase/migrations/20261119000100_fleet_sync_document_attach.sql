-- First business-reference adapter for verified sync uploads: append ONE
-- vehicle document. Bytes are copied by the trusted service verifier into the
-- legacy fleet-files bucket (which existing viewers sign), proven by hash,
-- then the record mutation runs as the uploader through apply_fleet_changes
-- (RLS, member guards, revisions and side effects unchanged). Issues have no
-- file field, so issue attachments cannot be attached by this adapter.
begin;

create table public.fleet_sync_attachment_links (
  company_id uuid not null,
  user_id uuid not null,
  attachment_id uuid not null,
  request_id uuid not null,
  request jsonb not null check (jsonb_typeof(request) = 'object'),
  vehicle_id uuid not null,
  destination_path text not null unique,
  received_at timestamptz not null default statement_timestamp(),
  copy_object_id uuid,
  copy_verified_at timestamptz,
  result jsonb check (result is null or jsonb_typeof(result) = 'object'),
  completed_at timestamptz,
  primary key (company_id, user_id, attachment_id),
  unique (company_id, user_id, request_id),
  foreign key (company_id, user_id, attachment_id)
    references public.fleet_sync_attachment_uploads(company_id, user_id, attachment_id) on delete cascade,
  check (destination_path = company_id::text || '/' || user_id::text || '/sync-' || attachment_id::text),
  check ((copy_object_id is null) = (copy_verified_at is null)),
  check ((result is null) = (completed_at is null))
);
alter table public.fleet_sync_attachment_links enable row level security;
revoke all on public.fleet_sync_attachment_links from public, anon, authenticated, service_role;
grant select, update (copy_object_id, copy_verified_at) on public.fleet_sync_attachment_links to service_role;
grant select, insert, update (result, completed_at) on public.fleet_sync_attachment_links to fireops_sync_writer;
create policy "sync writer reads own attachment links" on public.fleet_sync_attachment_links
  for select to fireops_sync_writer using (user_id = (select auth.uid()));
create policy "sync writer requests own attachment links" on public.fleet_sync_attachment_links
  for insert to fireops_sync_writer with check (user_id = (select auth.uid()) and copy_object_id is null and result is null);
create policy "sync writer completes own attachment links" on public.fleet_sync_attachment_links
  for update to fireops_sync_writer using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create function public.guard_fleet_sync_attachment_link()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'Attachment links are append-only' using errcode = '42501';
  end if;
  if (new.company_id, new.user_id, new.attachment_id, new.request_id, new.request, new.vehicle_id, new.destination_path, new.received_at)
      is distinct from (old.company_id, old.user_id, old.attachment_id, old.request_id, old.request, old.vehicle_id, old.destination_path, old.received_at)
    or (old.copy_object_id is not null and (new.copy_object_id, new.copy_verified_at) is distinct from (old.copy_object_id, old.copy_verified_at))
    or (old.result is not null and (new.result, new.completed_at) is distinct from (old.result, old.completed_at))
    or (new.result is not null and old.result is null and new.copy_object_id is null and new.result ->> 'kind' = 'applied') then
    raise exception 'Attachment links are append-only' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger guard_fleet_sync_attachment_link before update or delete on public.fleet_sync_attachment_links
  for each row execute function public.guard_fleet_sync_attachment_link();

-- Applied business references stop counting toward the unattached quota.
create or replace function public.fleet_sync_attachment_quota_usage(actor uuid)
returns table(retained_bytes bigint, retained_count int) language sql stable set search_path = '' as $$
  select coalesce(sum(u.byte_size), 0)::bigint, count(*)::int from public.fleet_sync_attachment_uploads u
    where u.user_id = actor and not exists (select 1 from public.fleet_sync_attachment_links l
      where l.company_id = u.company_id and l.user_id = u.user_id and l.attachment_id = u.attachment_id and l.result ->> 'kind' = 'applied');
$$;

-- Exact request shape; returns the upload it targets. Raises on any mismatch.
create function public.validate_fleet_sync_document_attach(attach_request jsonb)
returns public.fleet_sync_attachment_uploads language plpgsql stable set search_path = '' as $$
declare
  actor uuid := auth.uid();
  provenance jsonb := attach_request -> 'provenance';
  upload public.fleet_sync_attachment_uploads;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(attach_request) is distinct from 'object'
    or (select array_agg(k order by k collate "C") from jsonb_object_keys(attach_request) k)
      is distinct from array['attachmentId','companyId','documentName','entityId','entityType','provenance','requestId','schemaVersion']
    or attach_request -> 'schemaVersion' is distinct from '1'::jsonb or attach_request ->> 'entityType' is distinct from 'vehicle'
    or jsonb_typeof(attach_request -> 'requestId') is distinct from 'string' or attach_request ->> 'requestId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(attach_request -> 'companyId') is distinct from 'string' or attach_request ->> 'companyId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(attach_request -> 'entityId') is distinct from 'string' or attach_request ->> 'entityId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(attach_request -> 'attachmentId') is distinct from 'string' or attach_request ->> 'attachmentId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(attach_request -> 'documentName') is distinct from 'string' or btrim(attach_request ->> 'documentName') = ''
    or char_length(attach_request ->> 'documentName') > 120 or attach_request ->> 'documentName' ~ '[\x01-\x1f\x7f]'
    or jsonb_typeof(provenance) is distinct from 'object'
    or (select array_agg(k order by k collate "C") from jsonb_object_keys(provenance) k) is distinct from array['connectivity','deviceId','savedAt','userId']
    or jsonb_typeof(provenance -> 'userId') is distinct from 'string' or provenance ->> 'userId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(provenance -> 'deviceId') is distinct from 'string' or char_length(btrim(provenance ->> 'deviceId')) not between 1 and 200
    or jsonb_typeof(provenance -> 'savedAt') is distinct from 'string' or provenance ->> 'savedAt' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$'
    or provenance ->> 'connectivity' is null or provenance ->> 'connectivity' not in ('online','offline','unknown') then
    raise exception 'Invalid attachment document request' using errcode = '22023';
  end if;
  perform (provenance ->> 'savedAt')::timestamptz;
  if (provenance ->> 'userId')::uuid <> actor then raise exception 'Attachment belongs to another account' using errcode = '42501'; end if;
  if not public.is_company_owner((attach_request ->> 'companyId')::uuid, actor) then raise exception 'Company manager access required' using errcode = '42501'; end if;
  select * into upload from public.fleet_sync_attachment_uploads u
    where u.company_id = (attach_request ->> 'companyId')::uuid and u.user_id = actor and u.attachment_id = (attach_request ->> 'attachmentId')::uuid;
  if not found then raise exception 'Attachment upload reservation not found' using errcode = 'P0002'; end if;
  if upload.entity_type <> 'vehicle' or upload.entity_id <> (attach_request ->> 'entityId')::uuid then
    raise exception 'Attachment belongs to another record' using errcode = '22023';
  end if;
  -- Legacy fleet-files (which viewers sign) is limited to 8 MiB.
  if upload.byte_size > 8388608 then raise exception 'Vehicle documents must be 8 MB or smaller' using errcode = '22023'; end if;
  if upload.receipt is null then raise exception 'Attachment bytes are not verified yet' using errcode = '55000'; end if;
  return upload;
end;
$$;

grant create on schema public to fireops_sync_writer;
alter function public.validate_fleet_sync_document_attach(jsonb) owner to fireops_sync_writer;
revoke all on function public.validate_fleet_sync_document_attach(jsonb) from public, anon, authenticated, service_role;

-- Uploader JWT. Registers the immutable request and says what is missing.
create function public.begin_fleet_sync_document_attach(attach_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  upload public.fleet_sync_attachment_uploads := public.validate_fleet_sync_document_attach(attach_request);
  link public.fleet_sync_attachment_links;
begin
  perform pg_advisory_xact_lock(hashtextextended('fleet-sync-attach:' || upload.object_path, 0));
  select * into link from public.fleet_sync_attachment_links l
    where l.company_id = upload.company_id and l.user_id = upload.user_id and l.attachment_id = upload.attachment_id;
  if found and link.request <> attach_request then
    raise exception 'Attachment already has a different document request' using errcode = 'PT409';
  end if;
  if not found then
    if exists (select 1 from public.fleet_sync_attachment_links l where l.company_id = upload.company_id and l.user_id = upload.user_id
        and l.request_id = (attach_request ->> 'requestId')::uuid) then
      raise exception 'Request identity was already used for another attachment' using errcode = 'PT409';
    end if;
    insert into public.fleet_sync_attachment_links (company_id, user_id, attachment_id, request_id, request, vehicle_id, destination_path)
      values (upload.company_id, upload.user_id, upload.attachment_id, (attach_request ->> 'requestId')::uuid, attach_request, upload.entity_id,
        upload.company_id::text || '/' || upload.user_id::text || '/sync-' || upload.attachment_id::text)
      returning * into link;
  end if;
  if link.result is not null then return jsonb_build_object('kind', 'completed', 'result', link.result); end if;
  if link.copy_object_id is not null then return jsonb_build_object('kind', 'ready'); end if;
  return jsonb_build_object('kind', 'copy', 'sourcePath', upload.object_path, 'destinationPath', link.destination_path,
    'byteSize', upload.byte_size, 'sha256', upload.sha256, 'contentType', upload.content_type);
end;
$$;

-- Uploader JWT. Atomic record mutation + result; replays never mutate again.
create function public.complete_fleet_sync_document_attach(attach_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  upload public.fleet_sync_attachment_uploads := public.validate_fleet_sync_document_attach(attach_request);
  link public.fleet_sync_attachment_links;
  current_data jsonb;
  current_version bigint;
  latest_deleted boolean;
  documents jsonb;
  outcome jsonb;
  stored uuid;
begin
  -- Record-group lock BEFORE row locks, matching every other fleet sync writer.
  perform public.lock_fleet_sync_review(upload.company_id, 'vehicle', upload.entity_id);
  perform pg_advisory_xact_lock(hashtextextended('fleet-sync-attach:' || upload.object_path, 0));
  select * into link from public.fleet_sync_attachment_links l
    where l.company_id = upload.company_id and l.user_id = upload.user_id and l.attachment_id = upload.attachment_id;
  if not found or link.request <> attach_request then raise exception 'Begin this document request first' using errcode = 'PT409'; end if;
  if link.result is not null then return link.result; end if;
  if link.copy_object_id is null then raise exception 'Verified document copy is not ready' using errcode = '55000'; end if;
  select o.id into stored from storage.objects o where o.bucket_id = 'fleet-files' and o.name = link.destination_path;
  if stored is distinct from link.copy_object_id then raise exception 'Verified document copy is unavailable or was replaced' using errcode = '55000'; end if;

  select v.data, v.version into current_data, current_version from public.fleet_vehicles v
    where v.company_id = upload.company_id and v.record_id = upload.entity_id for update;
  if current_data is null then
    select r.deleted into latest_deleted from public.fleet_sync_revisions r
      where r.company_id = upload.company_id and r.collection = 'vehicles' and r.record_id = upload.entity_id order by r.version desc limit 1;
    if latest_deleted is distinct from true then raise exception 'Record is unavailable' using errcode = '42501'; end if;
    -- Never resurrect a deleted vehicle. Verified bytes stay retained.
    outcome := jsonb_build_object('kind', 'rejected', 'reason', 'record_deleted', 'receivedAt', statement_timestamp());
  else
    documents := coalesce(current_data -> 'documents', '[]'::jsonb);
    if jsonb_typeof(documents) <> 'array' then
      outcome := jsonb_build_object('kind', 'rejected', 'reason', 'invalid_documents', 'receivedAt', statement_timestamp());
    elsif exists (select 1 from jsonb_array_elements(documents) d where d ->> 'id' = upload.attachment_id::text) then
      outcome := jsonb_build_object('kind', 'rejected', 'reason', 'document_id_conflict', 'receivedAt', statement_timestamp());
    else
      perform public.apply_fleet_changes(upload.company_id, jsonb_build_array(jsonb_build_object('collection', 'vehicles',
        'recordId', upload.entity_id, 'event', 'update', 'expectedVersion', current_version,
        'data', current_data || jsonb_build_object('documents', documents || jsonb_build_array(jsonb_build_object(
          'id', upload.attachment_id, 'name', btrim(attach_request ->> 'documentName'),
          'file', jsonb_build_object('name', upload.manifest ->> 'name', 'type', upload.content_type, 'dataUrl', '', 'path', link.destination_path)))))));
      select v.version into current_version from public.fleet_vehicles v where v.company_id = upload.company_id and v.record_id = upload.entity_id;
      outcome := jsonb_build_object('kind', 'applied', 'receivedAt', statement_timestamp(), 'revision', current_version::text,
        'documentId', upload.attachment_id, 'path', link.destination_path);
    end if;
  end if;
  update public.fleet_sync_attachment_links set result = outcome, completed_at = clock_timestamp()
    where company_id = link.company_id and user_id = link.user_id and attachment_id = link.attachment_id;
  return outcome;
end;
$$;
alter function public.begin_fleet_sync_document_attach(jsonb) owner to fireops_sync_writer;
alter function public.complete_fleet_sync_document_attach(jsonb) owner to fireops_sync_writer;
revoke all on function public.begin_fleet_sync_document_attach(jsonb), public.complete_fleet_sync_document_attach(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.begin_fleet_sync_document_attach(jsonb), public.complete_fleet_sync_document_attach(jsonb) to authenticated;
revoke create on schema public from fireops_sync_writer;

-- Service verifier only: proves the fleet-files copy holds the receipt's bytes.
create function public.record_fleet_sync_document_copy(target_company_id uuid, target_user_id uuid, target_attachment_id uuid,
  observed_size bigint, observed_digest text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  link public.fleet_sync_attachment_links;
  upload public.fleet_sync_attachment_uploads;
  stored uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Service verifier required' using errcode = '42501'; end if;
  select * into link from public.fleet_sync_attachment_links
    where company_id = target_company_id and user_id = target_user_id and attachment_id = target_attachment_id for update;
  if not found then raise exception 'Document request not found' using errcode = 'P0002'; end if;
  if link.copy_object_id is not null then return jsonb_build_object('kind', 'ready'); end if;
  if not public.fleet_sync_attachment_uploader_allowed(target_company_id, target_user_id) then return jsonb_build_object('kind', 'access_revoked'); end if;
  select * into upload from public.fleet_sync_attachment_uploads
    where company_id = target_company_id and user_id = target_user_id and attachment_id = target_attachment_id;
  select o.id into stored from storage.objects o where o.bucket_id = 'fleet-files' and o.name = link.destination_path;
  if stored is null then return jsonb_build_object('kind', 'missing'); end if;
  if upload.receipt is null or observed_size is distinct from upload.byte_size or observed_digest is distinct from upload.sha256 then
    return jsonb_build_object('kind', 'mismatch');
  end if;
  update public.fleet_sync_attachment_links set copy_object_id = stored, copy_verified_at = clock_timestamp()
    where company_id = link.company_id and user_id = link.user_id and attachment_id = link.attachment_id;
  return jsonb_build_object('kind', 'ready');
end;
$$;
revoke all on function public.record_fleet_sync_document_copy(uuid, uuid, uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.record_fleet_sync_document_copy(uuid, uuid, uuid, bigint, text) to service_role;
commit;
