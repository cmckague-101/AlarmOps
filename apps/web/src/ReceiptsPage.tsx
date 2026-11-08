import {DemoModeContext, FileInput, UploadButton} from './demo-uploads';
import { useCallback, useContext, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Download, ExternalLink, FileText, Pencil, ReceiptText, Trash2, Upload, X } from 'lucide-react';
import { collectReceiptExportEntries, formatCalendarDate, isCompanyManager, possibleDuplicateReceiptIds, receiptDate, receiptExportEntryName, receiptExportZipName, receiptSingleExportZipName, zipStore, type CrewMember, type FireOpsUser } from '@fireops/domain';
import { supabase } from './supabase';
import { createId } from './create-id';
import { fetchReceiptBytes, triggerBrowserDownload } from './receipt-export';

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
  purchased_on?: string | null;
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
  purchasedOn?: string;
};

type Timespan = '30-days' | 'this-year' | 'last-year' | 'all';

// '*' keeps reads working before and after the purchase-date migration is deployed.
const RECEIPT_COLUMNS = '*';
const todayIso = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; };

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
    purchasedOn: row.purchased_on ?? undefined,
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

function startFor(timespan: Timespan) {
  const now = new Date();
  if (timespan === '30-days') return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
  if (timespan === 'this-year') return new Date(now.getFullYear(), 0, 1);
  if (timespan === 'last-year') return new Date(now.getFullYear() - 1, 0, 1);
  return null;
}

export default function ReceiptsPage({ companyId, user, crew }: { companyId?: string; user: FireOpsUser; crew: CrewMember[] }) {
  const demoMode=useContext(DemoModeContext);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(Boolean(companyId));
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [purchasedOn, setPurchasedOn] = useState(todayIso);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [timespan, setTimespan] = useState<Timespan>('this-year');
  const [crewId, setCrewId] = useState('all');
  const [editingReceipt, setEditingReceipt] = useState<Receipt | null>(null);
  const [editName, setEditName] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editPurchasedOn, setEditPurchasedOn] = useState('');
  const [actionId, setActionId] = useState('');
  const [exporting, setExporting] = useState(false);
  const isOwner = isCompanyManager(user.role);
  const storageReady = Boolean(supabase && companyId && !demoMode);

  const load = useCallback(async () => {
    if (!companyId || !supabase) {
      setLoading(false);
      return;
    }
    setError('');
    const { data, error: loadError } = await supabase
      .from('company_receipts')
      .select(RECEIPT_COLUMNS)
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

  const duplicates = useMemo(() => possibleDuplicateReceiptIds(receipts), [receipts]);
  const visible = useMemo(() => {
    const start = startFor(timespan);
    const end = timespan === 'last-year' ? new Date(new Date().getFullYear(), 0, 1) : null;
    return receipts.filter((receipt) => {
      const [year, month, day] = receiptDate(receipt).split('-').map(Number);
      const purchased = new Date(year, month - 1, day);
      return (!isOwner || crewId === 'all' || receipt.uploadedBy === crewId)
        && (!start || purchased >= start)
        && (!end || purchased < end);
    }).sort((a, b) => receiptDate(b).localeCompare(receiptDate(a)) || b.createdAt.localeCompare(a.createdAt));
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
    const path = `${companyId}/${user.id}/${createId()}-${safeFileName(file.name)}`;
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
        ...(purchasedOn ? { purchased_on: purchasedOn } : {}),
      }).select(RECEIPT_COLUMNS).single<ReceiptRow>();
      if (insertError) {
        await supabase.storage.from(BUCKET).remove([path]);
        throw insertError;
      }
      setReceipts((current) => [fromRow(data), ...current.filter((receipt) => receipt.id !== data.id)]);
      setName('');
      setAmount('');
      setPurchasedOn(todayIso());
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

  const signedReceiptBytes = async (receipt: Receipt) => {
    if (!supabase) throw new Error('Receipt storage is unavailable in this build.');
    const { data, error: urlError } = await supabase.storage.from(BUCKET).createSignedUrl(receipt.storagePath, 5 * 60);
    if (urlError || !data?.signedUrl) throw new Error(urlError?.message ?? 'Receipt file could not be prepared.');
    return fetchReceiptBytes(data.signedUrl);
  };

  const downloadReceiptZip = async (receipt: Receipt) => {
    if (!storageReady || actionId || exporting) return;
    setActionId(receipt.id);
    setError('');
    try {
      const data = await signedReceiptBytes(receipt);
      const purchase = receiptDate(receipt);
      const zip = zipStore([{name: receiptExportEntryName(receipt, purchase), data}]);
      triggerBrowserDownload(zip, receiptSingleExportZipName(receipt, purchase));
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'Receipt could not be downloaded.');
    } finally {
      setActionId('');
    }
  };

  const exportVisibleZip = async () => {
    if (!storageReady || !visible.length || actionId || exporting) return;
    setExporting(true);
    setError('');
    try {
      const result = await collectReceiptExportEntries(visible, signedReceiptBytes);
      if (!result.entries.length) throw new Error(result.warning ?? 'No receipt files were available to export.');
      triggerBrowserDownload(zipStore(result.entries), receiptExportZipName());
      if (result.warning) setError(result.warning);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Receipts could not be exported.');
    } finally {
      setExporting(false);
    }
  };

  const beginEdit = (receipt: Receipt) => {
    setEditingReceipt(receipt);
    setEditName(receipt.name);
    setEditAmount((receipt.amountCents / 100).toFixed(2));
    setEditPurchasedOn(receiptDate(receipt));
    setError('');
  };

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    const amountCents = amountToCents(editAmount);
    if (!isOwner || !companyId || !supabase || !editingReceipt || !editName.trim() || amountCents === null || actionId) return;
    setActionId(editingReceipt.id);
    setError('');
    try {
      const { data, error: updateError } = await supabase.from('company_receipts')
        .update({ name: editName.trim(), amount_cents: amountCents, ...(editPurchasedOn && editPurchasedOn !== receiptDate(editingReceipt) ? { purchased_on: editPurchasedOn } : {}) })
        .eq('company_id', companyId)
        .eq('id', editingReceipt.id)
        .select(RECEIPT_COLUMNS)
        .single<ReceiptRow>();
      if (updateError) setError(`Receipt could not be updated. ${updateError.message}`);
      else {
        const updated = fromRow(data);
        setReceipts((current) => current.map((receipt) => receipt.id === updated.id ? updated : receipt));
        setEditingReceipt(null);
      }
    } catch (updateError) {
      setError(`Receipt could not be updated. ${updateError instanceof Error ? updateError.message : 'Network request failed.'}`);
    } finally {
      setActionId('');
    }
  };

  const removeReceipt = async (receipt: Receipt) => {
    if (!isOwner || !companyId || !supabase || actionId || !window.confirm(`Delete “${receipt.name}”? This action cannot be undone.`)) return;
    setActionId(receipt.id);
    setError('');
    try {
      const { error: deleteError } = await supabase.from('company_receipts').delete().eq('company_id', companyId).eq('id', receipt.id);
      if (deleteError) setError(`Receipt could not be deleted. ${deleteError.message}`);
      else {
        setReceipts((current) => current.filter((item) => item.id !== receipt.id));
        const { error: storageError } = await supabase.storage.from(BUCKET).remove([receipt.storagePath]);
        if (storageError) setError(`Receipt was deleted, but its file could not be removed. ${storageError.message}`);
      }
    } catch (deleteError) {
      setError(`Receipt could not be deleted. ${deleteError instanceof Error ? deleteError.message : 'Network request failed.'}`);
    } finally {
      setActionId('');
    }
  };

  const amountCents = amountToCents(amount);
  const filterCrew = crew.filter((member) => member.status === 'Active' || receipts.some((receipt) => receipt.uploadedBy === member.id));

  return <div className="page receipts-page">
    <div className="page-heading"><div><h1>{isOwner ? 'Receipts' : 'My receipts'}</h1>{!isOwner&&<p>Keep expense records ready for reimbursement and audits.</p>}</div></div>

    <section className="receipt-upload-card" aria-labelledby="add-receipt-heading">
      <div className="receipt-card-heading"><ReceiptText/><div><h2 id="add-receipt-heading">Add receipt</h2><p>Record the day the expense was paid.</p></div></div>
      <form className="receipt-form" onSubmit={submit}>
        <label><span>Name</span><input maxLength={160} placeholder="Fuel at Station 12" value={name} onChange={(event) => setName(event.target.value)} aria-invalid={attempted && !name.trim()}/>{attempted && !name.trim() && <small>Enter receipt name.</small>}</label>
        <label><span>Purchase date</span><input type="date" max={todayIso()} value={purchasedOn} onChange={(event) => setPurchasedOn(event.target.value)} required/></label>
        <label><span>Amount</span><div className="receipt-money-input"><b>$</b><input inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} aria-invalid={attempted && amountCents === null}/></div>{attempted && amountCents === null && <small>Enter valid amount.</small>}</label>
        <label className="receipt-file-field"><span>Receipt file</span><FileInput id="receipt-file" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.heic,.heif" onChange={(event) => setFile(event.target.files?.[0] ?? null)} aria-invalid={attempted && !file}/><em>{file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : 'JPG, PNG, WebP, HEIC, or PDF · 10 MB maximum'}</em>{attempted && !file && <small>Choose receipt file.</small>}</label>
        <UploadButton className="primary" disabled={saving || !companyId} type="submit"><Upload/>{saving ? 'Uploading…' : 'Upload receipt'}</UploadButton>
      </form>
      {!demoMode && !companyId && <p className="receipt-error" role="alert">Connect Supabase and select company before uploading receipts.</p>}
      {error && <p className="receipt-error" role="alert">{error}</p>}
    </section>

    <section className="receipt-list-card" aria-labelledby="receipt-list-heading">
      <div className="receipt-list-heading"><div><h2 id="receipt-list-heading">{isOwner ? 'Submitted receipts' : 'Receipt history'}</h2><p>{visible.length} {visible.length === 1 ? 'receipt' : 'receipts'} · {formatMoney(visible.reduce((total, receipt) => total + receipt.amountCents, 0))}</p></div>
        <div className="receipt-list-tools">
          {!!visible.length && <button type="button" className="secondary receipt-export" disabled={!storageReady || exporting || Boolean(actionId)} onClick={() => void exportVisibleZip()} title={storageReady ? 'Download a ZIP of the filtered original receipt files' : 'Receipt export needs a connected company workspace'}><Download/>{exporting ? 'Exporting…' : 'Export ZIP'}</button>}
          <div className="receipt-filters">
            {isOwner && <label><span>Crew member</span><select value={crewId} onChange={(event) => setCrewId(event.target.value)}><option value="all">All crew</option>{filterCrew.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>}
            <label><span>Timespan</span><select value={timespan} onChange={(event) => setTimespan(event.target.value as Timespan)}><option value="30-days">Last 30 days</option><option value="this-year">This year</option><option value="last-year">Last year</option><option value="all">All time</option></select></label>
          </div>
        </div>
      </div>
      {demoMode && !!visible.length && <p className="receipt-state">Demo mode keeps sample receipts on-screen only. Connect a company workspace to download or export files.</p>}
      {loading && <p className="receipt-state">Loading receipts…</p>}
      {!loading && !error && !visible.length && <div className="receipt-empty"><FileText/><h3>No receipts found</h3><p>{receipts.length ? 'Change filters to see more receipts.' : 'Uploaded receipts will appear here.'}</p></div>}
      {!!visible.length && <div className="receipt-table-wrap"><table className="receipt-table"><thead><tr><th>Name</th>{isOwner && <th>Crew member</th>}<th className="receipt-date">Date</th><th className="receipt-amount">Amount</th><th><span className="sr-only">File</span></th>{isOwner && <th><span className="sr-only">Actions</span></th>}</tr></thead><tbody>{visible.map((receipt) => <tr key={receipt.id}><td><b>{receipt.name}</b>{duplicates.has(receipt.id) ? <small className="receipt-duplicate" title="Same amount, uploader and day as another receipt">Possible duplicate</small> : <small>{receipt.fileName}</small>}</td>{isOwner && <td>{receipt.uploadedByName}</td>}<td className="receipt-date">{formatCalendarDate(receiptDate(receipt))}</td><td className="receipt-amount"><b>{formatMoney(receipt.amountCents)}</b></td><td><div className="receipt-file-actions"><button className="receipt-open" type="button" disabled={Boolean(actionId) || exporting} onClick={() => void openReceipt(receipt)} aria-label={`Open ${receipt.name}`}><ExternalLink/>View</button><button className="receipt-open" type="button" disabled={!storageReady || Boolean(actionId) || exporting} onClick={() => void downloadReceiptZip(receipt)} aria-label={`Download ZIP for ${receipt.name}`}><Download/>{actionId === receipt.id ? '…' : 'ZIP'}</button></div></td>{isOwner && <td><div className="receipt-actions"><button type="button" disabled={Boolean(actionId) || exporting} onClick={() => beginEdit(receipt)} aria-label={`Edit ${receipt.name}`}><Pencil/></button><button className="delete" type="button" disabled={Boolean(actionId) || exporting} onClick={() => void removeReceipt(receipt)} aria-label={`Delete ${receipt.name}`}><Trash2/></button></div></td>}</tr>)}</tbody></table></div>}
    </section>

    {editingReceipt && <div className="receipt-edit-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !actionId) setEditingReceipt(null); }}><section className="receipt-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-receipt-heading"><header><div><h2 id="edit-receipt-heading">Edit receipt</h2><p>{editingReceipt.fileName}</p></div><button type="button" disabled={Boolean(actionId)} onClick={() => setEditingReceipt(null)} aria-label="Close edit receipt"><X/></button></header><form onSubmit={(event) => void saveEdit(event)}><label><span>Name</span><input autoFocus maxLength={160} value={editName} onChange={(event) => setEditName(event.target.value)}/></label><label><span>Amount</span><div className="receipt-money-input"><b>$</b><input inputMode="decimal" value={editAmount} onChange={(event) => setEditAmount(event.target.value)}/></div></label><label><span>Purchase date</span><input type="date" max={todayIso()} value={editPurchasedOn} onChange={(event) => setEditPurchasedOn(event.target.value)}/></label>{error && <p className="receipt-error" role="alert">{error}</p>}<footer><button className="secondary" type="button" disabled={Boolean(actionId)} onClick={() => setEditingReceipt(null)}>Cancel</button><button className="primary" type="submit" disabled={Boolean(actionId) || !editName.trim() || amountToCents(editAmount) === null}><Pencil/>{actionId ? 'Saving…' : 'Save changes'}</button></footer></form></section></div>}
  </div>;
}
