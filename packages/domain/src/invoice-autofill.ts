import type { InvoiceCustomer, InvoiceForm } from './invoices';

export type InvoiceAutofillConfidence = 'high' | 'medium' | 'low';
export type InvoiceAutofillReadField = 'invoiceNumber' | 'invoiceDate' | 'dueDate' | 'invoiceAmount' | 'customerName';
/** What the invoice-autofill edge function returns; any field may be missing. */
export type InvoiceAutofillResult = {
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  invoiceAmount?: number | null;
  customerName?: string | null;
  confidence?: Partial<Record<InvoiceAutofillReadField, InvoiceAutofillConfidence | null>> | null;
  notInvoice?: boolean;
};

/** Invoice form fields auto-fill can set; the ones it was unsure of must be checked before submitting. */
export type InvoiceReviewField = 'invoiceNumber' | 'invoiceDate' | 'dueDate' | 'invoiceAmount' | 'customerId';

export type InvoiceAutofillOutcome = {
  form: InvoiceForm;
  /** Filled fields auto-fill was not sure of. */
  review: InvoiceReviewField[];
  /** Customer printed on the photo that is not in the customer list; offer to add it. */
  newCustomerName?: string;
  /** Message to show when nothing usable was read. */
  note?: string;
};

const SUFFIXES = new Set(['inc', 'incorporated', 'llc', 'llp', 'lp', 'pllc', 'ltd', 'limited', 'co', 'corp', 'corporation', 'company', 'pc']);

/** Customer name for matching: case, punctuation, "&"/"and", a leading "The" and company suffixes (Inc, LLC, Co…) are ignored. */
export function normalizeCustomerName(name: string): string {
  const words = name.toLowerCase().replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  if (words[0] === 'the' && words.length > 1) words.shift();
  while (words.length > 1 && SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}

/** The listed customer this printed name refers to, or null when it is not in the list. Never guesses between different names. */
export function matchInvoiceCustomer<Customer extends Pick<InvoiceCustomer, 'id' | 'name'>>(name: string | null | undefined, customers: readonly Customer[]): Customer | null {
  const printed = name?.trim();
  if (!printed) return null;
  const exact = customers.find((customer) => customer.name.trim().toLowerCase() === printed.toLowerCase());
  if (exact) return exact;
  const key = normalizeCustomerName(printed);
  if (!key) return null;
  const matches = customers.filter((customer) => normalizeCustomerName(customer.name) === key);
  return matches.length === 1 ? matches[0] : null;
}

const isoDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * Fill the draft from one photo read. Every field the photo shows replaces what
 * is on the form (the person chose to scan); fields read with less than high
 * confidence are returned in `review` and must be checked before submitting.
 */
export function applyInvoiceAutofill(form: InvoiceForm, result: InvoiceAutofillResult, customers: readonly InvoiceCustomer[]): InvoiceAutofillOutcome {
  if (result.notInvoice) return { form, review: [], note: 'This photo does not look like an invoice. Check it or enter the details.' };
  const sure = (field: InvoiceAutofillReadField) => result.confidence?.[field] === 'high';
  const next: InvoiceForm = { ...form };
  const review: InvoiceReviewField[] = [];
  let filled = false;
  const set = <Key extends InvoiceReviewField>(key: Key, value: InvoiceForm[Key], read: InvoiceAutofillReadField) => {
    next[key] = value;
    filled = true;
    if (!sure(read)) review.push(key);
  };

  const number = result.invoiceNumber?.trim().slice(0, 160);
  if (number) set('invoiceNumber', number, 'invoiceNumber');
  if (isoDate(result.invoiceDate)) set('invoiceDate', result.invoiceDate, 'invoiceDate');
  if (typeof result.invoiceAmount === 'number' && Number.isFinite(result.invoiceAmount) && result.invoiceAmount > 0) {
    set('invoiceAmount', Math.round(result.invoiceAmount * 100) / 100, 'invoiceAmount');
  }
  if (isoDate(result.dueDate) && (!next.invoiceDate || result.dueDate >= next.invoiceDate)) set('dueDate', result.dueDate, 'dueDate');
  else if (next.dueDate && next.invoiceDate && next.dueDate < next.invoiceDate) next.dueDate = undefined;

  let newCustomerName: string | undefined;
  const printedCustomer = result.customerName?.trim().replace(/\s+/g, ' ').slice(0, 160);
  if (printedCustomer) {
    const match = matchInvoiceCustomer(printedCustomer, customers);
    if (match) set('customerId', match.id, 'customerName');
    else {
      newCustomerName = printedCustomer;
      filled = true;
      // The form keeps whatever customer it had; when that was a different one, flag it.
      if (next.customerId) review.push('customerId');
    }
  }

  return {
    form: next,
    review,
    ...(newCustomerName ? { newCustomerName } : {}),
    ...(filled ? {} : { note: 'Auto-fill could not read this invoice. Enter the details.' }),
  };
}

/** The person edited or confirmed this field, so it no longer needs checking. */
export const clearInvoiceReview = (review: readonly InvoiceReviewField[], field: InvoiceReviewField) => review.filter((item) => item !== field);

/** Fields whose value differs between two versions of the form (used to clear review flags the person edited). */
export function changedInvoiceFields(before: InvoiceForm, after: InvoiceForm): InvoiceReviewField[] {
  return (['invoiceNumber', 'invoiceDate', 'dueDate', 'invoiceAmount', 'customerId'] as const).filter((key) => before[key] !== after[key]);
}

export const INVOICE_REVIEW_MESSAGE = 'Check the highlighted fields auto-fill was unsure of, then confirm them.';
