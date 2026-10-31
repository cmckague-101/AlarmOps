-- Receipt purchase dates. Adds a nullable column only; existing receipts are not
-- rewritten and read as their upload date in the apps until someone sets one.
-- * New receipts (online and offline) may carry purchased_on.
-- * Owners may correct it, alongside name and amount.
-- * Offline receipt.create accepts an optional purchasedOn (YYYY-MM-DD); devices
--   that do not send it keep working unchanged.
begin;

alter table public.company_receipts
  add column purchased_on date check (purchased_on is null or purchased_on >= date '2000-01-01');

grant update (purchased_on) on public.company_receipts to authenticated;

grant create on schema public to fireops_sync_writer;
create or replace function public.user_sync_apply_receipt_create(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  path text := company::text || '/' || actor::text || '/sync-' || record_uuid::text;
  stored_size text;
  keys text[] := (select array_agg(k order by k collate "C") from jsonb_object_keys(payload) k);
begin
  if (keys is distinct from array['amountCents','byteSize','fileName','mimeType','name']
      and keys is distinct from array['amountCents','byteSize','fileName','mimeType','name','purchasedOn'])
    or jsonb_typeof(payload -> 'name') <> 'string' or char_length(btrim(payload ->> 'name')) not between 1 and 160
    or jsonb_typeof(payload -> 'amountCents') <> 'number' or payload ->> 'amountCents' !~ '^[1-9][0-9]{0,8}$' or (payload ->> 'amountCents')::bigint > 100000000
    or jsonb_typeof(payload -> 'fileName') <> 'string' or char_length(btrim(payload ->> 'fileName')) not between 1 and 255 or payload ->> 'fileName' ~ '[\x01-\x1f\x7f]'
    or jsonb_typeof(payload -> 'mimeType') <> 'string'
    or payload ->> 'mimeType' not in ('image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf')
    or jsonb_typeof(payload -> 'byteSize') <> 'number' or payload ->> 'byteSize' !~ '^[1-9][0-9]{0,7}$' or (payload ->> 'byteSize')::bigint > 10485760
    or (payload ? 'purchasedOn' and (jsonb_typeof(payload -> 'purchasedOn') <> 'string' or payload ->> 'purchasedOn' !~ '^\d{4}-\d{2}-\d{2}$')) then
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
    insert into public.company_receipts (id, company_id, name, amount_cents, original_file_name, mime_type, byte_size, storage_path, uploaded_by, uploaded_by_name, purchased_on)
      values (record_uuid, company, btrim(payload ->> 'name'), (payload ->> 'amountCents')::bigint, payload ->> 'fileName', payload ->> 'mimeType',
        (payload ->> 'byteSize')::bigint, path, actor, '', (payload ->> 'purchasedOn')::date);
  exception
    when unique_violation then raise exception 'This receipt identity was already used' using errcode = '23505';
    when datetime_field_overflow or invalid_datetime_format or check_violation then raise exception 'Invalid receipt' using errcode = '22023';
  end;
  return '{}'::jsonb;
end;
$$;
alter function public.user_sync_apply_receipt_create(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
revoke all on function public.user_sync_apply_receipt_create(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke create on schema public from fireops_sync_writer;

commit;
