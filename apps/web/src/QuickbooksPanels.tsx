import { useCallback, useEffect, useState } from 'react';
import { Check, Link2, RefreshCw, Search, Unlink } from 'lucide-react';
import { qboInvoiceAction, qboStatusLabel, type InvoiceCustomer, type InvoiceForm, type QboSyncMode, type QboSyncStatus } from '@fireops/domain';
import { loadQuickbooksMappings, quickbooks, type QboCustomer, type QboInvoiceResult, type QboMapping, type QboOptions, type QboRef, type QboSettings, type QboStatus } from './quickbooks';
import { supabase } from './supabase';
import './QuickbooksPanels.css';

const errorText = (failure: unknown, fallback: string) => failure instanceof Error ? failure.message : fallback;

export function QboStatusBadge({ status }: { status: QboSyncStatus | undefined }) {
  const value = status ?? 'not_synced';
  return <i className={`qbo-badge ${value}`}>{qboStatusLabel(value)}</i>;
}

/** Search QuickBooks customers and remember the match for one FireOps customer. */
export function QuickbooksCustomerPicker({ companyId, customerId, customerName, mapping, onMapped }: { companyId: string; customerId: string; customerName: string; mapping: QboMapping | null; onMapped: (mapping: QboMapping | null) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(customerName);
  const [results, setResults] = useState<QboCustomer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const search = async (event?: React.FormEvent) => {
    event?.preventDefault(); setBusy(true); setError('');
    try { setResults((await quickbooks.searchCustomers(companyId, query)).customers); }
    catch (failure) { setError(errorText(failure, 'QuickBooks customers could not load.')); }
    finally { setBusy(false); }
  };
  const choose = async (customer: QboCustomer) => {
    setBusy(true); setError('');
    try {
      const { mapping: saved } = await quickbooks.mapCustomer(companyId, customerId, customer.id);
      onMapped({ customer_id: customerId, qbo_customer_id: saved.qboCustomerId, qbo_customer_name: saved.qboCustomerName });
      setOpen(false); setResults(null);
    } catch (failure) { setError(errorText(failure, 'Customer match could not be saved.')); }
    finally { setBusy(false); }
  };
  const unmap = async () => {
    if (!window.confirm(`Stop matching “${customerName}” to “${mapping?.qbo_customer_name}”? Invoices already in QuickBooks are not changed.`)) return;
    setBusy(true); setError('');
    try { await quickbooks.unmapCustomer(companyId, customerId); onMapped(null); }
    catch (failure) { setError(errorText(failure, 'Customer match could not be removed.')); }
    finally { setBusy(false); }
  };
  return <div className="qbo-customer">
    <div className="qbo-customer-row">
      <span className="qbo-customer-name"><b>{customerName}</b>{mapping ? <small><Link2 /> {mapping.qbo_customer_name}</small> : <small className="qbo-unmatched">Not matched to QuickBooks</small>}</span>
      <span className="qbo-customer-actions">
        <button type="button" className="secondary" disabled={busy} onClick={() => { setOpen(!open); setQuery(customerName); setResults(null); }}>{open ? 'Cancel' : mapping ? 'Change' : 'Match'}</button>
        {mapping && !open && <button type="button" className="qbo-icon-button" disabled={busy} aria-label={`Remove QuickBooks match for ${customerName}`} onClick={() => void unmap()}><Unlink /></button>}
      </span>
    </div>
    {open && <form className="qbo-search" onSubmit={event => void search(event)} role="search" aria-label={`Find a QuickBooks customer for ${customerName}`}>
      <div className="qbo-search-input"><Search /><input autoFocus value={query} maxLength={100} placeholder="Search QuickBooks customers" onChange={event => setQuery(event.target.value)} /></div>
      <button className="primary" disabled={busy}>{busy && !results ? 'Searching…' : 'Search'}</button>
    </form>}
    {open && results && (results.length ? <ul className="qbo-results">{results.map(item => <li key={item.id}><button type="button" disabled={busy} onClick={() => void choose(item)}><b>{item.name}</b>{(item.companyName || item.email) && <small>{[item.companyName, item.email].filter(Boolean).join(' · ')}</small>}</button></li>)}</ul> : <p className="qbo-help">No active QuickBooks customers match. FireOps does not create QuickBooks customers; add the customer in QuickBooks, then search again.</p>)}
    {error && <p className="integration-error" role="alert">{error}</p>}
  </div>;
}

function RefSelect({ label, value, options, onChange, optional, help }: { label: string; value: QboRef | null; options: QboRef[]; onChange: (value: QboRef | null) => void; optional?: string; help?: string }) {
  const list = value && !options.some(item => item.id === value.id) ? [value, ...options] : options;
  return <label className="qbo-field"><span>{label}</span>
    <select value={value?.id ?? ''} onChange={event => onChange(list.find(item => item.id === event.target.value) ?? null)}>
      <option value="">{optional ?? 'Choose…'}</option>
      {list.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>{help && <small>{help}</small>}</label>;
}

/** Settings > QuickBooks Online: owner connects and sets defaults; owners and accounting match customers. */
export function QuickbooksSettings({ companyId, finance }: { companyId: string; finance: boolean }) {
  const params = new URLSearchParams(window.location.search);
  const [status, setStatus] = useState<QboStatus | null>(null);
  const [error, setError] = useState(params.get('quickbooks_error') ?? '');
  const [notice, setNotice] = useState(params.get('quickbooks') === 'connected' ? 'QuickBooks connected. Choose the Product/Service for invoices below.' : '');
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<QboOptions | null>(null);
  const [draft, setDraft] = useState<Omit<QboSettings, 'qboCompanyName'> | null>(null);
  const [customers, setCustomers] = useState<InvoiceCustomer[]>([]);
  const [mappings, setMappings] = useState<QboMapping[]>([]);
  const [filter, setFilter] = useState('');
  const load = useCallback(async () => {
    try {
      const next = await quickbooks.status(companyId);
      setStatus(next);
      if (next.settings) setDraft({ ...next.settings });
      if (next.connected && supabase) {
        const [{ data }, matched] = await Promise.all([supabase.from('invoice_customers').select('id,company_id,name,created_at,updated_at').eq('company_id', companyId).order('name'), loadQuickbooksMappings(companyId)]);
        setCustomers((data ?? []).map(row => ({ id: row.id, companyId: row.company_id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at })));
        setMappings(matched);
      }
    } catch (failure) {
      // Not on the plan (403) or not allowed: hide the section.
      setStatus({ enabled: false, connected: false, settings: null, canManage: false });
      if (!/plan|access required/i.test(errorText(failure, ''))) setError(errorText(failure, 'QuickBooks status could not load.'));
    }
  }, [companyId]);
  useEffect(() => { if (finance) void load(); }, [finance, load]);
  useEffect(() => {
    if (!params.has('quickbooks')) return;
    const url = new URL(window.location.href); url.searchParams.delete('quickbooks'); url.searchParams.delete('quickbooks_error');
    window.history.replaceState(null, '', url.toString());
  }, []);
  useEffect(() => {
    if (!status?.connected || !status.canManage || options) return;
    void quickbooks.options(companyId).then(setOptions).catch(failure => setError(errorText(failure, 'QuickBooks lists could not load.')));
  }, [companyId, options, status?.canManage, status?.connected]);
  if (!finance || !status?.enabled) return error ? <p className="integration-error" role="alert">{error}</p> : null;

  const connect = async () => {
    setBusy(true); setError('');
    try {
      const url = new URL(window.location.href); url.search = ''; url.hash = '';
      window.location.assign((await quickbooks.connect(companyId, url.toString())).authorizationUrl);
    } catch (failure) { setError(errorText(failure, 'QuickBooks authorization could not start.')); setBusy(false); }
  };
  const disconnect = async () => {
    if (!window.confirm('Disconnect QuickBooks? Syncing stops until the owner connects again. Invoices already in QuickBooks are not changed.')) return;
    setBusy(true); setError(''); setNotice('');
    try { await quickbooks.disconnect(companyId); setOptions(null); await load(); }
    catch (failure) { setError(errorText(failure, 'QuickBooks could not be disconnected.')); }
    finally { setBusy(false); }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!draft) return;
    setBusy(true); setError(''); setNotice('');
    try { const { settings } = await quickbooks.saveSettings(companyId, draft); setStatus({ ...status, settings }); setDraft({ ...settings }); setNotice('QuickBooks settings saved.'); }
    catch (failure) { setError(errorText(failure, 'QuickBooks settings could not be saved.')); }
    finally { setBusy(false); }
  };
  const set = <K extends keyof Omit<QboSettings, 'qboCompanyName'>>(key: K, value: QboSettings[K]) => { if (draft) setDraft({ ...draft, [key]: value }); setNotice(''); };
  const shown = customers.filter(item => item.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const unmatched = customers.filter(item => !mappings.some(mapping => mapping.customer_id === item.id)).length;

  return <section className="integration-panel qbo-panel" aria-labelledby="qbo-heading">
    <header><span className="integration-mark"><RefreshCw /></span><div><h2 id="qbo-heading">QuickBooks Online</h2><p>Send submitted invoices to QuickBooks and keep paid status in step.</p></div>{status.environment === 'sandbox' && <span className="demo-indicator">Sandbox</span>}<span className={`connection-state ${status.connected ? 'connected' : ''}`}><i />{status.connected ? 'Connected' : 'Not connected'}</span></header>
    <div className="qbo-body">
      {status.connected ? <p className="qbo-help">Connected to <b>{status.settings?.qboCompanyName ?? 'QuickBooks'}</b>{status.connectedAt ? ` since ${new Date(status.connectedAt).toLocaleDateString()}` : ''}.</p>
        : <p className="qbo-help">{status.canManage ? 'Connect your QuickBooks Online company. You sign in at Intuit; FireOps never sees your QuickBooks password.' : 'The company owner can connect QuickBooks Online here.'}</p>}
      {status.canManage && <div className="qbo-actions">{status.connected ? <button type="button" className="integration-disconnect" disabled={busy} onClick={() => void disconnect()}>Disconnect QuickBooks</button> : <button type="button" className="primary" disabled={busy} onClick={() => void connect()}>{busy ? 'Opening Intuit…' : 'Connect QuickBooks Online'}</button>}</div>}
      {error && <p className="integration-error" role="alert">{error}</p>}
      {notice && <p className="integration-success" role="status"><Check /> {notice}</p>}

      {status.connected && status.canManage && draft && <form className="qbo-settings" onSubmit={event => void save(event)} aria-label="QuickBooks settings">
        <h3>Invoices</h3>
        <fieldset className="qbo-mode"><legend>When to send invoices</legend>
          {([['manual', 'Manual', 'Owners and accounting press Sync to QuickBooks on each invoice.'], ['on_submit', 'Automatically on submit', 'Each invoice is sent when it is submitted.']] as [QboSyncMode, string, string][]).map(([value, label, help]) =>
            <label key={value}><input type="radio" name="qbo-sync-mode" checked={draft.syncMode === value} onChange={() => set('syncMode', value)} /><span><b>{label}</b><small>{help}</small></span></label>)}
        </fieldset>
        {!options ? <p className="qbo-help">Loading QuickBooks lists…</p> : <div className="qbo-grid">
          <RefSelect label="Product/Service for the invoice line" value={draft.item} options={options.items} onChange={value => set('item', value)} help="Each invoice is one line for its total, on this item." />
          <RefSelect label="Tax code" value={draft.taxCode} options={options.taxCodes} optional="None" onChange={value => set('taxCode', value)} />
          <RefSelect label="Terms" value={draft.terms} options={options.terms} optional="None (use the FireOps due date)" onChange={value => set('terms', value)} />
          <RefSelect label="Class" value={draft.class} options={options.classes} optional="None" onChange={value => set('class', value)} />
          <RefSelect label="Location" value={draft.department} options={options.departments} optional="None" onChange={value => set('department', value)} />
        </div>}
        <h3>Payments marked paid in FireOps</h3>
        {options && <div className="qbo-grid">
          <RefSelect label="Deposit to" value={draft.depositAccount} options={options.depositAccounts} optional="Undeposited Funds (default)" onChange={value => set('depositAccount', value)} />
          <RefSelect label="Payment method" value={draft.paymentMethod} options={options.paymentMethods} optional="None" onChange={value => set('paymentMethod', value)} />
        </div>}
        <footer><button className="primary" disabled={busy || !options || !draft.item}>{busy ? 'Saving…' : 'Save QuickBooks settings'}</button></footer>
      </form>}

      {status.connected && <div className="qbo-mapping">
        <h3>Customers</h3>
        <p className="qbo-help">Match each FireOps customer to a QuickBooks customer once. Invoices for an unmatched customer show Needs attention.{unmatched ? ` ${unmatched} not matched yet.` : ''}</p>
        {customers.length > 8 && <input className="qbo-filter" value={filter} placeholder="Filter customers" aria-label="Filter FireOps customers" onChange={event => setFilter(event.target.value)} />}
        {!customers.length ? <p className="qbo-help">No FireOps customers yet.</p> : shown.map(item => <QuickbooksCustomerPicker key={item.id} companyId={companyId} customerId={item.id} customerName={item.name} mapping={mappings.find(mapping => mapping.customer_id === item.id) ?? null}
          onMapped={mapping => setMappings(current => [...current.filter(entry => entry.customer_id !== item.id), ...(mapping ? [mapping] : [])])} />)}
      </div>}
    </div>
  </section>;
}

/** Invoice detail: QuickBooks status with Sync / Push update, and the customer match when it is missing. */
export function QuickbooksInvoicePanel({ companyId, form, customer, onResult }: { companyId: string; form: InvoiceForm; customer: InvoiceCustomer | undefined; onResult: (result: QboInvoiceResult) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mapping, setMapping] = useState<QboMapping | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    setMapping(undefined);
    if (customer) void loadQuickbooksMappings(companyId).then(rows => { if (active) setMapping(rows.find(row => row.customer_id === customer.id) ?? null); }).catch(() => { if (active) setMapping(undefined); });
    return () => { active = false; };
  }, [companyId, customer?.id]);
  const action = qboInvoiceAction(form);
  const run = async () => {
    if (!action) return;
    setBusy(true); setError('');
    try {
      const result = await quickbooks.syncInvoice(companyId, form.id, action);
      onResult(result.invoice);
      if (result.error) setError(result.error);
    } catch (failure) { setError(errorText(failure, 'QuickBooks sync failed.')); }
    finally { setBusy(false); }
  };
  const message = error || form.qboLastError || '';
  return <section className="qbo-invoice" aria-label="QuickBooks">
    <div className="qbo-invoice-head"><span><b>QuickBooks</b><QboStatusBadge status={form.qboSyncStatus} /></span>
      {action && <button type="button" className="secondary" disabled={busy} onClick={() => void run()}><RefreshCw />{busy ? 'Sending…' : action === 'sync' ? 'Sync to QuickBooks' : 'Push update to QuickBooks'}</button>}</div>
    {form.qboSyncedAt && <small className="qbo-help">Last sent {new Date(form.qboSyncedAt).toLocaleString()}</small>}
    {form.qboSyncStatus === 'out_of_sync' && <small className="qbo-help">Changed in FireOps after it was sent. Push the update to QuickBooks.</small>}
    {form.qboPaymentPending && <small className="qbo-help">The payment is waiting to be recorded in QuickBooks.</small>}
    {message && <p className={form.qboSyncStatus === 'needs_attention' || error ? 'integration-error' : 'qbo-help'} role={error ? 'alert' : undefined}>{message}</p>}
    {customer && mapping === null && form.status !== 'paid' && <QuickbooksCustomerPicker companyId={companyId} customerId={customer.id} customerName={customer.name} mapping={null} onMapped={setMapping} />}
  </section>;
}
