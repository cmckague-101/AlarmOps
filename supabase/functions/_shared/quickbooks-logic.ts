// Pure QuickBooks Online helpers for the quickbooks-* edge functions: request
// payloads, the webhook signature check, webhook/CDC parsing and error text.
// No Deno APIs here (Web Crypto only), so it is unit tested from
// packages/domain/src/quickbooks-logic.test.ts.

export const QBO_MINOR_VERSION = '75';
export const QBO_SCOPE = 'com.intuit.quickbooks.accounting';
export const QBO_AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
export const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
export const QBO_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
/** CDC looks back at most 30 days. */
export const QBO_CDC_MAX_DAYS = 30;

export function qboApiBase(environment: string | undefined) {
  return environment === 'production' ? 'https://quickbooks.api.intuit.com' : 'https://sandbox-quickbooks.api.intuit.com';
}

export type QboRef = { value: string; name?: string };

/** company_qbo_settings row (only the fields used for payloads). */
export type QboCompanySettings = {
  item_id: string | null; item_name?: string | null;
  tax_code_id?: string | null; tax_code_name?: string | null;
  terms_id?: string | null; terms_name?: string | null;
  class_id?: string | null; class_name?: string | null;
  department_id?: string | null; department_name?: string | null;
  deposit_account_id?: string | null; deposit_account_name?: string | null;
  payment_method_id?: string | null; payment_method_name?: string | null;
};

export type QboInvoiceSource = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  /** YYYY-MM-DD; FireOps' due date (saved, or 30 days after the invoice date). */
  dueDate: string;
  amount: number;
};

const ref = (value: string | null | undefined, name: string | null | undefined): QboRef | undefined =>
  value ? (name ? { value, name } : { value }) : undefined;
const cents = (value: number) => Math.round(value * 100) / 100;

/** Marker in PrivateNote so a retried create can find the invoice it already made. */
export const fireopsMarker = (invoiceId: string) => `FireOps invoice ${invoiceId}`;

/**
 * One QuickBooks invoice line for the FireOps total, on the company's Product/Service item.
 * Keeps the FireOps invoice number as DocNumber. Tax code, class, terms and location are optional settings.
 */
export function buildInvoicePayload(source: QboInvoiceSource, customer: QboRef, settings: QboCompanySettings) {
  if (!settings.item_id) throw new Error('Choose the QuickBooks Product/Service for invoices in Settings.');
  const amount = cents(source.amount);
  const taxCode = ref(settings.tax_code_id, settings.tax_code_name);
  const classRef = ref(settings.class_id, settings.class_name);
  const terms = ref(settings.terms_id, settings.terms_name);
  const department = ref(settings.department_id, settings.department_name);
  return {
    CustomerRef: customer,
    DocNumber: source.invoiceNumber.trim(),
    TxnDate: source.invoiceDate,
    ...(source.dueDate ? { DueDate: source.dueDate } : {}),
    ...(terms ? { SalesTermRef: terms } : {}),
    ...(department ? { DepartmentRef: department } : {}),
    PrivateNote: fireopsMarker(source.id),
    Line: [{
      DetailType: 'SalesItemLineDetail',
      Amount: amount,
      Description: `FireOps invoice ${source.invoiceNumber.trim()}`,
      SalesItemLineDetail: {
        ItemRef: ref(settings.item_id, settings.item_name)!,
        Qty: 1,
        UnitPrice: amount,
        ...(taxCode ? { TaxCodeRef: taxCode } : {}),
        ...(classRef ? { ClassRef: classRef } : {}),
      },
    }],
  };
}

/** Sparse update of an existing QuickBooks invoice (Line is replaced as a whole). */
export function buildInvoiceUpdate(source: QboInvoiceSource, customer: QboRef, settings: QboCompanySettings, qbo: { id: string; syncToken: string }) {
  return { ...buildInvoicePayload(source, customer, settings), Id: qbo.id, SyncToken: qbo.syncToken, sparse: true };
}

/** A QuickBooks payment for the invoice balance, linked to the invoice. No deposit account = Undeposited Funds. */
export function buildPaymentPayload(input: { fireopsInvoiceId: string; qboInvoiceId: string; customer: QboRef; amount: number; txnDate: string; settings: QboCompanySettings }) {
  const amount = cents(input.amount);
  const deposit = ref(input.settings.deposit_account_id, input.settings.deposit_account_name);
  const method = ref(input.settings.payment_method_id, input.settings.payment_method_name);
  return {
    CustomerRef: input.customer,
    TotalAmt: amount,
    TxnDate: input.txnDate,
    ...(deposit ? { DepositToAccountRef: deposit } : {}),
    ...(method ? { PaymentMethodRef: method } : {}),
    PrivateNote: `Marked paid in FireOps (${fireopsMarker(input.fireopsInvoiceId)})`,
    Line: [{ Amount: amount, LinkedTxn: [{ TxnId: input.qboInvoiceId, TxnType: 'Invoice' }] }],
  };
}

/** Quote a value for a QuickBooks query string. */
export function qboQueryValue(value: string) {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** intuit-signature is base64(HMAC-SHA256(verifier token, raw body)). Constant-time compare. */
export async function verifyIntuitSignature(rawBody: string, signature: string | null, verifierToken: string) {
  if (!signature || !verifierToken) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(verifierToken), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = bytesToBase64(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))));
  const given = signature.trim();
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) diff |= expected.charCodeAt(index) ^ given.charCodeAt(index);
  return diff === 0;
}

export type QboEntityName = 'Invoice' | 'Payment';
export type QboWebhookChange = { realmId: string; entity: QboEntityName; id: string; operation: string };

const entityName = (value: unknown): QboEntityName | null => {
  const text = String(value ?? '').toLowerCase();
  return text === 'invoice' ? 'Invoice' : text === 'payment' ? 'Payment' : null;
};
const capitalized = (value: string) => value ? value[0].toUpperCase() + value.slice(1).toLowerCase() : value;
const numericId = (value: unknown) => {
  const text = String(value ?? '');
  return /^\d{1,32}$/.test(text) ? text : null;
};

/**
 * Invoice and Payment changes from an Intuit webhook. Accepts the classic
 * `eventNotifications` payload and the CloudEvents array (type `qbo.invoice.updated.v1`).
 */
export function parseWebhookChanges(body: unknown): QboWebhookChange[] {
  const changes: QboWebhookChange[] = [];
  const push = (realm: unknown, entity: unknown, id: unknown, operation: string) => {
    const realmId = numericId(realm); const name = entityName(entity); const entityId = numericId(id);
    if (realmId && name && entityId) changes.push({ realmId, entity: name, id: entityId, operation: capitalized(operation) });
  };
  if (Array.isArray(body)) {
    for (const event of body as Record<string, unknown>[]) {
      const match = /^qbo\.([a-z]+)\.([a-z]+)\.v\d+$/i.exec(String(event?.type ?? ''));
      if (match) push(event.intuitaccountid, match[1], event.intuitentityid, match[2]);
    }
  } else {
    const notifications = (body as { eventNotifications?: unknown })?.eventNotifications;
    for (const notification of Array.isArray(notifications) ? notifications as Record<string, unknown>[] : []) {
      const entities = (notification?.dataChangeEvent as { entities?: unknown })?.entities;
      for (const entity of Array.isArray(entities) ? entities as Record<string, unknown>[] : []) {
        push(notification.realmId, entity?.name, entity?.id, String(entity?.operation ?? ''));
      }
    }
  }
  const seen = new Set<string>();
  return changes.filter(change => {
    const key = `${change.realmId}:${change.entity}:${change.id}:${change.operation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type QboInvoiceSnapshot = { id: string; syncToken: string; totalAmt: number; balance: number; deleted: boolean; customerId: string | null; docNumber: string | null; privateNote: string | null; paymentIds: string[] };
export type QboPaymentSnapshot = { id: string; deleted: boolean; invoiceIds: string[] };

const num = (value: unknown) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; };

export function invoiceSnapshot(value: unknown): QboInvoiceSnapshot | null {
  const item = value as Record<string, unknown> | null;
  const id = numericId(item?.Id);
  if (!item || !id) return null;
  const deleted = String(item.status ?? '').toLowerCase() === 'deleted';
  return {
    id, syncToken: String(item.SyncToken ?? '0'), totalAmt: num(item.TotalAmt), balance: num(item.Balance), deleted,
    customerId: numericId((item.CustomerRef as { value?: unknown } | undefined)?.value),
    docNumber: typeof item.DocNumber === 'string' ? item.DocNumber : null,
    privateNote: typeof item.PrivateNote === 'string' ? item.PrivateNote : null,
    paymentIds: (Array.isArray(item.LinkedTxn) ? item.LinkedTxn as Record<string, unknown>[] : [])
      .filter(txn => txn?.TxnType === 'Payment').flatMap(txn => numericId(txn.TxnId) ?? []),
  };
}

export function paymentSnapshot(value: unknown): QboPaymentSnapshot | null {
  const item = value as Record<string, unknown> | null;
  const id = numericId(item?.Id);
  if (!item || !id) return null;
  const lines = Array.isArray(item.Line) ? item.Line as Record<string, unknown>[] : [];
  const invoiceIds = [...new Set(lines.flatMap(line => (Array.isArray(line?.LinkedTxn) ? line.LinkedTxn as Record<string, unknown>[] : [])
    .filter(txn => txn?.TxnType === 'Invoice').flatMap(txn => numericId(txn.TxnId) ?? [])))];
  return { id, deleted: String(item.status ?? '').toLowerCase() === 'deleted', invoiceIds };
}

/** Invoices and payments from a /cdc response. */
export function parseCdc(body: unknown) {
  const invoices: QboInvoiceSnapshot[] = [];
  const payments: QboPaymentSnapshot[] = [];
  const responses = (body as { CDCResponse?: unknown })?.CDCResponse;
  for (const response of Array.isArray(responses) ? responses as Record<string, unknown>[] : []) {
    const queries = Array.isArray(response?.QueryResponse) ? response.QueryResponse as Record<string, unknown>[] : [];
    for (const query of queries) {
      for (const item of Array.isArray(query?.Invoice) ? query.Invoice : []) { const snapshot = invoiceSnapshot(item); if (snapshot) invoices.push(snapshot); }
      for (const item of Array.isArray(query?.Payment) ? query.Payment : []) { const snapshot = paymentSnapshot(item); if (snapshot) payments.push(snapshot); }
    }
  }
  return { invoices, payments };
}

/** changedSince for CDC: the last run (minus a minute of overlap), never more than 30 days back. */
export function cdcSince(lastRunAt: string | null, now = new Date()) {
  const floor = now.getTime() - (QBO_CDC_MAX_DAYS * 24 * 60 - 5) * 60_000;
  const last = lastRunAt ? Date.parse(lastRunAt) - 60_000 : now.getTime() - 24 * 60 * 60_000;
  return new Date(Math.max(floor, Number.isFinite(last) ? last : floor)).toISOString();
}

/** A short, safe message from a QuickBooks error response. */
export function qboErrorMessage(status: number, body: unknown) {
  const fault = (body as { Fault?: { Error?: { Message?: string; Detail?: string; code?: string }[] } } | null)?.Fault?.Error?.[0];
  const detail = (fault?.Detail || fault?.Message || '').replace(/\s+/g, ' ').trim();
  if (status === 401) return 'QuickBooks sign-in expired. The owner needs to reconnect QuickBooks in Settings.';
  if (status === 403) return 'QuickBooks denied access. The owner needs to reconnect QuickBooks in Settings.';
  if (status === 429) return 'QuickBooks is busy. Try again in a minute.';
  if (fault?.code === '5010') return 'This invoice changed in QuickBooks since FireOps last synced. Push the update again.';
  if (fault?.code === '6140') return 'QuickBooks already has an invoice with this number. Change the invoice number or turn off duplicate checking in QuickBooks.';
  const text = detail ? `QuickBooks: ${detail}` : `QuickBooks request failed (${status}).`;
  return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}

/** multipart/form-data body for /upload: JSON metadata linking the file to the invoice, then the file. */
export function buildAttachableUpload(input: { qboInvoiceId: string; fileName: string; contentType: string; bytes: Uint8Array; boundary: string }): Uint8Array<ArrayBuffer> {
  const fileName = input.fileName.replace(/["\r\n\\]/g, '_').slice(0, 200) || 'invoice';
  const metadata = JSON.stringify({
    AttachableRef: [{ EntityRef: { type: 'Invoice', value: input.qboInvoiceId }, IncludeOnSend: false }],
    FileName: fileName,
    ContentType: input.contentType,
  });
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${input.boundary}\r\nContent-Disposition: form-data; name="file_metadata_01"; filename="attachment.json"\r\nContent-Type: application/json\r\n\r\n${metadata}\r\n` +
    `--${input.boundary}\r\nContent-Disposition: form-data; name="file_content_01"; filename="${fileName}"\r\nContent-Type: ${input.contentType}\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${input.boundary}--\r\n`);
  const body = new Uint8Array(head.length + input.bytes.length + tail.length);
  body.set(head, 0); body.set(input.bytes, head.length); body.set(tail, head.length + input.bytes.length);
  return body;
}
