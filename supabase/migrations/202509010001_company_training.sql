-- Company training, crew registration, and per-user notification state.

create table public.company_trainings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  course_code text not null check (char_length(trim(course_code)) between 1 and 80),
  course_title text not null check (char_length(trim(course_title)) between 1 and 200),
  starts_at timestamptz not null,
  location text not null check (char_length(trim(location)) between 1 and 300),
  instructor text not null check (char_length(trim(instructor)) between 1 and 160),
  capacity integer not null check (capacity between 1 and 10000),
  course_information text not null default '' check (char_length(course_information) <= 5000),
  created_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id)
);

create table public.company_training_signups (
  company_id uuid not null references public.companies(id) on delete cascade,
  training_id uuid not null,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  user_name text not null,
  signed_up_at timestamptz not null default now(),
  primary key (company_id, training_id, user_id),
  foreign key (company_id, training_id) references public.company_trainings(company_id, id) on delete cascade
);

create table public.company_training_reads (
  company_id uuid not null references public.companies(id) on delete cascade,
  training_id uuid not null,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (company_id, training_id, user_id),
  foreign key (company_id, training_id) references public.company_trainings(company_id, id) on delete cascade
);

create index company_trainings_company_date_idx on public.company_trainings (company_id, starts_at);
create index company_training_signups_training_idx on public.company_training_signups (company_id, training_id);

create or replace function public.attribute_company_training()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.is_company_owner(new.company_id, auth.uid()) and not public.has_system_admin_company_access(new.company_id) then
    raise exception 'Company owner access required' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.attribute_company_training() from public, anon, authenticated;

create trigger company_trainings_attribution before insert or update on public.company_trainings
for each row execute function public.attribute_company_training();

create or replace function public.validate_training_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  training_capacity integer;
  profile_name text;
begin
  if auth.uid() is null or new.user_id <> auth.uid() then
    raise exception 'You can only register yourself' using errcode = '42501';
  end if;
  if not public.is_company_member(new.company_id, auth.uid()) then
    raise exception 'Company membership required' using errcode = '42501';
  end if;
  select capacity into training_capacity
  from public.company_trainings
  where company_id = new.company_id and id = new.training_id
  for update;
  if training_capacity is null then raise exception 'Training not found' using errcode = 'P0002'; end if;
  if (select count(*) from public.company_training_signups where company_id = new.company_id and training_id = new.training_id) >= training_capacity then
    raise exception 'Course is full' using errcode = '23514';
  end if;
  select full_name into profile_name from public.profiles where user_id = auth.uid();
  new.user_name := coalesce(nullif(trim(profile_name), ''), 'Crew member');
  new.signed_up_at := now();
  return new;
end;
$$;
revoke all on function public.validate_training_signup() from public, anon, authenticated;

create trigger company_training_signup_validation before insert on public.company_training_signups
for each row execute function public.validate_training_signup();

alter table public.company_trainings enable row level security;
alter table public.company_training_signups enable row level security;
alter table public.company_training_reads enable row level security;

create policy "company reads training" on public.company_trainings for select to authenticated
using (public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id));
create policy "owners create training" on public.company_trainings for insert to authenticated
with check ((public.is_company_owner(company_id, auth.uid()) or public.has_system_admin_company_access(company_id)) and created_by = auth.uid());
create policy "owners update training" on public.company_trainings for update to authenticated
using (public.is_company_owner(company_id, auth.uid()) or public.has_system_admin_company_access(company_id))
with check (public.is_company_owner(company_id, auth.uid()) or public.has_system_admin_company_access(company_id));
create policy "owners delete training" on public.company_trainings for delete to authenticated
using (public.is_company_owner(company_id, auth.uid()) or public.has_system_admin_company_access(company_id));

create policy "company reads training signups" on public.company_training_signups for select to authenticated
using (public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id));
create policy "crew registers self" on public.company_training_signups for insert to authenticated
with check (user_id = auth.uid() and public.is_company_member(company_id, auth.uid()));
create policy "crew cancels own registration" on public.company_training_signups for delete to authenticated
using (user_id = auth.uid() and public.is_company_member(company_id, auth.uid()));

create policy "users read own training state" on public.company_training_reads for select to authenticated
using (user_id = auth.uid() and (public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id)));
create policy "users create own training state" on public.company_training_reads for insert to authenticated
with check (user_id = auth.uid() and (public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id)));
create policy "users update own training state" on public.company_training_reads for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid() and (public.is_company_member(company_id, auth.uid()) or public.has_system_admin_company_access(company_id)));

revoke all on public.company_trainings, public.company_training_signups, public.company_training_reads from anon;
grant select, insert, update, delete on public.company_trainings to authenticated;
grant select, insert, delete on public.company_training_signups to authenticated;
grant select, insert, update on public.company_training_reads to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'company_trainings') then
    alter publication supabase_realtime add table public.company_trainings;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'company_training_signups') then
    alter publication supabase_realtime add table public.company_training_signups;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'company_training_reads') then
    alter publication supabase_realtime add table public.company_training_reads;
  end if;
end $$;
