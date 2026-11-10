-- QuickBooks Online sync for invoices (paid add-on).
-- * companies.quickbooks_enabled: turned on per company by FireOps staff (SQL or
--   the service role; there is no client grant). Members can read it so the
--   apps hide QuickBooks when it is off. Every QuickBooks edge function checks it.
-- * company_qbo_connections: server-only OAuth tokens (AES-GCM encrypted with
--   QBO_ENCRYPTION_KEY in the edge functions), the realm id and token expiry.
--   Only the owner connects or disconnects, through quickbooks-integration.
-- * company_qbo_oauth_states: server-only, single-use OAuth state records.
-- * company_qbo_settings: sync timing ('manual' default or 'on_submit'), the
--   Product/Service item for the single invoice line, optional tax code, terms,
--   class and location (department), and the payment deposit account (null =
--   Undeposited Funds) and payment method. Owners and accounting can read it;
--   only the owner changes it, through quickbooks-integration.
-- * company_qbo_customer_mappings: each FireOps invoice customer mapped once to
--   a QuickBooks customer. Owners and accounting read it; they map customers
--   through quickbooks-integration (the QuickBooks customer is checked there).
--   QuickBooks customers are never created by FireOps.
-- * invoice_forms.qbo_*: written only by the QuickBooks edge functions (service
--   role). Clients cannot change them. Editing a synced field on a synced
--   invoice marks it out_of_sync. Marking a synced invoice paid in FireOps
--   queues a QuickBooks payment (qbo_payment_pending).
-- * The service role may mark a submitted invoice paid when QuickBooks shows a
--   zero balance: paid_by null, paid_by_name 'QuickBooks'. Paid invoices stay
--   read only for everyone else; only QuickBooks status fields change on them.
-- * claim_qbo_invoice_sync / release_qbo_invoice_sync: a short per-invoice lock
--   so a double click, a webhook and the scheduled poll never create two
--   QuickBooks invoices or payments for the same FireOps invoice.
begin;

alter table public.companies
  add column quickbooks_enabled boolean not null default false;

create table public.company_qbo_connections (
  company_id uuid primary key references public.companies(id) on delete cascade,
  realm_id text not null check (realm_id ~ '^[0-9]{1,32}$'),
  encrypted_access_token text not null,
  access_token_iv text not null,
  encrypted_refresh_token text not null,
  refresh_token_iv text not null,
  token_expires_at timestamptz not null,
  refresh_token_expires_at timestamptz,
  connected_by uuid references public.profiles(user_id) on delete set null,
  connected_at timestamptz not null default now(),
  last_cdc_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index company_qbo_connections_realm_idx on public.company_qbo_connections(realm_id);
alter table public.company_qbo_connections enable row level security;
revoke all on public.company_qbo_connections from public, anon, authenticated;
grant all on public.company_qbo_connections to service_role;
comment on table public.company_qbo_connections is
  'Server-only encrypted QuickBooks Online OAuth tokens and realm id per company. Never expose to clients.';

create table public.company_qbo_oauth_states (
  state uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  return_to text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index company_qbo_oauth_states_company_idx on public.company_qbo_oauth_states(company_id);
alter table public.company_qbo_oauth_states enable row level security;
revoke all on public.company_qbo_oauth_states from public, anon, authenticated;
grant all on public.company_qbo_oauth_states to service_role;

create table public.company_qbo_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  -- The QuickBooks company last connected; kept after disconnect so reconnecting
  -- to a different company can clear links that belong to the old one.
  realm_id text,
  qbo_company_name text check (qbo_company_name is null or char_length(qbo_company_name) <= 200),
  connected boolean not null default false,
  sync_mode text not null default 'manual' check (sync_mode in ('manual', 'on_submit')),
  item_id text, item_name text,
  tax_code_id text, tax_code_name text,
  terms_id text, terms_name text,
  class_id text, class_name text,
  department_id text, department_name text,
  deposit_account_id text, deposit_account_name text,
  payment_method_id text, payment_method_name text,
  updated_by uuid references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint company_qbo_settings_ref_ids check (
    coalesce(item_id, '0') ~ '^[0-9A-Za-z_-]{1,64}$' and coalesce(tax_code_id, '0') ~ '^[0-9A-Za-z_-]{1,64}$'
    and coalesce(terms_id, '0') ~ '^[0-9A-Za-z_-]{1,64}$' and coalesce(class_id, '0') ~ '^[0-9A-Za-z_-]{1,64}$'
    and coalesce(department_id, '0') ~ '^[0-9A-Za-z_-]{1,64}$' and coalesce(deposit_account_id, '0') ~ '^[0-9A-Za-z_-]{1,64}$'
    and coalesce(payment_method_id, '0') ~ '^[0-9A-Za-z_-]{1,64}$'
  )
);
alter table public.company_qbo_settings enable row level security;
create policy "finance reads quickbooks settings" on public.company_qbo_settings for select to authenticated
using (public.is_company_finance_processor(company_id, (select auth.uid())));
revoke all on public.company_qbo_settings from public, anon, authenticated;
grant select on public.company_qbo_settings to authenticated;
grant all on public.company_qbo_settings to service_role;

create table public.company_qbo_customer_mappings (
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.invoice_customers(id) on delete cascade,
  qbo_customer_id text not null check (qbo_customer_id ~ '^[0-9]{1,32}$'),
  qbo_customer_name text not null check (char_length(qbo_customer_name) between 1 and 500),
  mapped_by uuid references public.profiles(user_id) on delete set null,
  mapped_at timestamptz not null default now(),
  primary key (company_id, customer_id)
);
create unique index company_qbo_customer_mappings_customer_idx on public.company_qbo_customer_mappings(customer_id);
alter table public.company_qbo_customer_mappings enable row level security;
create policy "finance reads quickbooks customer mappings" on public.company_qbo_customer_mappings for select to authenticated
using (public.is_company_finance_processor(company_id, (select auth.uid())));
revoke all on public.company_qbo_customer_mappings from public, anon, authenticated;
grant select on public.company_qbo_customer_mappings to authenticated;
grant all on public.company_qbo_customer_mappings to service_role;

alter table public.invoice_forms
  add column qbo_invoice_id text check (qbo_invoice_id is null or qbo_invoice_id ~ '^[0-9]{1,32}$'),
  add column qbo_sync_token text check (qbo_sync_token is null or qbo_sync_token ~ '^[0-9]{1,16}$'),
  add column qbo_sync_status text not null default 'not_synced'
    check (qbo_sync_status in ('not_synced', 'synced', 'out_of_sync', 'needs_attention')),
  add column qbo_synced_at timestamptz,
  add column qbo_last_error text check (qbo_last_error is null or char_length(qbo_last_error) <= 500),
  add column qbo_payment_id text check (qbo_payment_id is null or qbo_payment_id ~ '^[0-9]{1,32}$'),
  add column qbo_payment_pending boolean not null default false,
  add column qbo_attachable_id text check (qbo_attachable_id is null or qbo_attachable_id ~ '^[0-9]{1,32}$'),
  add column qbo_attachment_path text,
  add column qbo_sync_requested_at timestamptz;
create unique index invoice_forms_qbo_invoice_idx on public.invoice_forms(company_id, qbo_invoice_id) where qbo_invoice_id is not null;
create index invoice_forms_qbo_work_idx on public.invoice_forms(company_id)
  where qbo_payment_pending or (qbo_sync_requested_at is not null and qbo_invoice_id is null);

grant select, update on public.invoice_forms to service_role;
grant select on public.invoice_customers, public.companies, public.company_members, public.profiles to service_role;

-- Latest definition from 20270107000100, plus the QuickBooks rules above.
create or replace function public.protect_invoice_form()
returns trigger language plpgsql security definer set search_path = '' as $$
declare customer_company uuid;
begin
  -- QuickBooks edge functions (service role) change only QuickBooks fields, or
  -- mark a submitted invoice paid because QuickBooks shows it paid.
  if auth.uid() is null and auth.role() = 'service_role' then
    if tg_op = 'INSERT' then raise exception 'Invoices are created by members' using errcode = '42501'; end if;
    if new.status is distinct from old.status and not (old.status = 'submitted' and new.status = 'paid') then
      raise exception 'QuickBooks sync cannot change invoice status' using errcode = '42501';
    end if;
    new.company_id := old.company_id; new.created_by := old.created_by; new.created_by_name := old.created_by_name;
    new.invoice_number := old.invoice_number; new.invoice_date := old.invoice_date; new.invoice_amount := old.invoice_amount;
    new.customer_id := old.customer_id; new.attachment := old.attachment; new.due_date := old.due_date;
    new.submitted_at := old.submitted_at; new.created_at := old.created_at;
    if old.status = 'submitted' and new.status = 'paid' then
      new.paid_at := now(); new.paid_by := null; new.paid_by_name := 'QuickBooks';
    else
      new.paid_at := old.paid_at; new.paid_by := old.paid_by; new.paid_by_name := old.paid_by_name;
    end if;
    return new;
  end if;

  -- Members never write QuickBooks fields.
  if tg_op = 'INSERT' then
    new.qbo_invoice_id := null; new.qbo_sync_token := null; new.qbo_sync_status := 'not_synced';
    new.qbo_synced_at := null; new.qbo_last_error := null; new.qbo_payment_id := null;
    new.qbo_payment_pending := false; new.qbo_attachable_id := null; new.qbo_attachment_path := null;
    new.qbo_sync_requested_at := null;
  else
    new.qbo_invoice_id := old.qbo_invoice_id; new.qbo_sync_token := old.qbo_sync_token; new.qbo_sync_status := old.qbo_sync_status;
    new.qbo_synced_at := old.qbo_synced_at; new.qbo_last_error := old.qbo_last_error; new.qbo_payment_id := old.qbo_payment_id;
    new.qbo_payment_pending := old.qbo_payment_pending; new.qbo_attachable_id := old.qbo_attachable_id;
    new.qbo_attachment_path := old.qbo_attachment_path; new.qbo_sync_requested_at := old.qbo_sync_requested_at;
  end if;

  if tg_op = 'INSERT' then
    if new.created_by <> auth.uid() or not public.is_company_member(new.company_id, auth.uid()) then
      raise exception 'Company membership required' using errcode = '42501';
    end if;
    new.status := 'draft'; new.submitted_at := null;
    new.paid_at := null; new.paid_by := null; new.paid_by_name := null;
  else
    if old.status = 'paid' then raise exception 'Paid invoice is read only' using errcode = '42501'; end if;
    if old.status = 'submitted' then
      if new.status = 'paid' then
        if not public.is_company_finance_processor(old.company_id, auth.uid()) then
          raise exception 'Submitted invoice is read only' using errcode = '42501';
        end if;
        new.company_id := old.company_id; new.created_by := old.created_by; new.created_by_name := old.created_by_name;
        new.invoice_number := old.invoice_number; new.invoice_date := old.invoice_date; new.invoice_amount := old.invoice_amount;
        new.customer_id := old.customer_id; new.attachment := old.attachment; new.due_date := old.due_date;
        new.submitted_at := old.submitted_at;
        new.paid_at := now(); new.paid_by := auth.uid();
        select left(coalesce(nullif(btrim(p.full_name), ''), 'Company user'), 160) into new.paid_by_name
          from public.profiles p where p.user_id = auth.uid();
        new.paid_by_name := coalesce(new.paid_by_name, 'Company user');
        return new;
      end if;
      if new.status <> 'submitted'
        or not (
          old.created_by = auth.uid()
          or public.is_company_finance_processor(old.company_id, auth.uid())
        ) then
        raise exception 'Submitted invoice is read only' using errcode = '42501';
      end if;
      new.company_id := old.company_id;
      new.created_by := old.created_by;
      new.created_by_name := old.created_by_name;
      new.submitted_at := old.submitted_at;
      new.paid_at := null; new.paid_by := null; new.paid_by_name := null;
    else
      if old.created_by <> auth.uid() then raise exception 'Only creator can edit draft invoice' using errcode = '42501'; end if;
      new.company_id := old.company_id; new.created_by := old.created_by; new.created_by_name := old.created_by_name;
      new.paid_at := null; new.paid_by := null; new.paid_by_name := null;
      if new.status = 'submitted' then new.submitted_at := now();
      elsif new.status <> 'draft' then raise exception 'Invalid invoice status';
      end if;
    end if;
  end if;
  if new.customer_id is not null then
    select company_id into customer_company from public.invoice_customers where id = new.customer_id;
    if customer_company is distinct from new.company_id then raise exception 'Customer must belong to company'; end if;
  end if;
  if new.status = 'submitted' and (nullif(trim(new.invoice_number), '') is null or new.invoice_date is null or new.invoice_amount <= 0 or new.customer_id is null) then
    raise exception 'Invoice number, date, positive amount, and customer are required';
  end if;
  return new;
end $$;

-- Runs after invoice_forms_protect (trigger names fire in alphabetical order).
-- * A member edit to a field QuickBooks holds marks a synced invoice out_of_sync.
-- * Submitting an invoice in an 'on_submit' company queues an automatic sync.
-- * A member marking a synced invoice paid queues a QuickBooks payment.
-- Keep the field list in sync with QBO_SYNCED_FIELDS in packages/domain/src/quickbooks.ts.
create or replace function public.track_invoice_qbo_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null and auth.role() = 'service_role' then return new; end if;
  if old.status = 'submitted' and new.status = 'submitted' and old.qbo_invoice_id is not null and old.qbo_sync_status = 'synced'
    and (new.invoice_number, new.invoice_date, new.invoice_amount, new.customer_id, new.due_date, new.attachment->>'storagePath')
      is distinct from (old.invoice_number, old.invoice_date, old.invoice_amount, old.customer_id, old.due_date, old.attachment->>'storagePath') then
    new.qbo_sync_status := 'out_of_sync';
  end if;
  if old.status = 'draft' and new.status = 'submitted' and new.qbo_invoice_id is null and exists (
    select 1 from public.company_qbo_settings s join public.companies c on c.id = s.company_id
    where s.company_id = new.company_id and s.sync_mode = 'on_submit' and s.connected and c.quickbooks_enabled
  ) then
    new.qbo_sync_requested_at := now();
  end if;
  if old.status = 'submitted' and new.status = 'paid' and new.qbo_invoice_id is not null and new.qbo_payment_id is null then
    new.qbo_payment_pending := true;
  end if;
  return new;
end $$;
revoke all on function public.track_invoice_qbo_changes() from public, anon, authenticated;
create trigger invoice_forms_qbo_track before update on public.invoice_forms
for each row execute function public.track_invoice_qbo_changes();

-- A 2-minute lock per invoice for QuickBooks writes (kept apart from
-- invoice_forms so locking does not touch the invoice or its audit log).
-- claim returns false while another sync holds it, so a double click, a webhook
-- and the scheduled poll never create two QuickBooks invoices or payments.
create table public.qbo_sync_locks (
  invoice_id uuid primary key references public.invoice_forms(id) on delete cascade,
  locked_until timestamptz not null
);
alter table public.qbo_sync_locks enable row level security;
revoke all on public.qbo_sync_locks from public, anon, authenticated;
grant all on public.qbo_sync_locks to service_role;

create or replace function public.claim_qbo_invoice_sync(target uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare claimed uuid;
begin
  insert into public.qbo_sync_locks as lock (invoice_id, locked_until) values (target, now() + interval '2 minutes')
  on conflict (invoice_id) do update set locked_until = excluded.locked_until where lock.locked_until < now()
  returning lock.invoice_id into claimed;
  return claimed is not null;
end $$;
revoke all on function public.claim_qbo_invoice_sync(uuid) from public, anon, authenticated;
grant execute on function public.claim_qbo_invoice_sync(uuid) to service_role;

create or replace function public.release_qbo_invoice_sync(target uuid)
returns void language sql volatile security definer set search_path = '' as $$
  delete from public.qbo_sync_locks where invoice_id = target;
$$;
revoke all on function public.release_qbo_invoice_sync(uuid) from public, anon, authenticated;
grant execute on function public.release_qbo_invoice_sync(uuid) to service_role;

-- Remove the link to a QuickBooks company: every invoice in the company goes
-- back to Not synced and customer mappings are cleared. Used when an owner
-- reconnects FireOps to a different QuickBooks company.
create or replace function public.reset_company_qbo_links(target_company uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  delete from public.company_qbo_customer_mappings where company_id = target_company;
  update public.company_qbo_settings set item_id = null, item_name = null, tax_code_id = null, tax_code_name = null,
    terms_id = null, terms_name = null, class_id = null, class_name = null, department_id = null, department_name = null,
    deposit_account_id = null, deposit_account_name = null, payment_method_id = null, payment_method_name = null
  where company_id = target_company;
  update public.invoice_forms set qbo_invoice_id = null, qbo_sync_token = null, qbo_sync_status = 'not_synced',
    qbo_synced_at = null, qbo_last_error = null, qbo_payment_id = null, qbo_payment_pending = false,
    qbo_attachable_id = null, qbo_attachment_path = null, qbo_sync_requested_at = null
  where company_id = target_company and (qbo_invoice_id is not null or qbo_sync_status <> 'not_synced' or qbo_payment_pending or qbo_sync_requested_at is not null);
end $$;
revoke all on function public.reset_company_qbo_links(uuid) from public, anon, authenticated;
grant execute on function public.reset_company_qbo_links(uuid) to service_role;

commit;
