-- Immutable remote ownership for retained native attachment bytes. A
-- reservation proves only who may upload which exact declared bytes to which
-- stable path. It is NOT byte verification, a business-record attachment or
-- sync completion. Verification receipts are written later by a trusted
-- service verifier; no client role can set them.
begin;

-- Separate private bucket: legacy fleet-files cleanup (delete-fleet-files) is
-- hardcoded to its own bucket and cannot remove staged/reviewed sync objects.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fleet-sync-files', 'fleet-sync-files', false, 10485760,
  array['image/jpeg','image/png','image/webp','image/gif','application/pdf'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table public.fleet_sync_attachment_uploads (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id),
  attachment_id uuid not null,
  entity_type text not null check (entity_type in ('vehicle','issue')),
  entity_id uuid not null,
  byte_size bigint not null check (byte_size between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  content_type text not null,
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  object_path text not null unique,
  received_at timestamptz not null default statement_timestamp(),
  -- Set exactly once by the trusted verifier after hashing stored bytes.
  verified_object_id uuid,
  verified_at timestamptz,
  receipt jsonb,
  primary key (company_id, user_id, attachment_id),
  check (object_path = company_id::text || '/' || user_id::text || '/' || attachment_id::text),
  check ((receipt is null) = (verified_at is null) and (receipt is null) = (verified_object_id is null))
);
create index fleet_sync_attachment_uploads_user_idx on public.fleet_sync_attachment_uploads(user_id);
alter table public.fleet_sync_attachment_uploads enable row level security;
revoke all on public.fleet_sync_attachment_uploads from public, anon, authenticated, service_role;
grant select on public.fleet_sync_attachment_uploads to service_role;
grant select, insert on public.fleet_sync_attachment_uploads to fireops_sync_writer;
create policy "sync writer reads own attachment uploads" on public.fleet_sync_attachment_uploads
  for select to fireops_sync_writer using (user_id = (select auth.uid()));
create policy "sync writer reserves own attachment uploads" on public.fleet_sync_attachment_uploads
  for insert to fireops_sync_writer with check (user_id = (select auth.uid()) and receipt is null);

-- Reservations are append-only. Only an unset verification can be filled once;
-- identity, declared bytes, provenance and an issued receipt never change.
create function public.guard_fleet_sync_attachment_upload()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if; -- company cascade
    raise exception 'Attachment upload reservations are immutable' using errcode = '42501';
  end if;
  if (new.company_id, new.user_id, new.attachment_id, new.entity_type, new.entity_id, new.byte_size, new.sha256,
      new.content_type, new.manifest, new.object_path, new.received_at)
    is distinct from (old.company_id, old.user_id, old.attachment_id, old.entity_type, old.entity_id, old.byte_size, old.sha256,
      old.content_type, old.manifest, old.object_path, old.received_at)
    or (old.receipt is not null and (new.receipt, new.verified_at, new.verified_object_id)
      is distinct from (old.receipt, old.verified_at, old.verified_object_id)) then
    raise exception 'Attachment upload reservations are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger guard_fleet_sync_attachment_upload before update or delete on public.fleet_sync_attachment_uploads
  for each row execute function public.guard_fleet_sync_attachment_upload();

-- Shared response shape for reserve/replay and the later verifier.
create function public.fleet_sync_attachment_reservation_json(upload public.fleet_sync_attachment_uploads)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('schemaVersion', 1, 'manifest', upload.manifest, 'bucket', 'fleet-sync-files',
    'path', upload.object_path, 'contentType', upload.content_type, 'receivedAt', upload.received_at,
    'object', (select jsonb_build_object('objectId', o.id, 'updatedAt', o.updated_at,
        'byteSize', case when o.metadata ->> 'size' ~ '^[0-9]{1,15}$' then (o.metadata ->> 'size')::bigint end)
      from storage.objects o where o.bucket_id = 'fleet-sync-files' and o.name = upload.object_path),
    'receipt', upload.receipt);
$$;
revoke all on function public.fleet_sync_attachment_reservation_json(public.fleet_sync_attachment_uploads) from public, anon, authenticated;
grant execute on function public.fleet_sync_attachment_reservation_json(public.fleet_sync_attachment_uploads) to fireops_sync_writer, service_role;

-- Unattached remote bytes per user. Replaced by attach adapters so applied
-- business references stop counting; nothing here deletes objects.
create function public.fleet_sync_attachment_quota_usage(actor uuid)
returns table(retained_bytes bigint, retained_count int) language sql stable set search_path = '' as $$
  select coalesce(sum(u.byte_size), 0)::bigint, count(*)::int from public.fleet_sync_attachment_uploads u where u.user_id = actor;
$$;
revoke all on function public.fleet_sync_attachment_quota_usage(uuid) from public, anon, authenticated, service_role;
grant execute on function public.fleet_sync_attachment_quota_usage(uuid) to fireops_sync_writer;

grant create on schema public to fireops_sync_writer;
create function public.reserve_fleet_sync_attachment(manifest jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  company uuid;
  record uuid;
  attachment uuid;
  entity text;
  size bigint;
  upload public.fleet_sync_attachment_uploads;
  retained_bytes bigint;
  retained_count int;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(manifest) is distinct from 'object'
    or (select array_agg(k order by k collate "C") from jsonb_object_keys(manifest) k)
      is distinct from array['attachmentId','byteSize','companyId','connectivity','deviceId','entityId','entityType','mimeType','name','savedAt','sha256','userId']
    or jsonb_typeof(manifest -> 'attachmentId') is distinct from 'string' or manifest ->> 'attachmentId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(manifest -> 'userId') is distinct from 'string' or manifest ->> 'userId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(manifest -> 'companyId') is distinct from 'string' or manifest ->> 'companyId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(manifest -> 'entityId') is distinct from 'string' or manifest ->> 'entityId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or manifest ->> 'entityType' is null or manifest ->> 'entityType' not in ('vehicle','issue') or jsonb_typeof(manifest -> 'entityType') <> 'string'
    or manifest ->> 'connectivity' is null or manifest ->> 'connectivity' not in ('online','offline','unknown') or jsonb_typeof(manifest -> 'connectivity') <> 'string'
    or jsonb_typeof(manifest -> 'name') is distinct from 'string' or btrim(manifest ->> 'name') = '' or char_length(manifest ->> 'name') > 255 or manifest ->> 'name' ~ '[\x01-\x1f\x7f]'
    or jsonb_typeof(manifest -> 'byteSize') is distinct from 'number' or manifest ->> 'byteSize' !~ '^[1-9][0-9]{0,7}$'
    or jsonb_typeof(manifest -> 'sha256') is distinct from 'string' or manifest ->> 'sha256' !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(manifest -> 'deviceId') is distinct from 'string' or char_length(btrim(manifest ->> 'deviceId')) not between 1 and 200
    or jsonb_typeof(manifest -> 'savedAt') is distinct from 'string' or manifest ->> 'savedAt' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$'
    or jsonb_typeof(manifest -> 'mimeType') not in ('string','null') then
    raise exception 'Invalid attachment upload manifest' using errcode = '22023';
  end if;
  size := (manifest ->> 'byteSize')::bigint;
  if size > 10485760 then raise exception 'Attachment exceeds upload size limit' using errcode = '22023'; end if;
  perform (manifest ->> 'savedAt')::timestamptz;
  if jsonb_typeof(manifest -> 'mimeType') = 'null' or manifest ->> 'mimeType' not in ('image/jpeg','image/png','image/webp','image/gif','application/pdf') then
    raise exception 'Attachment file type is not supported for fleet uploads' using errcode = '22023';
  end if;
  company := (manifest ->> 'companyId')::uuid;
  record := (manifest ->> 'entityId')::uuid;
  attachment := (manifest ->> 'attachmentId')::uuid;
  entity := manifest ->> 'entityType';
  if (manifest ->> 'userId')::uuid <> actor then raise exception 'Attachment belongs to another account' using errcode = '42501'; end if;
  -- Cached device permissions are not authority, including for replay.
  if not public.is_company_owner(company, actor) then raise exception 'Company manager access required' using errcode = '42501'; end if;

  -- Serialize same-key retries and this user's quota accounting.
  perform pg_advisory_xact_lock(hashtextextended('fleet-sync-attachment-quota:' || actor::text, 0));
  select * into upload from public.fleet_sync_attachment_uploads u
    where u.company_id = company and u.user_id = actor and u.attachment_id = attachment;
  if found then
    if upload.manifest <> manifest then
      raise exception 'Attachment identity was already reserved for different bytes or provenance' using errcode = 'PT409';
    end if;
    return public.fleet_sync_attachment_reservation_json(upload);
  end if;

  -- Target must be a live record visible to this manager now; a hidden or
  -- missing row is unavailability, never inferred deletion.
  if not exists (select 1 from public.fleet_vehicles v where entity = 'vehicle' and v.company_id = company and v.record_id = record)
    and not exists (select 1 from public.fleet_issues i where entity = 'issue' and i.company_id = company and i.record_id = record) then
    raise exception 'Attachment target is unavailable' using errcode = '42501';
  end if;
  -- Bound remote bytes not yet attached to any business record. Attaching
  -- adapters must release quota explicitly; nothing here deletes objects.
  select q.retained_bytes, q.retained_count into retained_bytes, retained_count
    from public.fleet_sync_attachment_quota_usage(actor) q;
  if retained_bytes + size > 104857600 or retained_count >= 500 then
    raise exception 'Attachment upload quota exceeded' using errcode = '53400';
  end if;

  insert into public.fleet_sync_attachment_uploads (company_id, user_id, attachment_id, entity_type, entity_id,
      byte_size, sha256, content_type, manifest, object_path)
    values (company, actor, attachment, entity, record, size, manifest ->> 'sha256', manifest ->> 'mimeType', manifest,
      company::text || '/' || actor::text || '/' || attachment::text)
    returning * into upload;
  return public.fleet_sync_attachment_reservation_json(upload);
end;
$$;
alter function public.reserve_fleet_sync_attachment(jsonb) owner to fireops_sync_writer;
revoke all on function public.reserve_fleet_sync_attachment(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.reserve_fleet_sync_attachment(jsonb) to authenticated;

-- Storage policy helpers. Insert requires the caller's own unverified
-- reservation for that exact path plus CURRENT manager access.
create function public.can_upload_fleet_sync_attachment(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.fleet_sync_attachment_uploads u
    where u.object_path = object_name and u.user_id = auth.uid() and u.receipt is null
      and public.is_company_owner(u.company_id, auth.uid()));
$$;
create function public.can_read_fleet_sync_attachment(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.fleet_sync_attachment_uploads u
    where u.object_path = object_name and u.user_id = auth.uid()
      and public.is_company_owner(u.company_id, auth.uid()));
$$;
alter function public.can_upload_fleet_sync_attachment(text) owner to fireops_sync_writer;
alter function public.can_read_fleet_sync_attachment(text) owner to fireops_sync_writer;
revoke all on function public.can_upload_fleet_sync_attachment(text), public.can_read_fleet_sync_attachment(text)
  from public, anon, authenticated, service_role;
grant execute on function public.can_upload_fleet_sync_attachment(text), public.can_read_fleet_sync_attachment(text) to authenticated;
revoke create on schema public from fireops_sync_writer;

-- No UPDATE or DELETE policy: clients cannot overwrite (upsert) or remove
-- reserved objects. Mismatched bytes are handled by the trusted verifier.
create policy "reserved uploaders create fleet sync files" on storage.objects for insert to authenticated
with check (bucket_id = 'fleet-sync-files' and public.can_upload_fleet_sync_attachment(name));
create policy "reserved uploaders read fleet sync files" on storage.objects for select to authenticated
using (bucket_id = 'fleet-sync-files' and public.can_read_fleet_sync_attachment(name));
commit;
