import {DemoModeContext, FileInput, UploadButton} from './demo-uploads';
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Camera, Check, Download, ExternalLink, FileText, Pencil, Plus, ReceiptText, Search, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { MAX_RECEIPT_BATCH, MAX_RECEIPT_PROJECT_LENGTH, applyReceiptAutofill, collectReceiptExportEntries, failReceiptAutofill, formatCalendarDate, isCompanyManager, matchesReceiptFilter, newReceiptDraft, normalizeReceiptProject, possibleDuplicateReceiptIds, receiptAmountToCents, receiptDate, receiptDraftProblems, receiptDraftReady, receiptExportEntryName, receiptExportZipName, receiptProjects, receiptSingleExportZipName, zipStore, type CrewMember, type FireOpsUser, type ReceiptDraft } from '@fireops/domain';
import { supabase } from './supabase';
import { createId } from './create-id';
import { fetchReceiptBytes, triggerBrowserDownload } from './receipt-export';
import { autofillImage, loadReceiptAutofillEnabled, requestReceiptAutofill } from './receipt-autofill';

const BUCKET = 'receipt-files';
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
const ACCEPT_ATTR = 'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.heic,.heif';
/** Auto-fill requests running at once for one batch. */
const AUTOFILL_CONCURRENCY = 3;

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
  project?: string | null;
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
  project?: string;
};

/** A staged receipt: editable details plus the file it will upload. */
type PhotoCard = ReceiptDraft & { file: File; mimeType: string; previewUrl: string; uploadError?: string };

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
    project: row.project ?? undefined,
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

/** Receipt photos the FireOps Assistant handed over; added to the batch once per id for the user to check and submit. */
export type AssistantReceiptRequest = { id: number; files: File[] };

export default function ReceiptsPage({ companyId, user, crew, assistantRequest, onAssistantRequestDone, onBack }: { companyId?: string; user: FireOpsUser; crew: CrewMember[]; assistantRequest?: AssistantReceiptRequest | null; onAssistantRequestDone?: () => void; onBack?: () => void }) {
  const demoMode=useContext(DemoModeContext);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(Boolean(companyId));
  const [error, setError] = useState('');
  const cameraRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState('');
  const [cards, setCards] = useState<PhotoCard[]>([]);
  const [batchNotice, setBatchNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [autofillEnabled, setAutofillEnabled] = useState(false);
  const [autofillChecked, setAutofillChecked] = useState(false);
  const [timespan, setTimespan] = useState<Timespan>('this-year');
  const [crewId, setCrewId] = useState('all');
  const [projectFilter, setProjectFilter] = useState('');
  const [query, setQuery] = useState('');
  const [editingReceipt, setEditingReceipt] = useState<Receipt | null>(null);
  const [editName, setEditName] = useState('');
  const [editProject, setEditProject] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editPurchasedOn, setEditPurchasedOn] = useState('');
  const [actionId, setActionId] = useState('');
  const [exporting, setExporting] = useState(false);
  const isOwner = isCompanyManager(user.role);
  const storageReady = Boolean(supabase && companyId && !demoMode);
  const uploadsEnabled = Boolean(supabase && companyId && !demoMode);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const autofillQueue = useRef<string[]>([]);
  const autofillRunning = useRef(0);

  useEffect(() => {
    let active = true;
    setAutofillEnabled(false);
    setAutofillChecked(!companyId || demoMode);
    if (companyId && !demoMode) void loadReceiptAutofillEnabled(companyId).then((enabled) => { if (active) { setAutofillEnabled(enabled); setAutofillChecked(true); } });
    return () => { active = false; };
  }, [companyId, demoMode]);

  // Previews are object URLs; release whatever is still staged when leaving the page.
  useEffect(() => () => { cardsRef.current.forEach((card) => URL.revokeObjectURL(card.previewUrl)); }, []);

  const updateCard = useCallback((key: string, update: (card: PhotoCard) => PhotoCard) => {
    setCards((current) => current.map((card) => card.key === key ? update(card) : card));
  }, []);

  const pumpAutofill = useCallback(() => {
    while (companyId && autofillRunning.current < AUTOFILL_CONCURRENCY && autofillQueue.current.length) {
      const key = autofillQueue.current.shift()!;
      const card = cardsRef.current.find((item) => item.key === key);
      if (!card) continue;
      autofillRunning.current += 1;
      void (async () => {
        try {
          const photo = await autofillImage(card.file, card.mimeType);
          if (!photo) { updateCard(key, (current) => failReceiptAutofill(current, 'Auto-fill reads JPG, PNG and WebP photos. Enter the details.')); return; }
          const result = await requestReceiptAutofill(companyId, photo);
          updateCard(key, (current) => applyReceiptAutofill(current, result, todayIso()));
        } catch (autofillError) {
          updateCard(key, (current) => failReceiptAutofill(current, autofillError instanceof Error ? autofillError.message : 'Auto-fill could not read this photo. Enter the details.'));
        } finally {
          autofillRunning.current -= 1;
          pumpAutofill();
        }
      })();
    }
  }, [companyId, updateCard]);

  const queueAutofill = useCallback((keys: string[]) => {
    autofillQueue.current.push(...keys);
    pumpAutofill();
  }, [pumpAutofill]);

  const appendFiles = (files: FileList | File[] | null) => {
    if (!files?.length) return;
    const room = MAX_RECEIPT_BATCH - cardsRef.current.length;
    const rejected: string[] = [];
    const created: PhotoCard[] = [];
    for (const file of Array.from(files)) {
      const mimeType = effectiveMimeType(file);
      if (!ACCEPTED_TYPES.includes(mimeType)) { rejected.push(`“${file.name}” is not a JPG, PNG, WebP, HEIC, or PDF.`); continue; }
      if (file.size <= 0 || file.size > MAX_FILE_SIZE) { rejected.push(`“${file.name}” is larger than 10 MB.`); continue; }
      if (created.length >= room) { rejected.push(`Up to ${MAX_RECEIPT_BATCH} receipts per batch. Submit these first, then add the rest.`); break; }
      const image = mimeType.startsWith('image/');
      created.push({ ...newReceiptDraft(createId(), todayIso(), autofillEnabled && image), file, mimeType, previewUrl: image ? URL.createObjectURL(file) : '' });
    }
    setBatchNotice(rejected.join(' '));
    if (!created.length) return;
    cardsRef.current = [...cardsRef.current, ...created];
    setCards(cardsRef.current);
    queueAutofill(created.filter((card) => card.status === 'reading').map((card) => card.key));
  };

  // From the assistant: add its photos once we know whether auto-fill is on, so they are read like any other upload.
  const handledAssistant = useRef<number | null>(null);
  useEffect(() => {
    if (!assistantRequest || !autofillChecked || !uploadsEnabled || handledAssistant.current === assistantRequest.id) return;
    handledAssistant.current = assistantRequest.id;
    onAssistantRequestDone?.();
    appendFiles(assistantRequest.files);
  });

  const removeCard = (key: string) => {
    autofillQueue.current = autofillQueue.current.filter((item) => item !== key);
    setCards((current) => {
      const target = current.find((card) => card.key === key);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((card) => card.key !== key);
    });
  };

  const retryAutofill = (key: string) => {
    updateCard(key, (card) => ({ ...card, status: 'reading', note: undefined }));
    queueAutofill([key]);
  };

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
        && (!end || purchased < end)
        && matchesReceiptFilter(receipt, { project: projectFilter, query });
    }).sort((a, b) => receiptDate(b).localeCompare(receiptDate(a)) || b.createdAt.localeCompare(a.createdAt));
  }, [crewId, isOwner, projectFilter, query, receipts, timespan]);
  const projects = useMemo(() => receiptProjects(receipts), [receipts]);

  const today = todayIso();
  const readingCount = cards.filter((card) => card.status === 'reading').length;
  const readyCount = cards.filter((card) => receiptDraftReady(card, today)).length;
  const batchReady = cards.length > 0 && readyCount === cards.length;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (!companyId || !supabase || saving || !cards.length) return;
    if (readingCount) { setError('Auto-fill is still reading receipts. Wait a moment, then submit.'); return; }
    if (!batchReady) { setError('Review each card: every receipt needs a merchant, amount and date, and auto-filled cards must be confirmed.'); return; }
    const client = supabase;
    const batchProject = normalizeReceiptProject(project);
    setSaving(true);
    setError('');
    setCards((current) => current.map((card) => card.uploadError ? { ...card, uploadError: undefined } : card));
    const uploaded: Receipt[] = [];
    let failed = 0;
    // One storage object and one company_receipts row per card; a failed card stays staged to retry.
    for (const card of cards) {
      const path = `${companyId}/${user.id}/${createId()}-${safeFileName(card.file.name)}`;
      try {
        const { error: uploadError } = await client.storage.from(BUCKET).upload(path, card.file, { contentType: card.mimeType, upsert: false });
        if (uploadError) throw uploadError;
        const { data, error: insertError } = await client.from('company_receipts').insert({
          company_id: companyId,
          name: card.merchant.trim(),
          amount_cents: receiptAmountToCents(card.amount)!,
          original_file_name: card.file.name,
          mime_type: card.mimeType,
          byte_size: card.file.size,
          storage_path: path,
          uploaded_by: user.id,
          uploaded_by_name: user.name,
          purchased_on: card.purchasedOn,
          ...(batchProject ? { project: batchProject } : {}),
        }).select(RECEIPT_COLUMNS).single<ReceiptRow>();
        if (insertError) {
          await client.storage.from(BUCKET).remove([path]);
          throw insertError;
        }
        uploaded.push(fromRow(data));
        URL.revokeObjectURL(card.previewUrl);
        setCards((current) => current.filter((item) => item.key !== card.key));
      } catch (saveError) {
        failed += 1;
        updateCard(card.key, (current) => ({ ...current, uploadError: saveError instanceof Error ? saveError.message : 'Receipt could not be uploaded.' }));
      }
    }
    if (uploaded.length) setReceipts((current) => {
      const ids = new Set(uploaded.map((receipt) => receipt.id));
      return [...uploaded, ...current.filter((receipt) => !ids.has(receipt.id))];
    });
    if (failed) setError(`${failed} ${failed === 1 ? 'receipt' : 'receipts'} could not upload. ${uploaded.length ? `${uploaded.length} submitted. ` : ''}Check the cards below and submit again.`);
    else { setProject(''); setAttempted(false); setBatchNotice(''); }
    setSaving(false);
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
    setEditProject(receipt.project ?? '');
    setEditAmount((receipt.amountCents / 100).toFixed(2));
    setEditPurchasedOn(receiptDate(receipt));
    setError('');
  };

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    const amountCents = receiptAmountToCents(editAmount);
    if (!isOwner || !companyId || !supabase || !editingReceipt || !editName.trim() || amountCents === null || actionId) return;
    setActionId(editingReceipt.id);
    setError('');
    try {
      const { data, error: updateError } = await supabase.from('company_receipts')
        .update({ name: editName.trim(), amount_cents: amountCents, ...(editPurchasedOn && editPurchasedOn !== receiptDate(editingReceipt) ? { purchased_on: editPurchasedOn } : {}), ...(normalizeReceiptProject(editProject) !== normalizeReceiptProject(editingReceipt.project) ? { project: normalizeReceiptProject(editProject) ?? null } : {}) })
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

  const filterCrew = crew.filter((member) => member.status === 'Active' || receipts.some((receipt) => receipt.uploadedBy === member.id));

  return <div className="page receipts-page">
    {onBack&&<button type="button" className="page-back" onClick={onBack}><ArrowLeft/> Back</button>}
    <div className="page-heading hero-heading"><div><h1>{isOwner ? 'Receipts' : 'My receipts'}</h1>{!isOwner&&<p>Keep expense records ready for reimbursement and audits.</p>}</div></div>

    <section className="receipt-upload-card" aria-labelledby="add-receipt-heading">
      <div className="receipt-card-heading"><ReceiptText/><div><h2 id="add-receipt-heading">Add receipts</h2><p>{autofillEnabled ? 'Take a photo of each receipt. Auto-fill reads the merchant, date and amount; check each card before submitting.' : 'Take a photo of each receipt or add files, then enter the merchant, date and amount on each card.'}</p></div></div>
      <form className="receipt-capture-form" onSubmit={(event) => void submit(event)}>
        <label className="receipt-project-field"><span>Project <em>(optional)</em></span><input list="receipt-project-options" maxLength={MAX_RECEIPT_PROJECT_LENGTH} placeholder="Pine Valley Fire" value={project} disabled={saving} onChange={(event) => setProject(event.target.value)}/><datalist id="receipt-project-options">{projects.map((item) => <option key={item} value={item}/>)}</datalist><em className="receipt-field-hint">Applies to every receipt in this batch.</em></label>

        <div className="receipt-capture-actions">
          <button type="button" className="primary receipt-take-photo" disabled={saving || !uploadsEnabled || cards.length >= MAX_RECEIPT_BATCH} onClick={() => cameraRef.current?.click()}><Camera/> Take photo</button>
          <button type="button" className="secondary receipt-add-more" disabled={saving || !uploadsEnabled || cards.length >= MAX_RECEIPT_BATCH} onClick={() => filesRef.current?.click()}><Plus/> Add files</button>
        </div>
        <FileInput ref={cameraRef} className="sr-only" tabIndex={-1} aria-hidden type="file" accept="image/*" capture="environment" onChange={(event) => { appendFiles(event.target.files); event.target.value = ''; }}/>
        <FileInput ref={filesRef} className="sr-only" tabIndex={-1} aria-hidden type="file" multiple accept={ACCEPT_ATTR} onChange={(event) => { appendFiles(event.target.files); event.target.value = ''; }}/>
        {batchNotice && <p className="receipt-batch-notice" role="status">{batchNotice}</p>}

        {!cards.length ? <div className="receipt-capture-empty">
          <Camera/>
          <h3>No receipts added yet</h3>
          <p>Photograph receipts one after another, or add up to {MAX_RECEIPT_BATCH} photos or PDFs at once. Each becomes a card to check before submitting.</p>
        </div> : <div className="receipt-photo-grid" role="list" aria-label="Receipts to submit">
          {cards.map((card, index) => {
            const problems = attempted || card.autofilled ? receiptDraftProblems(card, today) : {};
            const label = `Receipt ${index + 1}`;
            return <article key={card.key} className={`receipt-photo-card status-${card.uploadError ? 'error' : card.status === 'reading' ? 'reading' : receiptDraftReady(card, today) ? 'ready' : 'review'}`} role="listitem" aria-label={label}>
              <div className="receipt-photo-thumb">
                {card.previewUrl ? <img src={card.previewUrl} alt={`${label} photo`}/> : <span className="receipt-photo-file"><FileText aria-hidden/>{card.file.name}</span>}
                <button type="button" className="receipt-photo-remove" disabled={saving} onClick={() => removeCard(card.key)} aria-label={`Remove ${label.toLowerCase()}`}><X/></button>
              </div>
              <div className="receipt-photo-body">
                <header>
                  <b>{label}</b>
                  {card.status === 'reading' ? <span className="receipt-photo-status reading"><Sparkles/> Reading…</span>
                    : card.uploadError ? <span className="receipt-photo-status error">Not uploaded</span>
                    : receiptDraftReady(card, today) ? <span className="receipt-photo-status ready"><Check/> Ready</span>
                    : card.autofilled && !card.confirmed ? <span className="receipt-photo-status review">Check details</span> : null}
                </header>
                {card.status === 'reading' ? <p className="receipt-photo-note">Auto-fill is reading this receipt…</p> : <>
                  <label><span>Merchant</span><input maxLength={160} placeholder="Merchant" value={card.merchant} disabled={saving} onChange={(event) => updateCard(card.key, (current) => ({ ...current, merchant: event.target.value }))} aria-invalid={Boolean(problems.merchant)}/>{problems.merchant && <small>{problems.merchant}</small>}</label>
                  <div className="receipt-photo-fields">
                    <label><span>Purchase date</span><input type="date" max={today} value={card.purchasedOn} disabled={saving} onChange={(event) => updateCard(card.key, (current) => ({ ...current, purchasedOn: event.target.value }))} aria-invalid={Boolean(problems.purchasedOn)}/>{problems.purchasedOn && <small>{problems.purchasedOn}</small>}</label>
                    <label><span>Amount</span><div className="receipt-money-input"><b>$</b><input inputMode="decimal" placeholder="0.00" value={card.amount} disabled={saving} onChange={(event) => updateCard(card.key, (current) => ({ ...current, amount: event.target.value }))} aria-invalid={Boolean(problems.amount)}/></div>{problems.amount && <small>{problems.amount}</small>}</label>
                  </div>
                  {card.note && <p className="receipt-photo-note warn">{card.note}</p>}
                  {card.autofilled && <label className={`receipt-confirm${problems.confirm && attempted ? ' invalid' : ''}`}><input type="checkbox" checked={card.confirmed} disabled={saving} onChange={(event) => updateCard(card.key, (current) => ({ ...current, confirmed: event.target.checked }))}/><span>I checked these details against the receipt{card.confidence && card.confidence !== 'high' ? ` (auto-fill confidence: ${card.confidence})` : ''}</span></label>}
                  {autofillEnabled && card.note && card.previewUrl && <button type="button" className="secondary receipt-retry" disabled={saving} onClick={() => retryAutofill(card.key)}><Sparkles/> Retry auto-fill</button>}
                </>}
                {card.uploadError && <p className="receipt-photo-note error" role="alert">{card.uploadError}</p>}
              </div>
            </article>;
          })}
          {cards.length < MAX_RECEIPT_BATCH && <button type="button" className="receipt-photo-add-tile" disabled={saving || !uploadsEnabled} onClick={() => cameraRef.current?.click()} aria-label="Take another receipt photo"><Camera/><span>Next receipt</span><small>{cards.length} of {MAX_RECEIPT_BATCH}</small></button>}
        </div>}

        <div className="receipt-batch-actions">
          <p className="receipt-capture-count">{!cards.length ? `Up to ${MAX_RECEIPT_BATCH} receipts per batch.` : readingCount ? `Reading ${readingCount} of ${cards.length}…` : `${readyCount} of ${cards.length} ready`}</p>
          <UploadButton className="primary" disabled={saving || !uploadsEnabled || !cards.length || readingCount > 0} type="submit"><Upload/>{saving ? 'Submitting…' : cards.length > 1 ? `Submit ${cards.length} receipts` : 'Submit receipt'}</UploadButton>
        </div>
      </form>
      {!demoMode && !companyId && <p className="receipt-error" role="alert">Connect Supabase and select company before uploading receipts.</p>}
      {error && !editingReceipt && <p className="receipt-error" role="alert">{error}</p>}
    </section>

    <section className="receipt-list-card" aria-labelledby="receipt-list-heading">
      <div className="receipt-list-heading"><div><h2 id="receipt-list-heading">{isOwner ? 'Submitted receipts' : 'Receipt history'}</h2><p>{visible.length} {visible.length === 1 ? 'receipt' : 'receipts'} · {formatMoney(visible.reduce((total, receipt) => total + receipt.amountCents, 0))}</p></div>
        <div className="receipt-list-tools">
          {!!visible.length && <button type="button" className="secondary receipt-export" disabled={!storageReady || exporting || Boolean(actionId)} onClick={() => void exportVisibleZip()} title={storageReady ? 'Download a ZIP of the filtered original receipt files' : 'Receipt export needs a connected company workspace'}><Download/>{exporting ? 'Exporting…' : 'Export ZIP'}</button>}
          <div className="receipt-filters">
            <label className="receipt-search"><span>Search</span><div><Search aria-hidden/><input type="search" placeholder="Merchant, project, file" value={query} onChange={(event) => setQuery(event.target.value)}/></div></label>
            {projects.length > 0 && <label><span>Project</span><select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="">All projects</option>{projects.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}
            {isOwner && <label><span>Crew member</span><select value={crewId} onChange={(event) => setCrewId(event.target.value)}><option value="all">All crew</option>{filterCrew.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>}
            <label><span>Timespan</span><select value={timespan} onChange={(event) => setTimespan(event.target.value as Timespan)}><option value="30-days">Last 30 days</option><option value="this-year">This year</option><option value="last-year">Last year</option><option value="all">All time</option></select></label>
          </div>
        </div>
      </div>
      {demoMode && !!visible.length && <p className="receipt-state">Demo mode keeps sample receipts on-screen only. Connect a company workspace to download or export files.</p>}
      {loading && <p className="receipt-state">Loading receipts…</p>}
      {!loading && !error && !visible.length && <div className="receipt-empty"><FileText/><h3>No receipts found</h3><p>{receipts.length ? 'Change filters to see more receipts.' : 'Uploaded receipts will appear here.'}</p></div>}
      {!!visible.length && <div className="receipt-table-wrap"><table className="receipt-table"><thead><tr><th>Name</th>{isOwner && <th>Crew member</th>}<th className="receipt-date">Date</th><th className="receipt-amount">Amount</th><th><span className="sr-only">File</span></th>{isOwner && <th><span className="sr-only">Actions</span></th>}</tr></thead><tbody>{visible.map((receipt) => <tr key={receipt.id}><td><b>{receipt.name}</b>{receipt.project && <span className="receipt-project-tag">{receipt.project}</span>}{duplicates.has(receipt.id) ? <small className="receipt-duplicate" title="Same amount, uploader and day as another receipt">Possible duplicate</small> : <small>{receipt.fileName}</small>}</td>{isOwner && <td>{receipt.uploadedByName}</td>}<td className="receipt-date">{formatCalendarDate(receiptDate(receipt))}</td><td className="receipt-amount"><b>{formatMoney(receipt.amountCents)}</b></td><td><div className="receipt-file-actions"><button className="receipt-open" type="button" disabled={Boolean(actionId) || exporting} onClick={() => void openReceipt(receipt)} aria-label={`Open ${receipt.name}`}><ExternalLink/>View</button><button className="receipt-open" type="button" disabled={!storageReady || Boolean(actionId) || exporting} onClick={() => void downloadReceiptZip(receipt)} aria-label={`Download ZIP for ${receipt.name}`}><Download/>{actionId === receipt.id ? '…' : 'ZIP'}</button></div></td>{isOwner && <td><div className="receipt-actions"><button type="button" disabled={Boolean(actionId) || exporting} onClick={() => beginEdit(receipt)} aria-label={`Edit ${receipt.name}`}><Pencil/></button><button className="delete" type="button" disabled={Boolean(actionId) || exporting} onClick={() => void removeReceipt(receipt)} aria-label={`Delete ${receipt.name}`}><Trash2/></button></div></td>}</tr>)}</tbody></table></div>}
    </section>

    {editingReceipt && <div className="receipt-edit-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !actionId) setEditingReceipt(null); }}><section className="receipt-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-receipt-heading"><header><div><h2 id="edit-receipt-heading">Edit receipt</h2><p>{editingReceipt.fileName}</p></div><button type="button" disabled={Boolean(actionId)} onClick={() => setEditingReceipt(null)} aria-label="Close edit receipt"><X/></button></header><form onSubmit={(event) => void saveEdit(event)}><label><span>Name</span><input autoFocus maxLength={160} value={editName} onChange={(event) => setEditName(event.target.value)}/></label><label><span>Project</span><input list="receipt-project-options" maxLength={MAX_RECEIPT_PROJECT_LENGTH} placeholder="Optional" value={editProject} onChange={(event) => setEditProject(event.target.value)}/></label><label><span>Amount</span><div className="receipt-money-input"><b>$</b><input inputMode="decimal" value={editAmount} onChange={(event) => setEditAmount(event.target.value)}/></div></label><label><span>Purchase date</span><input type="date" max={todayIso()} value={editPurchasedOn} onChange={(event) => setEditPurchasedOn(event.target.value)}/></label>{error && <p className="receipt-error" role="alert">{error}</p>}<footer><button className="secondary" type="button" disabled={Boolean(actionId)} onClick={() => setEditingReceipt(null)}>Cancel</button><button className="primary" type="submit" disabled={Boolean(actionId) || !editName.trim() || receiptAmountToCents(editAmount) === null}><Pencil/>{actionId ? 'Saving…' : 'Save changes'}</button></footer></form></section></div>}
  </div>;
}
