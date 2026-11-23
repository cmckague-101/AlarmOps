import {buildSeedSnapshot, mapManitouPayload, type CentralStationSnapshot} from './central-station';

/**
 * Company integration credentials.
 * Secrets are sealed with AES-GCM before they are stored. Public views and audit
 * lines carry the last four characters of a secret and never the secret itself.
 * A signed-in company persists the sealed record through the integration-vault
 * function. The demo vault keeps the sealed record in the session only.
 */

export const INTEGRATION_PROVIDERS = ['quickbooks', 'manitou', 'sedona', 'motive', 'verizon_connect', 'adi'] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];
export type IntegrationStatus = 'connected' | 'disconnected' | 'error';
export type IntegrationFieldKind = 'secret' | 'text' | 'url' | 'choice';

export type IntegrationField = {
  id: string;
  label: string;
  kind: IntegrationFieldKind;
  required?: boolean;
  choices?: {value: string; label: string}[];
  help?: string;
};

export type IntegrationCatalogEntry = {
  title: string;
  summary: string;
  fields: IntegrationField[];
};

export const integrationCatalog: Record<IntegrationProvider, IntegrationCatalogEntry> = {
  quickbooks: {
    title: 'QuickBooks Online',
    summary: 'Intuit OAuth. The client id and secret stay sealed. The realm id is the QuickBooks company id.',
    fields: [
      {id: 'clientId', label: 'Client ID', kind: 'secret', required: true},
      {id: 'clientSecret', label: 'Client secret', kind: 'secret', required: true},
      {id: 'realmId', label: 'Realm / company ID', kind: 'text', required: true, help: 'Shown in full so you can confirm which QuickBooks company is selected.'},
    ],
  },
  manitou: {
    title: 'Manitou',
    summary: 'Bold Manitou REST. Base URL plus a username and password, or an API key.',
    fields: [
      {id: 'baseUrl', label: 'REST base URL', kind: 'url', required: true},
      {id: 'authMode', label: 'Authentication', kind: 'choice', required: true, choices: [{value: 'password', label: 'Username and password'}, {value: 'api_key', label: 'API key'}]},
      {id: 'username', label: 'Username', kind: 'text'},
      {id: 'password', label: 'Password', kind: 'secret'},
      {id: 'apiKey', label: 'API key', kind: 'secret'},
    ],
  },
  sedona: {
    title: 'SedonaOffice',
    summary: 'SedonaAPI 2.0. Each company has its own base URL and client credentials.',
    fields: [
      {id: 'baseUrl', label: 'API base URL', kind: 'url', required: true, help: 'The per-company SedonaAPI 2.0 host.'},
      {id: 'clientId', label: 'Client ID', kind: 'secret', required: true},
      {id: 'clientSecret', label: 'Client secret', kind: 'secret', required: true},
    ],
  },
  motive: {
    title: 'Motive',
    summary: 'Fleet and ELD API key. Motive was formerly KeepTruckin.',
    fields: [
      {id: 'apiKey', label: 'API key', kind: 'secret', required: true},
    ],
  },
  verizon_connect: {
    title: 'Verizon Connect',
    summary: 'Reveal REST credentials used for fleet data and dash-camera video. Calls send the Integration Manager app id with a short-lived token from the Reveal username and password.',
    fields: [
      {id: 'region', label: 'Region', kind: 'choice', required: true, choices: [{value: 'us', label: 'United States'}, {value: 'eu', label: 'Europe'}]},
      {id: 'appId', label: 'App ID', kind: 'text', required: true, help: 'Atmosphere app id from Verizon Connect Integration Manager.'},
      {id: 'username', label: 'REST username', kind: 'text', required: true, help: 'Reveal REST integration user from the Reveal Marketplace, not the Integration Manager login.'},
      {id: 'password', label: 'REST password', kind: 'secret', required: true},
    ],
  },
  adi: {
    title: 'ADI Global Distribution',
    summary: 'Resideo dealer API for parts price and inventory. Onboarding provides the API key, password, and secret. The customer number and suffix go with every price request.',
    fields: [
      {id: 'customerNumber', label: 'Customer number', kind: 'text', required: true, help: 'ADI dealer account number. It is not a secret.'},
      {id: 'customerSuffix', label: 'Customer suffix', kind: 'text', required: true, help: 'Location code. 000 is the home account. Leave this blank to use 000.'},
      {id: 'apiKey', label: 'API key', kind: 'secret', required: true, help: 'Sent as the Api-Key header.'},
      {id: 'apiPassword', label: 'API password', kind: 'secret', required: true, help: 'Mixed into the request signature. It is not sent as its own header.'},
      {id: 'apiSecret', label: 'API secret', kind: 'secret', required: true, help: 'HMAC key for the Authentication-Signature header.'},
    ],
  },
};

export type PublicSecret = {field: string; lastFour: string};
export type SealedSecret = {field: string; ciphertext: string; iv: string; lastFour: string};

export type StoredIntegration = {
  provider: IntegrationProvider;
  status: IntegrationStatus;
  publicConfig: Record<string, string>;
  secrets: SealedSecret[];
  updatedAt: string;
  updatedBy: string;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
};

export type PublicIntegration = {
  provider: IntegrationProvider;
  title: string;
  status: IntegrationStatus;
  publicConfig: Record<string, string>;
  secrets: PublicSecret[];
  updatedAt: string | null;
  updatedBy: string | null;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
};

export type IntegrationAuditEntry = {
  id: string;
  at: string;
  actor: string;
  provider: IntegrationProvider;
  action: 'saved' | 'deleted' | 'tested';
  summary: string;
};

export type StationLoad = {snapshot: CentralStationSnapshot; using: 'seed' | 'manitou'};

const SECRET_MIN = 8;

export function maskSecret(value: string) {
  const trimmed = value.trim();
  return {lastFour: trimmed.slice(-4), display: `••••${trimmed.slice(-4)}`};
}

export function publicIntegration(record: StoredIntegration | null, provider: IntegrationProvider): PublicIntegration {
  const catalog = integrationCatalog[provider];
  if (!record) {
    return {provider, title: catalog.title, status: 'disconnected', publicConfig: {}, secrets: [], updatedAt: null, updatedBy: null, lastTestedAt: null, lastTestOk: null, lastTestMessage: null};
  }
  return {
    provider,
    title: catalog.title,
    status: record.status,
    publicConfig: {...record.publicConfig},
    secrets: record.secrets.map(secret => ({field: secret.field, lastFour: secret.lastFour})),
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
    lastTestedAt: record.lastTestedAt,
    lastTestOk: record.lastTestOk,
    lastTestMessage: record.lastTestMessage,
  };
}

export function integrationAuditSummary(actor: string, provider: IntegrationProvider, action: IntegrationAuditEntry['action'], detail: string) {
  const title = integrationCatalog[provider].title;
  const verb = action === 'saved' ? 'saved' : action === 'deleted' ? 'removed' : 'tested';
  return `${actor} ${verb} ${title} credentials. ${detail}`.trim();
}

export async function sealSecret(value: string, keyMaterial: string): Promise<{ciphertext: string; iv: string}> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(keyMaterial);
  const encrypted = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, key, new TextEncoder().encode(value));
  return {ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv)};
}

export async function openSecret(ciphertext: string, iv: string, keyMaterial: string) {
  const key = await aesKey(keyMaterial);
  const decrypted = await crypto.subtle.decrypt({name: 'AES-GCM', iv: base64ToBytes(iv)}, key, base64ToBytes(ciphertext));
  return new TextDecoder().decode(decrypted);
}

export class IntegrationVault {
  private records = new Map<IntegrationProvider, StoredIntegration>();
  private opened = new Map<string, string>();
  private entries: IntegrationAuditEntry[] = [];

  constructor(private readonly keyMaterial: string, private readonly fetchImpl: typeof fetch = fetch) {}

  importSealed(records: readonly StoredIntegration[]) {
    this.records = new Map(records.map(record => [record.provider, {...record, publicConfig: {...record.publicConfig}, secrets: record.secrets.map(secret => ({...secret}))}]));
    this.opened.clear();
  }

  list(): PublicIntegration[] {
    return INTEGRATION_PROVIDERS.map(provider => publicIntegration(this.records.get(provider) ?? null, provider));
  }

  audit() {
    return this.entries.map(entry => ({...entry}));
  }

  /** Server-bound sealed rows. Ciphertext is not a client view. */
  sealedRecords(): StoredIntegration[] {
    return [...this.records.values()].map(record => ({...record, publicConfig: {...record.publicConfig}, secrets: record.secrets.map(secret => ({...secret}))}));
  }

  async save(provider: IntegrationProvider, values: Record<string, string>, actor: string, at = new Date().toISOString()): Promise<PublicIntegration> {
    const existing = this.records.get(provider) ?? null;
    const resolved = await this.resolveValues(provider, values, existing);
    const publicConfig: Record<string, string> = {};
    const secrets: SealedSecret[] = [];
    const rotated: string[] = [];
    const updated: string[] = [];
    for (const field of integrationCatalog[provider].fields) {
      const value = resolved[field.id] ?? '';
      if (!value) continue;
      if (field.kind === 'secret') {
        const prior = existing ? await this.readSecret(existing, field.id) : '';
        if (prior !== value) rotated.push(field.label);
        const sealed = await sealSecret(value, this.keyMaterial);
        const lastFour = maskSecret(value).lastFour;
        secrets.push({field: field.id, ...sealed, lastFour});
        this.opened.set(`${provider}:${field.id}`, value);
      } else {
        if (existing?.publicConfig[field.id] !== value) updated.push(field.label);
        publicConfig[field.id] = value;
      }
    }
    const record: StoredIntegration = {
      provider,
      status: provider === 'quickbooks' ? 'disconnected' : (existing?.status ?? 'disconnected'),
      publicConfig,
      secrets,
      updatedAt: at,
      updatedBy: actor,
      lastTestedAt: null,
      lastTestOk: null,
      lastTestMessage: null,
    };
    this.records.set(provider, record);
    const detail = [updated.length ? `Updated ${updated.join(', ')}` : '', rotated.length ? `Rotated ${rotated.join(', ')}` : ''].filter(Boolean).join('. ') || 'Saved credentials.';
    this.recordAudit(provider, 'saved', actor, at, integrationAuditSummary(actor, provider, 'saved', detail));
    return publicIntegration(record, provider);
  }

  async remove(provider: IntegrationProvider, actor: string, at = new Date().toISOString()) {
    this.records.delete(provider);
    for (const field of integrationCatalog[provider].fields) this.opened.delete(`${provider}:${field.id}`);
    this.recordAudit(provider, 'deleted', actor, at, integrationAuditSummary(actor, provider, 'deleted', 'Credentials were deleted.'));
  }

  async test(provider: IntegrationProvider, actor: string, at = new Date().toISOString()) {
    const record = this.records.get(provider);
    if (!record) throw new IntegrationError('Save credentials before testing the connection.');
    const values = await this.readAll(provider, record);
    let ok = false;
    let message = 'The connection could not be tested.';
    try {
      const result = await probeIntegration(provider, values, this.fetchImpl);
      ok = result.ok;
      message = result.message;
    } catch {
      ok = false;
      message = 'The connection could not be tested.';
    }
    const next: StoredIntegration = {...record, status: ok ? 'connected' : 'error', lastTestedAt: at, lastTestOk: ok, lastTestMessage: message};
    if (provider === 'quickbooks') next.status = 'disconnected';
    this.records.set(provider, next);
    this.recordAudit(provider, 'tested', actor, at, integrationAuditSummary(actor, provider, 'tested', message));
    return {ok, message, integration: publicIntegration(next, provider)};
  }

  async loadStation(now: Date): Promise<StationLoad> {
    const record = this.records.get('manitou');
    if (!record) return {snapshot: buildSeedSnapshot(now), using: 'seed'};
    try {
      const values = await this.readAll('manitou', record);
      const response = await this.fetchImpl(values.baseUrl, {headers: manitouHeaders(values), signal: AbortSignal.timeout(8000)});
      if (!response.ok) throw new IntegrationError('Manitou refused the credentials.');
      const mapped = mapManitouPayload(await response.json());
      if (!mapped) throw new IntegrationError('Manitou did not return a signal list.');
      return {snapshot: mapped, using: 'manitou'};
    } catch {
      return {snapshot: buildSeedSnapshot(now), using: 'seed'};
    }
  }

  private async resolveValues(provider: IntegrationProvider, incoming: Record<string, string>, existing: StoredIntegration | null) {
    const resolved: Record<string, string> = {};
    for (const field of integrationCatalog[provider].fields) {
      const typed = (incoming[field.id] ?? '').trim();
      if (field.kind === 'secret' && !typed && existing) {
        const prior = await this.readSecret(existing, field.id);
        if (prior) resolved[field.id] = prior;
        continue;
      }
      if (typed) resolved[field.id] = field.kind === 'url' ? normalizeHttpsUrl(typed) : typed;
    }
    validateResolved(provider, resolved);
    return resolved;
  }

  private async readSecret(record: StoredIntegration, field: string) {
    const cached = this.opened.get(`${record.provider}:${field}`);
    if (cached) return cached;
    const sealed = record.secrets.find(secret => secret.field === field);
    if (!sealed) return '';
    const value = await openSecret(sealed.ciphertext, sealed.iv, this.keyMaterial);
    this.opened.set(`${record.provider}:${field}`, value);
    return value;
  }

  private async readAll(provider: IntegrationProvider, record: StoredIntegration) {
    const values = {...record.publicConfig};
    for (const secret of record.secrets) values[secret.field] = await this.readSecret(record, secret.field);
    validateResolved(provider, values);
    return values;
  }

  private recordAudit(provider: IntegrationProvider, action: IntegrationAuditEntry['action'], actor: string, at: string, summary: string) {
    this.entries = [{id: `${provider}-${action}-${this.entries.length + 1}`, at, actor, provider, action, summary}, ...this.entries].slice(0, 40);
  }
}

export class IntegrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrationError';
  }
}

export function validateResolved(provider: IntegrationProvider, values: Record<string, string>) {
  const fields = integrationCatalog[provider].fields;
  for (const field of fields) {
    if (field.kind === 'choice' && values[field.id] && field.choices && !field.choices.some(choice => choice.value === values[field.id])) {
      throw new IntegrationError(`${field.label} is not a supported choice.`);
    }
  }
  if (provider === 'manitou') {
    if (!values.baseUrl) throw new IntegrationError('Manitou needs an https base URL.');
    const mode = values.authMode || 'password';
    if (mode === 'api_key') {
      requireSecret(values.apiKey, 'API key');
    } else {
      if (!values.username) throw new IntegrationError('Manitou needs a username.');
      requireSecret(values.password, 'Password');
    }
    return;
  }
  if (provider === 'adi' && !values.customerSuffix) values.customerSuffix = '000';
  for (const field of fields) {
    if (!field.required) continue;
    const value = values[field.id] ?? '';
    if (!value) throw new IntegrationError(`${field.label} is required.`);
    if (field.kind === 'secret') requireSecret(value, field.label);
  }
}

export async function probeIntegration(provider: IntegrationProvider, values: Record<string, string>, fetchImpl: typeof fetch) {
  try {
    if (provider === 'quickbooks') {
      const response = await fetchImpl('https://accounts.platform.intuit.com/.well-known/openid-configuration', {signal: AbortSignal.timeout(8000)});
      return response.ok
        ? {ok: true, message: 'Intuit is reachable. Status stays disconnected until Intuit redirects back for this realm.'}
        : {ok: false, message: 'Intuit could not be reached.'};
    }
    if (provider === 'manitou') {
      const response = await fetchImpl(values.baseUrl, {headers: manitouHeaders(values), signal: AbortSignal.timeout(8000)});
      return response.ok ? {ok: true, message: 'Manitou accepted the credentials.'} : {ok: false, message: 'Manitou refused the credentials.'};
    }
    if (provider === 'sedona') {
      const response = await fetchImpl(`${values.baseUrl.replace(/\/$/, '')}/oauth/token`, {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json'},
        body: new URLSearchParams({grant_type: 'client_credentials', client_id: values.clientId, client_secret: values.clientSecret}),
        signal: AbortSignal.timeout(8000),
      });
      return response.ok ? {ok: true, message: 'SedonaOffice issued a token.'} : {ok: false, message: 'SedonaOffice refused the client credentials.'};
    }
    if (provider === 'motive') {
      const response = await fetchImpl('https://api.gomotive.com/v1/vehicles?per_page=1', {headers: {Accept: 'application/json', 'X-Api-Key': values.apiKey}, signal: AbortSignal.timeout(8000)});
      return response.ok ? {ok: true, message: 'Motive accepted the API key.'} : {ok: false, message: 'Motive refused the API key.'};
    }
    if (provider === 'adi') {
      const requestId = crypto.randomUUID();
      const timestamp = String(Date.now());
      const response = await fetchImpl('https://dev.api.adiglobal.com/adi/api/v1/PriceAndInventory/PriceAndInventoryDetails', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Api-Key': values.apiKey,
          'Client-Request-Id': requestId,
          Timestamp: timestamp,
          'Authentication-Signature': await adiSignature(values, requestId, timestamp),
        },
        body: JSON.stringify({CustomerNumber: values.customerNumber, CustomerSuffix: values.customerSuffix || '000', ItemList: [{ItemNumber: '0', Quantity: 1}]}),
        signal: AbortSignal.timeout(8000),
      });
      return response.ok ? {ok: true, message: 'ADI accepted the dealer credentials.'} : {ok: false, message: 'ADI refused the dealer credentials.'};
    }
    const host = values.region === 'eu' ? 'https://fim.api.eu.fleetmatics.com/token' : 'https://fim.api.us.fleetmatics.com/token';
    const response = await fetchImpl(host, {headers: {Accept: 'application/json', Authorization: `Basic ${btoa(`${values.username}:${values.password}`)}`}, signal: AbortSignal.timeout(8000)});
    return response.ok ? {ok: true, message: 'Verizon Connect issued a token.'} : {ok: false, message: 'Verizon Connect refused the REST credentials.'};
  } catch {
    return {ok: false, message: 'The provider could not be reached.'};
  }
}

async function adiSignature(values: Record<string, string>, requestId: string, timestamp: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(values.apiSecret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${values.apiKey}${values.apiPassword}${requestId}${timestamp}`));
  return bytesToBase64(new Uint8Array(signed));
}

function manitouHeaders(values: Record<string, string>) {
  const headers: Record<string, string> = {Accept: 'application/json'};
  if ((values.authMode || 'password') === 'api_key') headers['X-Api-Key'] = values.apiKey;
  else headers.Authorization = `Basic ${btoa(`${values.username}:${values.password}`)}`;
  return headers;
}

function requireSecret(value: string | undefined, label: string) {
  if (!value || value.trim().length < SECRET_MIN) throw new IntegrationError(`${label} must be at least ${SECRET_MIN} characters.`);
}

function normalizeHttpsUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new IntegrationError('Enter a full https URL.'); }
  if (url.protocol !== 'https:') throw new IntegrationError('Use an https URL.');
  if (url.username || url.password) throw new IntegrationError('Put the username and password in their own fields.');
  return `${url.origin}${url.pathname.replace(/\/$/, '')}${url.search}`;
}

async function aesKey(material: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function bytesToBase64(bytes: Uint8Array) {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function base64ToBytes(value: string) {
  const text = atob(value);
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
  return bytes;
}
