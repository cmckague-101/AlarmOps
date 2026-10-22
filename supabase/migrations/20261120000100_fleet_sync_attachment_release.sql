-- Retention policy for fleet-sync-files staging objects:
-- * applied vehicle documents: the service deletes the staging object (the
--   fleet-files copy is canonical); the reservation/receipt/request audit stays.
-- * unattached or rejected uploads: released only by an explicit user request,
--   which deletes the staging object and frees quota. Nothing expires silently.
begin;

create table public.fleet_sync_attachment_releases (
  company_id uuid not null,
  user_id uuid not null,
  attachment_id uuid not null,
  reason text not null check (reason in ('applied','user_released')),
  requested_at timestamptz not null default clock_timestamp(),
  object_removed_at timestamptz,
  primary key (company_id, user_id, attachment_id),
  foreign key (company_id, user_id, attachment_id)
    references public.fleet_sync_attachment_uploads(company_id, user_id, attachment_id) on delete cascade
);
alter table public.fleet_sync_attachment_releases enable row level security;
revoke all on public.fleet_sync_attachment_releases from public, anon, authenticated, service_role;
grant select, insert, update (object_removed_at) on public.fleet_sync_attachment_releases to service_role;
grant select, insert on public.fleet_sync_attachment_releases to fireops_sync_writer;
create policy "sync writer reads own attachment releases" on public.fleet_sync_attachment_releases
  for select to fireops_sync_writer using (user_id = (select auth.uid()));
create policy "sync writer releases own attachments" on public.fleet_sync_attachment_releases
  for insert to fireops_sync_writer with check (user_id = (select auth.uid()) and reason = 'user_released' and object_removed_at is null);

create function public.guard_fleet_sync_attachment_release()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'Attachment releases are append-only' using errcode = '42501';
  end if;
  if (new.company_id, new.user_id, new.attachment_id, new.reason, new.requested_at)
      is distinct from (old.company_id, old.user_id, old.attachment_id, old.reason, old.requested_at)
    or (old.object_removed_at is not null and new.object_removed_at is distinct from old.object_removed_at) then
    raise exception 'Attachment releases are append-only' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger guard_fleet_sync_attachment_release before update or delete on public.fleet_sync_attachment_releases
  for each row execute function public.guard_fleet_sync_attachment_release();

-- A user-released upload can never be verified, receive a receipt or be attached.
create function public.reject_released_fleet_sync_attachment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- On reservations only a newly issued receipt matters; never read OLD on INSERT.
  if tg_table_name = 'fleet_sync_attachment_uploads' and tg_op = 'UPDATE' then
    if new.receipt is not distinct from old.receipt then return new; end if;
  end if;
  if exists (select 1 from public.fleet_sync_attachment_releases r where r.company_id = new.company_id and r.user_id = new.user_id
      and r.attachment_id = new.attachment_id and r.reason = 'user_released') then
    raise exception 'Attachment upload was released' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function public.reject_released_fleet_sync_attachment() from public, anon, authenticated, service_role;
create trigger reject_released_verification before insert on public.fleet_sync_attachment_verifications
  for each row execute function public.reject_released_fleet_sync_attachment();
create trigger reject_released_link before insert on public.fleet_sync_attachment_links
  for each row execute function public.reject_released_fleet_sync_attachment();
create trigger reject_released_receipt before update on public.fleet_sync_attachment_uploads
  for each row execute function public.reject_released_fleet_sync_attachment();

create or replace function public.fleet_sync_attachment_reservation_json(upload public.fleet_sync_attachment_uploads)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('schemaVersion', 1, 'manifest', upload.manifest, 'bucket', 'fleet-sync-files',
    'path', upload.object_path, 'contentType', upload.content_type, 'receivedAt', upload.received_at,
    'object', (select jsonb_build_object('objectId', o.id, 'updatedAt', o.updated_at,
        'byteSize', case when o.metadata ->> 'size' ~ '^[0-9]{1,15}$' then (o.metadata ->> 'size')::bigint end)
      from storage.objects o where o.bucket_id = 'fleet-sync-files' and o.name = upload.object_path),
    'receipt', upload.receipt,
    'release', (select jsonb_build_object('reason', r.reason, 'requestedAt', r.requested_at, 'objectRemovedAt', r.object_removed_at)
      from public.fleet_sync_attachment_releases r
      where r.company_id = upload.company_id and r.user_id = upload.user_id and r.attachment_id = upload.attachment_id));
$$;

create or replace function public.fleet_sync_attachment_quota_usage(actor uuid)
returns table(retained_bytes bigint, retained_count int) language sql stable set search_path = '' as $$
  select coalesce(sum(u.byte_size), 0)::bigint, count(*)::int from public.fleet_sync_attachment_uploads u
    where u.user_id = actor
      and not exists (select 1 from public.fleet_sync_attachment_links l
        where l.company_id = u.company_id and l.user_id = u.user_id and l.attachment_id = u.attachment_id and l.result ->> 'kind' = 'applied')
      and not exists (select 1 from public.fleet_sync_attachment_releases r
        where r.company_id = u.company_id and r.user_id = u.user_id and r.attachment_id = u.attachment_id);
$$;

create or replace function public.can_upload_fleet_sync_attachment(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.fleet_sync_attachment_uploads u
    where u.object_path = object_name and u.user_id = auth.uid() and u.receipt is null
      and public.is_company_owner(u.company_id, auth.uid())
      and not exists (select 1 from public.fleet_sync_attachment_releases r
        where r.company_id = u.company_id and r.user_id = u.user_id and r.attachment_id = u.attachment_id)
      and not exists (select 1 from public.fleet_sync_attachment_verifications v
        where v.company_id = u.company_id and v.user_id = u.user_id and v.attachment_id = u.attachment_id
          and v.completed_at is null and v.expires_at > clock_timestamp()));
$$;

grant create on schema public to fireops_sync_writer;
-- Uploader JWT. Explicit release of an unattached or rejected upload.
create function public.request_fleet_sync_attachment_release(target_company_id uuid, target_attachment_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  upload public.fleet_sync_attachment_uploads;
  link public.fleet_sync_attachment_links;
  released public.fleet_sync_attachment_releases;
begin
  if actor is null or target_company_id is null or not public.is_company_owner(target_company_id, actor) then
    raise exception 'Company manager access required' using errcode = '42501';
  end if;
  select * into upload from public.fleet_sync_attachment_uploads u
    where u.company_id = target_company_id and u.user_id = actor and u.attachment_id = target_attachment_id;
  if not found then raise exception 'Attachment upload reservation not found' using errcode = 'P0002'; end if;
  -- Same lock order as attach (attach key) and then verification.
  perform pg_advisory_xact_lock(hashtextextended('fleet-sync-attach:' || upload.object_path, 0));
  perform pg_advisory_xact_lock(hashtextextended('fleet-sync-attachment-verify:' || upload.object_path, 0));
  select * into released from public.fleet_sync_attachment_releases r
    where r.company_id = upload.company_id and r.user_id = actor and r.attachment_id = upload.attachment_id;
  if found then
    return jsonb_build_object('kind', case when released.object_removed_at is null then 'remove' else 'released' end,
      'reason', released.reason, 'path', upload.object_path);
  end if;
  select * into link from public.fleet_sync_attachment_links l
    where l.company_id = upload.company_id and l.user_id = actor and l.attachment_id = upload.attachment_id;
  if found and link.result is null then raise exception 'A vehicle document request still needs this upload' using errcode = 'PT409'; end if;
  if found and link.result ->> 'kind' = 'applied' then return jsonb_build_object('kind', 'attached', 'path', upload.object_path); end if;
  if exists (select 1 from public.fleet_sync_attachment_verifications v
      where v.company_id = upload.company_id and v.user_id = actor and v.attachment_id = upload.attachment_id
        and v.completed_at is null and v.expires_at > clock_timestamp()) then
    raise exception 'Attachment verification is in progress' using errcode = 'PT409';
  end if;
  insert into public.fleet_sync_attachment_releases (company_id, user_id, attachment_id, reason)
    values (upload.company_id, actor, upload.attachment_id, 'user_released');
  return jsonb_build_object('kind', 'remove', 'reason', 'user_released', 'path', upload.object_path);
end;
$$;
alter function public.request_fleet_sync_attachment_release(uuid, uuid) owner to fireops_sync_writer;
revoke all on function public.request_fleet_sync_attachment_release(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.request_fleet_sync_attachment_release(uuid, uuid) to authenticated;
revoke create on schema public from fireops_sync_writer;

-- Service only: an applied document's staging object is no longer needed.
create function public.request_fleet_sync_attachment_applied_release(target_company_id uuid, target_user_id uuid, target_attachment_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  upload public.fleet_sync_attachment_uploads;
  released public.fleet_sync_attachment_releases;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Service cleanup required' using errcode = '42501'; end if;
  select * into upload from public.fleet_sync_attachment_uploads
    where company_id = target_company_id and user_id = target_user_id and attachment_id = target_attachment_id;
  if not found then raise exception 'Attachment upload reservation not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.fleet_sync_attachment_links l where l.company_id = target_company_id and l.user_id = target_user_id
      and l.attachment_id = target_attachment_id and l.result ->> 'kind' = 'applied') then
    raise exception 'Only applied documents release their staging copy' using errcode = 'PT409';
  end if;
  insert into public.fleet_sync_attachment_releases (company_id, user_id, attachment_id, reason)
    values (target_company_id, target_user_id, target_attachment_id, 'applied') on conflict do nothing;
  select * into released from public.fleet_sync_attachment_releases
    where company_id = target_company_id and user_id = target_user_id and attachment_id = target_attachment_id;
  return jsonb_build_object('kind', case when released.object_removed_at is null then 'remove' else 'released' end,
    'reason', released.reason, 'path', upload.object_path);
end;
$$;

-- Service only, after Storage removal: records removal only when the object is really gone.
create function public.confirm_fleet_sync_attachment_release(target_company_id uuid, target_user_id uuid, target_attachment_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  upload public.fleet_sync_attachment_uploads;
  released public.fleet_sync_attachment_releases;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Service cleanup required' using errcode = '42501'; end if;
  select * into released from public.fleet_sync_attachment_releases
    where company_id = target_company_id and user_id = target_user_id and attachment_id = target_attachment_id for update;
  if not found then raise exception 'Attachment release not requested' using errcode = 'P0002'; end if;
  select * into upload from public.fleet_sync_attachment_uploads
    where company_id = target_company_id and user_id = target_user_id and attachment_id = target_attachment_id;
  if released.object_removed_at is null then
    if exists (select 1 from storage.objects o where o.bucket_id = 'fleet-sync-files' and o.name = upload.object_path) then
      return jsonb_build_object('kind', 'remove_pending', 'reason', released.reason);
    end if;
    update public.fleet_sync_attachment_releases set object_removed_at = clock_timestamp()
      where company_id = target_company_id and user_id = target_user_id and attachment_id = target_attachment_id;
  end if;
  return jsonb_build_object('kind', 'released', 'reason', released.reason);
end;
$$;
revoke all on function public.request_fleet_sync_attachment_applied_release(uuid, uuid, uuid),
  public.confirm_fleet_sync_attachment_release(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.request_fleet_sync_attachment_applied_release(uuid, uuid, uuid),
  public.confirm_fleet_sync_attachment_release(uuid, uuid, uuid) to service_role;
commit;
