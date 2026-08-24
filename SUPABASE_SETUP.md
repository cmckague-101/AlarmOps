# Supabase system administration setup

1. Link Supabase CLI project and apply migration:

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

2. Create first administrator in Supabase Dashboard under Authentication > Users. Copy user UUID, then run in SQL editor:

```sql
insert into public.system_admins (user_id)
values ('AUTH-USER-UUID');
```

3. Configure and deploy Edge Function:

```sh
supabase secrets set SITE_URL=https://your-app.vercel.app
supabase secrets set ADMIN_ALLOWED_ORIGINS=https://your-app.vercel.app
supabase functions deploy system-admin-companies
```

Use comma-separated origins when Vercel preview deployment also needs access. Keep production list narrow.

4. Add Vercel environment variables:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_ANON_KEY
```

5. Deploy, open `https://your-app.vercel.app/system-admin`, and sign in with administrator account.

Never place Supabase service-role key in Vercel environment variables prefixed with `VITE_`. Supabase injects it into Edge Function runtime. Browser never receives it.

For production, disable open user registration unless product needs it. Require strong administrator passwords and email confirmation.
