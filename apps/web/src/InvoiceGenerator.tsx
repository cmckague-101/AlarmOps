import { useMemo, useState } from 'react';
import { ArrowLeft, FileDown, Plus, Trash2 } from 'lucide-react';

type LineItem = { id: number; description: string; quantity: string; rate: string };

type InvoiceGeneratorProps = {
  companyLogoUrl?: string | null;
  onBack: () => void;
};

const emptyItem = (id: number): LineItem => ({ id, description: '', quantity: '1', rate: '0.00' });
const money = (value: number) => value.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char] ?? char);

export function InvoiceGenerator({ companyLogoUrl, onBack }: InvoiceGeneratorProps) {
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [billTo, setBillTo] = useState('');
  const [billFrom, setBillFrom] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const logo = companyLogoUrl ?? '';
  const [items, setItems] = useState<LineItem[]>([emptyItem(1)]);
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
    </style></head><body><div class="head"><div>${logo ? `<img class="logo" src="${escapeHtml(logo)}" />` : ''}</div><div class="title"><h1>INVOICE</h1><div># ${escapeHtml(invoiceNumber)}</div><div>${escapeHtml(invoiceDate)}</div></div></div><div class="parties"><div><div class="label">Bill from</div><div class="multiline">${escapeHtml(billFrom)}</div></div><div><div class="label">Bill to</div><div class="multiline">${escapeHtml(billTo)}</div></div></div><table><thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table><div class="total">Total: ${money(total)}</div><script>window.onload=()=>window.print()<\/script></body></html>`);
    popup.document.close();
  };

  const inputStyle = { width: '100%', boxSizing: 'border-box' as const, border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', font: 'inherit', background: 'var(--paper)', color: 'var(--ink)' };
  const labelStyle = { display: 'grid', gap: 6, color: 'var(--ink)', fontSize: 14, fontWeight: 600 };

  return <section style={{ maxWidth: 980, margin: '0 auto', padding: '24px', color: 'var(--ink)' }}>
    <button type="button" onClick={onBack} style={{ border: 0, background: 'transparent', color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 18 }}><ArrowLeft size={18} /> Back to invoices</button>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', marginBottom: 24, flexWrap: 'wrap' }}><div><h1 style={{ margin: 0 }}>Invoice Generator</h1><p style={{ color: 'var(--muted)', marginBottom: 0 }}>Create invoice and save it as PDF.</p></div><button type="button" onClick={generatePdf} style={{ border: 0, borderRadius: 8, padding: '11px 16px', background: 'var(--orange)', color: '#fff', fontWeight: 700, display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}><FileDown size={18} /> Generate PDF</button></div>
    <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 12, padding: 24, display: 'grid', gap: 22 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16 }}>
        <label style={labelStyle}>Invoice date<input style={inputStyle} type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} /></label>
        <label style={labelStyle}>Invoice number<input style={inputStyle} value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} placeholder="INV-001" /></label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 16 }}>
        <label style={labelStyle}>Bill from<textarea style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }} value={billFrom} onChange={(event) => setBillFrom(event.target.value)} placeholder={'Company name\nAddress\nEmail'} /></label>
        <label style={labelStyle}>Bill to<textarea style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }} value={billTo} onChange={(event) => setBillTo(event.target.value)} placeholder={'Customer name\nAddress\nEmail'} /></label>
      </div>
      <div style={labelStyle}>Company logo<div>{logo ? <img src={logo} alt="Company logo" style={{ width: 96, height: 64, objectFit: 'contain', border: '1px solid var(--line)', borderRadius: 8 }} /> : <span style={{ color: 'var(--muted)', fontWeight: 400 }}>Add company logo in Settings to include it on invoices.</span>}</div></div>
      <div><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}><strong>Line items</strong><button type="button" onClick={() => setItems((current) => [...current, emptyItem(Date.now())])} style={{ border: '1px solid var(--line)', borderRadius: 8, background: 'var(--paper)', color: 'var(--ink)', padding: '8px 12px', display: 'flex', gap: 6, cursor: 'pointer' }}><Plus size={16} /> Add item</button></div>
        <div style={{ display: 'grid', gap: 10 }}>{items.map((item) => <div key={item.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) 90px 120px 44px', gap: 10 }}><input aria-label="Item description" style={inputStyle} value={item.description} onChange={(event) => updateItem(item.id, 'description', event.target.value)} placeholder="Description" /><input aria-label="Quantity" style={inputStyle} type="number" min="0" step="any" value={item.quantity} onChange={(event) => updateItem(item.id, 'quantity', event.target.value)} /><input aria-label="Rate" style={inputStyle} type="number" min="0" step="0.01" value={item.rate} onChange={(event) => updateItem(item.id, 'rate', event.target.value)} /><button aria-label="Remove item" type="button" disabled={items.length === 1} onClick={() => setItems((current) => current.filter(({ id }) => id !== item.id))} style={{ border: 0, background: 'transparent', color: 'var(--danger)', cursor: items.length === 1 ? 'not-allowed' : 'pointer' }}><Trash2 size={18} /></button></div>)}</div>
        <div style={{ textAlign: 'right', fontSize: 20, fontWeight: 700, marginTop: 18 }}>Total: {money(total)}</div>
      </div>
    </div>
  </section>;
}
