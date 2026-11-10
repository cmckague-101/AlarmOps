import { qboFieldsFromRow, type InvoiceForm } from '@fireops/domain';
import { isDemoActive, supabase } from '@/lib/supabase';

/**
 * QuickBooks Online (paid add-on) on mobile: sync status and the Sync / Push update buttons.
 * Connecting, settings and customer matching are web only.
 */
export type QuickbooksAccess = { enabled: boolean; connected: boolean };
export type QuickbooksInvoiceAction = 'sync' | 'push' | 'payment' | 'submitted';
type InvoiceResult = { id: string; status: InvoiceForm['status']; paid_at: string | null; paid_by_name: string | null; qbo_invoice_id: string | null; qbo_sync_status: string; qbo_synced_at: string | null; qbo_last_error: string | null; qbo_payment_pending: boolean };

/** Whether the plan includes QuickBooks and (for owners/accounting, who can read settings) whether it is connected. */
export async function loadQuickbooksAccess(companyId: string, finance: boolean): Promise<QuickbooksAccess> {
  if (!supabase || isDemoActive()) return { enabled: false, connected: false };
  try {
    const { data } = await supabase.from('companies').select('quickbooks_enabled').eq('id', companyId).maybeSingle<{ quickbooks_enabled?: boolean }>();
    const enabled = data?.quickbooks_enabled === true;
    if (!enabled || !finance) return { enabled, connected: false };
    const { data: settings } = await supabase.from('company_qbo_settings').select('connected').eq('company_id', companyId).maybeSingle<{ connected: boolean }>();
    return { enabled, connected: settings?.connected === true };
  } catch {
    return { enabled: false, connected: false };
  }
}

/** Run a QuickBooks sync for one invoice and return the invoice fields that changed. */
export async function syncInvoiceToQuickbooks(companyId: string, invoiceId: string, action: QuickbooksInvoiceAction): Promise<{ changes: Partial<InvoiceForm>; error?: string }> {
  if (!supabase || isDemoActive()) throw new Error('QuickBooks is unavailable here.');
  const { data, error } = await supabase.functions.invoke<{ invoice: InvoiceResult; error?: string }>('quickbooks-sync-invoice', { body: { companyId, invoiceId, action } });
  if (error) {
    let message = '';
    try { message = (await (error as { context?: Response }).context?.json?.())?.error ?? ''; } catch { /* not JSON */ }
    if (!message && /connection/i.test(error.message)) message = 'QuickBooks sync needs a network connection.';
    throw new Error(message || 'QuickBooks sync failed. Try again.');
  }
  if (!data?.invoice) throw new Error('QuickBooks returned an invalid response.');
  const invoice = data.invoice;
  return { changes: { status: invoice.status, paidAt: invoice.paid_at, paidByName: invoice.paid_by_name, ...qboFieldsFromRow(invoice) }, error: data.error };
}
