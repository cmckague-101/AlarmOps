# Invoice auto-fill

"Scan invoice" on the Invoices page (web and mobile) and inside the invoice
form reads one invoice photo with xAI Grok through the `invoice-autofill` edge
function and fills the caller's draft: invoice number, invoice date, due date,
amount and customer. The photo is attached to the draft. Nothing is submitted:
the person reviews the draft and submits it as usual.

- **Who:** everyone who can create invoices (any company member), in companies
  with auto-fill turned on.
- **Review:** each field comes back with its own confidence. High-confidence
  reads are trusted. Less certain fields are highlighted with "Check" and the
  invoice cannot be submitted until each one is edited or confirmed ("They are
  correct").
- **Customer:** the printed customer is matched to the customer list, ignoring
  case, punctuation, a leading "The" and suffixes such as Inc/LLC/Co. If it is
  not on the list, the person filling the invoice is offered "Add “Name”".
  Every member can add customers (also from the customer drop-down); renaming
  and deleting customers stay with owners and accounting.
- **Photos:** JPG and PNG are read (web also converts WebP and, in Safari,
  HEIC). PDFs can still be attached but are not read. Mobile scanning needs a
  connection.

## Deploy

1. Apply migration `20270115000100_invoice_autofill.sql` (adds
   `receipt_autofill_usage.kind`, `claim_invoice_autofill`, and lets every
   member add invoice customers).
2. Deploy the function. It uses the same `XAI_API_KEY` secret as receipts:

   ```sh
   npx supabase functions deploy invoice-autofill
   # optional, falls back to XAI_RECEIPT_MODEL, then grok-4.7; must accept images
   npx supabase secrets set XAI_INVOICE_MODEL="grok-4.7"
   ```

## Turn it on for a company

Invoice auto-fill uses the receipt auto-fill switch, so a company with receipt
auto-fill gets both:

```sql
update public.companies set receipt_autofill_enabled = true where company_code = 'ABC-123';
```

## Limits and usage

Receipts and invoices share one budget: 200 auto-fills per person and 2,000 per
company in any rolling 24 hours. Every read is logged in
`receipt_autofill_usage` with `kind` `receipt` or `invoice`:

```sql
select c.name, u.kind, count(*) as autofills
from public.receipt_autofill_usage u join public.companies c on c.id = u.company_id
where u.created_at >= date_trunc('month', now())
group by c.name, u.kind order by c.name, u.kind;
```

Photos are sent to xAI only for reading and are not stored by the function; the
app uploads the original to `invoice-files` as the draft's attachment.
