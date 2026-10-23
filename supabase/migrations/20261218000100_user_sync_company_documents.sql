-- Offline company documents (owners/admins), like offline receipts
-- (20261212000100): the device keeps the picked file and, once connected,
-- uploads it into the caller's own fleet-files folder (existing upload policy,
-- no overwrite) at <company>/<user>/doc-<document id>, then sends the command.
-- * company_document (entity ID = document ID chosen on the device):
--   `document.create` {name, fileName, mimeType, byteSize} creates the document
--   for exactly that path through the existing attribution trigger and owner
--   insert policy (crew are refused as online), if the uploaded object exists
--   (otherwise retryable 55000) with the declared size (otherwise notApplied
--   'file_mismatch'). A reused ID or path is refused (23505).
-- Renames, file replacement and deletes stay online-only.
begin;

insert into public.user_sync_commands values ('company_document','document.create',false);

grant create on schema public to fireops_sync_writer;
create function public.user_sync_state_company_document(company uuid, actor uuid, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', d.id, 'name', d.name, 'storagePath', d.storage_path, 'createdAt', d.created_at) from public.company_documents d
    where d.id = record_uuid and d.company_id = company;
$$;
create function public.user_sync_apply_company_document(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  path text := company::text || '/' || actor::text || '/doc-' || record_uuid::text;
  stored_size text;
begin
  if (select array_agg(k order by k collate "C") from jsonb_object_keys(payload) k) is distinct from array['byteSize','fileName','mimeType','name']
    or jsonb_typeof(payload -> 'name') <> 'string' or char_length(btrim(payload ->> 'name')) not between 1 and 160
    or jsonb_typeof(payload -> 'fileName') <> 'string' or char_length(btrim(payload ->> 'fileName')) not between 1 and 255 or payload ->> 'fileName' ~ '[\x01-\x1f\x7f]'
    or jsonb_typeof(payload -> 'mimeType') <> 'string' or payload ->> 'mimeType' not in ('image/jpeg','image/png','image/webp','image/gif','application/pdf')
    or jsonb_typeof(payload -> 'byteSize') <> 'number' or payload ->> 'byteSize' !~ '^[1-9][0-9]{0,6}$' or (payload ->> 'byteSize')::bigint > 8388608 then
    raise exception 'Invalid company document' using errcode = '22023';
  end if;
  if not public.is_company_owner(company, actor) then raise exception 'Company owner access required' using errcode = '42501'; end if;
  if exists (select 1 from public.company_documents d where d.storage_path = path or d.id = record_uuid) then
    raise exception 'This document identity was already used' using errcode = '23505';
  end if;
  select o.metadata ->> 'size' into stored_size from storage.objects o where o.bucket_id = 'fleet-files' and o.name = path;
  if not found then raise exception 'The document file has not uploaded yet' using errcode = '55000'; end if;
  if stored_size is distinct from payload ->> 'byteSize' then return jsonb_build_object('notApplied', 'file_mismatch'); end if;
  begin
    insert into public.company_documents (id, company_id, name, file_name, mime_type, storage_path, created_by)
      values (record_uuid, company, btrim(payload ->> 'name'), payload ->> 'fileName', payload ->> 'mimeType', path, actor);
  exception when unique_violation then
    raise exception 'This document identity was already used' using errcode = '23505';
  end;
  return '{}'::jsonb;
end;
$$;
alter function public.user_sync_state_company_document(uuid, uuid, uuid) owner to fireops_sync_writer;
alter function public.user_sync_apply_company_document(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
revoke all on function public.user_sync_state_company_document(uuid, uuid, uuid), public.user_sync_apply_company_document(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke create on schema public from fireops_sync_writer;
commit;
