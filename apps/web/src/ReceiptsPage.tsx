import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ExternalLink, FileText, ReceiptText, Upload } from 'lucide-react';
import type { CrewMember, FireOpsUser } from '@fireops/domain';
import { supabase } from './supabase';

const BUCKET = 'receipt-files';
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

type ReceiptRow = {
  id: string;
  name: string;
  amount_cents: number;
  original_file_name: string;
  mime_type: string;
  byte_size: number;
  storage_path: string;
  uploaded_by: string;
  uploaded_by_name: string;
  created_at: string;
};

type Receipt = {
  id: string;
  name: string;
  amountCents: number;
  fileName: string;
  mimeType: string;
  byteSize: number;
  storagePath: string;
  uploadedBy: string;
  uploadedByName: string;
  createdAt: string;
};

type Timespan = '30-days' | 'this-year' | 'last-year' | 'all';

function fromRow(row: ReceiptRow): Receipt {
  return {
    id: row.id,
    name: row.name,
    amountCents: Number(row.amount_cents),
    fileName: row.original_file_name,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    storagePath: row.storage_path,
    uploadedBy: row.uploaded_by,
    uploadedByName: row.uploaded_by_name,
    createdAt: row.created_at,
  };
}

function safeFileName(name: string) {
  return name.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'receipt';
}

function effectiveMimeType(file: File) {
  if (file.type) return file.type;
  if (/\.pdf$/i.test(file.name)) return 'application/pdf';
  if (/\.hei[cf]$/i.test(file.name)) return 'image/heic';
  if (/\.png$/i.test(file.name)) return 'image/png';
  if (/\.webp$/i.test(file.name)) return 'image/webp';
  return 'image/jpeg';
}

function amountToCents(value: string) {
  const normalized = value.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [dollars, cents = ''] = normalized.split('.');
  const result = Number(dollars) * 100 + Number(cents.padEnd(2, '0'));
  return Number.isSafeInteger(result) && result > 0 && result <= 100000000 ? result : null;
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

function startFor(timespan: Timespan) {
  const now = new Date();
  if (timespan === '30-days') return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
  if (timespan === 'this-year') return new Date(now.getFullYear(), 0, 1);
  if (timespan === 'last-year') return new Date(now.getFullYear() - 1, 0, 1);
  return null;
}

export default function ReceiptsPage({ companyId, user, crew }: { companyId?: string; user: FireOpsUser; crew: CrewMember[] }) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(Boolean(companyId));
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [timespan, setTimespan] = useState<Timespan>('this-year');
  const [crewId, setCrewId] = useState('all');
  const isOwner = user.role === 'owner';

  const load = useCallback(async () => {
    if (!companyId || !supabase) {
      setLoading(false);
      return;
    }
    setError('');
    const { data, error: loadError } = await supabase
      .from('company_receipts')
      .select('id,name,amount_cents,original_file_name,mime_type,byte_size,storage_path,uploaded_by,uploaded_by_name,created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });
    if (loadError) setError(`Receipts could not load. ${loadError.message}`);
    else setReceipts(((data ?? []) as ReceiptRow[]).map(fromRow));
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    void load();
    if (!companyId || !supabase) return;
    const client = supabase;
    const channel = client.channel(`web-receipts:${companyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'company_receipts', filter: `company_id=eq.${companyId}` }, () => void load())
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [companyId, load]);

  const visible = useMemo(() => {
    const start = startFor(timespan);
    const end = timespan === 'last-year' ? new Date(new Date().getFullYear(), 0, 1) : null;
    return receipts.filter((receipt) => {
      const created = new Date(receipt.createdAt);
      return (!isOwner || crewId === 'all' || receipt.uploadedBy === crewId)
        && (!start || created >= start)
        && (!end || created < end);
    });
  }, [crewId, isOwner, receipts, timespan]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    const amountCents = amountToCents(amount);
    if (!companyId || !supabase || !name.trim() || amountCents === null || !file || saving) return;
    const mimeType = effectiveMimeType(file);
    if (file.size > MAX_FILE_SIZE) { setError('Receipt must be 10 MB or smaller.'); return; }
    if (!ACCEPTED_TYPES.includes(mimeType)) { setError('Choose a JPG, PNG, WebP, HEIC, or PDF receipt.'); return; }

    setSaving(true);
    setError('');
    const path = `${companyId}/${user.id}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    try {
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: mimeType, upsert: false });
      if (uploadError) throw uploadError;
      const { data, error: insertError } = await supabase.from('company_receipts').insert({
        company_id: companyId,
        name: name.trim(),
        amount_cents: amountCents,
        original_file_name: file.name,
        mime_type: mimeType,
        byte_size: file.size,
        storage_path: path,
        uploaded_by: user.id,
        uploaded_by_name: user.name,
      }).select('id,name,amount_cents,original_file_name,mime_type,byte_size,storage_path,uploaded_by,uploaded_by_name,created_at').single<ReceiptRow>();
      if (insertError) {
        await supabase.storage.from(BUCKET).remove([path]);
        throw insertError;
      }
      setReceipts((current) => [fromRow(data), ...current.filter((receipt) => receipt.id !== data.id)]);
      setName('');
      setAmount('');
      setFile(null);
      setAttempted(false);
      const input = document.getElementById('receipt-file') as HTMLInputElement | null;
      if (input) input.value = '';
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Receipt could not be uploaded.');
    } finally {
      setSaving(false);
    }
  };

  const openReceipt = async (receipt: Receipt) => {
    if (!supabase) return;
    setError('');
    const { data, error: urlError } = await supabase.storage.from(BUCKET).createSignedUrl(receipt.storagePath, 60 * 60);
    if (urlError) { setError(`Receipt could not be opened. ${urlError.message}`); return; }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const amountCents = amountToCents(amount);
  const filterCrew = crew.filter((member) => member.status === 'Active' || receipts.some((receipt) => receipt.uploadedBy === member.id));

  return <div className="page receipts-page">
    <div className="page-heading"><div><h1>{isOwner ? 'Receipts' : 'My receipts'}</h1><p>{isOwner ? 'Review expense receipts submitted by crew.' : 'Keep expense records ready for reimbursement and audits.'}</p></div></div>

    <section className="receipt-upload-card" aria-labelledby="add-receipt-heading">
      <div className="receipt-card-heading"><ReceiptText/><div><h2 id="add-receipt-heading">Add receipt</h2><p>Upload date will be recorded as {formatDate(new Date().toISOString())}.</p></div></div>
      <form className="receipt-form" onSubmit={submit}>
        <label><span>Name</span><input maxLength={160} placeholder="Fuel at Station 12" value={name} onChange={(event) => setName(event.target.value)} aria-invalid={attempted && !name.trim()}/>{attempted && !name.trim() && <small>Enter receipt name.</small>}</label>
        <label><span>Amount</span><div className="receipt-money-input"><b>$</b><input inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} aria-invalid={attempted && amountCents === null}/></div>{attempted && amountCents === null && <small>Enter valid amount.</small>}</label>
        <label className="receipt-file-field"><span>Receipt file</span><input id="receipt-file" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.heic,.heif" onChange={(event) => setFile(event.target.files?.[0] ?? null)} aria-invalid={attempted && !file}/><em>{file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : 'JPG, PNG, WebP, HEIC, or PDF · 10 MB maximum'}</em>{attempted && !file && <small>Choose receipt file.</small>}</label>
        <button className="primary" disabled={saving || !companyId} type="submit"><Upload/>{saving ? 'Uploading…' : 'Upload receipt'}</button>
      </form>
      {!companyId && <p className="receipt-error" role="alert">Connect Supabase and select company before uploading receipts.</p>}
      {error && <p className="receipt-error" role="alert">{error}</p>}
    </section>

    <section className="receipt-list-card" aria-labelledby="receipt-list-heading">
      <div className="receipt-list-heading"><div><h2 id="receipt-list-heading">{isOwner ? 'Submitted receipts' : 'Receipt history'}</h2><p>{visible.length} {visible.length === 1 ? 'receipt' : 'receipts'} · {formatMoney(visible.reduce((total, receipt) => total + receipt.amountCents, 0))}</p></div>
        <div className="receipt-filters">
          {isOwner && <label><span>Crew member</span><select value={crewId} onChange={(event) => setCrewId(event.target.value)}><option value="all">All crew</option>{filterCrew.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>}
          <label><span>Timespan</span><select value={timespan} onChange={(event) => setTimespan(event.target.value as Timespan)}><option value="30-days">Last 30 days</option><option value="this-year">This year</option><option value="last-year">Last year</option><option value="all">All time</option></select></label>
        </div>
      </div>
      {loading && <p className="receipt-state">Loading receipts…</p>}
      {!loading && !error && !visible.length && <div className="receipt-empty"><FileText/><h3>No receipts found</h3><p>{receipts.length ? 'Change filters to see more receipts.' : 'Uploaded receipts will appear here.'}</p></div>}
      {!!visible.length && <div className="receipt-table-wrap"><table className="receipt-table"><thead><tr><th>Name</th>{isOwner && <th>Crew member</th>}<th>Date</th><th className="receipt-amount">Amount</th><th><span className="sr-only">File</span></th></tr></thead><tbody>{visible.map((receipt) => <tr key={receipt.id}><td><b>{receipt.name}</b><small>{receipt.fileName}</small></td>{isOwner && <td>{receipt.uploadedByName}</td>}<td>{formatDate(receipt.createdAt)}</td><td className="receipt-amount"><b>{formatMoney(receipt.amountCents)}</b></td><td><button className="receipt-open" onClick={() => void openReceipt(receipt)} aria-label={`Open ${receipt.name}`}><ExternalLink/>View</button></td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
