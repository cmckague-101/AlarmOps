# Supabase setup and company provisioning

## Apply database migrations

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

For projects that previously deployed the removed admin function, delete it once:

```sh
supabase functions delete system-admin-companies --project-ref YOUR_PROJECT_REF
```

## Configure application access

Add these Vercel environment variables:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_ANON_KEY
```

Never place the Supabase service-role key in Vercel or any variable prefixed with `VITE_`.

In Supabase Authentication URL Configuration, set Site URL to:

```text
https://YOUR_APP.vercel.app/accept-invite
```

Add these Redirect URLs:

```text
https://YOUR_APP.vercel.app/accept-invite
http://localhost:5173/accept-invite
```

Configure SMTP before inviting external users. Disable open registration unless the product needs it.

## Create a company

Company provisioning is an operator task in Supabase Dashboard. No FireOps system-admin route or Edge Function is required.

### 1. Create or invite the owner

1. Open Authentication > Users in Supabase Dashboard.
2. Choose Add user, then Send invitation.
3. Use the owner's real email address.
4. Confirm URL Configuration points invitations to `https://YOUR_APP.vercel.app/accept-invite`.
5. Copy the new user's UUID. Owner enters full name during account setup.

The `auth_user_profile_created` trigger creates the matching row in `public.profiles`. Confirm it exists before creating the company:

```sql
select user_id, email, full_name
from public.profiles
where user_id = 'OWNER_AUTH_USER_UUID';
```

### 2. Create company and owner membership

Open SQL Editor and run this as one transaction. Replace every uppercase placeholder.

```sql
begin;

with new_company as (
  insert into public.companies (
    name,
    company_code,
    industry,
    owner_user_id
  )
  values (
    'COMPANY NAME',
    'COMPANY-CODE',
    'INDUSTRY',
    'OWNER_AUTH_USER_UUID'
  )
  returning id
)
insert into public.company_members (
  company_id,
  user_id,
  role
)
select
  id,
  'OWNER_AUTH_USER_UUID',
  'owner'
from new_company;

commit;
```

Company code must be unique and contain 3 to 32 uppercase letters, numbers, or hyphens. Owner UUID must exist in `public.profiles`.

### 3. Verify access

```sql
select
  c.id,
  c.name,
  c.company_code,
  p.email as owner_email,
  cm.role
from public.companies c
join public.profiles p on p.user_id = c.owner_user_id
join public.company_members cm
  on cm.company_id = c.id
 and cm.user_id = c.owner_user_id
where c.company_code = 'COMPANY-CODE';
```

Ask owner to complete invitation, set password, and sign in at application root. First fleet change creates the company's `fleet_state` row.

## Enable administrator troubleshooting

Apply latest migrations first. Keep administrator as normal Supabase Auth user, then grant system access in SQL Editor:

```sql
insert into public.system_admins (user_id)
select user_id
from public.profiles
where lower(email) = lower('ADMIN_EMAIL')
on conflict (user_id) do nothing;
```

Administrator signs in through normal application login, chooses company, then enters workspace with owner permissions. Company access is recorded in `public.system_admin_audit_log`.

Review access history:

```sql
select a.created_at, p.email as admin_email, c.name as company
from public.system_admin_audit_log a
join public.profiles p on p.user_id = a.actor_user_id
left join public.companies c on c.id = a.company_id
order by a.created_at desc;
```

Revoke access immediately when no longer needed:

```sql
delete from public.system_admins
where user_id = (select user_id from public.profiles where lower(email) = lower('ADMIN_EMAIL'));
```

## Add a member manually

Create Auth user first, copy UUID, then run:

```sql
insert into public.company_members (company_id, user_id, role)
values ('COMPANY_UUID', 'MEMBER_AUTH_USER_UUID', 'member')
on conflict (company_id, user_id) do update set role = 'member';
```

In-app crew invitations remain operational records only. They do not provision Auth users or memberships.
