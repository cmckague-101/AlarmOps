-- Structured invoice submissions and company-managed customer lists.
create or replace function public.is_company_manager(target_company_id uuid, target_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_system_admin_company_access(target_company_id) or exists (
    select 1 from public.company_members
    where company_id = target_company_id and user_id = target_user_id and role in ('owner', 'admin')
  );
$$;
revoke all on function public.is_company_manager(uuid, uuid) from public, anon;
grant execute on function public.is_company_manager(uuid, uuid) to authenticated;

create table public.invoice_customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index invoice_customers_company_name on public.invoice_customers(company_id, lower(name));
create trigger invoice_customers_touch before update on public.invoice_customers
for each row execute function public.touch_updated_at();
alter table public.invoice_customers enable row level security;
create policy "members read invoice customers" on public.invoice_customers for select to authenticated
using (public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id));
create policy "managers create invoice customers" on public.invoice_customers for insert to authenticated
with check (public.is_company_manager(company_id, auth.uid()));
create policy "managers update invoice customers" on public.invoice_customers for update to authenticated
using (public.is_company_manager(company_id, auth.uid())) with check (public.is_company_manager(company_id, auth.uid()));
create policy "managers delete invoice customers" on public.invoice_customers for delete to authenticated
using (public.is_company_manager(company_id, auth.uid()));
revoke all on public.invoice_customers from anon, authenticated;
grant select, insert, update, delete on public.invoice_customers to authenticated;

create table public.invoice_forms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_by_name text not null check (char_length(created_by_name) between 1 and 160),
  invoice_number text not null default '' check (char_length(invoice_number) <= 160),
  invoice_date date,
  invoice_amount numeric(12,2) not null default 0 check (invoice_amount >= 0),
  customer_id uuid references public.invoice_customers(id) on delete restrict,
  attachment jsonb,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'draft' and submitted_at is null) or (status = 'submitted' and submitted_at is not null)),
  check (attachment is null or (
    jsonb_typeof(attachment) = 'object'
    and jsonb_typeof(attachment->'name') = 'string'
    and char_length(attachment->>'name') between 1 and 255
    and attachment->>'mimeType' in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf')
    and (attachment->>'byteSize')::bigint between 1 and 10485760
    and attachment->>'storagePath' ~ ('^' || company_id::text || '/' || created_by::text || '/forms/' || id::text || '/[^/]+$')
  ))
);
create unique index invoice_forms_one_draft_per_user on public.invoice_forms(company_id, created_by) where status = 'draft';
create index invoice_forms_company_created on public.invoice_forms(company_id, created_at desc);

create or replace function public.protect_invoice_form()
returns trigger language plpgsql security definer set search_path = '' as $$
declare customer_company uuid;
begin
  if tg_op = 'INSERT' then
    if new.created_by <> auth.uid() or not public.is_company_member(new.company_id, auth.uid()) then
      raise exception 'Company membership required' using errcode = '42501';
    end if;
    new.status := 'draft'; new.submitted_at := null;
  else
    if old.status = 'submitted' then raise exception 'Submitted invoice is read only' using errcode = '42501'; end if;
    if old.created_by <> auth.uid() then raise exception 'Only creator can edit draft invoice' using errcode = '42501'; end if;
    new.company_id := old.company_id; new.created_by := old.created_by; new.created_by_name := old.created_by_name;
    if new.status = 'submitted' then new.submitted_at := now();
    elsif new.status <> 'draft' then raise exception 'Invalid invoice status';
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
create trigger invoice_forms_protect before insert or update on public.invoice_forms
for each row execute function public.protect_invoice_form();
create trigger invoice_forms_touch before update on public.invoice_forms
for each row execute function public.touch_updated_at();
alter table public.invoice_forms enable row level security;
create policy "users read permitted invoices" on public.invoice_forms for select to authenticated
using (created_by = auth.uid() or public.is_company_manager(company_id, auth.uid()));
create policy "members create invoice drafts" on public.invoice_forms for insert to authenticated
with check (public.is_company_member(company_id, auth.uid()) and created_by = auth.uid());
create policy "creators update invoice drafts" on public.invoice_forms for update to authenticated
using (created_by = auth.uid() and status = 'draft') with check (created_by = auth.uid());
create policy "creators and managers delete invoices" on public.invoice_forms for delete to authenticated
using ((created_by = auth.uid() and status = 'draft') or public.is_company_manager(company_id, auth.uid()));
revoke all on public.invoice_forms from anon, authenticated;
grant select, insert, update, delete on public.invoice_forms to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoice-files', 'invoice-files', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy "members upload invoice files" on storage.objects for insert to authenticated with check (
  bucket_id = 'invoice-files' and (storage.foldername(name))[2] = auth.uid()::text
  and public.is_company_member(((storage.foldername(name))[1])::uuid, auth.uid())
);
create policy "users read permitted invoice files" on storage.objects for select to authenticated using (
  bucket_id = 'invoice-files' and (
    (storage.foldername(name))[2] = auth.uid()::text
    or public.is_company_manager(((storage.foldername(name))[1])::uuid, auth.uid())
  )
);
create policy "users remove permitted invoice files" on storage.objects for delete to authenticated using (
  bucket_id = 'invoice-files' and (
    public.is_company_manager(((storage.foldername(name))[1])::uuid, auth.uid())
    or ((storage.foldername(name))[2] = auth.uid()::text and not exists (
      select 1 from public.invoice_forms form where form.attachment->>'storagePath' = name and form.status = 'submitted'
    ))
  )
);

create or replace function public.notify_submitted_invoice()
returns trigger language plpgsql security definer set search_path = '' as $$
declare manager record;
begin
  if new.status = 'submitted' and old.status = 'draft' then
    for manager in select user_id from public.company_members where company_id = new.company_id and role in ('owner', 'admin') loop
      perform public.create_user_notification(new.company_id, manager.user_id, new.created_by, 'system', 'system', new.id,
        'Invoice submitted', new.created_by_name || ' submitted invoice ' || new.invoice_number || '.', '/invoices',
        'invoice:' || new.id::text, 'invoice-submitted:' || new.id::text);
    end loop;
  end if;
  return new;
end $$;
create trigger invoice_forms_submitted_notification after update of status on public.invoice_forms
for each row execute function public.notify_submitted_invoice();

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.invoice_forms;
    alter publication supabase_realtime add table public.invoice_customers;
  end if;
exception when duplicate_object then null; end $$;
