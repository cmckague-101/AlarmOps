// Pure helpers for invoice-autofill: the Grok schema and the clean-up of its
// answer. No Deno APIs here so the parsing can be unit tested.

export type FieldConfidence = 'high' | 'medium' | 'low';
export type InvoiceAutofillFields = 'invoiceNumber' | 'invoiceDate' | 'dueDate' | 'invoiceAmount' | 'customerName';
export type InvoiceAutofillResponse = {
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  invoiceAmount: number | null;
  customerName: string | null;
  confidence: Record<InvoiceAutofillFields, FieldConfidence>;
  notInvoice?: true;
};

const levels = ['high', 'medium', 'low'] as const;
const field = (description: string, type: string) => ({
  type: 'object',
  additionalProperties: false,
  required: ['value', 'confidence'],
  properties: { value: { type: [type, 'null'], description }, confidence: { type: 'string', enum: levels } },
});

export const invoiceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['is_invoice', 'invoice_number', 'invoice_date', 'due_date', 'total', 'customer'],
  properties: {
    is_invoice: { type: 'boolean', description: 'False when the image is not a sales invoice or bill.' },
    invoice_number: field('Invoice number exactly as printed, without a leading "Invoice #" label.', 'string'),
    invoice_date: field('Invoice (issue) date as YYYY-MM-DD.', 'string'),
    due_date: field('Payment due date as YYYY-MM-DD. Null when only terms such as "Net 30" are printed.', 'string'),
    total: field('Invoice total due in US dollars.', 'number'),
    customer: field('Name of the customer being billed (the "Bill to" party), not the company that issued the invoice.', 'string'),
  },
} as const;

export function systemPrompt(today: string) {
  return `You read sales invoices issued by a wildland fire company to its customers. Today is ${today}. Return the invoice number, invoice date, due date, invoice total and the billed customer's name. Use null for anything you cannot read clearly; never guess. For each field give confidence high only when it is printed clearly and unambiguously; use medium or low when the photo is blurry, cropped, handwritten or there is more than one candidate.`;
}

const text = (value: unknown, max: number) => {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return cleaned || null;
};

export function cleanInvoiceNumber(value: unknown) {
  const cleaned = text(value, 160)?.replace(/^(?:invoice|inv)\.?(?:\s*(?:no\.?|number))?\s*[:#]\s*|^(?:invoice|inv)\.?(?:\s+(?:no\.?|number))?\s+/i, '').trim();
  return cleaned || null;
}

export function cleanCustomerName(value: unknown) {
  return text(value, 160);
}

function validIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Invoice date: 2000-01-01 up to one day ahead (time zones), clamped to today. */
export function cleanInvoiceDate(value: unknown, today: string) {
  if (!validIsoDate(value) || value < '2000-01-01') return null;
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  if (value > tomorrow) return null;
  return value > today ? today : value;
}

/** Due date: a real date on or after the invoice date and within two years of it. */
export function cleanDueDate(value: unknown, invoiceDate: string | null) {
  if (!validIsoDate(value) || value < '2000-01-01') return null;
  if (invoiceDate && value < invoiceDate) return null;
  const base = invoiceDate ?? value;
  const limit = new Date(Date.parse(`${base}T00:00:00Z`) + 2 * 366 * 86_400_000).toISOString().slice(0, 10);
  return value <= limit ? value : null;
}

/** Dollars rounded to cents; invoice_forms.invoice_amount is numeric(12,2). */
export function cleanAmount(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const cents = Math.round(value * 100);
  return cents >= 1 && cents < 1_000_000_000_00 ? cents / 100 : null;
}

const level = (value: unknown): FieldConfidence => (levels as readonly string[]).includes(String(value)) ? value as FieldConfidence : 'low';
const part = (parsed: Record<string, unknown>, key: string) => {
  const entry = parsed[key];
  return entry && typeof entry === 'object' ? entry as { value?: unknown; confidence?: unknown } : {};
};

const empty: InvoiceAutofillResponse = {
  invoiceNumber: null, invoiceDate: null, dueDate: null, invoiceAmount: null, customerName: null,
  confidence: { invoiceNumber: 'low', invoiceDate: 'low', dueDate: 'low', invoiceAmount: 'low', customerName: 'low' },
};

/** Turn Grok's JSON into the response the apps read. A field that does not survive clean-up is null with low confidence. */
export function parseInvoiceExtraction(parsed: Record<string, unknown>, today: string): InvoiceAutofillResponse {
  if (parsed.is_invoice === false) return { ...empty, confidence: { ...empty.confidence }, notInvoice: true };
  const number = part(parsed, 'invoice_number'), date = part(parsed, 'invoice_date'), due = part(parsed, 'due_date');
  const total = part(parsed, 'total'), customer = part(parsed, 'customer');
  const invoiceNumber = cleanInvoiceNumber(number.value);
  const invoiceDate = cleanInvoiceDate(date.value, today);
  const dueDate = cleanDueDate(due.value, invoiceDate);
  const invoiceAmount = cleanAmount(total.value);
  const customerName = cleanCustomerName(customer.value);
  // A date that had to be clamped to today was not read as printed.
  const dateLevel = invoiceDate && invoiceDate === date.value ? level(date.confidence) : 'low';
  return {
    invoiceNumber, invoiceDate, dueDate, invoiceAmount, customerName,
    confidence: {
      invoiceNumber: invoiceNumber ? level(number.confidence) : 'low',
      invoiceDate: invoiceDate ? dateLevel : 'low',
      dueDate: dueDate ? level(due.confidence) : 'low',
      invoiceAmount: invoiceAmount ? level(total.confidence) : 'low',
      customerName: customerName ? level(customer.confidence) : 'low',
    },
  };
}
