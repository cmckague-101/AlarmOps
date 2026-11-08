import { useEffect, useMemo, useState } from 'react';
import { invoiceDueDate, formatCalendarDate, type InvoiceCustomer } from '@fireops/domain';
import { ArrowLeft, FileDown, Plus, Trash2 } from 'lucide-react';

type LineItem = { id: number; description: string; quantity: string; rate: string };

const ADD_CUSTOMER = '__add_customer__';

type InvoiceGeneratorProps = {
  companyLogoUrl?: string | null;
  company: { name: string; phone?: string; location?: string };
  customers: InvoiceCustomer[];
  /** localStorage key for this user's unfinished generator draft. */
  draftKey: string;
  onAddCustomer: (name: string) => Promise<InvoiceCustomer>;
  onAddToInvoices: (invoice: { invoiceNumber: string; invoiceDate: string; amount: number; customerId: string }) => Promise<void>;
  onBack: () => void;
};
type Draft = { invoiceDate: string; invoiceNumber: string; billFrom: string; billTo: string; customerId: string; items: LineItem[] };
const emptyDraft = (company: InvoiceGeneratorProps['company']): Draft => ({ invoiceDate: new Date().toISOString().slice(0, 10), invoiceNumber: '', billFrom: [company.name, company.location, company.phone].filter(Boolean).join('\n'), billTo: '', customerId: '', items: [emptyItem(1)] });
function readDraft(key: string, company: InvoiceGeneratorProps['company']): Draft {
  try { const saved = window.localStorage.getItem(key); if (saved) return { ...emptyDraft(company), ...JSON.parse(saved) as Draft }; } catch { /* storage unavailable or damaged */ }
  return emptyDraft(company);
}

const emptyItem = (id: number): LineItem => ({ id, description: '', quantity: '1', rate: '0.00' });
const money = (value: number) => value.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char] ?? char);

export function InvoiceGenerator({ companyLogoUrl, company, customers, draftKey, onAddCustomer, onAddToInvoices, onBack }: InvoiceGeneratorProps) {
  const [draft, setDraft] = useState<Draft>(() => readDraft(draftKey, company));
  const { invoiceDate, invoiceNumber, billFrom, billTo, customerId, items } = draft;
  const patch = (values: Partial<Draft>) => setDraft((current) => ({ ...current, ...values }));
  const setInvoiceDate = (invoiceDate: string) => patch({ invoiceDate });
  const setInvoiceNumber = (invoiceNumber: string) => patch({ invoiceNumber });
  const setBillFrom = (billFrom: string) => patch({ billFrom });
  const setBillTo = (billTo: string) => patch({ billTo });
  const setItems = (next: (current: LineItem[]) => LineItem[]) => setDraft((current) => ({ ...current, items: next(current.items) }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [customerName, setCustomerName] = useState('');
  // Keep the unfinished invoice in this browser so leaving the page does not lose it.
  useEffect(() => { try { window.localStorage.setItem(draftKey, JSON.stringify(draft)); } catch { /* storage unavailable */ } }, [draft, draftKey]);
  const chooseCustomer = (id: string) => {
    if (id === ADD_CUSTOMER) { setAddingCustomer(true); setCustomerName(''); return; }
    setAddingCustomer(false);
    const name = customers.find((customer) => customer.id === id)?.name ?? '';
    const [, ...rest] = billTo.split('\n');
    patch({ customerId: id, billTo: name ? [name, ...rest].join('\n') : billTo });
  };
  const saveCustomer = async () => {
    const name = customerName.trim();
    if (!name) return;
    setBusy(true); setError('');
    try {
      const created = await onAddCustomer(name);
      const [, ...rest] = billTo.split('\n');
      patch({ customerId: created.id, billTo: [created.name, ...rest].join('\n') });
      setAddingCustomer(false); setCustomerName('');
    } catch (addError) { setError(addError instanceof Error ? addError.message : 'Customer could not be added.'); }
    finally { setBusy(false); }
  };
  const startOver = () => { if (window.confirm('Start a new invoice? This clears the invoice in the generator.')) setDraft(emptyDraft(company)); };
  const logo = companyLogoUrl ?? '';
  const total = useMemo(() => items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.rate) || 0), 0), [items]);

  const updateItem = (id: number, key: keyof Omit<LineItem, 'id'>, value: string) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, [key]: value } : item));
  };

  const generatePdf = () => {
    const popup = window.open('', '_blank');
    if (!popup) return;
    popup.opener = null;
    const rows = items.map((item) => {
      const amount = (Number(item.quantity) || 0) * (Number(item.rate) || 0);
      return `<tr><td>${escapeHtml(item.description)}</td><td>${escapeHtml(item.quantity)}</td><td>${money(Number(item.rate) || 0)}</td><td>${money(amount)}</td></tr>`;
    }).join('');
    popup.document.write(`<!doctype html><html><head><title>Invoice ${escapeHtml(invoiceNumber)}</title><style>
      body{font:14px Arial,sans-serif;color:#18212f;padding:48px;max-width:900px;margin:auto}.head{display:flex;justify-content:space-between;align-items:start;margin-bottom:48px}.logo{max-width:180px;max-height:90px}.title{text-align:right}h1{font-size:36px;margin:0 0 8px;color:#b42318}.parties{display:grid;grid-template-columns:1fr 1fr;gap:48px;margin-bottom:36px}.label{font-size:11px;font-weight:700;letter-spacing:.08em;color:#667085;text-transform:uppercase;margin-bottom:8px}.multiline{white-space:pre-wrap}table{width:100%;border-collapse:collapse}th{background:#f2f4f7;text-align:left}th,td{padding:12px;border-bottom:1px solid #e4e7ec}th:nth-child(n+2),td:nth-child(n+2){text-align:right}.total{font-size:20px;font-weight:700;text-align:right;margin-top:24px}@media print{body{padding:20px}}
    </style></head><body><div class="head"><div>${logo ? `<img class="logo" src="${escapeHtml(logo)}" />` : ''}</div><div class="title"><h1>INVOICE</h1><div># ${escapeHtml(invoiceNumber)}</div><div>${escapeHtml(formatCalendarDate(invoiceDate, invoiceDate))}</div>${invoiceDueDate({ invoiceDate }) ? `<div>Due ${escapeHtml(formatCalendarDate(invoiceDueDate({ invoiceDate })))}</div>` : ''}</div></div><div class="parties"><div><div class="label">Bill from</div><div class="multiline">${escapeHtml(billFrom)}</div></div><div><div class="label">Bill to</div><div class="multiline">${escapeHtml(billTo)}</div></div></div><table><thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table><div class="total">Total: ${money(total)}</div><script>window.onload=()=>window.print()<\/script></body></html>`);
    popup.document.close();
  };

  const addToInvoices = async () => {
    if (!invoiceNumber.trim() || !invoiceDate || total <= 0 || !customerId) { setError('Add an invoice number, date, customer and at least one priced line item first.'); return; }
    setBusy(true); setError('');
    try { await onAddToInvoices({ invoiceNumber: invoiceNumber.trim(), invoiceDate, amount: Math.round(total * 100) / 100, customerId }); setDraft(emptyDraft(company)); }
    catch (addError) { setError(addError instanceof Error ? addError.message : 'Invoice could not be added.'); }
    finally { setBusy(false); }
  };

  const inputStyle = { width: '100%', boxSizing: 'border-box' as const, border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', font: 'inherit', background: 'var(--paper)', color: 'var(--ink)' };
  const labelStyle = { display: 'grid', gap: 6, color: 'var(--ink)', fontSize: 14, fontWeight: 600 };

  return <section style={{ maxWidth: 980, margin: '0 auto', padding: '24px', color: 'var(--ink)' }}>
    <button type="button" onClick={onBack} style={{ border: 0, background: 'transparent', color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 18 }}><ArrowLeft size={18} /> Back to invoices</button>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', marginBottom: 24, flexWrap: 'wrap' }}><div><h1 style={{ margin: 0 }}>Invoice Generator</h1><p style={{ color: 'var(--muted)', marginBottom: 0 }}>Create an invoice PDF, then add it to Invoices. Your work is kept in this browser until you finish.</p></div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button type="button" className="secondary" onClick={startOver}>Start over</button><button type="button" className="secondary" disabled={busy} onClick={() => void addToInvoices()}>{busy ? 'Adding…' : 'Add to Invoices'}</button><button type="button" onClick={generatePdf} style={{ border: 0, borderRadius: 8, padding: '11px 16px', background: 'var(--orange)', color: '#fff', fontWeight: 700, display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}><FileDown size={18} /> Generate PDF</button></div></div>{error && <p className="receipt-error" role="alert">{error}</p>}
    <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 12, padding: 24, display: 'grid', gap: 22 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16 }}>
        <label style={labelStyle}>Invoice date<input style={inputStyle} type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} /></label>
        <label style={labelStyle}>Invoice number<input style={inputStyle} value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} placeholder="INV-001" /></label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 16 }}>
        <label style={labelStyle}>Bill from<textarea style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }} value={billFrom} onChange={(event) => setBillFrom(event.target.value)} placeholder={'Company name\nAddress\nEmail'} /></label>
        <div style={{ display: 'grid', gap: 10 }}><label style={labelStyle}>Customer<select style={inputStyle} value={addingCustomer ? ADD_CUSTOMER : customerId} onChange={(event) => chooseCustomer(event.target.value)}><option value="">{customers.length ? 'Select customer' : 'Add a customer'}</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}<option value={ADD_CUSTOMER}>Add customer…</option></select></label>{addingCustomer && <div className="invoice-inline-customer"><input style={inputStyle} autoFocus value={customerName} maxLength={160} placeholder="Customer name" onChange={(event) => setCustomerName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void saveCustomer(); } }} /><button type="button" className="primary" disabled={!customerName.trim() || busy} onClick={() => void saveCustomer()}>Add</button><button type="button" className="secondary" onClick={() => { setAddingCustomer(false); setCustomerName(''); }}>Cancel</button></div>}<label style={labelStyle}>Bill to<textarea style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }} value={billTo} onChange={(event) => setBillTo(event.target.value)} placeholder={'Customer name\nAddress\nEmail'} /></label></div>
      </div>
      <div style={labelStyle}>Company logo<div>{logo ? <img src={logo} alt="Company logo" style={{ width: 96, height: 64, objectFit: 'contain', border: '1px solid var(--line)', borderRadius: 8 }} /> : <span style={{ color: 'var(--muted)', fontWeight: 400 }}>Add company logo in Settings to include it on invoices.</span>}</div></div>
      <div><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}><strong>Line items</strong><button type="button" onClick={() => setItems((current) => [...current, emptyItem(Date.now())])} style={{ border: '1px solid var(--line)', borderRadius: 8, background: 'var(--paper)', color: 'var(--ink)', padding: '8px 12px', display: 'flex', gap: 6, cursor: 'pointer' }}><Plus size={16} /> Add item</button></div>
        <div style={{ display: 'grid', gap: 10 }}><div aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) 90px 120px 110px 44px', gap: 10, color: 'var(--muted)', fontSize: 12, fontWeight: 700 }}><span>Description</span><span>Qty</span><span>Rate</span><span style={{ textAlign: 'right' }}>Amount</span><span /></div>{items.map((item) => <div key={item.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) 90px 120px 110px 44px', gap: 10, alignItems: 'center' }}><input aria-label="Item description" style={inputStyle} value={item.description} onChange={(event) => updateItem(item.id, 'description', event.target.value)} placeholder="Description" /><input aria-label="Quantity" style={inputStyle} type="number" min="0" step="any" value={item.quantity} onChange={(event) => updateItem(item.id, 'quantity', event.target.value)} /><input aria-label="Rate" style={inputStyle} type="number" min="0" step="0.01" value={item.rate} onChange={(event) => updateItem(item.id, 'rate', event.target.value)} /><span style={{ textAlign: 'right', fontWeight: 700 }}>{money((Number(item.quantity) || 0) * (Number(item.rate) || 0))}</span><button aria-label="Remove item" type="button" disabled={items.length === 1} onClick={() => setItems((current) => current.filter(({ id }) => id !== item.id))} style={{ border: 0, background: 'transparent', color: 'var(--danger)', cursor: items.length === 1 ? 'not-allowed' : 'pointer' }}><Trash2 size={18} /></button></div>)}</div>
        <div style={{ textAlign: 'right', fontSize: 20, fontWeight: 700, marginTop: 18 }}>Total: {money(total)}</div>
      </div>
    </div>
  </section>;
}
