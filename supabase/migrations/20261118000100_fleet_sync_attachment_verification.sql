-- Trusted byte verification for reserved fleet sync uploads. Only the service
-- verifier (Edge Function with the service key) records observed size/SHA-256
-- of stored bytes. A receipt proves stored bytes only: not a business-record
-- attachment, review outcome or synchronized change.
begin;

-- Append-only attempt log. An active lease (uncompleted, unexpired) serializes
-- verifiers per attachment and blocks client re-upload while a mismatched
-- object is being removed, so a late removal cannot delete a newer upload.
create table public.fleet_sync_attachment_verifications (
  lease_token uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  user_id uuid not null,
  attachment_id uuid not null,
  object_id uuid not null,
  started_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  outcome text check (outcome in ('verified','mismatch','missing','access_revoked','expired')),
  observed_byte_size bigint check (observed_byte_size >= 0),
  observed_sha256 text check (observed_sha256 ~ '^[0-9a-f]{64}$'),
  completed_at timestamptz,
  object_removed boolean,
  foreign key (company_id, user_id, attachment_id)
    references public.fleet_sync_attachment_uploads(company_id, user_id, attachment_id) on delete cascade,
  check (expires_at > started_at),
  check (completed_at is null or outcome is not null)
);
create index fleet_sync_attachment_verifications_attachment_idx
  on public.fleet_sync_attachment_verifications(company_id, user_id, attachment_id, started_at desc);
alter table public.fleet_sync_attachment_verifications enable row level security;
revoke all on public.fleet_sync_attachment_verifications from public, anon, authenticated, service_role;
grant select, update (outcome, observed_byte_size, observed_sha256, completed_at, object_removed)
  on public.fleet_sync_attachment_verifications to service_role;
grant select, insert on public.fleet_sync_attachment_verifications to fireops_sync_writer;
create policy "sync writer reads own attachment verifications" on public.fleet_sync_attachment_verifications
  for select to fireops_sync_writer using (user_id = (select auth.uid()));
create policy "sync writer leases own attachment verifications" on public.fleet_sync_attachment_verifications
  for insert to fireops_sync_writer with check (user_id = (select auth.uid()) and outcome is null and completed_at is null);
grant update (verified_object_id, verified_at, receipt) on public.fleet_sync_attachment_uploads to service_role;

create function public.guard_fleet_sync_attachment_verification()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'Attachment verification history is append-only' using errcode = '42501';
  end if;
  if (new.lease_token, new.company_id, new.user_id, new.attachment_id, new.object_id, new.started_at, new.expires_at)
      is distinct from (old.lease_token, old.company_id, old.user_id, old.attachment_id, old.object_id, old.started_at, old.expires_at)
    or old.completed_at is not null
    or (old.outcome is not null and new.outcome is distinct from old.outcome)
    or (old.observed_sha256 is not null and new.observed_sha256 is distinct from old.observed_sha256)
    or (old.observed_byte_size is not null and new.observed_byte_size is distinct from old.observed_byte_size) then
    raise exception 'Attachment verification history is append-only' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger guard_fleet_sync_attachment_verification before update or delete on public.fleet_sync_attachment_verifications
  for each row execute function public.guard_fleet_sync_attachment_verification();

-- Re-upload is blocked while a verifier holds an active lease.
create or replace function public.can_upload_fleet_sync_attachment(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.fleet_sync_attachment_uploads u
    where u.object_path = object_name and u.user_id = auth.uid() and u.receipt is null
      and public.is_company_owner(u.company_id, auth.uid())
      and not exists (select 1 from public.fleet_sync_attachment_verifications v
        where v.company_id = u.company_id and v.user_id = u.user_id and v.attachment_id = u.attachment_id
          and v.completed_at is null and v.expires_at > clock_timestamp()));
$$;

grant create on schema public to fireops_sync_writer;
-- Called with the uploader's own JWT so CURRENT access is checked as them.
create function public.begin_fleet_sync_attachment_verification(target_company_id uuid, target_attachment_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  upload public.fleet_sync_attachment_uploads;
  stored uuid;
  token uuid;
begin
  if actor is null or target_company_id is null or not public.is_company_owner(target_company_id, actor) then
    raise exception 'Company manager access required' using errcode = '42501';
  end if;
  select * into upload from public.fleet_sync_attachment_uploads u
    where u.company_id = target_company_id and u.user_id = actor and u.attachment_id = target_attachment_id;
  if not found then raise exception 'Attachment upload reservation not found' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fleet-sync-attachment-verify:' || upload.object_path, 0));
  if upload.receipt is not null then
    return jsonb_build_object('kind', 'verified', 'reservation', public.fleet_sync_attachment_reservation_json(upload));
  end if;
  select o.id into stored from storage.objects o where o.bucket_id = 'fleet-sync-files' and o.name = upload.object_path;
  if stored is null then
    return jsonb_build_object('kind', 'not_uploaded', 'reservation', public.fleet_sync_attachment_reservation_json(upload));
  end if;
  if exists (select 1 from public.fleet_sync_attachment_verifications v
      where v.company_id = upload.company_id and v.user_id = actor and v.attachment_id = upload.attachment_id
        and v.completed_at is null and v.expires_at > clock_timestamp()) then
    raise exception 'Attachment verification already in progress' using errcode = 'PT409';
  end if;
  -- Longer than the Edge Function wall-clock limit, so a live verifier keeps it.
  insert into public.fleet_sync_attachment_verifications (company_id, user_id, attachment_id, object_id, expires_at)
    values (upload.company_id, actor, upload.attachment_id, stored, clock_timestamp() + interval '10 minutes')
    returning lease_token into token;
  return jsonb_build_object('kind', 'lease', 'leaseToken', token, 'path', upload.object_path, 'byteSize', upload.byte_size,
    'sha256', upload.sha256, 'objectId', stored);
end;
$$;
alter function public.begin_fleet_sync_attachment_verification(uuid, uuid) owner to fireops_sync_writer;
revoke all on function public.begin_fleet_sync_attachment_verification(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.begin_fleet_sync_attachment_verification(uuid, uuid) to authenticated;
-- Recheck the uploader's CURRENT manager access with the shared helper,
-- evaluated as that user (system-admin company access depends on auth.uid()).
create function public.fleet_sync_attachment_uploader_allowed(target_company_id uuid, target_user_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  previous_sub text := current_setting('request.jwt.claim.sub', true);
  allowed boolean;
begin
  perform set_config('request.jwt.claim.sub', target_user_id::text, true);
  allowed := public.is_company_owner(target_company_id, target_user_id);
  perform set_config('request.jwt.claim.sub', coalesce(previous_sub, ''), true);
  return coalesce(allowed, false);
end;
$$;
alter function public.fleet_sync_attachment_uploader_allowed(uuid, uuid) owner to fireops_sync_writer;
revoke all on function public.fleet_sync_attachment_uploader_allowed(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fleet_sync_attachment_uploader_allowed(uuid, uuid) to service_role;
revoke create on schema public from fireops_sync_writer;

-- Service verifier only. Observed values come from bytes the verifier read
-- itself; the client never supplies them.
create function public.complete_fleet_sync_attachment_verification(lease uuid, observed_object_id uuid,
  observed_size bigint, observed_digest text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  attempt public.fleet_sync_attachment_verifications;
  upload public.fleet_sync_attachment_uploads;
  stored uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Service verifier required' using errcode = '42501'; end if;
  if observed_digest is not null and observed_digest !~ '^[0-9a-f]{64}$' then raise exception 'Invalid observed digest' using errcode = '22023'; end if;
  select * into attempt from public.fleet_sync_attachment_verifications where lease_token = lease for update;
  if not found then raise exception 'Verification lease not found' using errcode = 'P0002'; end if;
  select * into upload from public.fleet_sync_attachment_uploads u
    where u.company_id = attempt.company_id and u.user_id = attempt.user_id and u.attachment_id = attempt.attachment_id for update;
  if attempt.outcome is not null then
    -- Exact retry of an already-recorded result; never re-decide it.
    return jsonb_build_object('kind', attempt.outcome, 'reservation', public.fleet_sync_attachment_reservation_json(upload));
  end if;
  if attempt.expires_at <= clock_timestamp() then
    update public.fleet_sync_attachment_verifications set outcome = 'expired', completed_at = clock_timestamp() where lease_token = lease;
    return jsonb_build_object('kind', 'expired', 'reservation', public.fleet_sync_attachment_reservation_json(upload));
  end if;
  if not public.fleet_sync_attachment_uploader_allowed(attempt.company_id, attempt.user_id) then
    update public.fleet_sync_attachment_verifications set outcome = 'access_revoked', completed_at = clock_timestamp() where lease_token = lease;
    return jsonb_build_object('kind', 'access_revoked');
  end if;
  select o.id into stored from storage.objects o where o.bucket_id = 'fleet-sync-files' and o.name = upload.object_path;
  if stored is null or stored <> attempt.object_id or observed_object_id is distinct from attempt.object_id then
    update public.fleet_sync_attachment_verifications set outcome = 'missing', completed_at = clock_timestamp() where lease_token = lease;
    return jsonb_build_object('kind', 'missing', 'reservation', public.fleet_sync_attachment_reservation_json(upload));
  end if;
  if observed_size = upload.byte_size and observed_digest = upload.sha256 then
    update public.fleet_sync_attachment_uploads set verified_object_id = stored, verified_at = statement_timestamp(),
      receipt = jsonb_build_object('schemaVersion', 1, 'kind', 'uploaded', 'companyId', upload.company_id, 'userId', upload.user_id,
        'attachmentId', upload.attachment_id, 'entityType', upload.entity_type, 'entityId', upload.entity_id, 'bucket', 'fleet-sync-files',
        'path', upload.object_path, 'byteSize', upload.byte_size, 'sha256', upload.sha256, 'objectId', stored, 'verifiedAt', statement_timestamp())
      where company_id = upload.company_id and user_id = upload.user_id and attachment_id = upload.attachment_id
      returning * into upload;
    update public.fleet_sync_attachment_verifications set outcome = 'verified', observed_byte_size = observed_size,
      observed_sha256 = observed_digest, completed_at = clock_timestamp() where lease_token = lease;
    return jsonb_build_object('kind', 'verified', 'reservation', public.fleet_sync_attachment_reservation_json(upload));
  end if;
  -- Lease stays active (blocking re-upload) until the verifier removes the object.
  update public.fleet_sync_attachment_verifications set outcome = 'mismatch', observed_byte_size = observed_size,
    observed_sha256 = observed_digest where lease_token = lease;
  return jsonb_build_object('kind', 'mismatch', 'reservation', public.fleet_sync_attachment_reservation_json(upload));
end;
$$;

create function public.release_fleet_sync_attachment_verification(lease uuid, removed boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare attempt public.fleet_sync_attachment_verifications;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Service verifier required' using errcode = '42501'; end if;
  select * into attempt from public.fleet_sync_attachment_verifications where lease_token = lease for update;
  if not found then raise exception 'Verification lease not found' using errcode = 'P0002'; end if;
  if attempt.outcome is distinct from 'mismatch' then raise exception 'Only mismatched objects are released' using errcode = 'PT409'; end if;
  if attempt.completed_at is null then
    update public.fleet_sync_attachment_verifications set completed_at = clock_timestamp(), object_removed = coalesce(removed, false)
      where lease_token = lease returning * into attempt;
  end if;
  return jsonb_build_object('kind', 'released', 'objectRemoved', attempt.object_removed);
end;
$$;
revoke all on function public.complete_fleet_sync_attachment_verification(uuid, uuid, bigint, text),
  public.release_fleet_sync_attachment_verification(uuid, boolean) from public, anon, authenticated;
grant execute on function public.complete_fleet_sync_attachment_verification(uuid, uuid, bigint, text),
  public.release_fleet_sync_attachment_verification(uuid, boolean) to service_role;
commit;
