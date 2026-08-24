# System admin company function

## Deploy

```sh
supabase db push
supabase secrets set SITE_URL=https://your-app.vercel.app
supabase secrets set ADMIN_ALLOWED_ORIGINS=https://your-app.vercel.app
supabase functions deploy system-admin-companies
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are supplied by Supabase. Never add service-role key to Vercel or any `VITE_` variable.

Set these Vercel environment variables:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_ANON_KEY
```

## Bootstrap first administrator

Create administrator in Supabase Auth, then run this once in SQL editor with that user's UUID:

```sql
insert into public.system_admins (user_id)
values ('AUTH-USER-UUID');
```

Only SQL editor or another trusted service-role process can add system administrators. Client users cannot read or edit `system_admins`.

Open `/system-admin`, sign in, then create or edit companies. Saving owner email assigns existing account. Unknown email receives Supabase invitation.

## Security controls

- Edge Function validates JWT through Supabase Auth.
- Function checks `system_admins` server-side.
- Service-role key exists only inside Supabase Edge Function.
- Database RPC repeats administrator check and writes audit record.
- RLS blocks browser writes to companies, memberships, admin records, and audit records.
- Allowed browser origins come from `ADMIN_ALLOWED_ORIGINS`. Use comma-separated values for preview and production domains.
