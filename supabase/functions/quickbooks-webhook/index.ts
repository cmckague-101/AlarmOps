import {
  type Admin, Qbo, type Connection, type InvoiceRow, applyRemoteInvoice, applyRemotePayment, companyContext, invoiceColumns,
  invoiceSnapshot, paymentSnapshot, qboConfig, serviceClient, syncInvoice,
} from '../_shared/quickbooks.ts';
import { cdcSince, parseCdc, parseWebhookChanges, verifyIntuitSignature, type QboWebhookChange } from '../_shared/quickbooks-logic.ts';

// Changes from QuickBooks Online back into FireOps, plus queued FireOps work.
// POST with `intuit-signature` (Intuit webhook; verified with QBO_WEBHOOK_VERIFIER_TOKEN):
//   answers 200 at once and applies Invoice/Payment changes in the background.
// POST with `x-qbo-cron-secret: QBO_CRON_SECRET` (scheduled, every 5 minutes):
//   backup CDC poll of Invoices and Payments since the last poll for every
//   connected company, then sends queued automatic syncs and FireOps payments.
// Deploy with --no-verify-jwt; both callers authenticate as above.

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;
const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const PENDING_LIMIT = 25;
const AUTO_SYNC_DAYS = 7;

async function enabledCompany(admin: Admin, realmId: string) {
  const { data } = await admin.from('company_qbo_connections').select('company_id').eq('realm_id', realmId).maybeSingle();
  if (!data) return null;
  const { data: company } = await admin.from('companies').select('quickbooks_enabled').eq('id', data.company_id).maybeSingle();
  return company?.quickbooks_enabled ? data.company_id as string : null;
}

async function applyChange(admin: Admin, qbo: Qbo, companyId: string, change: QboWebhookChange) {
  // Classic payloads say Delete/Void; CloudEvents say Deleted/Voided.
  const deleted = /^delete/i.test(change.operation);
  if (change.entity === 'Invoice') {
    if (deleted) return applyRemoteInvoice(admin, companyId, { id: change.id, syncToken: '0', totalAmt: 0, balance: 0, deleted: true, customerId: null, docNumber: null, privateNote: null, paymentIds: [] });
    const snapshot = invoiceSnapshot(await qbo.read('invoice', change.id));
    if (snapshot) await applyRemoteInvoice(admin, companyId, snapshot);
    return;
  }
  if (deleted || /^void/i.test(change.operation)) return applyRemotePayment(admin, qbo, companyId, { id: change.id, deleted: true, invoiceIds: [] });
  const payment = paymentSnapshot(await qbo.read('payment', change.id));
  if (payment) await applyRemotePayment(admin, qbo, companyId, payment);
}

async function processWebhook(admin: Admin, changes: QboWebhookChange[]) {
  const config = qboConfig()!;
  const byRealm = new Map<string, QboWebhookChange[]>();
  for (const change of changes) byRealm.set(change.realmId, [...(byRealm.get(change.realmId) ?? []), change]);
  for (const [realmId, items] of byRealm) {
    const companyId = await enabledCompany(admin, realmId);
    if (!companyId) continue;
    const context = await companyContext(admin, config, companyId);
    if (!context.qbo) continue;
    for (const change of items) {
      try { await applyChange(admin, context.qbo, companyId, change); }
      catch (failure) { console.error('QuickBooks webhook change failed (the CDC poll retries it):', change, failure instanceof Error ? failure.message : failure); }
    }
  }
}

async function pollCompany(admin: Admin, companyId: string) {
  const config = qboConfig()!;
  const context = await companyContext(admin, config, companyId);
  if (!context.enabled || !context.qbo || !context.settings) return { companyId, skipped: true };
  const qbo = context.qbo;
  const startedAt = new Date().toISOString();
  const { invoices, payments } = parseCdc(await qbo.request('/cdc', { query: { entities: 'Invoice,Payment', changedSince: cdcSince(qbo.connection.last_cdc_at) } }));
  const seen = new Set<string>();
  for (const invoice of invoices) { seen.add(invoice.id); await applyRemoteInvoice(admin, companyId, invoice); }
  for (const payment of payments) await applyRemotePayment(admin, qbo, companyId, payment, seen);
  await admin.from('company_qbo_connections').update({ last_cdc_at: startedAt }).eq('company_id', companyId);

  // Queued FireOps work: automatic syncs after submit, and payments marked in FireOps.
  const since = new Date(Date.now() - AUTO_SYNC_DAYS * 86_400_000).toISOString();
  const [{ data: autoSync }, { data: pendingPayments }] = await Promise.all([
    admin.from('invoice_forms').select(invoiceColumns).eq('company_id', companyId).eq('status', 'submitted').is('qbo_invoice_id', null).gt('qbo_sync_requested_at', since).limit(PENDING_LIMIT),
    admin.from('invoice_forms').select(invoiceColumns).eq('company_id', companyId).eq('qbo_payment_pending', true).neq('qbo_sync_status', 'out_of_sync').limit(PENDING_LIMIT),
  ]);
  let synced = 0;
  for (const row of [...(autoSync ?? []), ...(pendingPayments ?? [])] as InvoiceRow[]) {
    const outcome = await syncInvoice(admin, qbo, context.settings, row.id, row.qbo_invoice_id ? 'payment' : 'auto');
    if (outcome.ok) synced += 1;
  }
  return { companyId, invoices: invoices.length, payments: payments.length, synced };
}

Deno.serve(async request => {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const admin = serviceClient();
  if (!admin || !qboConfig()) return json(500, { error: 'QuickBooks integration is not configured.' });

  const signature = request.headers.get('intuit-signature');
  if (signature) {
    const verifier = Deno.env.get('QBO_WEBHOOK_VERIFIER_TOKEN') ?? '';
    const raw = await request.text();
    if (!verifier || !await verifyIntuitSignature(raw, signature, verifier)) return json(401, { error: 'Invalid signature.' });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return json(400, { error: 'Invalid body.' }); }
    const work = processWebhook(admin, parseWebhookChanges(body)).catch(failure => console.error('QuickBooks webhook failed:', failure));
    // Intuit expects a fast 200; finish in the background where supported.
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work); else await work;
    return json(200, { ok: true });
  }

  const cronSecret = Deno.env.get('QBO_CRON_SECRET');
  const supplied = request.headers.get('x-qbo-cron-secret');
  if (!cronSecret || !supplied || supplied !== cronSecret) return json(401, { error: 'Unauthorized.' });
  const { data: connections, error } = await admin.from('company_qbo_connections').select('company_id');
  if (error) return json(500, { error: 'Connections could not be loaded.' });
  const results = [];
  for (const connection of (connections ?? []) as Pick<Connection, 'company_id'>[]) {
    try { results.push(await pollCompany(admin, connection.company_id)); }
    catch (failure) { console.error('QuickBooks poll failed for company', connection.company_id, failure instanceof Error ? failure.message : failure); results.push({ companyId: connection.company_id, error: true }); }
  }
  return json(200, { companies: results.length, results });
});
