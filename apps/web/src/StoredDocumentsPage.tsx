import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react';
import {Camera, ExternalLink, FileText, Upload} from 'lucide-react';
import type {CrewMember, FireOpsUser} from '@fireops/domain';
import {supabase} from './supabase';

type DocumentRow = {id:string;name:string;original_file_name:string;storage_path:string;uploaded_by:string;uploaded_by_name:string;created_at:string};
const columns = 'id,name,original_file_name,storage_path,uploaded_by,uploaded_by_name,created_at';

export default function StoredDocumentsPage({kind, companyId, user, crew}: {kind:'invoices'|'payroll';companyId?:string;user:FireOpsUser;crew:CrewMember[]}) {
  const title = kind === 'invoices' ? 'Invoices' : 'Payroll';
  const bucket = `${kind}-files`;
  const [records,setRecords] = useState<DocumentRow[]>([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [name,setName] = useState('');
  const [file,setFile] = useState<File|null>(null);
  const [filter,setFilter] = useState('all');
  const form = useRef<HTMLFormElement>(null);
  const owner = user.role === 'owner';
  const load = useCallback(async () => {
    if (!companyId || !supabase) {setLoading(false);return;}
    try {
      let query = supabase.from(`company_${kind}`).select(columns).eq('company_id',companyId);
      if (!owner) query = query.eq('uploaded_by',user.id);
      const {data,error:failure} = await query.order('created_at',{ascending:false});
      if (failure) throw failure;
      setRecords(data ?? []);setError('');
    } catch (failure) {setError(`Documents could not load. ${failure instanceof Error ? failure.message : String((failure as {message?:string}).message ?? failure)}`);}
    finally {setLoading(false);}
  },[companyId,kind,owner,user.id]);
  useEffect(() => {
    setRecords([]);setLoading(true);void load();
    if (!companyId || !supabase) return;
    const client = supabase;
    const channel = client.channel(`stored-${kind}:${companyId}:${user.id}`).on('postgres_changes',{event:'*',schema:'public',table:`company_${kind}`,filter:`company_id=eq.${companyId}`},()=>void load()).subscribe();
    return () => {void client.removeChannel(channel);};
  },[companyId,kind,user.id,load]);
  async function upload(event:FormEvent) {
    event.preventDefault();
    if (!supabase || !companyId || !file || !name.trim() || busy) return;
    const mime = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : /\.hei[cf]$/i.test(file.name) ? 'image/heic' : '');
    if (!['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'].includes(mime) || file.size === 0 || file.size > 10485760) {setError('Choose an image or PDF between 1 byte and 10 MB.');return;}
    setBusy(true);setError('');
    const path = `${companyId}/${user.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]+/g,'-')}`;
    try {
      const {error:uploadError} = await supabase.storage.from(bucket).upload(path,file,{contentType:mime});
      if (uploadError) throw uploadError;
      const {error:insertError} = await supabase.from(`company_${kind}`).insert({company_id:companyId,name:name.trim(),original_file_name:file.name,mime_type:mime,byte_size:file.size,storage_path:path,uploaded_by:user.id,uploaded_by_name:user.name});
      if (insertError) {await supabase.storage.from(bucket).remove([path]);throw insertError;}
      setName('');setFile(null);form.current?.reset();await load();
    } catch (failure) {setError(`Upload failed. ${(failure as {message?:string}).message ?? 'Check your connection and try again.'}`);}
    finally {setBusy(false);}
  }
  async function open(record:DocumentRow) {
    if (!supabase) return;
    // Open synchronously so browsers do not block the window after the URL request.
    const tab = window.open('about:blank','_blank');
    if (tab) tab.opener = null;
    try {
      const {data,error:failure} = await supabase.storage.from(bucket).createSignedUrl(record.storage_path,3600);
      if (failure) throw failure;
      if (tab) tab.location.href = data.signedUrl;
      else setError('Allow pop-ups to open the document, then try again.');
    } catch (failure) {tab?.close();setError(`Document could not open. ${(failure as {message?:string}).message ?? 'Try again.'}`);}
  }
  const visible = records.filter(record => (owner || record.uploaded_by === user.id) && (!owner || filter === 'all' || record.uploaded_by === filter));
  const people = new Map(crew.map(person => [person.id,person.name]));
  records.forEach(record => people.set(record.uploaded_by,record.uploaded_by_name));
  return <div className="page receipts-page">
    <div className="page-heading"><div><h1>{owner ? title : `My ${title.toLowerCase()}`}</h1>{!owner&&<p>Your uploads are visible to you and the company owner.</p>}</div></div>
    <section className="receipt-upload-card"><div className="receipt-card-heading"><FileText/><div><h2>Add {kind === 'invoices' ? 'invoice' : 'payroll document'}</h2><p>Photograph a document or upload an image or PDF. Maximum 10 MB.</p></div></div>
      <form ref={form} className="receipt-form stored-document-form" onSubmit={event=>void upload(event)}>
        <label><span>Name</span><input required maxLength={160} value={name} onChange={event=>setName(event.target.value)} placeholder="Document name" disabled={busy}/></label>
        <label className="receipt-file-field"><span>Document file</span><input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.heic,.heif" disabled={busy} onChange={event=>setFile(event.target.files?.[0] ?? null)}/></label>
        <label className="document-camera"><Camera/><span>Take photo</span><input type="file" accept="image/*" capture="environment" disabled={busy} onChange={event=>setFile(event.target.files?.[0] ?? null)}/></label>
        {file && <p className="selected-document-file">Selected: {file.name}</p>}
        <button className="primary" disabled={busy || !companyId || !file || !name.trim()}><Upload/>{busy ? 'Uploading…' : 'Upload document'}</button>
      </form>
      {!companyId && <p className="receipt-error">Connect a company account to upload documents.</p>}
    </section>
    {error && <p className="receipt-error" role="alert">{error} <button className="secondary" onClick={()=>void load()}>Retry loading</button></p>}
    <section className="receipt-list-card"><div className="receipt-list-heading"><h2>{owner ? 'Submitted documents' : 'My documents'} ({visible.length})</h2>{owner && <label>Crew member <select value={filter} onChange={event=>setFilter(event.target.value)}><option value="all">All Crew</option>{[...people].map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>}</div>
      {loading ? <p className="receipt-state">Loading documents…</p> : !visible.length ? <p className="receipt-state">No documents found. Uploaded files will appear here.</p> : <div className="receipt-table-wrap"><table className="receipt-table"><thead><tr><th>Name</th>{owner && <th>Uploaded by</th>}<th>Date</th><th>File</th></tr></thead><tbody>{visible.map(record=><tr key={record.id}><td><b>{record.name}</b><small>{record.original_file_name}</small></td>{owner && <td>{record.uploaded_by_name}</td>}<td>{new Date(record.created_at).toLocaleDateString()}</td><td><button className="receipt-open" onClick={()=>void open(record)} aria-label={`Open ${record.name}`}><ExternalLink/>View</button></td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
