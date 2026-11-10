# QuickBooks Online sync for invoices

Paid add-on. FireOps sends submitted invoices to QuickBooks Online and keeps paid status the same in both apps.

## What it does

- **Turning it on:** FireOps staff set `companies.quickbooks_enabled = true` with SQL. When it is off, the apps hide QuickBooks and every QuickBooks edge function refuses requests.
- **Connecting (web Settings, owner only):** the owner clicks Connect QuickBooks Online, signs in at Intuit, and picks a company. Tokens are AES-GCM encrypted with `QBO_ENCRYPTION_KEY` and stored in `company_qbo_connections`, which only the server can read. The realm id is saved per company. If the owner later connects a different QuickBooks company, FireOps clears the old company's links (customer matches, settings references and invoice links).
- **Settings (web, owner only):**
  - When to sync: Manual (Sync to QuickBooks button, the default) or Automatically on submit.
  - The Product/Service item for the invoice line (required).
  - Optional tax code, terms, class and location.
  - For payments: the deposit account (default Undeposited Funds) and an optional payment method.
- **Customers (web Settings, owners and accounting):** match each FireOps customer to a QuickBooks customer once; FireOps remembers the match per company. FireOps never creates QuickBooks customers. An invoice whose customer has no match is set to **Needs attention**. On web, the invoice's QuickBooks card also has a match picker.
- **Invoice contents:** one line for the invoice total on the chosen item. DocNumber is the FireOps invoice number; QuickBooks allows at most 21 characters. TxnDate is the invoice date. DueDate is the FireOps due date (saved, or 30 days after the invoice date). The attached PDF or photo is uploaded to the QuickBooks invoice as an Attachable. QuickBooks accepts JPG, PNG and PDF; for HEIC or WebP files the invoice syncs without the file and a note is shown. The PrivateNote reads `FireOps invoice <id>`.
- **Statuses** (`invoice_forms.qbo_sync_status`):
  - `not_synced`
  - `synced`
  - `out_of_sync`: a trigger sets this when someone edits the number, date, amount, customer, due date or attachment of a synced invoice.
  - `needs_attention`: shown with `qbo_last_error`.
- **Buttons (owners and accounting, web and mobile):**
  - **Sync to QuickBooks** appears on any submitted, unpaid invoice that is not in QuickBooks yet, including older invoices.
  - **Push update to QuickBooks** sends a sparse update using the latest SyncToken. It also retries a failed attachment or payment.
- **Paid, QuickBooks → FireOps:** when the QuickBooks invoice balance reaches $0, the FireOps invoice is marked paid (`paid_by` null, `paid_by_name` 'QuickBooks'). A partial payment does not mark it paid. If a payment is deleted after FireOps shows the invoice paid, the invoice is set to Needs attention; FireOps never un-pays an invoice. A voided or deleted QuickBooks invoice is also set to Needs attention, and a deleted one is unlinked so it can be synced again.
- **Paid, FireOps → QuickBooks:** marking a synced invoice paid in FireOps queues a QuickBooks Payment for the open balance, linked to the invoice. It uses the deposit account and payment method from Settings. The payment waits while the invoice is Out of sync. It is refused when the QuickBooks total differs from FireOps. If QuickBooks already shows the invoice paid, FireOps links that payment instead of adding another.
- **No duplicates:**
  - A per-invoice lock (`claim_qbo_invoice_sync`) stops two syncs from running at once.
  - The QuickBooks id is saved right after the create.
  - A retried create first looks for its own invoice by DocNumber and the PrivateNote marker.
  - Creates and payments carry a content-based `requestid`, so QuickBooks replays an identical retry instead of creating a second record.
- **Mobile:** shows the sync status on the invoice list and form, plus the Sync and Push update buttons. Connecting, settings and customer matching are web only.

## Pieces

| Piece | What it is |
| --- | --- |
| `supabase/migrations/20270117000100_quickbooks_sync.sql` | add-on switch, connection/settings/mapping tables, `invoice_forms.qbo_*`, triggers, lock, reset |
| `supabase/functions/quickbooks-integration` | OAuth connect/callback/disconnect, settings lists and save, customer search/match |
| `supabase/functions/quickbooks-sync-invoice` | `sync`, `push`, `payment`, `submitted` for one invoice |
| `supabase/functions/quickbooks-webhook` | Intuit webhooks (signature checked) and the scheduled CDC poll |
| `supabase/functions/_shared/quickbooks*.ts` | client, tokens, payloads; `quickbooks-status.ts` is a copy of `packages/domain/src/quickbooks.ts` |

## Intuit app setup

1. At https://developer.intuit.com, create an app on the QuickBooks Online and Payments platform.
2. Scope: `com.intuit.quickbooks.accounting` (no other scopes).
3. Redirect URI, for both Development and Production keys:
   `https://pkfwlhtihudagxxyqyyg.supabase.co/functions/v1/quickbooks-integration`
4. Webhooks: endpoint `https://pkfwlhtihudagxxyqyyg.supabase.co/functions/v1/quickbooks-webhook`, with events for **Invoice** (Create, Update, Delete, Void) and **Payment** (Create, Update, Delete, Void). Copy the Verifier Token.
5. Production keys need Intuit's app assessment (privacy policy, EULA, host domain, and so on).

## Secrets

```bash
npx supabase secrets set \
  QBO_CLIENT_ID=... \
  QBO_CLIENT_SECRET=... \
  QBO_REDIRECT_URI=https://pkfwlhtihudagxxyqyyg.supabase.co/functions/v1/quickbooks-integration \
  QBO_ENVIRONMENT=sandbox \
  QBO_WEBHOOK_VERIFIER_TOKEN=... \
  QBO_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  QBO_CRON_SECRET="$(openssl rand -hex 32)"
# Optional: other web origins allowed as the OAuth return page (the calling page's own origin is always allowed)
# npx supabase secrets set QBO_ALLOWED_RETURN_URLS=https://app.example.com/
```

Set `QBO_ENVIRONMENT=production` and the production client id and secret once Intuit approves the app. Keep `QBO_ENCRYPTION_KEY` fixed: changing it makes stored tokens unreadable, and owners would have to reconnect.

## Deploy

```bash
npx supabase db push        # applies 20270117000100_quickbooks_sync.sql
npx supabase functions deploy quickbooks-integration --no-verify-jwt
npx supabase functions deploy quickbooks-sync-invoice
npx supabase functions deploy quickbooks-webhook --no-verify-jwt
```

Schedule the backup poll every 5 minutes with Supabase Cron (pg_cron + pg_net), as with `dispatch-push-notifications`. Store the cron secret in Vault first:

```sql
select vault.create_secret('<QBO_CRON_SECRET>', 'qbo_cron_secret');
select cron.schedule('quickbooks-poll', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://pkfwlhtihudagxxyqyyg.supabase.co/functions/v1/quickbooks-webhook',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-qbo-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'qbo_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$$);
```

Each poll runs CDC for Invoices and Payments changed since the last poll (at most 30 days back) for every connected company. It then sends automatic syncs queued at submit (for up to 7 days) and pending FireOps payments, up to 25 of each per company per run.

Turn the add-on on for a company:

```sql
update public.companies set quickbooks_enabled = true where id = '<company id>';
```

## Testing against an Intuit sandbox company

1. In the Intuit developer portal, open **Sandbox** and create a QuickBooks Online sandbox company (US). It comes with sample customers and items.
2. Use the app's Development keys with `QBO_ENVIRONMENT=sandbox`. Deploy, and turn on `quickbooks_enabled` for a test company.
3. As the owner, open web Settings → QuickBooks Online → Connect, sign in, and pick the sandbox company. Choose a Product/Service (for example "Services") and save.
4. In Settings → Customers, match a FireOps customer to a sandbox customer (for example "Amy's Bird Sanctuary").
5. Submit an invoice for that customer with a PDF attached. Open it as owner or accounting and press **Sync to QuickBooks**. In the sandbox, check that the invoice has the same number, total and due date, one line, and the attachment.
6. Edit the amount in FireOps. The invoice shows Out of sync. Press **Push update to QuickBooks** and check that the sandbox invoice changes.
7. In the sandbox, use Receive payment for part of the balance. FireOps stays unpaid. Pay the rest, and within a few seconds (webhook) or 5 minutes (poll) FireOps shows Paid, marked by QuickBooks.
8. On another synced invoice, press **Mark as paid** in FireOps. A Payment linked to the invoice appears in the sandbox, in Undeposited Funds unless a deposit account is set.
9. Delete that payment in the sandbox. The FireOps invoice stays paid and shows Needs attention.
10. Set an invoice's customer to an unmatched one and sync it. The invoice shows Needs attention with a match prompt.
11. Set Settings → When to send invoices to Automatically on submit, then submit a new invoice (as crew, too). It syncs right away, or on the next poll if it was submitted offline.

Webhooks need a public URL; the deployed function works. To exercise the poll without waiting, call it by hand:

```bash
curl -X POST https://pkfwlhtihudagxxyqyyg.supabase.co/functions/v1/quickbooks-webhook \
  -H "x-qbo-cron-secret: $QBO_CRON_SECRET" -H 'Content-Type: application/json' -d '{}'
```

## Tests

- `node --test supabase/tests/quickbooks-sync.test.mjs`: grants, RLS, triggers, the paid rules and the lock (PGlite).
- `packages/domain`: `quickbooks.test.ts` covers status rules and checks the edge copy matches; `quickbooks-logic.test.ts` covers payload mapping, the webhook signature, webhook/CDC parsing, error text and the attachment upload.
