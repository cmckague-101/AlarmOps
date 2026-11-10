import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  qboAmountsEqual, qboFieldsFromRow, qboInvoiceAction, qboInvoiceProblem, qboPaymentDeletedDecision, qboRemoteDecision, qboStatusLabel,
  type QboLocalInvoice,
} from './quickbooks';

const submitted: QboLocalInvoice = { status: 'submitted', invoiceAmount: 1200, qboInvoiceId: '145', qboSyncStatus: 'synced', qboPaymentPending: false };
const paid: QboLocalInvoice = { ...submitted, status: 'paid' };

describe('QuickBooks status rules', () => {
  it('keeps the edge function copy identical', () => {
    const domain = readFileSync(new URL('./quickbooks.ts', import.meta.url), 'utf8');
    const edge = readFileSync(new URL('../../../supabase/functions/_shared/quickbooks-status.ts', import.meta.url), 'utf8');
    expect(edge).toBe(domain);
  });

  it('labels each status', () => {
    expect(qboStatusLabel('not_synced')).toBe('Not synced');
    expect(qboStatusLabel('synced')).toBe('Synced');
    expect(qboStatusLabel('out_of_sync')).toBe('Out of sync');
    expect(qboStatusLabel('needs_attention')).toBe('Needs attention');
  });

  it('offers Sync for any submitted unpaid invoice not in QuickBooks, Push for out-of-sync or failed ones', () => {
    expect(qboInvoiceAction({ status: 'draft', invoiceAmount: 1 })).toBeNull();
    expect(qboInvoiceAction({ status: 'submitted', invoiceAmount: 1 })).toBe('sync');
    expect(qboInvoiceAction({ status: 'submitted', invoiceAmount: 1, qboSyncStatus: 'needs_attention' })).toBe('sync');
    expect(qboInvoiceAction({ status: 'paid', invoiceAmount: 1 })).toBeNull();
    expect(qboInvoiceAction(submitted)).toBeNull();
    expect(qboInvoiceAction({ ...submitted, qboSyncStatus: 'out_of_sync' })).toBe('push');
    expect(qboInvoiceAction({ ...submitted, qboSyncStatus: 'needs_attention' })).toBe('push');
    expect(qboInvoiceAction({ ...paid, qboPaymentPending: true })).toBe('push');
    expect(qboInvoiceAction(paid)).toBeNull();
  });

  it('marks a submitted invoice paid only at a zero balance', () => {
    expect(qboRemoteDecision(submitted, { totalAmt: 1200, balance: 0 })).toEqual({ kind: 'mark_paid' });
    expect(qboRemoteDecision(submitted, { totalAmt: 1200, balance: 0.004 })).toEqual({ kind: 'mark_paid' });
    expect(qboRemoteDecision(submitted, { totalAmt: 1200, balance: 200 })).toEqual({ kind: 'none' });
    expect(qboRemoteDecision(submitted, { totalAmt: 1200, balance: 1200 })).toEqual({ kind: 'none' });
    expect(qboRemoteDecision({ ...submitted, status: 'draft' }, { totalAmt: 1200, balance: 0 })).toEqual({ kind: 'none' });
  });

  it('never un-pays: a balance on a paid invoice needs attention unless FireOps still owes its payment', () => {
    const decision = qboRemoteDecision(paid, { totalAmt: 1200, balance: 1200 });
    expect(decision.kind).toBe('needs_attention');
    expect(decision.kind === 'needs_attention' && decision.error).toMatch(/\$1200\.00 still due/);
    expect(qboRemoteDecision({ ...paid, qboPaymentPending: true }, { totalAmt: 1200, balance: 1200 })).toEqual({ kind: 'none' });
    expect(qboRemoteDecision(paid, { totalAmt: 1200, balance: 0 })).toEqual({ kind: 'none' });
    expect(qboRemoteDecision({ ...paid, qboSyncStatus: 'needs_attention' }, { totalAmt: 1200, balance: 0 })).toEqual({ kind: 'resolved' });
    expect(qboPaymentDeletedDecision(paid).kind).toBe('needs_attention');
    expect(qboPaymentDeletedDecision(submitted)).toEqual({ kind: 'none' });
  });

  it('flags deleted and voided QuickBooks invoices instead of marking them paid', () => {
    expect(qboRemoteDecision(submitted, { totalAmt: 1200, balance: 0, deleted: true }).kind).toBe('needs_attention');
    const voided = qboRemoteDecision(submitted, { totalAmt: 0, balance: 0 });
    expect(voided.kind === 'needs_attention' && voided.error).toMatch(/voided/);
    expect(qboRemoteDecision(paid, { totalAmt: 0, balance: 0 }).kind).toBe('needs_attention');
  });

  it('checks invoices before sending them', () => {
    expect(qboInvoiceProblem({ invoiceNumber: 'INV-1', invoiceDate: '2026-11-01', invoiceAmount: 10 })).toBeNull();
    expect(qboInvoiceProblem({ invoiceNumber: ' ', invoiceDate: '2026-11-01', invoiceAmount: 10 })).toMatch(/invoice number/);
    expect(qboInvoiceProblem({ invoiceNumber: 'X'.repeat(22), invoiceDate: '2026-11-01', invoiceAmount: 10 })).toMatch(/21 characters/);
    expect(qboInvoiceProblem({ invoiceNumber: 'X'.repeat(21), invoiceDate: '2026-11-01', invoiceAmount: 10 })).toBeNull();
    expect(qboInvoiceProblem({ invoiceNumber: 'A', invoiceDate: '', invoiceAmount: 10 })).toMatch(/date/);
    expect(qboInvoiceProblem({ invoiceNumber: 'A', invoiceDate: '2026-11-01', invoiceAmount: 0 })).toMatch(/more than/);
  });

  it('reads rows and compares money in cents', () => {
    expect(qboFieldsFromRow({})).toEqual({ qboInvoiceId: null, qboSyncStatus: 'not_synced', qboSyncedAt: null, qboLastError: null, qboPaymentPending: false });
    expect(qboFieldsFromRow({ qbo_invoice_id: '9', qbo_sync_status: 'out_of_sync', qbo_payment_pending: true }).qboSyncStatus).toBe('out_of_sync');
    expect(qboFieldsFromRow({ qbo_sync_status: 'weird' }).qboSyncStatus).toBe('not_synced');
    expect(qboAmountsEqual(0.1 + 0.2, 0.3)).toBe(true);
    expect(qboAmountsEqual(10, 10.01)).toBe(false);
  });
});
