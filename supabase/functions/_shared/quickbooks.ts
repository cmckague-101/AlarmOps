// QuickBooks Online plumbing shared by quickbooks-integration,
// quickbooks-sync-invoice and quickbooks-webhook: configuration, encrypted
// tokens, the API client and the invoice/payment sync operations.
//
// Secrets: QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI,
// QBO_ENVIRONMENT (sandbox|production), QBO_ENCRYPTION_KEY (base64, 32 bytes),
// QBO_WEBHOOK_VERIFIER_TOKEN and QBO_CRON_SECRET (quickbooks-webhook only).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.112.4';
import {
  QBO_MINOR_VERSION, QBO_TOKEN_URL, buildAttachableUpload, buildInvoicePayload, buildInvoiceUpdate, buildPaymentPayload,
  fireopsMarker, invoiceSnapshot, paymentSnapshot, qboApiBase, qboErrorMessage, qboQueryValue,
  type QboCompanySettings, type QboInvoiceSnapshot, type QboPaymentSnapshot,
} from './quickbooks-logic.ts';
import { qboAmountsEqual, qboInvoiceProblem, qboPaymentDeletedDecision, qboRemoteDecision, type QboSyncStatus } from './quickbooks-status.ts';

// Database types are not generated for Edge Functions; keep the service client schema-dynamic.
// deno-lint-ignore no-explicit-any
export type Admin = SupabaseClient<any, 'public', any>;

export type QboConfig = { clientId: string; clientSecret: string; redirectUri: string; environment: 'sandbox' | 'production'; encryptionKey: string; apiBase: string };

export function qboConfig(): QboConfig | null {
  const clientId = Deno.env.get('QBO_CLIENT_ID');
  const clientSecret = Deno.env.get('QBO_CLIENT_SECRET');
  const redirectUri = Deno.env.get('QBO_REDIRECT_URI');
  const encryptionKey = Deno.env.get('QBO_ENCRYPTION_KEY');
  const environment = Deno.env.get('QBO_ENVIRONMENT') === 'production' ? 'production' : 'sandbox';
  if (!clientId || !clientSecret || !redirectUri || !encryptionKey) return null;
  return { clientId, clientSecret, redirectUri, environment, encryptionKey, apiBase: qboApiBase(environment) };
}

export function serviceClient(actorId?: string): Admin | null {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  // The audit log trusts x-fireops-actor-id only on service-role requests.
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(actorId ? { global: { headers: { 'x-fireops-actor-id': actorId } } } : {}),
  });
}

// ---- Encryption (AES-GCM, like Motive) -------------------------------------

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}
function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}
async function aesKey(secret: string, usages: KeyUsage[]) {
  let raw: Uint8Array<ArrayBuffer>;
  try { raw = base64ToBytes(secret); } catch { throw new Error('QBO_ENCRYPTION_KEY must be base64 encoded.'); }
  if (raw.byteLength !== 32) throw new Error('QBO_ENCRYPTION_KEY must decode to 32 bytes.');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, usages);
}
export async function encryptValue(value: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret, ['encrypt']), new TextEncoder().encode(value));
  return { encrypted: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}
export async function decryptValue(encrypted: string, iv: string, secret: string) {
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) }, await aesKey(secret, ['decrypt']), base64ToBytes(encrypted));
  return new TextDecoder().decode(decrypted);
}

// ---- OAuth tokens -----------------------------------------------------------

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; x_refresh_token_expires_in?: number };

export async function requestTokens(config: QboConfig, body: Record<string, string>) {
  const response = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15000),
  });
  const tokens = await response.json().catch(() => null) as TokenResponse | null;
  if (!response.ok || !tokens?.access_token || !tokens.refresh_token) return null;
  return tokens as Required<Pick<TokenResponse, 'access_token' | 'refresh_token'>> & TokenResponse;
}

export async function encryptedTokenColumns(config: QboConfig, tokens: { access_token: string; refresh_token: string; expires_in?: number; x_refresh_token_expires_in?: number }) {
  const [access, refresh] = await Promise.all([encryptValue(tokens.access_token, config.encryptionKey), encryptValue(tokens.refresh_token, config.encryptionKey)]);
  const now = Date.now();
  return {
    encrypted_access_token: access.encrypted, access_token_iv: access.iv,
    encrypted_refresh_token: refresh.encrypted, refresh_token_iv: refresh.iv,
    token_expires_at: new Date(now + Math.max(60, Number(tokens.expires_in) || 3600) * 1000).toISOString(),
    refresh_token_expires_at: tokens.x_refresh_token_expires_in ? new Date(now + Number(tokens.x_refresh_token_expires_in) * 1000).toISOString() : null,
    updated_at: new Date(now).toISOString(),
  };
}

export type Connection = {
  company_id: string; realm_id: string;
  encrypted_access_token: string; access_token_iv: string; encrypted_refresh_token: string; refresh_token_iv: string;
  token_expires_at: string; last_cdc_at: string | null;
};
const connectionColumns = 'company_id,realm_id,encrypted_access_token,access_token_iv,encrypted_refresh_token,refresh_token_iv,token_expires_at,last_cdc_at';

export class QboAuthError extends Error {}
export class QboHttpError extends Error {
  constructor(public status: number, message: string, public body: unknown) { super(message); }
}

/** A QuickBooks API client for one connected company. Refreshes the access token when needed. */
export class Qbo {
  private accessToken: string | null = null;
  constructor(private admin: Admin, private config: QboConfig, public connection: Connection) {}

  get realmId() { return this.connection.realm_id; }

  private async token(force = false) {
    if (!force && this.accessToken) return this.accessToken;
    if (!force && Date.parse(this.connection.token_expires_at) > Date.now() + 120_000) {
      this.accessToken = await decryptValue(this.connection.encrypted_access_token, this.connection.access_token_iv, this.config.encryptionKey);
      return this.accessToken;
    }
    const refreshToken = await decryptValue(this.connection.encrypted_refresh_token, this.connection.refresh_token_iv, this.config.encryptionKey);
    const tokens = await requestTokens(this.config, { grant_type: 'refresh_token', refresh_token: refreshToken });
    if (!tokens) {
      // Another request may have refreshed (and rotated) the token first.
      const { data } = await this.admin.from('company_qbo_connections').select(connectionColumns).eq('company_id', this.connection.company_id).maybeSingle();
      if (data && data.encrypted_refresh_token !== this.connection.encrypted_refresh_token && Date.parse(data.token_expires_at) > Date.now() + 60_000) {
        this.connection = data as Connection;
        this.accessToken = await decryptValue(this.connection.encrypted_access_token, this.connection.access_token_iv, this.config.encryptionKey);
        return this.accessToken;
      }
      throw new QboAuthError('QuickBooks sign-in expired. The owner needs to reconnect QuickBooks in Settings.');
    }
    const columns = await encryptedTokenColumns(this.config, tokens);
    const { error } = await this.admin.from('company_qbo_connections').update(columns).eq('company_id', this.connection.company_id);
    if (error) throw new Error('Refreshed QuickBooks session could not be saved.');
    this.connection = { ...this.connection, ...columns };
    this.accessToken = tokens.access_token;
    return this.accessToken;
  }

  /** Call /v3/company/{realm}{path}. Retries once after a 401 with a refreshed token. */
  async request(path: string, init: { method?: string; body?: BodyInit; contentType?: string; query?: Record<string, string> } = {}): Promise<unknown> {
    const url = new URL(`${this.config.apiBase}/v3/company/${this.realmId}${path}`);
    url.searchParams.set('minorversion', QBO_MINOR_VERSION);
    for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await this.token(attempt > 0);
      const response = await fetch(url, {
        method: init.method ?? 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(init.contentType ? { 'Content-Type': init.contentType } : {}) },
        body: init.body,
        signal: AbortSignal.timeout(20000),
      });
      const body = await response.json().catch(() => null);
      if (response.status === 401 && attempt === 0) continue;
      if (!response.ok || (body as { Fault?: unknown } | null)?.Fault) {
        const status = response.ok ? 400 : response.status;
        console.error('QuickBooks request failed', { path, status, intuitTid: response.headers.get('intuit_tid') });
        throw new QboHttpError(status, qboErrorMessage(status, body), body);
      }
      return body;
    }
    throw new QboAuthError('QuickBooks sign-in expired. The owner needs to reconnect QuickBooks in Settings.');
  }

  query<T = Record<string, unknown>>(entity: string, statement: string): Promise<T[]> {
    return this.request('/query', { query: { query: statement } }).then(body => {
      const rows = (body as { QueryResponse?: Record<string, unknown> } | null)?.QueryResponse?.[entity];
      return (Array.isArray(rows) ? rows : []) as T[];
    });
  }

  async read(entity: 'invoice' | 'payment' | 'customer' | 'item' | 'attachable' | 'companyinfo', id: string) {
    const body = await this.request(`/${entity}/${encodeURIComponent(id)}`) as Record<string, unknown>;
    const key = Object.keys(body ?? {}).find(name => name !== 'time');
    return (key ? body[key] : null) as Record<string, unknown> | null;
  }

  async write(entity: 'invoice' | 'payment' | 'attachable', payload: unknown, options: { requestId?: string; operation?: string } = {}) {
    const query: Record<string, string> = {};
    if (options.requestId) query.requestid = options.requestId;
    if (options.operation) query.operation = options.operation;
    const body = await this.request(`/${entity}`, { method: 'POST', body: JSON.stringify(payload), contentType: 'application/json', query }) as Record<string, unknown>;
    const key = Object.keys(body ?? {}).find(name => name !== 'time');
    return (key ? body[key] : null) as Record<string, unknown> | null;
  }

  async upload(form: Uint8Array<ArrayBuffer>, boundary: string) {
    const body = await this.request('/upload', { method: 'POST', body: form, contentType: `multipart/form-data; boundary=${boundary}` }) as { AttachableResponse?: { Attachable?: { Id?: string }; Fault?: unknown }[] };
    const result = body?.AttachableResponse?.[0];
    if (!result?.Attachable?.Id) throw new QboHttpError(400, qboErrorMessage(400, result), result);
    return String(result.Attachable.Id);
  }
}

// ---- Company context --------------------------------------------------------

export type QboSettingsRow = QboCompanySettings & { company_id: string; realm_id: string | null; qbo_company_name: string | null; connected: boolean; sync_mode: 'manual' | 'on_submit' };

export async function companyContext(admin: Admin, config: QboConfig, companyId: string) {
  const [{ data: company }, { data: connection }, { data: settings }] = await Promise.all([
    admin.from('companies').select('quickbooks_enabled').eq('id', companyId).maybeSingle(),
    admin.from('company_qbo_connections').select(connectionColumns).eq('company_id', companyId).maybeSingle(),
    admin.from('company_qbo_settings').select('*').eq('company_id', companyId).maybeSingle(),
  ]);
  return {
    enabled: company?.quickbooks_enabled === true,
    qbo: connection ? new Qbo(admin, config, connection as Connection) : null,
    settings: (settings ?? null) as QboSettingsRow | null,
  };
}

export type MemberAccess = { member: boolean; owner: boolean; finance: boolean };

/** Owners connect and change settings; owners and accounting sync and map customers (plus scoped FireOps staff). */
export async function memberAccess(admin: Admin, companyId: string, userId: string): Promise<MemberAccess> {
  const [{ data: membership }, { data: staff }] = await Promise.all([
    admin.from('company_members').select('role').eq('company_id', companyId).eq('user_id', userId).maybeSingle(),
    admin.from('system_admin_company_access').select('user_id').eq('company_id', companyId).eq('user_id', userId).gt('expires_at', new Date().toISOString()).maybeSingle(),
  ]);
  const role = membership?.role as string | undefined;
  const owner = role === 'owner' || Boolean(staff);
  return { member: Boolean(role) || Boolean(staff), owner, finance: owner || role === 'accounting' };
}

// ---- Invoice sync -----------------------------------------------------------

export type InvoiceRow = {
  id: string; company_id: string; created_by: string; invoice_number: string; invoice_date: string | null; invoice_amount: number | string;
  customer_id: string | null; attachment: { name: string; mimeType: string; storagePath: string } | null; status: 'draft' | 'submitted' | 'paid';
  due_date: string | null; paid_at: string | null;
  qbo_invoice_id: string | null; qbo_sync_token: string | null; qbo_sync_status: QboSyncStatus; qbo_last_error: string | null;
  qbo_payment_id: string | null; qbo_payment_pending: boolean; qbo_attachable_id: string | null; qbo_attachment_path: string | null;
  qbo_sync_requested_at: string | null;
};
export const invoiceColumns = 'id,company_id,created_by,invoice_number,invoice_date,invoice_amount,customer_id,attachment,status,due_date,paid_at,qbo_invoice_id,qbo_sync_token,qbo_sync_status,qbo_last_error,qbo_payment_id,qbo_payment_pending,qbo_attachable_id,qbo_attachment_path,qbo_sync_requested_at';
export const publicInvoiceColumns = 'id,status,paid_at,paid_by_name,qbo_invoice_id,qbo_sync_status,qbo_synced_at,qbo_last_error,qbo_payment_pending';

/** QuickBooks file types FireOps can attach (QuickBooks rejects HEIC and WebP). */
const ATTACHABLE_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];

function dueDate(row: InvoiceRow) {
  if (row.due_date) return row.due_date;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(row.invoice_date ?? '');
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 30));
  return date.toISOString().slice(0, 10);
}

/** requestid for a QuickBooks create: identical retries reuse it (QuickBooks returns the first result); changed content gets a new one. */
async function requestId(prefix: string, invoiceId: string, payload: unknown) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload))));
  const hash = [...digest.slice(0, 7)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${prefix}${invoiceId.replace(/-/g, '')}${hash}`.slice(0, 50);
}

async function saveInvoice(admin: Admin, id: string, values: Record<string, unknown>) {
  const { error } = await admin.from('invoice_forms').update(values).eq('id', id);
  if (error) throw new Error(`QuickBooks status could not be saved. ${error.message}`);
}

const attention = (error: string) => ({ qbo_sync_status: 'needs_attention', qbo_last_error: error.slice(0, 500) });

export type SyncMode = 'sync' | 'push' | 'payment' | 'auto';
export type SyncOutcome = { ok: boolean; busy?: boolean; error?: string };

/**
 * Create or update the QuickBooks invoice for one FireOps invoice, attach its file,
 * and send a pending FireOps payment. Holds a per-invoice lock; never creates duplicates:
 * the QuickBooks id is saved right after the create, a retried create first looks for the
 * invoice it already made (PrivateNote marker), and creates carry a content-based requestid.
 */
export async function syncInvoice(admin: Admin, qbo: Qbo, settings: QboSettingsRow, invoiceId: string, mode: SyncMode): Promise<SyncOutcome> {
  const { data: claimed, error: claimError } = await admin.rpc('claim_qbo_invoice_sync', { target: invoiceId });
  if (claimError) throw new Error('QuickBooks sync could not start.');
  if (!claimed) return { ok: false, busy: true, error: 'A QuickBooks sync for this invoice is already running. Try again in a moment.' };
  try {
    const { data, error } = await admin.from('invoice_forms').select(invoiceColumns).eq('id', invoiceId).maybeSingle();
    if (error || !data) return { ok: false, error: 'Invoice not found.' };
    const row = data as InvoiceRow;
    if (row.status === 'draft') return { ok: false, error: 'Submit the invoice before syncing it to QuickBooks.' };
    if (!row.qbo_invoice_id && row.status === 'paid') return { ok: false, error: 'Paid invoices that were never synced stay in FireOps only.' };
    try {
      if (!row.qbo_invoice_id || mode !== 'payment') await upsertInvoice(admin, qbo, settings, row);
      if (row.qbo_payment_pending) await recordPayment(admin, qbo, settings, row);
      return { ok: true };
    } catch (failure) {
      const message = failure instanceof QboHttpError || failure instanceof QboAuthError || failure instanceof SyncProblem
        ? failure.message : 'QuickBooks sync failed. Try again.';
      if (!(failure instanceof QboHttpError || failure instanceof QboAuthError || failure instanceof SyncProblem)) console.error('QuickBooks sync failed', failure);
      await saveInvoice(admin, row.id, attention(message));
      return { ok: false, error: message };
    }
  } finally {
    await admin.rpc('release_qbo_invoice_sync', { target: invoiceId });
  }
}

/** A problem the person can fix in FireOps (mapping, settings, invoice fields). */
export class SyncProblem extends Error {}

async function upsertInvoice(admin: Admin, qbo: Qbo, settings: QboSettingsRow, row: InvoiceRow) {
  const source = { id: row.id, invoiceNumber: row.invoice_number, invoiceDate: row.invoice_date ?? '', dueDate: dueDate(row), amount: Number(row.invoice_amount) };
  const problem = qboInvoiceProblem({ ...source, invoiceAmount: source.amount });
  if (problem) throw new SyncProblem(problem);
  if (!settings.item_id) throw new SyncProblem('The owner needs to choose the QuickBooks Product/Service for invoices in Settings.');
  const { data: mapping } = await admin.from('company_qbo_customer_mappings').select('qbo_customer_id,qbo_customer_name').eq('company_id', row.company_id).eq('customer_id', row.customer_id ?? '').maybeSingle();
  if (!mapping) {
    const { data: customer } = await admin.from('invoice_customers').select('name').eq('id', row.customer_id ?? '').maybeSingle();
    throw new SyncProblem(`Match customer “${customer?.name ?? 'Unknown'}” to a QuickBooks customer in Settings, then sync again.`);
  }
  const customer = { value: mapping.qbo_customer_id, name: mapping.qbo_customer_name };
  let qboId = row.qbo_invoice_id;
  let syncToken = row.qbo_sync_token ?? '0';
  if (!qboId) {
    const existing = (await qbo.query<Record<string, unknown>>('Invoice', `select * from Invoice where DocNumber = ${qboQueryValue(source.invoiceNumber.trim())}`))
      .map(invoiceSnapshot).find(item => item?.privateNote?.includes(fireopsMarker(row.id)));
    if (existing) {
      qboId = existing.id; syncToken = existing.syncToken;
      const updated = await qbo.write('invoice', buildInvoiceUpdate(source, customer, settings, { id: qboId, syncToken }));
      syncToken = String(updated?.SyncToken ?? syncToken);
    } else {
      const payload = buildInvoicePayload(source, customer, settings);
      const created = invoiceSnapshot(await qbo.write('invoice', payload, { requestId: await requestId('i', row.id, payload) }));
      if (!created) throw new Error('QuickBooks did not return the new invoice.');
      qboId = created.id; syncToken = created.syncToken;
    }
    // Save the link at once so a later failure (attachment, payment) never leads to a second invoice.
    await saveInvoice(admin, row.id, { qbo_invoice_id: qboId, qbo_sync_token: syncToken, qbo_sync_requested_at: null });
  } else {
    const current = invoiceSnapshot(await qbo.read('invoice', qboId));
    if (!current) throw new SyncProblem('This invoice is no longer in QuickBooks. Check QuickBooks before syncing again.');
    const updated = invoiceSnapshot(await qbo.write('invoice', buildInvoiceUpdate(source, customer, settings, { id: qboId, syncToken: current.syncToken })));
    syncToken = updated?.syncToken ?? current.syncToken;
  }
  row.qbo_invoice_id = qboId; row.qbo_sync_token = syncToken;
  const note = await syncAttachment(admin, qbo, row);
  await saveInvoice(admin, row.id, {
    qbo_invoice_id: qboId, qbo_sync_token: syncToken, qbo_sync_status: 'synced', qbo_synced_at: new Date().toISOString(),
    qbo_last_error: note, qbo_sync_requested_at: null, qbo_attachable_id: row.qbo_attachable_id, qbo_attachment_path: row.qbo_attachment_path,
  });
  row.qbo_sync_status = 'synced';
}

/** Attach the invoice file to the QuickBooks invoice when it is new or changed. Returns a note for unsupported files. */
async function syncAttachment(admin: Admin, qbo: Qbo, row: InvoiceRow): Promise<string | null> {
  const path = row.attachment?.storagePath ?? null;
  if (path === row.qbo_attachment_path) return null;
  if (row.qbo_attachable_id) {
    try {
      const old = await qbo.read('attachable', row.qbo_attachable_id);
      if (old) await qbo.write('attachable', { Id: row.qbo_attachable_id, SyncToken: String(old.SyncToken ?? '0') }, { operation: 'delete' });
    } catch (failure) { console.warn('Old QuickBooks attachment could not be removed', failure instanceof Error ? failure.message : failure); }
    row.qbo_attachable_id = null;
  }
  row.qbo_attachment_path = path;
  if (!row.attachment || !path) return null;
  if (!ATTACHABLE_TYPES.includes(row.attachment.mimeType)) return 'Synced without the attachment: QuickBooks accepts JPG, PNG or PDF files.';
  const { data: file, error } = await admin.storage.from('invoice-files').download(path);
  if (error || !file) throw new SyncProblem('The invoice attachment could not be read. Try again.');
  const boundary = `fireops${crypto.randomUUID().replace(/-/g, '')}`;
  row.qbo_attachable_id = await qbo.upload(buildAttachableUpload({
    qboInvoiceId: row.qbo_invoice_id!, fileName: row.attachment.name, contentType: row.attachment.mimeType, bytes: new Uint8Array(await file.arrayBuffer()), boundary,
  }), boundary);
  return null;
}

/** Send the FireOps "paid" to QuickBooks as a payment for the open balance, once. */
async function recordPayment(admin: Admin, qbo: Qbo, settings: QboSettingsRow, row: InvoiceRow) {
  if (row.status !== 'paid' || !row.qbo_invoice_id || row.qbo_payment_id) {
    await saveInvoice(admin, row.id, { qbo_payment_pending: false });
    return;
  }
  // Unpushed edits go first: the payment waits for "Push update to QuickBooks".
  if (row.qbo_sync_status === 'out_of_sync') return;
  const invoice = invoiceSnapshot(await qbo.read('invoice', row.qbo_invoice_id));
  if (!invoice) throw new SyncProblem('This invoice is no longer in QuickBooks, so the payment could not be recorded.');
  const done = { qbo_payment_pending: false, qbo_sync_status: 'synced', qbo_last_error: null, qbo_synced_at: new Date().toISOString() };
  if (invoice.balance <= 0.005) {
    // Already paid in QuickBooks: link that payment instead of adding another.
    await saveInvoice(admin, row.id, { ...done, qbo_payment_id: invoice.paymentIds.at(-1) ?? null });
    return;
  }
  if (!qboAmountsEqual(invoice.totalAmt, Number(row.invoice_amount))) {
    throw new SyncProblem(`QuickBooks shows a total of $${invoice.totalAmt.toFixed(2)}, not $${Number(row.invoice_amount).toFixed(2)}. Fix the invoice in QuickBooks or push the update, then try again.`);
  }
  if (!invoice.customerId) throw new SyncProblem('The QuickBooks invoice has no customer, so the payment could not be recorded.');
  const payload = buildPaymentPayload({
    fireopsInvoiceId: row.id, qboInvoiceId: invoice.id, customer: { value: invoice.customerId }, amount: invoice.balance,
    txnDate: (row.paid_at ?? new Date().toISOString()).slice(0, 10), settings,
  });
  const payment = await qbo.write('payment', payload, { requestId: await requestId('p', row.id, payload) });
  const paymentId = payment?.Id ? String(payment.Id) : null;
  if (!paymentId) throw new Error('QuickBooks did not return the payment.');
  await saveInvoice(admin, row.id, { ...done, qbo_payment_id: paymentId });
}

// ---- Changes from QuickBooks (webhooks and CDC) ----------------------------

/** Apply a QuickBooks invoice change to the linked FireOps invoice (mark paid / needs attention / resolved). */
export async function applyRemoteInvoice(admin: Admin, companyId: string, snapshot: QboInvoiceSnapshot) {
  const { data } = await admin.from('invoice_forms').select(invoiceColumns).eq('company_id', companyId).eq('qbo_invoice_id', snapshot.id).maybeSingle();
  if (!data) return;
  const row = data as InvoiceRow;
  const decision = qboRemoteDecision({
    status: row.status, invoiceAmount: Number(row.invoice_amount), qboInvoiceId: row.qbo_invoice_id,
    qboSyncStatus: row.qbo_sync_status, qboPaymentPending: row.qbo_payment_pending,
  }, snapshot);
  if (decision.kind === 'mark_paid') {
    await admin.from('invoice_forms').update({
      status: 'paid', qbo_payment_id: snapshot.paymentIds.at(-1) ?? null, qbo_payment_pending: false,
      ...(row.qbo_sync_status === 'needs_attention' ? { qbo_sync_status: 'synced', qbo_last_error: null } : {}),
    }).eq('id', row.id).eq('status', 'submitted');
  } else if (decision.kind === 'needs_attention' && snapshot.deleted) {
    // Unlink so the invoice can be synced again. A paid invoice stays paid.
    await saveInvoice(admin, row.id, { ...attention(decision.error), qbo_invoice_id: null, qbo_sync_token: null, qbo_attachable_id: null, qbo_attachment_path: null, qbo_payment_pending: false });
  } else if (decision.kind === 'needs_attention') {
    if (row.qbo_sync_status !== 'needs_attention' || row.qbo_last_error !== decision.error) await saveInvoice(admin, row.id, attention(decision.error));
  } else if (decision.kind === 'resolved') {
    await saveInvoice(admin, row.id, { qbo_sync_status: 'synced', qbo_last_error: null });
  }
}

/** Apply a QuickBooks payment change: a deleted payment flags the invoice; others re-check the invoices they pay. */
export async function applyRemotePayment(admin: Admin, qbo: Qbo, companyId: string, payment: QboPaymentSnapshot, skipInvoices = new Set<string>()) {
  if (payment.deleted) {
    const { data } = await admin.from('invoice_forms').select(invoiceColumns).eq('company_id', companyId).eq('qbo_payment_id', payment.id);
    for (const row of (data ?? []) as InvoiceRow[]) {
      const decision = qboPaymentDeletedDecision({ status: row.status, invoiceAmount: Number(row.invoice_amount) });
      if (decision.kind === 'needs_attention') await saveInvoice(admin, row.id, { ...attention(decision.error), qbo_payment_id: null });
    }
    return;
  }
  for (const invoiceId of payment.invoiceIds) {
    if (skipInvoices.has(invoiceId)) continue;
    const snapshot = invoiceSnapshot(await qbo.read('invoice', invoiceId));
    if (snapshot) await applyRemoteInvoice(admin, companyId, snapshot);
  }
}

export { paymentSnapshot, invoiceSnapshot };
