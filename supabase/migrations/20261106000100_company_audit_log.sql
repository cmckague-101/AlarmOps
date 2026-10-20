-- Append-only company activity. Store descriptions, never row snapshots, file URLs,
-- message bodies, payroll values, signatures, or integration credentials.
create table public.company_audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_user_id uuid,
  actor_name text not null,
  description text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index company_audit_log_recent_idx on public.company_audit_log (company_id, created_at desc, id desc);
alter table public.company_audit_log enable row level security;
revoke all on public.company_audit_log from public, anon, authenticated;
grant select on public.company_audit_log to authenticated;
grant all on public.company_audit_log to service_role;
create policy "managers read recent company audit log" on public.company_audit_log
for select to authenticated using (
  created_at >= now() - interval '30 days'
  and public.is_company_owner(company_id, (select auth.uid()))
);

create function public.capture_company_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) else '{}'::jsonb end;
  after_row jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) else '{}'::jsonb end;
  item jsonb;
  before_data jsonb;
  after_data jsonb;
  target_company uuid;
  actor uuid := auth.uid();
  actor_label text;
  item_label text;
  changed text;
  field_name text;
  summary text;
begin
  item := case when tg_op = 'DELETE' then before_row else after_row end;
  target_company := (case when tg_table_name = 'companies' then item ->> 'id' else item ->> 'company_id' end)::uuid;
  -- Cascading deletes during company removal must not recreate company records.
  if not exists (select 1 from public.companies where id = target_company) then return null; end if;
  before_data := coalesce(before_row -> 'data', before_row) - array['updated_at','updated_by','version','created_at'];
  after_data := coalesce(after_row -> 'data', after_row) - array['updated_at','updated_by','version','created_at'];
  if tg_op = 'UPDATE' and before_data = after_data then return null; end if;

  -- Only trusted backend requests may forward a verified user's identity.
  if actor is null and auth.role() = 'service_role' then
    actor := nullif(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-fireops-actor-id', '')::uuid;
    if actor is null and tg_op <> 'DELETE' then
      actor := nullif(after_row ->> 'updated_by', '')::uuid;
    end if;
  end if;
  select nullif(full_name, '') into actor_label from public.profiles where user_id = actor;
  actor_label := coalesce(actor_label, case when actor is null then 'System' else 'Company user' end);
  item := coalesce(item -> 'data', item);
  item_label := coalesce(nullif(item ->> 'unit',''), nullif(item ->> 'name',''),
    nullif(item ->> 'title',''), nullif(item ->> 'subject',''), nullif(item ->> 'course_title',''),
    nullif(item ->> 'invoice_number',''), nullif(item ->> 'crew_name',''));
  if item_label is null and item ->> 'user_id' is not null then
    select nullif(full_name, '') into item_label from public.profiles where user_id = (item ->> 'user_id')::uuid;
  end if;
  summary := case tg_op when 'INSERT' then 'Created ' when 'DELETE' then 'Deleted ' else 'Updated ' end || tg_argv[0];
  if item_label is not null then summary := summary || ': ' || left(item_label, 160); end if;
  if tg_op = 'UPDATE' then
    -- Field names explain the change without copying potentially sensitive values.
    select string_agg(replace(regexp_replace(key, '([a-z])([A-Z])', '\1 \2', 'g'), '_', ' '), ', ' order by key)
      into changed from (
        select key from jsonb_object_keys(before_data || after_data) as keys(key)
        where before_data -> key is distinct from after_data -> key
      ) fields;
    if changed is not null then summary := summary || ' (changed: ' || changed || ')'; end if;
  end if;
  -- Include meaningful workflow/role transitions, but never arbitrary field values.
  foreach field_name in array array['role','status'] loop
    if after_data ->> field_name is not null
      and (tg_op = 'INSERT' or before_data -> field_name is distinct from after_data -> field_name)
    then
      summary := summary || '; ' || field_name || ': '
        || case when tg_op = 'UPDATE' then coalesce(before_data ->> field_name, 'none') || ' → ' else '' end
        || left(after_data ->> field_name, 80);
    end if;
  end loop;
  insert into public.company_audit_log (company_id, actor_user_id, actor_name, description)
    values (target_company, actor, actor_label, summary);
  return null;
end;
$$;
revoke all on function public.capture_company_audit_log() from public, anon, authenticated;

-- Exclude derived activity feeds, read receipts, caches and delivery queues.
do $$
declare entry record;
begin
  for entry in select * from (values
    ('companies','company profile'), ('company_members','company membership'),
    ('fleet_vehicles','vehicle'), ('fleet_issues','vehicle issue'), ('fleet_crew','crew record'),
    ('communication_threads','communication'), ('communication_replies','communication reply'),
    ('company_documents','document'), ('company_trainings','training'),
    ('company_training_signups','training signup'), ('company_inventory_items','inventory item'),
    ('company_inventory_checkouts','inventory checkout'), ('company_vehicle_types','vehicle type'),
    ('company_vehicle_inspection_items','inspection checklist item'), ('company_receipts','receipt'),
    ('company_invoices','invoice document'), ('company_payroll','payroll document'),
    ('invoice_forms','invoice'), ('invoice_customers','invoice customer'), ('payroll_forms','payroll form'),
    ('crew_availability','crew availability'), ('qualification_card_requests','qualification card request'),
    ('vehicle_notes','vehicle note')
  ) as tracked(table_name, label)
  loop
    execute format('create trigger capture_company_audit after insert or update or delete on public.%I for each row execute function public.capture_company_audit_log(%L)', entry.table_name, entry.label);
  end loop;
end;
$$;
