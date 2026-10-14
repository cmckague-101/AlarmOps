-- Trigger functions run through their owning triggers and must not be callable as RPCs.
revoke all on function public.protect_payroll_form() from public, anon, authenticated;
revoke all on function public.notify_pending_payroll() from public, anon, authenticated;

-- Company profile updates are an intentional authenticated RPC. Remove PostgreSQL's
-- default PUBLIC execute privilege so anonymous callers cannot invoke it.
revoke all on function public.update_company_profile(uuid, text, text, text, text)
  from public, anon;
grant execute on function public.update_company_profile(uuid, text, text, text, text)
  to authenticated;
