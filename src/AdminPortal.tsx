import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Building2, LogOut, Pencil, Plus, ShieldCheck, X } from 'lucide-react';
import { supabase, supabaseConfigured } from './supabase';
import './admin.css';

type Company = {
  id: string;
  name: string;
  company_code: string;
  industry: string;
  owner_user_id: string;
  created_at: string;
  updated_at: string;
  owner: { email: string; full_name: string } | null;
};

type CompanyForm = {
  id?: string;
  name: string;
  companyCode: string;
  industry: string;
  ownerEmail: string;
  ownerFullName: string;
};

const emptyForm: CompanyForm = { name: '', companyCode: '', industry: '', ownerEmail: '', ownerFullName: '' };

async function invoke<T>(body: object): Promise<T> {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase.functions.invoke('system-admin-companies', { body });
  if (!error) return data as T;
  const context = 'context' in error ? error.context : null;
  if (context instanceof Response) {
    const response = await context.clone().json().catch(() => null) as { error?: string } | null;
    if (response?.error) throw new Error(response.error);
  }
  throw new Error(error.message);
}

export default function AdminPortal() {
  const [session, setSession] = useState<Session | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    if (!supabase) { setCheckingSession(false); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setCheckingSession(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, []);

  if (!supabaseConfigured) return <AdminMessage title="Admin portal not configured">Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel.</AdminMessage>;
  if (checkingSession) return <AdminMessage title="Checking session">Loading...</AdminMessage>;
  if (!session) return <AdminLogin/>;
  return <CompanyAdmin email={session.user.email ?? ''}/>;
}

function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setError('');
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (signInError) setError(signInError.message);
    setBusy(false);
  };
  return <div className="admin-auth"><form onSubmit={submit}><span className="admin-shield"><ShieldCheck/></span><h1>System administration</h1><p>Sign in with an authorized administrator account.</p><label>Email<input type="email" autoComplete="email" required value={email} onChange={event=>setEmail(event.target.value)}/></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={event=>setPassword(event.target.value)}/></label>{error&&<div className="admin-error">{error}</div>}<button disabled={busy}>{busy?'Signing in...':'Sign in'}</button></form></div>;
}

function CompanyAdmin({email}:{email:string}) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState<CompanyForm | null>(null);

  const load = async () => {
    setLoading(true); setError('');
    try { const result = await invoke<{companies:Company[]}>({ action: 'list' }); setCompanies(result.companies); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Unable to load companies'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const edit = (company:Company) => setForm({id:company.id,name:company.name,companyCode:company.company_code,industry:company.industry,ownerEmail:company.owner?.email??'',ownerFullName:company.owner?.full_name??''});
  const signOut = () => supabase?.auth.signOut();

  return <div className="admin-page"><header><div><span><ShieldCheck/> FireOps system administration</span><small>{email}</small></div><button onClick={signOut}><LogOut/> Sign out</button></header><main><div className="admin-heading"><div><h1>Companies</h1><p>Create companies and control company ownership.</p></div><button className="admin-primary" onClick={()=>setForm({...emptyForm})}><Plus/> New company</button></div>{error&&<div className="admin-error access-error">{error}</div>}{loading?<div className="admin-empty">Loading companies...</div>:!error&&companies.length===0?<div className="admin-empty"><Building2/><h2>No companies</h2><p>Create first company.</p></div>:<div className="admin-company-list">{companies.map(company=><article key={company.id}><span className="admin-company-icon"><Building2/></span><div><h2>{company.name}</h2><p>{company.industry||'No industry specified'}</p><small>{company.company_code}</small></div><div className="admin-owner"><span>Owner</span><b>{company.owner?.full_name||company.owner?.email||'Unknown'}</b><small>{company.owner?.email}</small></div><button onClick={()=>edit(company)} aria-label={`Edit ${company.name}`}><Pencil/></button></article>)}</div>}</main>{form&&<CompanyEditor form={form} onClose={()=>setForm(null)} onSaved={async()=>{setForm(null);await load()}}/>}</div>;
}

function CompanyEditor({form:initial,onClose,onSaved}:{form:CompanyForm;onClose:()=>void;onSaved:()=>Promise<void>}) {
  const [form,setForm] = useState(initial);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const update=(key:keyof CompanyForm,value:string)=>setForm(current=>({...current,[key]:value}));
  const submit=async(event:React.FormEvent)=>{event.preventDefault();setBusy(true);setError('');try{await invoke({action:'save',company:form});await onSaved()}catch(saveError){setError(saveError instanceof Error?saveError.message:'Unable to save company')}finally{setBusy(false)}};
  return <div className="admin-overlay"><form className="admin-editor" onSubmit={submit}><header><div><span>{form.id?'Edit company':'New company'}</span><h2>{form.id?form.name:'Create company'}</h2></div><button type="button" onClick={onClose} aria-label="Close"><X/></button></header><div className="admin-fields"><label>Company name<input required minLength={2} maxLength={120} value={form.name} onChange={event=>update('name',event.target.value)}/></label><label>Company code<input required pattern="[A-Za-z0-9][A-Za-z0-9-]{2,31}" maxLength={32} value={form.companyCode} onChange={event=>update('companyCode',event.target.value.toUpperCase())} placeholder="NRW-2048"/><small>Unique, 3 to 32 letters, numbers, or hyphens.</small></label><label>Industry<input maxLength={120} value={form.industry} onChange={event=>update('industry',event.target.value)} placeholder="Wildland fire contractor"/></label><fieldset><legend>Company owner</legend><p>Existing account will become owner. If email has no account, Supabase sends an invitation.</p><label>Owner email<input required type="email" value={form.ownerEmail} onChange={event=>update('ownerEmail',event.target.value)}/></label><label>Owner full name<input value={form.ownerFullName} onChange={event=>update('ownerFullName',event.target.value)} placeholder="Used for new invitations"/></label></fieldset>{error&&<div className="admin-error">{error}</div>}</div><footer><button type="button" onClick={onClose}>Cancel</button><button className="admin-primary" disabled={busy}>{busy?'Saving...':'Save company'}</button></footer></form></div>;
}

function AdminMessage({title,children}:{title:string;children:React.ReactNode}) { return <div className="admin-auth"><div className="admin-message"><ShieldCheck/><h1>{title}</h1><p>{children}</p></div></div>; }
