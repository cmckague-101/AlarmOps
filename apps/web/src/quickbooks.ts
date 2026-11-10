import type { QboSyncMode } from '@fireops/domain';
import { supabase } from './supabase';

/** QuickBooks Online (paid add-on) calls for web: the connection lives in Settings, sync on Invoices. */

export type QboRef = { id: string; name: string };
export type QboSettings = {
  syncMode: QboSyncMode; qboCompanyName: string | null; item: QboRef | null; taxCode: QboRef | null; terms: QboRef | null;
  class: QboRef | null; department: QboRef | null; depositAccount: QboRef | null; paymentMethod: QboRef | null;
};
export type QboStatus = { enabled: boolean; connected: boolean; environment?: 'sandbox' | 'production'; connectedAt?: string | null; settings: QboSettings | null; canManage: boolean };
export type QboOptions = { items: QboRef[]; taxCodes: QboRef[]; terms: QboRef[]; classes: QboRef[]; departments: QboRef[]; depositAccounts: QboRef[]; paymentMethods: QboRef[] };
export type QboCustomer = { id: string; name: string; companyName: string | null; email: string | null };
export type QboInvoiceResult = { id: string; status: 'draft' | 'submitted' | 'paid'; paid_at: string | null; paid_by_name: string | null; qbo_invoice_id: string | null; qbo_sync_status: string; qbo_synced_at: string | null; qbo_last_error: string | null; qbo_payment_pending: boolean };

/** Whether this company's plan includes QuickBooks sync. False when unknown. */
export async function loadQuickbooksEnabled(companyId: string) {
  if (!supabase) return false;
  try {
    const { data, error } = await supabase.from('companies').select('quickbooks_enabled').eq('id', companyId).maybeSingle<{ quickbooks_enabled?: boolean }>();
    return !error && data?.quickbooks_enabled === true;
  } catch {
    return false;
  }
}

/** Whether QuickBooks is connected (owners and accounting can read the settings row). */
export async function loadQuickbooksConnected(companyId: string) {
  if (!supabase) return false;
  const { data } = await supabase.from('company_qbo_settings').select('connected').eq('company_id', companyId).maybeSingle<{ connected: boolean }>();
  return data?.connected === true;
}

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('QuickBooks is unavailable.');
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    const detail = context instanceof Response ? await context.clone().json().catch(() => null) as { error?: string } | null : null;
    throw new Error(detail?.error ?? 'QuickBooks request failed. Check your connection and try again.');
  }
  if (!data) throw new Error('QuickBooks returned an invalid response.');
  return data;
}

export const quickbooks = {
  status: (companyId: string) => invoke<QboStatus>('quickbooks-integration', { companyId, action: 'status' }),
  connect: (companyId: string, returnTo: string) => invoke<{ authorizationUrl: string }>('quickbooks-integration', { companyId, action: 'connect', returnTo }),
  disconnect: (companyId: string) => invoke<{ connected: false }>('quickbooks-integration', { companyId, action: 'disconnect' }),
  options: (companyId: string) => invoke<QboOptions>('quickbooks-integration', { companyId, action: 'options' }),
  saveSettings: (companyId: string, settings: Omit<QboSettings, 'qboCompanyName'>) => invoke<{ settings: QboSettings }>('quickbooks-integration', { companyId, action: 'save-settings', ...settings }),
  searchCustomers: (companyId: string, query: string) => invoke<{ customers: QboCustomer[] }>('quickbooks-integration', { companyId, action: 'search-customers', query }),
  mapCustomer: (companyId: string, customerId: string, qboCustomerId: string) => invoke<{ mapping: { customerId: string; qboCustomerId: string; qboCustomerName: string } }>('quickbooks-integration', { companyId, action: 'map-customer', customerId, qboCustomerId }),
  unmapCustomer: (companyId: string, customerId: string) => invoke<{ mapping: null }>('quickbooks-integration', { companyId, action: 'unmap-customer', customerId }),
  /** sync / push / payment, or 'submitted' right after submitting (the server checks the company syncs on submit). */
  syncInvoice: (companyId: string, invoiceId: string, action: 'sync' | 'push' | 'payment' | 'submitted') =>
    invoke<{ invoice: QboInvoiceResult; error?: string; skipped?: boolean }>('quickbooks-sync-invoice', { companyId, invoiceId, action }),
};

export type QboMapping = { customer_id: string; qbo_customer_id: string; qbo_customer_name: string };
export async function loadQuickbooksMappings(companyId: string) {
  if (!supabase) return [];
  const { data, error } = await supabase.from('company_qbo_customer_mappings').select('customer_id,qbo_customer_id,qbo_customer_name').eq('company_id', companyId);
  if (error) throw new Error(`QuickBooks customer matches could not load. ${error.message}`);
  return (data ?? []) as QboMapping[];
}
