import { authedAdmin, isUuid, json } from '../_shared/fireops-edge.ts';
import { companyContext, memberAccess, publicInvoiceColumns, qboConfig, serviceClient, syncInvoice, type SyncMode } from '../_shared/quickbooks.ts';

// Send one FireOps invoice to QuickBooks Online (paid add-on: companies.quickbooks_enabled).
// POST {companyId, invoiceId, action}:
//   sync       owners and accounting: create the QuickBooks invoice (any submitted unpaid invoice)
//   push       owners and accounting: sparse update after edits (SyncToken), retry attachment/payment
//   payment    owners and accounting: record the FireOps "paid" as a QuickBooks payment
//   submitted  the creator or finance, right after submitting, when the company syncs on submit
// Returns the invoice's QuickBooks status. Repeated calls never create duplicates.

const ACTIONS = ['sync', 'push', 'payment', 'submitted'];

Deno.serve(async request => {
  const auth = await authedAdmin(request);
  if (!auth.ok) return auth.response;
  const { actor, body } = auth;
  const config = qboConfig();
  const admin = serviceClient(actor.id);
  if (!config || !admin) return json(500, { error: 'QuickBooks integration is not configured.' });

  const companyId = String(body.companyId ?? '');
  const invoiceId = String(body.invoiceId ?? '');
  const action = String(body.action ?? '');
  if (!isUuid(companyId) || !isUuid(invoiceId)) return json(400, { error: 'Invoice is invalid.' });
  if (!ACTIONS.includes(action)) return json(400, { error: 'Action is invalid.' });

  const [access, { data: invoice }] = await Promise.all([
    memberAccess(admin, companyId, actor.id),
    admin.from('invoice_forms').select('id,created_by,status,qbo_invoice_id,qbo_sync_requested_at').eq('id', invoiceId).eq('company_id', companyId).maybeSingle(),
  ]);
  if (!access.member) return json(403, { error: 'Company membership required.' });
  if (!invoice) return json(404, { error: 'Invoice not found.' });
  if (action === 'submitted') {
    if (!access.finance && invoice.created_by !== actor.id) return json(403, { error: 'Owner or accounting access required.' });
  } else if (!access.finance) {
    return json(403, { error: 'Only owners and accounting can sync invoices to QuickBooks.' });
  }

  const context = await companyContext(admin, config, companyId);
  if (!context.enabled) return json(403, { error: 'QuickBooks sync is not included in this company’s plan.' });
  if (!context.qbo || !context.settings) return json(409, { error: 'QuickBooks is not connected. The owner can connect it in Settings.' });

  let mode: SyncMode;
  if (action === 'submitted') {
    // Only the automatic sync the submit queued; nothing for manual companies or already-synced invoices.
    if (context.settings.sync_mode !== 'on_submit' || !invoice.qbo_sync_requested_at || invoice.qbo_invoice_id) {
      const { data } = await admin.from('invoice_forms').select(publicInvoiceColumns).eq('id', invoiceId).single();
      return json(200, { invoice: data, skipped: true });
    }
    mode = 'auto';
  } else if (action === 'sync') {
    if (invoice.status !== 'submitted' && !invoice.qbo_invoice_id) return json(400, { error: 'Only submitted, unpaid invoices can be synced to QuickBooks.' });
    mode = 'sync';
  } else if (action === 'push') {
    if (!invoice.qbo_invoice_id) return json(400, { error: 'Sync this invoice to QuickBooks first.' });
    mode = 'push';
  } else {
    mode = 'payment';
  }

  try {
    const outcome = await syncInvoice(admin, context.qbo, context.settings, invoiceId, mode);
    const { data } = await admin.from('invoice_forms').select(publicInvoiceColumns).eq('id', invoiceId).single();
    if (outcome.busy) return json(409, { error: outcome.error, invoice: data });
    return json(200, { invoice: data, ...(outcome.error ? { error: outcome.error } : {}) });
  } catch (failure) {
    console.error('QuickBooks invoice sync failed:', failure);
    return json(502, { error: 'QuickBooks sync failed. Try again.' });
  }
});
