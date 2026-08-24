-- Company provisioning now happens manually through Supabase Dashboard and SQL Editor.
drop function if exists public.admin_upsert_company(uuid, uuid, text, text, text, uuid);
drop table if exists public.system_admin_audit_log;
drop table if exists public.system_admins;
