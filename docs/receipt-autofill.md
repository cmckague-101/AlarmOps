# Receipt auto-fill

Multi-receipt upload (web and mobile) stages up to 25 receipts per batch as
cards. For companies with auto-fill turned on, each JPG/PNG photo is read by
xAI Grok through the `receipt-autofill` edge function, which fills merchant,
purchase date and amount. The submitter must tick "I checked these details"
on every auto-filled card before the batch submits. Everyone else (and PDFs,
HEIC outside Safari, offline mobile) enters the details by hand.

## Deploy

1. Apply migration `20270112000100_receipt_projects_autofill.sql` before
   shipping the apps (adds `company_receipts.project`, the per-company flag,
   usage log and daily limits).
2. Set the shared key and deploy the function:

   ```sh
   npx supabase secrets set XAI_API_KEY="xai-..."
   # optional, defaults to grok-4.7; must be a Grok model that accepts images
   npx supabase secrets set XAI_RECEIPT_MODEL="grok-4.7"
   npx supabase functions deploy receipt-autofill
   ```

## Turn auto-fill on for a company

There is no in-app switch; set it for companies whose subscription includes it:

```sql
update public.companies set receipt_autofill_enabled = true where company_code = 'ABC-123';
```

## Limits and usage

`claim_receipt_autofill` allows 200 auto-fills per person and 2,000 per company
in any rolling 24 hours, and logs each one in `receipt_autofill_usage`:

```sql
select c.name, count(*) as autofills
from public.receipt_autofill_usage u join public.companies c on c.id = u.company_id
where u.created_at >= date_trunc('month', now())
group by c.name order by autofills desc;
```

Photos are sent to xAI only for reading and are not stored by the function; the
app uploads the original file to `receipt-files` when the batch is submitted.
