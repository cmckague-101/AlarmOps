// Unit tests for the QuickBooks edge functions' pure logic (no Deno needed).
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildAttachableUpload, buildInvoicePayload, buildInvoiceUpdate, buildPaymentPayload, cdcSince, invoiceSnapshot, parseCdc,
  parseWebhookChanges, paymentSnapshot, qboApiBase, qboErrorMessage, qboQueryValue, verifyIntuitSignature,
} from '../../../supabase/functions/_shared/quickbooks-logic';

const source = { id: '7d0c0b6e-0000-4000-8000-000000000001', invoiceNumber: ' INV-104 ', invoiceDate: '2026-11-01', dueDate: '2026-12-01', amount: 1234.565 };
const customer = { value: '58', name: 'County of Shasta' };
const minimal = { item_id: '1', item_name: 'Services' };

describe('QuickBooks invoice payload', () => {
  it('sends one line for the total on the company item and keeps the FireOps number', () => {
    expect(buildInvoicePayload(source, customer, minimal)).toEqual({
      CustomerRef: customer,
      DocNumber: 'INV-104',
      TxnDate: '2026-11-01',
      DueDate: '2026-12-01',
      PrivateNote: `FireOps invoice ${source.id}`,
      Line: [{
        DetailType: 'SalesItemLineDetail', Amount: 1234.57, Description: 'FireOps invoice INV-104',
        SalesItemLineDetail: { ItemRef: { value: '1', name: 'Services' }, Qty: 1, UnitPrice: 1234.57 },
      }],
    });
  });

  it('adds the optional tax code, terms, class and location', () => {
    const payload = buildInvoicePayload(source, customer, {
      ...minimal, tax_code_id: 'TAX', tax_code_name: 'Taxable', terms_id: '3', terms_name: 'Net 30',
      class_id: '200', class_name: 'Fire', department_id: '2', department_name: 'Redding',
    });
    expect(payload.SalesTermRef).toEqual({ value: '3', name: 'Net 30' });
    expect(payload.DepartmentRef).toEqual({ value: '2', name: 'Redding' });
    expect(payload.Line[0].SalesItemLineDetail).toMatchObject({ TaxCodeRef: { value: 'TAX', name: 'Taxable' }, ClassRef: { value: '200', name: 'Fire' } });
  });

  it('requires the Product/Service item', () => {
    expect(() => buildInvoicePayload(source, customer, { item_id: null })).toThrow(/Product\/Service/);
  });

  it('pushes edits as a sparse update with the SyncToken', () => {
    expect(buildInvoiceUpdate(source, customer, minimal, { id: '145', syncToken: '4' })).toMatchObject({ Id: '145', SyncToken: '4', sparse: true, DocNumber: 'INV-104' });
  });

  it('links a payment to the invoice; no deposit account means Undeposited Funds', () => {
    const payment = buildPaymentPayload({ fireopsInvoiceId: source.id, qboInvoiceId: '145', customer: { value: '58' }, amount: 99.999, txnDate: '2026-11-05', settings: minimal });
    expect(payment).toEqual({
      CustomerRef: { value: '58' }, TotalAmt: 100, TxnDate: '2026-11-05',
      PrivateNote: `Marked paid in FireOps (FireOps invoice ${source.id})`,
      Line: [{ Amount: 100, LinkedTxn: [{ TxnId: '145', TxnType: 'Invoice' }] }],
    });
    const deposit = buildPaymentPayload({ fireopsInvoiceId: source.id, qboInvoiceId: '145', customer: { value: '58' }, amount: 5, txnDate: '2026-11-05',
      settings: { ...minimal, deposit_account_id: '35', deposit_account_name: 'Checking', payment_method_id: '2', payment_method_name: 'Check' } });
    expect(deposit).toMatchObject({ DepositToAccountRef: { value: '35', name: 'Checking' }, PaymentMethodRef: { value: '2', name: 'Check' } });
  });

  it('quotes query values and picks the API host', () => {
    expect(qboQueryValue("O'Brien \\ Co")).toBe("'O\\'Brien \\\\ Co'");
    expect(qboApiBase('production')).toBe('https://quickbooks.api.intuit.com');
    expect(qboApiBase('sandbox')).toBe('https://sandbox-quickbooks.api.intuit.com');
    expect(qboApiBase(undefined)).toBe('https://sandbox-quickbooks.api.intuit.com');
  });
});

describe('Intuit webhooks', () => {
  const token = 'verifier-token-123';
  const body = JSON.stringify({ eventNotifications: [{ realmId: '9130', dataChangeEvent: { entities: [
    { name: 'Invoice', id: '145', operation: 'Update', lastUpdated: '2026-11-10T10:00:00.000Z' },
    { name: 'Payment', id: '77', operation: 'Delete' },
    { name: 'Customer', id: '58', operation: 'Update' },
    { name: 'Invoice', id: '145', operation: 'Update' },
  ] } }] });
  const sign = (value: string) => createHmac('sha256', token).update(value).digest('base64');

  it('accepts only a matching intuit-signature', async () => {
    expect(await verifyIntuitSignature(body, sign(body), token)).toBe(true);
    expect(await verifyIntuitSignature(`${body} `, sign(body), token)).toBe(false);
    expect(await verifyIntuitSignature(body, sign(body), 'other-token')).toBe(false);
    expect(await verifyIntuitSignature(body, null, token)).toBe(false);
    expect(await verifyIntuitSignature(body, sign(body), '')).toBe(false);
    expect(await verifyIntuitSignature(body, 'short', token)).toBe(false);
  });

  it('reads Invoice and Payment changes from classic payloads, once each', () => {
    expect(parseWebhookChanges(JSON.parse(body))).toEqual([
      { realmId: '9130', entity: 'Invoice', id: '145', operation: 'Update' },
      { realmId: '9130', entity: 'Payment', id: '77', operation: 'Delete' },
    ]);
  });

  it('reads CloudEvents payloads', () => {
    expect(parseWebhookChanges([
      { specversion: '1.0', type: 'qbo.invoice.updated.v1', intuitaccountid: '9130', intuitentityid: '145' },
      { specversion: '1.0', type: 'qbo.payment.deleted.v1', intuitaccountid: '9130', intuitentityid: '77' },
      { specversion: '1.0', type: 'qbo.customer.created.v1', intuitaccountid: '9130', intuitentityid: '1' },
      { type: 'qbo.invoice.updated.v1', intuitaccountid: 'x', intuitentityid: '1' },
    ])).toEqual([
      { realmId: '9130', entity: 'Invoice', id: '145', operation: 'Updated' },
      { realmId: '9130', entity: 'Payment', id: '77', operation: 'Deleted' },
    ]);
    expect(parseWebhookChanges(null)).toEqual([]);
    expect(parseWebhookChanges({ eventNotifications: 'x' })).toEqual([]);
  });
});

describe('QuickBooks responses', () => {
  it('reads invoices, payments and CDC', () => {
    const invoice = { Id: '145', SyncToken: '2', TotalAmt: 1200, Balance: 0, DocNumber: 'INV-104', CustomerRef: { value: '58' }, PrivateNote: 'FireOps invoice x', LinkedTxn: [{ TxnId: '77', TxnType: 'Payment' }, { TxnId: '9', TxnType: 'Estimate' }] };
    expect(invoiceSnapshot(invoice)).toEqual({ id: '145', syncToken: '2', totalAmt: 1200, balance: 0, deleted: false, customerId: '58', docNumber: 'INV-104', privateNote: 'FireOps invoice x', paymentIds: ['77'] });
    expect(invoiceSnapshot({ Id: 'abc' })).toBeNull();
    expect(paymentSnapshot({ Id: '77', Line: [{ LinkedTxn: [{ TxnId: '145', TxnType: 'Invoice' }, { TxnId: '146', TxnType: 'Invoice' }] }, { LinkedTxn: [{ TxnId: '145', TxnType: 'Invoice' }] }] }))
      .toEqual({ id: '77', deleted: false, invoiceIds: ['145', '146'] });
    const cdc = parseCdc({ CDCResponse: [{ QueryResponse: [{ Invoice: [invoice, { Id: '146', status: 'Deleted' }] }, { Payment: [{ Id: '78', status: 'Deleted' }] }] }] });
    expect(cdc.invoices.map(item => [item.id, item.deleted])).toEqual([['145', false], ['146', true]]);
    expect(cdc.payments).toEqual([{ id: '78', deleted: true, invoiceIds: [] }]);
    expect(parseCdc({})).toEqual({ invoices: [], payments: [] });
  });

  it('polls since the last run with overlap, never past 30 days', () => {
    const now = new Date('2026-11-10T12:00:00.000Z');
    expect(cdcSince('2026-11-10T11:55:00.000Z', now)).toBe('2026-11-10T11:54:00.000Z');
    expect(cdcSince(null, now)).toBe('2026-11-09T12:00:00.000Z');
    expect(cdcSince('2026-01-01T00:00:00.000Z', now)).toBe('2026-10-11T12:05:00.000Z');
  });

  it('turns QuickBooks faults into short messages', () => {
    expect(qboErrorMessage(400, { Fault: { Error: [{ Message: 'Duplicate Document Number Error', Detail: 'Duplicate  Document\nNumber', code: '6140' }] } })).toMatch(/already has an invoice with this number/);
    expect(qboErrorMessage(400, { Fault: { Error: [{ Detail: 'Stale object', code: '5010' }] } })).toMatch(/changed in QuickBooks/);
    expect(qboErrorMessage(400, { Fault: { Error: [{ Detail: 'Invalid Reference Id' }] } })).toBe('QuickBooks: Invalid Reference Id');
    expect(qboErrorMessage(401, null)).toMatch(/reconnect/);
    expect(qboErrorMessage(500, null)).toBe('QuickBooks request failed (500).');
    expect(qboErrorMessage(400, { Fault: { Error: [{ Detail: 'x'.repeat(600) }] } })).toHaveLength(500);
  });

  it('builds the attachment upload linked to the invoice', () => {
    const body = new TextDecoder().decode(buildAttachableUpload({ qboInvoiceId: '145', fileName: 'inv"1.pdf', contentType: 'application/pdf', bytes: new TextEncoder().encode('%PDF'), boundary: 'b1' }));
    expect(body).toContain('name="file_metadata_01"');
    expect(body).toContain('"AttachableRef":[{"EntityRef":{"type":"Invoice","value":"145"},"IncludeOnSend":false}]');
    expect(body).toContain('name="file_content_01"; filename="inv_1.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF\r\n--b1--\r\n');
  });
});
