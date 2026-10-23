-- Offline invoice drafts and submission through the user command registry,
-- mirroring payroll forms (20261209000100). Only the creator edits a draft; the
-- existing protect trigger and RLS still enforce that and the submit rules.
-- * invoice_form (entity ID = form ID, chosen on the device):
--   - `form.save` {invoiceNumber?, invoiceDate?, invoiceAmount?, customerId?}
--     ('' clears the date or customer): creates the caller's draft if new,
--     otherwise merges the given fields; later arrival wins per field. The
--     attachment is never changed offline.
--   - `form.submit` {}: submits the draft. An already submitted form is a no-op.
-- Nothing changes and the device keeps its intent when the invoice was already
-- submitted (`already_submitted`), was deleted after this user's device saw it
-- (`form_deleted`), another draft is in progress (`other_draft`), the chosen
-- customer was removed (`customer_deleted`), or a submission is missing the
-- number, date, positive amount or customer (`incomplete`).
-- Deleting, attachments and customer management remain online-only.
begin;

insert into public.user_sync_commands values ('invoice_form','form.save',false),('invoice_form','form.submit',false);

grant create on schema public to fireops_sync_writer;
create function public.user_sync_state_invoice_form(company uuid, actor uuid, record_uuid uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', f.id, 'status', f.status, 'invoiceNumber', f.invoice_number, 'invoiceDate', coalesce(f.invoice_date::text, ''),
      'invoiceAmount', f.invoice_amount, 'customerId', coalesce(f.customer_id::text, ''), 'submittedAt', f.submitted_at, 'updatedAt', f.updated_at)
    from public.invoice_forms f where f.id = record_uuid and f.company_id = company and f.created_by = actor;
$$;
create function public.user_sync_apply_invoice_form(company uuid, actor uuid, record_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  existing public.invoice_forms;
  customer uuid;
  amount numeric;
  author text;
  violated text;
begin
  if command = 'form.save' then
    if payload = '{}'::jsonb or exists (select 1 from jsonb_object_keys(payload) k where k not in ('invoiceNumber','invoiceDate','invoiceAmount','customerId'))
      or (payload ? 'invoiceNumber' and (jsonb_typeof(payload -> 'invoiceNumber') <> 'string' or char_length(payload ->> 'invoiceNumber') > 160))
      or (payload ? 'invoiceDate' and (jsonb_typeof(payload -> 'invoiceDate') <> 'string' or payload ->> 'invoiceDate' !~ '^(\d{4}-\d{2}-\d{2})?$'))
      or (payload ? 'invoiceAmount' and jsonb_typeof(payload -> 'invoiceAmount') <> 'number')
      or (payload ? 'customerId' and (jsonb_typeof(payload -> 'customerId') <> 'string'
        or payload ->> 'customerId' !~ '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$')) then
      raise exception 'Invalid invoice' using errcode = '22023';
    end if;
    if payload ? 'invoiceAmount' then
      amount := (payload ->> 'invoiceAmount')::numeric;
      if amount < 0 or amount >= 10000000000 or amount <> round(amount, 2) then raise exception 'Invalid invoice amount' using errcode = '22023'; end if;
    end if;
    if coalesce(payload ->> 'invoiceDate', '') <> '' then perform (payload ->> 'invoiceDate')::date; end if;
    customer := nullif(payload ->> 'customerId', '')::uuid;
    if customer is not null and not exists (select 1 from public.invoice_customers c where c.id = customer and c.company_id = company) then
      return jsonb_build_object('notApplied', 'customer_deleted');
    end if;
  elsif payload <> '{}'::jsonb then
    raise exception 'Invalid invoice submission' using errcode = '22023';
  end if;

  -- No FOR UPDATE: the update policy hides submitted invoices. The writes below
  -- re-check status = 'draft' themselves.
  select * into existing from public.invoice_forms f
    where f.id = record_uuid and f.company_id = company and f.created_by = actor;
  if not found then
    -- Never recreate an invoice this user's device already saw on the server.
    if command = 'form.submit' or exists (select 1 from public.user_sync_receipts r where r.user_id = actor and r.company_id = company
        and r.entity_type = 'invoice_form' and r.entity_id = record_uuid and r.result -> 'record' <> 'null'::jsonb) then
      return jsonb_build_object('notApplied', 'form_deleted');
    end if;
    select coalesce(nullif(btrim(p.full_name), ''), 'Crew member') into author from public.profiles p where p.user_id = actor;
    begin
      insert into public.invoice_forms (id, company_id, created_by, created_by_name, invoice_number, invoice_date, invoice_amount, customer_id)
        values (record_uuid, company, actor, left(coalesce(author, 'Crew member'), 160), coalesce(payload ->> 'invoiceNumber', ''),
          nullif(payload ->> 'invoiceDate', '')::date, coalesce(amount, 0), customer);
    exception when unique_violation then
      get stacked diagnostics violated = constraint_name;
      if violated = 'invoice_forms_pkey' then
        raise exception 'This invoice identity was already used' using errcode = '23505';
      end if;
      return jsonb_build_object('notApplied', 'other_draft');
    end;
    return '{}'::jsonb;
  end if;

  if existing.status <> 'draft' then
    return case when command = 'form.submit' then '{}'::jsonb else jsonb_build_object('notApplied', 'already_submitted') end;
  end if;
  if command = 'form.submit' then
    if nullif(btrim(existing.invoice_number), '') is null or existing.invoice_date is null or existing.invoice_amount <= 0
      or existing.customer_id is null then
      return jsonb_build_object('notApplied', 'incomplete');
    end if;
    begin
      update public.invoice_forms f set status = 'submitted' where f.id = record_uuid and f.status = 'draft';
    exception when raise_exception then
      return jsonb_build_object('notApplied', 'incomplete'); -- cleared by a concurrent save
    end;
  else
    update public.invoice_forms f set
      invoice_number = coalesce(payload ->> 'invoiceNumber', f.invoice_number),
      invoice_date = case when payload ? 'invoiceDate' then nullif(payload ->> 'invoiceDate', '')::date else f.invoice_date end,
      invoice_amount = coalesce(amount, f.invoice_amount),
      customer_id = case when payload ? 'customerId' then customer else f.customer_id end
      where f.id = record_uuid and f.status = 'draft';
    if not found then return jsonb_build_object('notApplied', 'already_submitted'); end if;
  end if;
  return '{}'::jsonb;
end;
$$;
alter function public.user_sync_state_invoice_form(uuid, uuid, uuid) owner to fireops_sync_writer;
alter function public.user_sync_apply_invoice_form(uuid, uuid, uuid, text, jsonb) owner to fireops_sync_writer;
revoke all on function public.user_sync_state_invoice_form(uuid, uuid, uuid), public.user_sync_apply_invoice_form(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke create on schema public from fireops_sync_writer;
commit;
