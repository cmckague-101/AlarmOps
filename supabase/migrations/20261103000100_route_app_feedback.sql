-- Route all app feedback to owner of designated FireOps company.
alter table public.app_feedback
  add column source_company_name text,
  add column source_company_code text,
  add column submitter_name text,
  add column submitter_email text;

update public.app_feedback feedback
set source_company_name = company.name,
    source_company_code = company.company_code,
    submitter_name = coalesce(nullif(trim(profile.full_name), ''), 'FireOps user'),
    submitter_email = profile.email
from public.companies company, public.profiles profile
where company.id = feedback.company_id
  and profile.user_id = feedback.submitted_by;

alter table public.app_feedback
  alter column source_company_name set not null,
  alter column source_company_code set not null,
  alter column submitter_name set not null,
  alter column submitter_email set not null;

create or replace function public.populate_app_feedback_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select company.name, company.company_code
    into new.source_company_name, new.source_company_code
  from public.companies company
  where company.id = new.company_id;

  select coalesce(nullif(trim(profile.full_name), ''), 'FireOps user'), profile.email
    into new.submitter_name, new.submitter_email
  from public.profiles profile
  where profile.user_id = new.submitted_by;

  if new.source_company_name is null or new.submitter_email is null then
    raise exception 'Feedback source could not be identified' using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke all on function public.populate_app_feedback_source() from public, anon, authenticated;

create trigger app_feedback_populate_source
before insert on public.app_feedback
for each row execute function public.populate_app_feedback_source();

drop policy if exists "system admins read app feedback" on public.app_feedback;
create policy "feedback company owner reads app feedback" on public.app_feedback
for select to authenticated
using (
  exists (
    select 1
    from public.companies destination
    where destination.company_code = 'FCLLC-2026'
      and destination.owner_user_id = (select auth.uid())
  )
);

create or replace function public.notify_app_feedback_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  destination_company_id uuid;
  destination_owner_id uuid;
  category_label text;
begin
  select company.id, company.owner_user_id
    into destination_company_id, destination_owner_id
  from public.companies company
  where company.company_code = 'FCLLC-2026';

  if destination_company_id is null or destination_owner_id is null then
    return new;
  end if;

  category_label := case new.category
    when 'idea' then 'Idea'
    when 'issue' then 'Issue'
    else 'Other'
  end;

  perform public.create_user_notification(
    destination_company_id,
    destination_owner_id,
    null,
    'system',
    'system',
    new.id,
    'New app feedback · ' || category_label,
    new.source_company_name || ' (' || new.source_company_code || ') · ' ||
      new.submitter_name || ': ' || left(regexp_replace(new.message, '\s+', ' ', 'g'), 260),
    '/feedback/' || new.id::text,
    'app-feedback:' || new.id::text,
    'app-feedback-submitted:' || new.id::text
  );
  return new;
end;
$$;
revoke all on function public.notify_app_feedback_owner() from public, anon, authenticated;

create trigger app_feedback_notify_owner
after insert on public.app_feedback
for each row execute function public.notify_app_feedback_owner();
