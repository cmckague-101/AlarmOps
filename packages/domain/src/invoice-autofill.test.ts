import { describe, expect, it } from 'vitest';
import { applyInvoiceAutofill, changedInvoiceFields, clearInvoiceReview, matchInvoiceCustomer, normalizeCustomerName, type InvoiceAutofillResult } from './invoice-autofill';
import type { InvoiceCustomer, InvoiceForm } from './invoices';

const customer = (id: string, name: string): InvoiceCustomer => ({ id, companyId: 'c', name, createdAt: '', updatedAt: '' });
const customers = [customer('srm', 'Sierra Resource Management'), customer('usfs', 'USFS - Region 5'), customer('cal', 'CAL FIRE, Inc.')];
const draft: InvoiceForm = {
  id: 'f', companyId: 'c', createdBy: 'u', createdByName: 'U', invoiceNumber: '', invoiceDate: '2026-11-09', invoiceAmount: 0,
  customerId: '', attachment: null, status: 'draft', submittedAt: null, createdAt: '', updatedAt: '',
};
const high = { invoiceNumber: 'high', invoiceDate: 'high', dueDate: 'high', invoiceAmount: 'high', customerName: 'high' } as const;
const read: InvoiceAutofillResult = { invoiceNumber: 'INV-142', invoiceDate: '2026-10-30', dueDate: '2026-11-29', invoiceAmount: 12480.5, customerName: 'Sierra Resource Management', confidence: high };

describe('normalizeCustomerName', () => {
  it('ignores case, punctuation, "the", "&" and company suffixes', () => {
    expect(normalizeCustomerName('The Sierra Resource Mgmt, LLC.')).toBe('sierra resource mgmt');
    expect(normalizeCustomerName('Smith & Sons Co')).toBe('smith and sons');
    expect(normalizeCustomerName("O'Neil Logging Inc")).toBe('oneil logging');
    expect(normalizeCustomerName('The Company')).toBe('company');
  });
});

describe('matchInvoiceCustomer', () => {
  it('matches the same name regardless of case, punctuation or suffix', () => {
    expect(matchInvoiceCustomer('sierra resource management', customers)?.id).toBe('srm');
    expect(matchInvoiceCustomer('Sierra Resource Management, Inc.', customers)?.id).toBe('srm');
    expect(matchInvoiceCustomer('Cal Fire', customers)?.id).toBe('cal');
    expect(matchInvoiceCustomer('USFS Region 5', customers)?.id).toBe('usfs');
  });
  it('returns null for names not in the list, never a near miss', () => {
    expect(matchInvoiceCustomer('Sierra Resources', customers)).toBeNull();
    expect(matchInvoiceCustomer('USFS Region 6', customers)).toBeNull();
    expect(matchInvoiceCustomer('', customers)).toBeNull();
    expect(matchInvoiceCustomer(null, customers)).toBeNull();
  });
  it('does not pick between two listed customers that normalise the same', () => {
    const twins = [customer('a', 'Pine Co'), customer('b', 'Pine LLC')];
    expect(matchInvoiceCustomer('Pine Inc', twins)).toBeNull();
    expect(matchInvoiceCustomer('pine llc', twins)?.id).toBe('b');
  });
});

describe('applyInvoiceAutofill', () => {
  it('fills every field from a confident read with nothing to check', () => {
    const outcome = applyInvoiceAutofill(draft, read, customers);
    expect(outcome.form).toMatchObject({ invoiceNumber: 'INV-142', invoiceDate: '2026-10-30', dueDate: '2026-11-29', invoiceAmount: 12480.5, customerId: 'srm' });
    expect(outcome.review).toEqual([]);
    expect(outcome.newCustomerName).toBeUndefined();
    expect(outcome.note).toBeUndefined();
  });

  it('flags only the fields read with less than high confidence', () => {
    const outcome = applyInvoiceAutofill(draft, { ...read, confidence: { ...high, invoiceAmount: 'medium', customerName: 'low' } }, customers);
    expect(outcome.review).toEqual(['invoiceAmount', 'customerId']);
    expect(outcome.form.customerId).toBe('srm');
  });

  it('treats a missing confidence as unsure', () => {
    expect(applyInvoiceAutofill(draft, { invoiceNumber: 'A-1' }, customers).review).toEqual(['invoiceNumber']);
  });

  it('offers a new customer when the printed name is not listed and keeps the form customer empty', () => {
    const outcome = applyInvoiceAutofill(draft, { ...read, customerName: '  Pine  Valley Fire District ' }, customers);
    expect(outcome.newCustomerName).toBe('Pine Valley Fire District');
    expect(outcome.form.customerId).toBe('');
    expect(outcome.review).toEqual([]);
  });

  it('flags an existing different customer when the printed one is new', () => {
    const outcome = applyInvoiceAutofill({ ...draft, customerId: 'usfs' }, { customerName: 'Pine Valley', confidence: high }, customers);
    expect(outcome.form.customerId).toBe('usfs');
    expect(outcome.review).toEqual(['customerId']);
  });

  it('leaves fields the photo did not show alone', () => {
    const start = { ...draft, invoiceNumber: 'MINE', invoiceAmount: 50 };
    const outcome = applyInvoiceAutofill(start, { invoiceDate: '2026-10-01', confidence: high }, customers);
    expect(outcome.form).toMatchObject({ invoiceNumber: 'MINE', invoiceAmount: 50, invoiceDate: '2026-10-01' });
  });

  it('ignores a due date before the invoice date and clears a stale one', () => {
    const outcome = applyInvoiceAutofill({ ...draft, dueDate: '2026-10-15' }, { invoiceDate: '2026-10-30', dueDate: '2026-10-01', confidence: high }, customers);
    expect(outcome.form.dueDate).toBeUndefined();
    expect(outcome.review).toEqual([]);
  });

  it('rejects bad amounts and dates', () => {
    const outcome = applyInvoiceAutofill(draft, { invoiceAmount: -4, invoiceDate: '10/30/2026', confidence: high }, customers);
    expect(outcome.form).toEqual(draft);
    expect(outcome.note).toMatch(/could not read/);
  });

  it('changes nothing for a photo that is not an invoice', () => {
    const outcome = applyInvoiceAutofill(draft, { ...read, notInvoice: true }, customers);
    expect(outcome.form).toBe(draft);
    expect(outcome.note).toMatch(/does not look like an invoice/);
  });
});

describe('review helpers', () => {
  it('clears a field once the person edits it', () => {
    expect(clearInvoiceReview(['invoiceNumber', 'customerId'], 'customerId')).toEqual(['invoiceNumber']);
    expect(changedInvoiceFields(draft, { ...draft, invoiceAmount: 10, dueDate: '2026-12-01' })).toEqual(['dueDate', 'invoiceAmount']);
  });
});
