# Company audit log

Apply `supabase/migrations/20261106000100_company_audit_log.sql` and redeploy the `invite-company-member` and `remove-company-member` Edge Functions.

Owners and company admins can open **Audit log** above Settings on web or under More on mobile. Entries are plain text, newest first, with local date/time, the actor's name at the time of the change, and a description. Both clients paginate in batches of 100. Refresh loads new activity.

Database triggers record new activity from either client: company profiles/memberships, fleet/crew changes (including inspections and qualifications saved in fleet records), communications, documents, training/signups, inventory/checkouts, receipts, invoices, payroll, availability, qualification card requests, and vehicle notes. No historical activity is backfilled. Derived feeds, read receipts, and notification delivery are excluded; timestamp/version-only writes are ignored.

RLS limits reads to the current company's owners/admins (including system administrators with active company access) and the last 30 days. Older entries are inaccessible to app clients; this is a visibility window, not a scheduled physical deletion policy. Clients cannot insert, edit, or delete entries. Database-trigger writes are transactional with the underlying change. Company deletion cascades its log.

Names and descriptions are snapshots, so deleting a user or a source record does not delete its history. Descriptions contain record labels, changed field names, and role/status transitions, not complete row snapshots, message bodies, signatures, payroll values, file URLs, or integration secrets. Automated writes without a verified actor are attributed to System. Service-role Edge Function requests can forward a verified actor header; ordinary clients cannot override attribution this way.

Targeted checks:

- `npm run test:db-audit` (static security/coverage checks, not a live PostgreSQL integration test)
- `npm run test:db-grants`
- `npm exec --workspace=fireops-web -- vitest run src/FleetApp.test.ts`
- Type checks for the web and mobile workspaces
