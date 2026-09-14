-- Supabase grants function execution to API roles through default privileges.
-- Keep this security-definer RPC available only to signed-in users.
revoke execute on function public.register_push_token(text, text, text, text) from anon;
