-- Single-slot vehicle files (photo, contract, VIPR checklist, registration,
-- insurance, DOT inspection) through the EXISTING verified detail-update path:
-- three-way merge, whole-operation conflicts, owner/admin review, outcomes and
-- device history all apply unchanged. A slot value may only reference a
-- receipt-verified upload whose bytes the service copied into fleet-files and
-- proved by hash; arbitrary client paths are rejected. Clearing a slot is an
-- ordinary optional-field removal. Replacements never delete the previous file.
begin;

alter table public.fleet_sync_attachment_releases drop constraint fleet_sync_attachment_releases_reason_check;
alter table public.fleet_sync_attachment_releases add constraint fleet_sync_attachment_releases_reason_check
  check (reason in ('applied','user_released','copied'));

-- One proven fleet-files copy per verified upload. Shares the deterministic
-- sync-<attachment> path with documents, so each upload has exactly one use.
create table public.fleet_sync_attachment_copies (
  company_id uuid not null,
  user_id uuid not null,
  attachment_id uuid not null,
  vehicle_id uuid not null,
  destination_path text not null unique,
  requested_at timestamptz not null default clock_timestamp(),
  copy_object_id uuid,
  copy_verified_at timestamptz,
  primary key (company_id, user_id, attachment_id),
  foreign key (company_id, user_id, attachment_id)
    references public.fleet_sync_attachment_uploads(company_id, user_id, attachment_id) on delete cascade,
  check (destination_path = company_id::text || '/' || user_id::text || '/sync-' || attachment_id::text),
  check ((copy_object_id is null) = (copy_verified_at is null))
);
alter table public.fleet_sync_attachment_copies enable row level security;
revoke all on public.fleet_sync_attachment_copies from public, anon, authenticated, service_role;
grant select, update (copy_object_id, copy_verified_at) on public.fleet_sync_attachment_copies to service_role;
grant select, insert on public.fleet_sync_attachment_copies to fireops_sync_writer;
-- Reviewers (any current manager) must be able to revalidate another user's copy.
create policy "managers read attachment copies" on public.fleet_sync_attachment_copies
  for select to fireops_sync_writer using (user_id = (select auth.uid()) or public.is_company_owner(company_id, (select auth.uid())));
create policy "sync writer requests own attachment copies" on public.fleet_sync_attachment_copies
  for insert to fireops_sync_writer with check (user_id = (select auth.uid()) and copy_object_id is null);
-- Validation joins the reservation's identity/name/type for any manager too.
create policy "managers read attachment uploads for review" on public.fleet_sync_attachment_uploads
  for select to fireops_sync_writer using (public.is_company_owner(company_id, (select auth.uid())));

create function public.guard_fleet_sync_attachment_copy()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'Attachment copies are append-only' using errcode = '42501';
  end if;
  if (new.company_id, new.user_id, new.attachment_id, new.vehicle_id, new.destination_path, new.requested_at)
      is distinct from (old.company_id, old.user_id, old.attachment_id, old.vehicle_id, old.destination_path, old.requested_at)
    or (old.copy_object_id is not null and (new.copy_object_id, new.copy_verified_at) is distinct from (old.copy_object_id, old.copy_verified_at)) then
    raise exception 'Attachment copies are append-only' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger guard_fleet_sync_attachment_copy before update or delete on public.fleet_sync_attachment_copies
  for each row execute function public.guard_fleet_sync_attachment_copy();
create trigger reject_released_copy before insert on public.fleet_sync_attachment_copies
  for each row execute function public.reject_released_fleet_sync_attachment();

-- A verified upload is either one vehicle document or one slot copy, never both.
create function public.reject_dual_use_fleet_sync_attachment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (tg_table_name = 'fleet_sync_attachment_links' and exists (select 1 from public.fleet_sync_attachment_copies c
        where c.company_id = new.company_id and c.user_id = new.user_id and c.attachment_id = new.attachment_id))
    or (tg_table_name = 'fleet_sync_attachment_copies' and exists (select 1 from public.fleet_sync_attachment_links l
        where l.company_id = new.company_id and l.user_id = new.user_id and l.attachment_id = new.attachment_id)) then
    raise exception 'This upload is already used for another vehicle file' using errcode = 'PT409';
  end if;
  return new;
end;
$$;
revoke all on function public.reject_dual_use_fleet_sync_attachment() from public, anon, authenticated, service_role;
create trigger reject_dual_use_link before insert on public.fleet_sync_attachment_links
  for each row execute function public.reject_dual_use_fleet_sync_attachment();
create trigger reject_dual_use_copy before insert on public.fleet_sync_attachment_copies
  for each row execute function public.reject_dual_use_fleet_sync_attachment();

-- Shared validator: scalar rules unchanged; slots accept only proven copies.
create or replace function public.validate_fleet_sync_detail_field(company uuid, proposer uuid, entity text, record_uuid uuid, field text, slot jsonb, purpose text)
returns void language plpgsql stable set search_path = '' as $$
declare
  field_value jsonb := slot -> 'value';
  value_text text := slot ->> 'value';
  path_parts text[];
  file_owner uuid;
  copied_attachment uuid;
begin
  if entity = 'vehicle' and field in ('photo','contract','viprChecklist','registration','insurance','dotInspection') then
    if purpose = 'review-field' or slot -> 'present' = 'false'::jsonb then return; end if; -- clearing a slot is allowed
    path_parts := regexp_match(coalesce(field_value ->> 'path', ''),
      '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/sync-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$');
    if jsonb_typeof(field_value) is distinct from 'object'
      or (select array_agg(k order by k collate "C") from jsonb_object_keys(field_value) k) is distinct from array['dataUrl','name','path','type']
      or field_value -> 'dataUrl' is distinct from '""'::jsonb or path_parts is null or path_parts[1]::uuid <> company then
      raise exception 'Vehicle file must reference a verified sync upload' using errcode = '22023';
    end if;
    file_owner := path_parts[2]::uuid; copied_attachment := path_parts[3]::uuid;
    if purpose = 'sync' and file_owner is distinct from proposer then raise exception 'Vehicle file belongs to another account' using errcode = '42501'; end if;
    if not exists (select 1 from public.fleet_sync_attachment_copies c
        join public.fleet_sync_attachment_uploads u on u.company_id = c.company_id and u.user_id = c.user_id and u.attachment_id = c.attachment_id
        join storage.objects o on o.bucket_id = 'fleet-files' and o.name = c.destination_path and o.id = c.copy_object_id
        where c.company_id = company and c.user_id = file_owner and c.attachment_id = copied_attachment and c.vehicle_id = record_uuid
          and u.receipt is not null and u.manifest ->> 'name' = field_value ->> 'name' and u.content_type = field_value ->> 'type') then
      raise exception 'Vehicle file copy is not verified for this vehicle' using errcode = '55000';
    end if;
    return;
  end if;
  if field <> all(case entity when 'vehicle' then array['unit','type','year','make','model','vin','plate','notes'] else array['title','description','priority'] end) then
    if purpose in ('review','review-field') then raise exception 'Field requires a different review adapter' using errcode = '22023'; end if;
    raise exception 'Field requires a different sync adapter: %', field using errcode = '22023';
  end if;
  if purpose = 'review-field' then return; end if; -- allowlist only
  if slot -> 'present' = 'false'::jsonb then
    if field not in ('vin','plate','notes') then raise exception 'Required detail field cannot be removed' using errcode = '22023'; end if;
  elsif field = 'year' then
    if jsonb_typeof(field_value) is distinct from 'number' or value_text !~ '^[0-9]{4}$' then raise exception 'Invalid vehicle year' using errcode = '22023'; end if;
  else
    if jsonb_typeof(field_value) is distinct from 'string' or char_length(value_text) > (case when field in ('notes','description') then 10000 else 200 end) then
      raise exception 'Invalid detail field value' using errcode = '22023';
    end if;
    if field in ('unit','type','make','model','title') and btrim(value_text) = '' then raise exception 'Detail field cannot be blank' using errcode = '22023'; end if;
    if field = 'priority' and value_text not in ('Low','Medium','High','Critical') then raise exception 'Invalid issue priority' using errcode = '22023'; end if;
  end if;
end;
$$;

grant create on schema public to fireops_sync_writer;
-- Uploader JWT: prepare (or report) the proven fleet-files copy for a slot.
create function public.begin_fleet_sync_attachment_copy(target_company_id uuid, target_attachment_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  upload public.fleet_sync_attachment_uploads;
  copy public.fleet_sync_attachment_copies;
begin
  if actor is null or target_company_id is null or not public.fleet_sync_attachment_user_allowed(target_company_id, actor) then
    raise exception 'Company manager access required' using errcode = '42501';
  end if;
  select * into upload from public.fleet_sync_attachment_uploads u
    where u.company_id = target_company_id and u.user_id = actor and u.attachment_id = target_attachment_id;
  if not found then raise exception 'Attachment upload reservation not found' using errcode = 'P0002'; end if;
  if upload.entity_type <> 'vehicle' then raise exception 'Only vehicle uploads fill vehicle file slots' using errcode = '22023'; end if;
  if upload.byte_size > 8388608 then raise exception 'Vehicle files must be 8 MB or smaller' using errcode = '22023'; end if;
  if upload.receipt is null then raise exception 'Attachment bytes are not verified yet' using errcode = '55000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fleet-sync-attach:' || upload.object_path, 0));
  select * into copy from public.fleet_sync_attachment_copies c
    where c.company_id = upload.company_id and c.user_id = actor and c.attachment_id = upload.attachment_id;
  if not found then
    insert into public.fleet_sync_attachment_copies (company_id, user_id, attachment_id, vehicle_id, destination_path)
      values (upload.company_id, actor, upload.attachment_id, upload.entity_id,
        upload.company_id::text || '/' || actor::text || '/sync-' || upload.attachment_id::text)
      returning * into copy;
  end if;
  if copy.copy_object_id is not null then
    return jsonb_build_object('kind', 'ready', 'value', jsonb_build_object('name', upload.manifest ->> 'name', 'type', upload.content_type, 'dataUrl', '', 'path', copy.destination_path));
  end if;
  return jsonb_build_object('kind', 'copy', 'sourcePath', upload.object_path, 'destinationPath', copy.destination_path,
    'byteSize', upload.byte_size, 'sha256', upload.sha256, 'contentType', upload.content_type);
end;
$$;
alter function public.begin_fleet_sync_attachment_copy(uuid, uuid) owner to fireops_sync_writer;
revoke all on function public.begin_fleet_sync_attachment_copy(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.begin_fleet_sync_attachment_copy(uuid, uuid) to authenticated;
revoke create on schema public from fireops_sync_writer;

-- Service verifier only: records the proven copy and queues staging release
-- (the fleet-files copy is canonical from here on).
create function public.record_fleet_sync_attachment_copy(target_company_id uuid, target_user_id uuid, target_attachment_id uuid,
  observed_size bigint, observed_digest text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  copy public.fleet_sync_attachment_copies;
  upload public.fleet_sync_attachment_uploads;
  stored uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Service verifier required' using errcode = '42501'; end if;
  select * into copy from public.fleet_sync_attachment_copies
    where company_id = target_company_id and user_id = target_user_id and attachment_id = target_attachment_id for update;
  if not found then raise exception 'Copy request not found' using errcode = 'P0002'; end if;
  if copy.copy_object_id is not null then return jsonb_build_object('kind', 'ready'); end if;
  if exists (select 1 from public.fleet_sync_attachment_releases r where r.company_id = target_company_id and r.user_id = target_user_id
      and r.attachment_id = target_attachment_id and r.reason = 'user_released') then return jsonb_build_object('kind', 'released'); end if;
  if not public.fleet_sync_attachment_uploader_allowed(target_company_id, target_user_id) then return jsonb_build_object('kind', 'access_revoked'); end if;
  select * into upload from public.fleet_sync_attachment_uploads
    where company_id = target_company_id and user_id = target_user_id and attachment_id = target_attachment_id;
  select o.id into stored from storage.objects o where o.bucket_id = 'fleet-files' and o.name = copy.destination_path;
  if stored is null then return jsonb_build_object('kind', 'missing'); end if;
  if upload.receipt is null or observed_size is distinct from upload.byte_size or observed_digest is distinct from upload.sha256 then
    return jsonb_build_object('kind', 'mismatch');
  end if;
  update public.fleet_sync_attachment_copies set copy_object_id = stored, copy_verified_at = clock_timestamp()
    where company_id = copy.company_id and user_id = copy.user_id and attachment_id = copy.attachment_id;
  insert into public.fleet_sync_attachment_releases (company_id, user_id, attachment_id, reason)
    values (copy.company_id, copy.user_id, copy.attachment_id, 'copied') on conflict do nothing;
  return jsonb_build_object('kind', 'ready');
end;
$$;
revoke all on function public.record_fleet_sync_attachment_copy(uuid, uuid, uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.record_fleet_sync_attachment_copy(uuid, uuid, uuid, bigint, text) to service_role;
commit;
