import {useState} from 'react';
import {
  integrationCatalog, maskSecret,
  type IntegrationProvider, type IntegrationVault, type PublicIntegration,
} from '@fireops/domain';
import './integrations.css';

const statusLabel = {connected: 'Connected', disconnected: 'Disconnected', error: 'Needs attention'} as const;

export function IntegrationsPanel({vault, actor}: {vault: IntegrationVault; actor: string}) {
  const [records, setRecords] = useState(() => vault.list());
  const [audit, setAudit] = useState(() => vault.audit());
  const [editing, setEditing] = useState<IntegrationProvider | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const refresh = () => { setRecords(vault.list()); setAudit(vault.audit()); };
  return <section className="integration-keys" aria-labelledby="integration-keys-heading">
    <header>
      <div>
        <h2 id="integration-keys-heading">API keys</h2>
        <p>Owners and admins save provider credentials here. Secrets are sealed before they are stored and only the last four characters come back.</p>
      </div>
    </header>
    <p className="integration-keys-note">In this demo the sealed values stay in the session and are not written to disk. A signed-in company stores them encrypted on the server.</p>
    {message && <p className="integration-keys-status" role="status">{message}</p>}
    {error && <p className="integration-keys-error" role="alert">{error}</p>}
    <div className="integration-keys-list">
      {records.map(record => <article key={record.provider} className="integration-key-card">
        <div className="integration-key-heading">
          <div>
            <h3>{record.title}</h3>
            <p>{integrationCatalog[record.provider].summary}</p>
          </div>
          <i className={`integration-key-badge ${record.status}`}>{statusLabel[record.status]}</i>
        </div>
        <dl>
          {Object.entries(record.publicConfig).map(([field, value]) => <div key={field}><dt>{fieldLabel(record.provider, field)}</dt><dd>{value}</dd></div>)}
          {record.secrets.map(secret => <div key={secret.field}><dt>{fieldLabel(record.provider, secret.field)}</dt><dd>{maskSecret(secret.lastFour).display}</dd></div>)}
          {record.updatedBy && <div><dt>Last change</dt><dd>{record.updatedBy}{record.updatedAt ? ` · ${formatWhen(record.updatedAt)}` : ''}</dd></div>}
          {record.lastTestMessage && <div><dt>Last test</dt><dd>{record.lastTestMessage}</dd></div>}
        </dl>
        <div className="integration-key-actions">
          <button type="button" className="secondary" onClick={() => { setEditing(record.provider); setError(''); }}>{record.secrets.length || Object.keys(record.publicConfig).length ? 'Edit' : 'Add credentials'}</button>
          <button type="button" className="secondary" disabled={!record.updatedAt} onClick={() => void run(async () => { const result = await vault.test(record.provider, actor); setMessage(result.message); })}>Test connection</button>
          <button type="button" className="secondary" disabled={!record.updatedAt} onClick={() => void run(async () => { if (!window.confirm(`Delete ${record.title} credentials?`)) return; await vault.remove(record.provider, actor); setEditing(null); setMessage(`${record.title} credentials were deleted.`); })}>Delete</button>
        </div>
        {editing === record.provider && <CredentialForm provider={record.provider} existing={record} onCancel={() => setEditing(null)} onSave={values => void run(async () => { await vault.save(record.provider, values, actor); setEditing(null); setMessage(`${record.title} credentials were saved.`); })}/>}
      </article>)}
    </div>
    <section className="integration-key-audit" aria-labelledby="integration-audit-heading">
      <h3 id="integration-audit-heading">Credential changes</h3>
      {audit.length ? <ol>{audit.map(entry => <li key={entry.id}><b>{formatWhen(entry.at)}</b> {entry.summary}</li>)}</ol> : <p>No credential changes yet.</p>}
    </section>
  </section>;

  async function run(action: () => Promise<void>) {
    setError('');
    try { await action(); refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The credential change could not be saved.'); }
  }
}

function CredentialForm({provider, existing, onCancel, onSave}: {provider: IntegrationProvider; existing: PublicIntegration; onCancel: () => void; onSave: (values: Record<string, string>) => void}) {
  const fields = integrationCatalog[provider].fields;
  const [values, setValues] = useState<Record<string, string>>(() => ({...existing.publicConfig}));
  return <form className="integration-key-form" onSubmit={event => { event.preventDefault(); onSave(values); }}>
    {fields.map(field => <label key={field.id}><span>{field.label}</span>
      {field.kind === 'choice'
        ? <select value={values[field.id] ?? field.choices?.[0]?.value ?? ''} onChange={event => setValues(current => ({...current, [field.id]: event.target.value}))}>{field.choices?.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select>
        : <input type={field.kind === 'secret' ? 'password' : 'text'} autoComplete="off" value={values[field.id] ?? ''} placeholder={field.kind === 'secret' && existing.secrets.some(secret => secret.field === field.id) ? 'Leave blank to keep the saved secret' : ''} onChange={event => setValues(current => ({...current, [field.id]: event.target.value}))}/>}
      {field.help && <small>{field.help}</small>}
    </label>)}
    <div className="integration-key-actions">
      <button className="primary" type="submit">Save</button>
      <button className="secondary" type="button" onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}

function fieldLabel(provider: IntegrationProvider, id: string) {
  return integrationCatalog[provider].fields.find(field => field.id === id)?.label ?? id;
}

function formatWhen(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
