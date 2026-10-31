import {describe,expect,it} from 'vitest';
import {invoiceDueDate,invoicePaymentState} from './invoices';

const today=new Date(2026,9,31);

describe('invoice payment state',()=>{
  it('uses the saved due date, else 30 days after the invoice date',()=>{expect(invoiceDueDate({dueDate:'2026-11-15',invoiceDate:'2026-10-01'})).toBe('2026-11-15');expect(invoiceDueDate({invoiceDate:'2026-10-30'})).toBe('2026-11-29');expect(invoiceDueDate({invoiceDate:''})).toBe('')});
  it('reports draft and paid as is',()=>{expect(invoicePaymentState({status:'draft',invoiceDate:'2026-01-01'},today)).toBe('draft');expect(invoicePaymentState({status:'paid',invoiceDate:'2026-01-01'},today)).toBe('paid')});
  it('is overdue only after the due date',()=>{expect(invoicePaymentState({status:'submitted',invoiceDate:'2026-09-01'},today)).toBe('overdue');expect(invoicePaymentState({status:'submitted',invoiceDate:'2026-10-01'},today)).toBe('unpaid');expect(invoicePaymentState({status:'submitted',dueDate:'2026-10-31',invoiceDate:'2026-10-01'},today)).toBe('unpaid')});
});
