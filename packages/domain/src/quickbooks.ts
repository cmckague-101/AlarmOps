// QuickBooks Online sync status rules shared by web, mobile and the QuickBooks
// edge functions. supabase/functions/_shared/quickbooks-status.ts must be an
// exact copy of this file (quickbooks.test.ts checks); edit both together.
// No imports, so Deno can load the copy as is.

export type QboSyncStatus = 'not_synced' | 'synced' | 'out_of_sync' | 'needs_attention';
export const QBO_SYNC_STATUSES: readonly QboSyncStatus[] = ['not_synced', 'synced', 'out_of_sync', 'needs_attention'];
export type QboSyncMode = 'manual' | 'on_submit';

/**
 * Invoice fields QuickBooks holds. Editing one on a synced invoice marks it out of sync
 * (track_invoice_qbo_changes in 20270117000100_quickbooks_sync.sql uses the same list).
 */
export const QBO_SYNCED_FIELDS = ['invoiceNumber', 'invoiceDate', 'invoiceAmount', 'customerId', 'dueDate', 'attachment'] as const;

/** QuickBooks Online limits DocNumber to 21 characters. */
export const QBO_DOC_NUMBER_MAX = 21;

const STATUS_LABELS: Record<QboSyncStatus, string> = {
  not_synced: 'Not synced',
  synced: 'Synced',
  out_of_sync: 'Out of sync',
  needs_attention: 'Needs attention',
};

export function isQboSyncStatus(value: unknown): value is QboSyncStatus {
  return typeof value === 'string' && (QBO_SYNC_STATUSES as readonly string[]).includes(value);
}

export function qboStatusLabel(status: QboSyncStatus): string {
  return STATUS_LABELS[status] ?? STATUS_LABELS.not_synced;
}

export type QboLocalInvoice = {
  status: 'draft' | 'submitted' | 'paid';
  invoiceAmount: number;
  qboInvoiceId?: string | null;
  qboSyncStatus?: QboSyncStatus;
  qboPaymentPending?: boolean;
};

export type QboInvoiceAction = 'sync' | 'push';

/**
 * The button a finance processor sees for an invoice:
 * - 'sync' (Sync to QuickBooks): a submitted, unpaid invoice that is not in QuickBooks yet,
 *   including older invoices and ones that need attention before their first sync.
 * - 'push' (Push update to QuickBooks): an invoice already in QuickBooks that is out of sync
 *   or needs attention (retries a failed update or payment).
 */
export function qboInvoiceAction(form: QboLocalInvoice): QboInvoiceAction | null {
  if (form.status === 'draft') return null;
  const status = form.qboSyncStatus ?? 'not_synced';
  if (!form.qboInvoiceId) return form.status === 'submitted' ? 'sync' : null;
  if (status === 'out_of_sync' || status === 'needs_attention' || form.qboPaymentPending) return 'push';
  return null;
}

/** Cents-safe money compare: amounts within half a cent are equal. */
export function qboAmountsEqual(a: number, b: number): boolean {
  return Math.abs(Math.round(a * 100) - Math.round(b * 100)) < 1;
}

export type QboRemoteInvoice = {
  totalAmt: number;
  balance: number;
  /** The invoice was deleted in QuickBooks (CDC status 'Deleted' or a Delete webhook). */
  deleted?: boolean;
};

export type QboRemoteDecision =
  | { kind: 'none' }
  | { kind: 'mark_paid' }
  | { kind: 'resolved' }
  | { kind: 'needs_attention'; error: string };

const usd = (value: number) => `$${(Math.round(value * 100) / 100).toFixed(2)}`;

/**
 * What a change seen in QuickBooks means for the FireOps invoice.
 * - Balance $0 on a submitted invoice: mark it paid (by QuickBooks).
 * - Partial payments never mark it paid.
 * - A paid FireOps invoice that shows a balance again (a payment was deleted) needs attention.
 *   FireOps never un-pays an invoice. While FireOps still has its own payment to send, a balance
 *   is expected.
 * - A deleted or voided QuickBooks invoice needs attention.
 * - A paid invoice that needed attention and shows $0 again is resolved.
 */
export function qboRemoteDecision(local: QboLocalInvoice, remote: QboRemoteInvoice): QboRemoteDecision {
  if (local.status === 'draft') return { kind: 'none' };
  if (remote.deleted) return { kind: 'needs_attention', error: 'This invoice was deleted in QuickBooks. Sync it again or check QuickBooks.' };
  if (remote.totalAmt <= 0 && local.invoiceAmount > 0) {
    return { kind: 'needs_attention', error: 'This invoice was voided in QuickBooks (total is $0.00).' };
  }
  const settled = remote.balance <= 0.005;
  if (local.status === 'submitted') return settled ? { kind: 'mark_paid' } : { kind: 'none' };
  if (settled) return local.qboSyncStatus === 'needs_attention' && !local.qboPaymentPending ? { kind: 'resolved' } : { kind: 'none' };
  if (local.qboPaymentPending) return { kind: 'none' };
  return {
    kind: 'needs_attention',
    error: `QuickBooks shows ${usd(remote.balance)} still due, but this invoice is paid in FireOps. A payment may have been deleted in QuickBooks.`,
  };
}

/** A QuickBooks payment FireOps created (or linked) was deleted. */
export function qboPaymentDeletedDecision(local: QboLocalInvoice): QboRemoteDecision {
  if (local.status !== 'paid') return { kind: 'none' };
  return { kind: 'needs_attention', error: 'The QuickBooks payment for this invoice was deleted. FireOps still shows it paid.' };
}

export type QboInvoiceRow = {
  qbo_invoice_id?: string | null;
  qbo_sync_status?: string | null;
  qbo_synced_at?: string | null;
  qbo_last_error?: string | null;
  qbo_payment_pending?: boolean | null;
};

/** QuickBooks fields of an invoice_forms row in app shape. Rows from before the migration read as not synced. */
export function qboFieldsFromRow(row: QboInvoiceRow) {
  return {
    qboInvoiceId: row.qbo_invoice_id ?? null,
    qboSyncStatus: isQboSyncStatus(row.qbo_sync_status) ? row.qbo_sync_status : ('not_synced' as QboSyncStatus),
    qboSyncedAt: row.qbo_synced_at ?? null,
    qboLastError: row.qbo_last_error ?? null,
    qboPaymentPending: row.qbo_payment_pending === true,
  };
}

/** Why an invoice cannot be sent to QuickBooks as it is, or null. */
export function qboInvoiceProblem(form: { invoiceNumber: string; invoiceDate: string; invoiceAmount: number }): string | null {
  const number = form.invoiceNumber.trim();
  if (!number) return 'Add an invoice number before syncing to QuickBooks.';
  if (number.length > QBO_DOC_NUMBER_MAX) return `QuickBooks invoice numbers are limited to ${QBO_DOC_NUMBER_MAX} characters. Shorten the invoice number.`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.invoiceDate)) return 'Add an invoice date before syncing to QuickBooks.';
  if (!(form.invoiceAmount > 0)) return 'Invoice amount must be more than $0.00 to sync to QuickBooks.';
  return null;
}
