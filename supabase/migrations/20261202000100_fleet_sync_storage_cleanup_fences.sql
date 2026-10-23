-- Storage removals are path-only: a late remove can delete whatever object is
-- at that path by then. Fence every sync cleanup removal with a database check
-- taken immediately before it, and keep proven fleet-files copies out of reach
-- of legacy deletion paths.
begin;

-- Remaining lease time a verifier needs before removing a mismatched object.
-- While the lease is active, re-upload and new leases are refused, so the
-- path still holds the leased object. The margin is far longer than the
-- bounded Storage remove request that follows; an expiring lease instead
-- skips removal and a later verification redoes it with a fresh lease.
create function public.authorize_fleet_sync_attachment_mismatch_removal(lease uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  attempt public.fleet_sync_attachment_verifications;
  upload public.fleet_sync_attachment_uploads;
  stored uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Service verifier required' using errcode = '42501'; end if;
  select * into attempt from public.fleet_sync_attachment_verifications where lease_token = lease for update;
  if not found then raise exception 'Verification lease not found' using errcode = 'P0002'; end if;
  if attempt.outcome is distinct from 'mismatch' then raise exception 'Only mismatched objects are removed' using errcode = 'PT409'; end if;
  if attempt.completed_at is not null then return jsonb_build_object('kind', 'stale', 'reason', 'released'); end if;
  if attempt.expires_at - clock_timestamp() < interval '5 minutes' then return jsonb_build_object('kind', 'stale', 'reason', 'lease_ending'); end if;
  select * into upload from public.fleet_sync_attachment_uploads u
    where u.company_id = attempt.company_id and u.user_id = attempt.user_id and u.attachment_id = attempt.attachment_id;
  select o.id into stored from storage.objects o where o.bucket_id = 'fleet-sync-files' and o.name = upload.object_path;
  if stored is null then return jsonb_build_object('kind', 'stale', 'reason', 'missing'); end if;
  if stored <> attempt.object_id then return jsonb_build_object('kind', 'stale', 'reason', 'replaced'); end if;
  return jsonb_build_object('kind', 'remove', 'path', upload.object_path, 'objectId', stored);
end;
$$;
revoke all on function public.authorize_fleet_sync_attachment_mismatch_removal(uuid) from public, anon, authenticated;
grant execute on function public.authorize_fleet_sync_attachment_mismatch_removal(uuid) to service_role;

-- A mismatched deterministic fleet-files copy may be removed only while no copy
-- of that upload has been proven. Row locks serialize with the record RPCs.
create function public.authorize_fleet_sync_copy_removal(target_company_id uuid, target_user_id uuid, target_attachment_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  link public.fleet_sync_attachment_links;
  copy public.fleet_sync_attachment_copies;
  path text := target_company_id::text || '/' || target_user_id::text || '/sync-' || target_attachment_id::text;
  stored uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Service verifier required' using errcode = '42501'; end if;
  select * into link from public.fleet_sync_attachment_links
    where company_id = target_company_id and user_id = target_user_id and attachment_id = target_attachment_id for update;
  select * into copy from public.fleet_sync_attachment_copies
    where company_id = target_company_id and user_id = target_user_id and attachment_id = target_attachment_id for update;
  if link.attachment_id is null and copy.attachment_id is null then raise exception 'Copy request not found' using errcode = 'P0002'; end if;
  if link.copy_object_id is not null or copy.copy_object_id is not null then return jsonb_build_object('kind', 'stale', 'reason', 'proven'); end if;
  select o.id into stored from storage.objects o where o.bucket_id = 'fleet-files' and o.name = path;
  if stored is null then return jsonb_build_object('kind', 'stale', 'reason', 'missing'); end if;
  return jsonb_build_object('kind', 'remove', 'path', path, 'objectId', stored);
end;
$$;
revoke all on function public.authorize_fleet_sync_copy_removal(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.authorize_fleet_sync_copy_removal(uuid, uuid, uuid) to service_role;

-- Proven copies are canonical business files that records, reviews and device
-- history may reference. They are retained, never removed by legacy paths.
create function public.fleet_sync_copy_is_protected(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.fleet_sync_attachment_links l where l.destination_path = object_name and l.copy_object_id is not null)
    or exists (select 1 from public.fleet_sync_attachment_copies c where c.destination_path = object_name and c.copy_object_id is not null);
$$;
revoke all on function public.fleet_sync_copy_is_protected(text) from public, anon;
grant execute on function public.fleet_sync_copy_is_protected(text) to authenticated, service_role;

create policy "proven fleet sync copies are retained" on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'fleet-files' or not public.fleet_sync_copy_is_protected(name));

-- Service filter for delete-fleet-files, which bypasses RLS.
create function public.fleet_sync_protected_copy_paths(target_company_id uuid, paths text[])
returns text[] language plpgsql stable security invoker set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Service caller required' using errcode = '42501'; end if;
  return coalesce((select array_agg(p order by p) from unnest(paths) p
    where p like target_company_id::text || '/%' and public.fleet_sync_copy_is_protected(p)), '{}');
end;
$$;
revoke all on function public.fleet_sync_protected_copy_paths(uuid, text[]) from public, anon, authenticated;
grant execute on function public.fleet_sync_protected_copy_paths(uuid, text[]) to service_role;
commit;
