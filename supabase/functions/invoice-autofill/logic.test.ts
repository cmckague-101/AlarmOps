import { assertEquals } from 'jsr:@std/assert@1';
import { cleanAmount, cleanDueDate, cleanInvoiceDate, cleanInvoiceNumber, parseInvoiceExtraction } from './logic.ts';

const today = '2026-11-09';
const read = (value: unknown, confidence = 'high') => ({ value, confidence });

Deno.test('parses a clear invoice with per-field confidence', () => {
  const result = parseInvoiceExtraction({
    is_invoice: true,
    invoice_number: read('INV-2026-0142'),
    invoice_date: read('2026-10-30'),
    due_date: read('2026-11-29', 'medium'),
    total: read(12480.5),
    customer: read('  Sierra   Resource\nManagement '),
  }, today);
  assertEquals(result, {
    invoiceNumber: 'INV-2026-0142', invoiceDate: '2026-10-30', dueDate: '2026-11-29', invoiceAmount: 12480.5,
    customerName: 'Sierra Resource Management',
    confidence: { invoiceNumber: 'high', invoiceDate: 'high', dueDate: 'medium', invoiceAmount: 'high', customerName: 'high' },
  });
});

Deno.test('not an invoice returns empty fields', () => {
  const result = parseInvoiceExtraction({ is_invoice: false, invoice_number: read('123') }, today);
  assertEquals(result.notInvoice, true);
  assertEquals(result.invoiceNumber, null);
  assertEquals(result.confidence.invoiceNumber, 'low');
});

Deno.test('unreadable or malformed fields become null with low confidence', () => {
  const result = parseInvoiceExtraction({
    is_invoice: true,
    invoice_number: read(null),
    invoice_date: read('10/30/2026'),
    due_date: 'garbage',
    total: read('12,480'),
    customer: read('   ', 'high'),
  }, today);
  assertEquals(result.invoiceNumber, null);
  assertEquals(result.invoiceDate, null);
  assertEquals(result.dueDate, null);
  assertEquals(result.invoiceAmount, null);
  assertEquals(result.customerName, null);
  assertEquals(Object.values(result.confidence), ['low', 'low', 'low', 'low', 'low']);
});

Deno.test('unknown confidence values are treated as low', () => {
  const result = parseInvoiceExtraction({ is_invoice: true, invoice_number: read('A-1', 'certain') }, today);
  assertEquals(result.confidence.invoiceNumber, 'low');
});

Deno.test('invoice numbers drop a printed label', () => {
  assertEquals(cleanInvoiceNumber('Invoice # 4471'), '4471');
  assertEquals(cleanInvoiceNumber('INV: FO-22'), 'FO-22');
  assertEquals(cleanInvoiceNumber('Invoice No. 88'), '88');
  assertEquals(cleanInvoiceNumber('FO-2026-001'), 'FO-2026-001');
  assertEquals(cleanInvoiceNumber('INV-2026-0142'), 'INV-2026-0142');
  assertEquals(cleanInvoiceNumber('Invoice 4471'), '4471');
  assertEquals(cleanInvoiceNumber('Invoice #'), null);
  assertEquals(cleanInvoiceNumber('x'.repeat(200))?.length, 160);
});

Deno.test('invoice dates must be real, after 2000 and not in the future', () => {
  assertEquals(cleanInvoiceDate('2026-02-30', today), null);
  assertEquals(cleanInvoiceDate('1999-12-31', today), null);
  assertEquals(cleanInvoiceDate('2026-12-01', today), null);
  assertEquals(cleanInvoiceDate('2026-11-10', today), today);
  assertEquals(cleanInvoiceDate('2026-11-09', today), today);
});

Deno.test('a date clamped to today is low confidence', () => {
  const result = parseInvoiceExtraction({ is_invoice: true, invoice_date: read('2026-11-10') }, today);
  assertEquals(result.invoiceDate, today);
  assertEquals(result.confidence.invoiceDate, 'low');
});

Deno.test('due dates cannot precede the invoice date or be years out', () => {
  assertEquals(cleanDueDate('2026-10-01', '2026-10-30'), null);
  assertEquals(cleanDueDate('2026-10-30', '2026-10-30'), '2026-10-30');
  assertEquals(cleanDueDate('2030-01-01', '2026-10-30'), null);
  assertEquals(cleanDueDate('2026-12-15', null), '2026-12-15');
});

Deno.test('amounts are positive dollars rounded to cents', () => {
  assertEquals(cleanAmount(12480.499), 12480.5);
  assertEquals(cleanAmount(0), null);
  assertEquals(cleanAmount(-5), null);
  assertEquals(cleanAmount(Number.NaN), null);
  assertEquals(cleanAmount(1e12), null);
});
