-- Receipt projects and per-company receipt auto-fill.
-- * company_receipts.project: optional free-text project (1-120 characters),
--   set on upload (online or offline) and correctable by owners like the name.
--   Existing receipts keep a null project.
-- * Offline receipt.create accepts an optional `project`; devices that do not
--   send it keep working unchanged.
-- * companies.receipt_autofill_enabled: turned on per company by FireOps staff
--   (SQL or the service role, there is no client grant) for subscriptions that
--   include auto-fill. Members can read it to show the auto-fill flow.
-- * claim_receipt_autofill(company, actor): called by the receipt-autofill edge
--   function (service role only) before each vision request. It refuses
--   non-members, companies without auto-fill, and callers over the daily limits,
--   and logs each allowed request in receipt_autofill_usage for billing review.
begin;

alter table public.company_receipts
  add column project text check (project is null or char_length(btrim(project)) between 1 and 120);

grant update (project) on public.company_receipts to authenticated;

alter table public.companies
  add column receipt_autofill_enabled boolean not null default false;

create table public.receipt_autofill_usage (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default now()
);
create index receipt_autofill_usage_company_created_idx on public.receipt_autofill_usage (company_id, created_at desc);
create index receipt_autofill_usage_user_created_idx on public.receipt_autofill_usage (user_id, created_at desc);
alter table public.receipt_autofill_usage enable row level security;
revoke all on public.receipt_autofill_usage from public, anon, authenticated;

-- Daily caps protect the shared API key: 200 receipts per person and 2,000 per
-- company in any rolling 24 hours (a full 25-receipt batch is 25 requests).
create or replace function public.claim_receipt_autofill(company uuid, actor uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.company_members m where m.company_id = company and m.user_id = actor) then
    return 'not_member';
  end if;
  if not coalesce((select c.receipt_autofill_enabled from public.companies c where c.id = company), false) then
    return 'disabled';
  end if;
  -- Serialise claims per company so concurrent batches cannot overshoot the caps.
  perform pg_advisory_xact_lock(hashtextextended('receipt_autofill:' || company::text, 0));
  if (select count(*) from public.receipt_autofill_usage u where u.user_id = actor and u.created_at > now() - interval '24 hours') >= 200
    or (select count(*) from public.receipt_autofill_usage u where u.company_id = company and u.created_at > now() - interval '24 hours') >= 2000 then
    return 'limit';
  end if;
  insert into public.receipt_autofill_usage (company_id, user_id) values (company, actor);
  return 'ok';
end;
$$;
revoke all on function public.claim_receipt_autofill(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_receipt_autofill(uuid, uuid) to service_role;

-- Latest definition is 20270102000100_receipt_purchase_date; adds optional `project`.
grant create on schema public to fireops_sync_writer;
create or replace function public.user_sync_apply_receipt_create(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  path text := company::text || '/' || actor::text || '/sync-' || record_uuid::text;
  stored_size text;
  keys text[] := (select array_agg(k order by k collate "C") from jsonb_object_keys(payload) k);
begin
  if not (keys @> array['amountCents','byteSize','fileName','mimeType','name'])
    or not (keys <@ array['amountCents','byteSize','fileName','mimeType','name','project','purchasedOn'])
    or jsonb_typeof(payload -> 'name') <> 'string' or char_length(btrim(payload ->> 'name')) not between 1 and 160
    or jsonb_typeof(payload -> 'amountCents') <> 'number' or payload ->> 'amountCents' !~ '^[1-9][0-9]{0,8}$' or (payload ->> 'amountCents')::bigint > 100000000
    or jsonb_typeof(payload -> 'fileName') <> 'string' or char_length(btrim(payload ->> 'fileName')) not between 1 and 255 or payload ->> 'fileName' ~ '[\x01-\x1f\x7f]'
    or jsonb_typeof(payload -> 'mimeType') <> 'string'
    or payload ->> 'mimeType' not in ('image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf')
    or jsonb_typeof(payload -> 'byteSize') <> 'number' or payload ->> 'byteSize' !~ '^[1-9][0-9]{0,7}$' or (payload ->> 'byteSize')::bigint > 10485760
    or (payload ? 'purchasedOn' and (jsonb_typeof(payload -> 'purchasedOn') <> 'string' or payload ->> 'purchasedOn' !~ '^\d{4}-\d{2}-\d{2}$'))
    or (payload ? 'project' and (jsonb_typeof(payload -> 'project') <> 'string' or char_length(btrim(payload ->> 'project')) not between 1 and 120)) then
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
    insert into public.company_receipts (id, company_id, name, amount_cents, original_file_name, mime_type, byte_size, storage_path, uploaded_by, uploaded_by_name, purchased_on, project)
      values (record_uuid, company, btrim(payload ->> 'name'), (payload ->> 'amountCents')::bigint, payload ->> 'fileName', payload ->> 'mimeType',
        (payload ->> 'byteSize')::bigint, path, actor, '', (payload ->> 'purchasedOn')::date, btrim(payload ->> 'project'));
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
