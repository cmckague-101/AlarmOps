-- Keep this security-definer RPC available only to signed-in users.
revoke execute on function public.unregister_push_token(text) from anon;
