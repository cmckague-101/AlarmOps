-- Offline expense receipts through the user command registry.
-- The device keeps the picked file and, once connected, uploads it into the
-- caller's own receipt-files folder exactly as the online flow does (existing
-- storage policies: own folder only, no overwrite), at the fixed path
-- <company>/<user>/sync-<receipt id>. Only then does it send the command.
-- * receipt (entity ID = receipt ID, chosen on the device):
--   - `receipt.create` {name, amountCents, fileName, mimeType, byteSize}:
--     creates the receipt pointing at that path through the existing
--     attribution trigger and RLS, if the uploaded object exists and has the
--     declared size. A file that has not arrived yet is a retryable error
--     (55000); a stored object of another size returns notApplied
--     'file_mismatch' and nothing is created. A reused receipt ID is refused.
-- Edits and deletes stay online-only (owners, as today).
begin;

insert into public.user_sync_commands values ('receipt','receipt.create',false);

grant create on schema public to fireops_sync_writer;
create function public.user_sync_state_receipt(company uuid, actor uuid, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'name', r.name, 'amountCents', r.amount_cents, 'storagePath', r.storage_path, 'createdAt', r.created_at)
    from public.company_receipts r where r.id = record_uuid and r.company_id = company and r.uploaded_by = actor;
$$;
create function public.user_sync_apply_receipt(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  path text := company::text || '/' || actor::text || '/sync-' || record_uuid::text;
  stored_size text;
begin
  if (select array_agg(k order by k collate "C") from jsonb_object_keys(payload) k) is distinct from array['amountCents','byteSize','fileName','mimeType','name']
    or jsonb_typeof(payload -> 'name') <> 'string' or char_length(btrim(payload ->> 'name')) not between 1 and 160
    or jsonb_typeof(payload -> 'amountCents') <> 'number' or payload ->> 'amountCents' !~ '^[1-9][0-9]{0,8}$' or (payload ->> 'amountCents')::bigint > 100000000
    or jsonb_typeof(payload -> 'fileName') <> 'string' or char_length(btrim(payload ->> 'fileName')) not between 1 and 255 or payload ->> 'fileName' ~ '[\x01-\x1f\x7f]'
    or jsonb_typeof(payload -> 'mimeType') <> 'string'
    or payload ->> 'mimeType' not in ('image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf')
    or jsonb_typeof(payload -> 'byteSize') <> 'number' or payload ->> 'byteSize' !~ '^[1-9][0-9]{0,7}$' or (payload ->> 'byteSize')::bigint > 10485760 then
    raise exception 'Invalid receipt' using errcode = '22023';
  end if;
  if exists (select 1 from public.company_receipts r where r.storage_path = path) then
    raise exception 'This receipt identity was already used' using errcode = '23505';
  end if;
  -- Read as the uploader through the existing receipt-files read policy.
  select o.metadata ->> 'size' into stored_size from storage.objects o where o.bucket_id = 'receipt-files' and o.name = path;
  if not found then raise exception 'The receipt file has not uploaded yet' using errcode = '55000'; end if;
  if stored_size is distinct from payload ->> 'byteSize' then return jsonb_build_object('notApplied', 'file_mismatch'); end if;
  begin
    insert into public.company_receipts (id, company_id, name, amount_cents, original_file_name, mime_type, byte_size, storage_path, uploaded_by, uploaded_by_name)
      values (record_uuid, company, btrim(payload ->> 'name'), (payload ->> 'amountCents')::bigint, payload ->> 'fileName', payload ->> 'mimeType',
        (payload ->> 'byteSize')::bigint, path, actor, '');
  exception when unique_violation then
    raise exception 'This receipt identity was already used' using errcode = '23505';
  end;
  return '{}'::jsonb;
end;
$$;
alter function public.user_sync_state_receipt(uuid, uuid, uuid) owner to fireops_sync_writer;
alter function public.user_sync_apply_receipt(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
revoke all on function public.user_sync_state_receipt(uuid, uuid, uuid), public.user_sync_apply_receipt(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke create on schema public from fireops_sync_writer;
commit;
