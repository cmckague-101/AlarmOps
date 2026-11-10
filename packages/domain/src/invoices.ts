export type InvoiceStatus = 'draft' | 'submitted' | 'paid';

export type InvoiceCustomer = {
  id: string;
  companyId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceAttachment = {
  name: string;
  mimeType: string;
  byteSize: number;
  storagePath: string;
};

export type InvoiceForm = {
  id: string;
  companyId: string;
  createdBy: string;
  createdByName: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceAmount: number;
  customerId: string;
  attachment: InvoiceAttachment | null;
  status: InvoiceStatus;
  submittedAt: string | null;
  /** YYYY-MM-DD; when missing, 30 days after the invoice date is assumed. */
  dueDate?: string;
  paidAt?: string | null;
  paidByName?: string | null;
  /** QuickBooks Online sync (paid add-on); written only by the QuickBooks edge functions. */
  qboInvoiceId?: string | null;
  qboSyncStatus?: 'not_synced' | 'synced' | 'out_of_sync' | 'needs_attention';
  qboSyncedAt?: string | null;
  qboLastError?: string | null;
  qboPaymentPending?: boolean;
  createdAt: string;
  updatedAt: string;
};

export const DEFAULT_INVOICE_TERM_DAYS = 30;
export type InvoicePaymentState = 'draft' | 'unpaid' | 'overdue' | 'paid';

function localIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Due date as YYYY-MM-DD: the saved one, else invoice date + 30 days, else ''. */
export function invoiceDueDate(form: Pick<InvoiceForm, 'dueDate' | 'invoiceDate'>): string {
  if (form.dueDate) return form.dueDate;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(form.invoiceDate);
  if (!match) return '';
  return localIsoDate(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + DEFAULT_INVOICE_TERM_DAYS));
}

export function invoicePaymentState(form: Pick<InvoiceForm, 'status' | 'dueDate' | 'invoiceDate'>, today = new Date()): InvoicePaymentState {
  if (form.status === 'draft') return 'draft';
  if (form.status === 'paid') return 'paid';
  const due = invoiceDueDate(form);
  return due && due < localIsoDate(today) ? 'overdue' : 'unpaid';
}
