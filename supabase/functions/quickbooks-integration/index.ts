import { corsHeaders, isUuid, json } from '../_shared/fireops-edge.ts';
import {
  type Admin, type QboConfig, Qbo, type Connection, companyContext, encryptedTokenColumns, memberAccess, qboConfig, requestTokens, serviceClient, decryptValue,
} from '../_shared/quickbooks.ts';
import { QBO_AUTHORIZE_URL, QBO_REVOKE_URL, QBO_SCOPE, qboQueryValue } from '../_shared/quickbooks-logic.ts';

// QuickBooks Online connection for a company (paid add-on: companies.quickbooks_enabled).
// GET  ?code&state&realmId  OAuth callback (unauthenticated browser redirect; bound by state).
// POST {companyId, action}:
//   status            owners and accounting: connection and settings
//   connect           owner: start OAuth (returns authorizationUrl)
//   disconnect        owner: revoke and remove tokens
//   options           owner: QuickBooks items, tax codes, terms, classes, locations, deposit accounts, payment methods
//   save-settings     owner: sync timing and the QuickBooks references used for invoices and payments
//   search-customers  owners and accounting: QuickBooks customers by name
//   map-customer      owners and accounting: remember FireOps customer -> QuickBooks customer
//   unmap-customer    owners and accounting
// QuickBooks customers are never created by FireOps.

const OWNER_ACTIONS = ['connect', 'disconnect', 'options', 'save-settings'];
const FINANCE_ACTIONS = ['status', 'search-customers', 'map-customer', 'unmap-customer'];
const idPattern = /^[0-9A-Za-z_-]{1,64}$/;

function redirectWithResult(returnTo: string, values: Record<string, string>) {
  const url = new URL(returnTo);
  Object.entries(values).forEach(([key, value]) => url.searchParams.set(key, value));
  return Response.redirect(url.toString(), 302);
}

function validReturnTo(value: string, request: Request) {
  try {
    const target = new URL(value);
    const origin = request.headers.get('Origin');
    if (origin && (target.protocol === 'https:' || target.protocol === 'http:') && target.origin === origin) return target.toString();
    const allowed = (Deno.env.get('QBO_ALLOWED_RETURN_URLS') ?? '').split(',').map(item => item.trim()).filter(Boolean);
    return allowed.some(item => target.toString().startsWith(item)) ? target.toString() : '';
  } catch {
    return '';
  }
}

async function handleCallback(request: Request, admin: Admin, config: QboConfig) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') ?? '';
  if (!isUuid(state)) return json(400, { error: 'OAuth state is invalid.' });
  const { data: pending, error: stateError } = await admin.from('company_qbo_oauth_states')
    .delete().eq('state', state).gt('expires_at', new Date().toISOString())
    .select('company_id,user_id,return_to').maybeSingle();
  if (stateError || !pending) return json(400, { error: 'QuickBooks authorization expired or was already used. Start again from Settings.' });
  const fail = (message: string) => redirectWithResult(pending.return_to, { quickbooks: 'error', quickbooks_error: message });
  if (url.searchParams.get('error')) return fail('QuickBooks authorization was cancelled.');
  const code = url.searchParams.get('code') ?? '';
  const realmId = url.searchParams.get('realmId') ?? '';
  if (!code || !/^\d{1,32}$/.test(realmId)) return fail('QuickBooks did not return an authorization code.');
  const access = await memberAccess(admin, pending.company_id, pending.user_id);
  if (!access.owner) return fail('Only the company owner can connect QuickBooks.');
  try {
    const { data: otherCompany } = await admin.from('company_qbo_connections').select('company_id').eq('realm_id', realmId).neq('company_id', pending.company_id).maybeSingle();
    if (otherCompany) return fail('This QuickBooks company is already connected to another FireOps company.');
    const tokens = await requestTokens(config, { grant_type: 'authorization_code', code, redirect_uri: config.redirectUri });
    if (!tokens) return fail('QuickBooks could not complete authorization. Try again.');
    const columns = await encryptedTokenColumns(config, tokens);
    const connection = { company_id: pending.company_id, realm_id: realmId, ...columns, connected_by: pending.user_id, connected_at: new Date().toISOString(), last_cdc_at: new Date().toISOString() };
    const { error: saveError } = await admin.from('company_qbo_connections').upsert(connection);
    if (saveError) throw saveError;
    let companyName: string | null = null;
    try {
      const info = await new Qbo(admin, config, connection as Connection).read('companyinfo', realmId);
      companyName = typeof info?.CompanyName === 'string' ? info.CompanyName.slice(0, 200) : null;
    } catch (failure) { console.warn('QuickBooks company name unavailable', failure instanceof Error ? failure.message : failure); }
    const { data: previous } = await admin.from('company_qbo_settings').select('realm_id').eq('company_id', pending.company_id).maybeSingle();
    if (previous?.realm_id && previous.realm_id !== realmId) {
      const { error } = await admin.rpc('reset_company_qbo_links', { target_company: pending.company_id });
      if (error) throw error;
    }
    const { error: settingsError } = await admin.from('company_qbo_settings').upsert({
      company_id: pending.company_id, realm_id: realmId, qbo_company_name: companyName, connected: true, updated_by: pending.user_id, updated_at: new Date().toISOString(),
    });
    if (settingsError) throw settingsError;
    return redirectWithResult(pending.return_to, { quickbooks: 'connected' });
  } catch (failure) {
    console.error('QuickBooks OAuth callback failed:', failure);
    return fail('QuickBooks connection could not be saved. Try again.');
  }
}

type RefInput = { id: string; name: string } | null;
function refInput(value: unknown): RefInput | undefined {
  if (value === null || value === undefined || value === '') return null;
  const item = value as { id?: unknown; name?: unknown };
  const id = String(item?.id ?? ''); const name = String(item?.name ?? '').trim().slice(0, 200);
  return idPattern.test(id) && name ? { id, name } : undefined;
}

async function listOptions(qbo: Qbo) {
  const named = (rows: Record<string, unknown>[], label = (row: Record<string, unknown>) => String(row.FullyQualifiedName ?? row.Name ?? '')) =>
    rows.map(row => ({ id: String(row.Id), name: label(row) })).filter(row => row.id && row.name).sort((a, b) => a.name.localeCompare(b.name));
  const [items, taxCodes, terms, classes, departments, accounts, paymentMethods] = await Promise.all([
    qbo.query('Item', "select Id, Name, FullyQualifiedName, Type from Item where Active = true and Type in ('Service', 'NonInventory', 'Inventory') maxresults 1000"),
    qbo.query('TaxCode', 'select Id, Name from TaxCode where Active = true maxresults 1000').catch(() => []),
    qbo.query('Term', 'select Id, Name from Term where Active = true maxresults 1000').catch(() => []),
    qbo.query('Class', 'select Id, Name, FullyQualifiedName from Class where Active = true maxresults 1000').catch(() => []),
    qbo.query('Department', 'select Id, Name, FullyQualifiedName from Department where Active = true maxresults 1000').catch(() => []),
    qbo.query('Account', "select Id, Name, FullyQualifiedName, AccountType from Account where Active = true and AccountType in ('Bank', 'Other Current Asset') maxresults 1000"),
    qbo.query('PaymentMethod', 'select Id, Name from PaymentMethod where Active = true maxresults 1000').catch(() => []),
  ]);
  return {
    items: named(items), taxCodes: named(taxCodes), terms: named(terms), classes: named(classes),
    departments: named(departments), depositAccounts: named(accounts), paymentMethods: named(paymentMethods),
  };
}

const settingsView = (settings: Record<string, unknown> | null) => settings ? {
  syncMode: settings.sync_mode, qboCompanyName: settings.qbo_company_name,
  item: settings.item_id ? { id: settings.item_id, name: settings.item_name } : null,
  taxCode: settings.tax_code_id ? { id: settings.tax_code_id, name: settings.tax_code_name } : null,
  terms: settings.terms_id ? { id: settings.terms_id, name: settings.terms_name } : null,
  class: settings.class_id ? { id: settings.class_id, name: settings.class_name } : null,
  department: settings.department_id ? { id: settings.department_id, name: settings.department_name } : null,
  depositAccount: settings.deposit_account_id ? { id: settings.deposit_account_id, name: settings.deposit_account_name } : null,
  paymentMethod: settings.payment_method_id ? { id: settings.payment_method_id, name: settings.payment_method_name } : null,
} : null;

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const config = qboConfig();
  const admin = serviceClient();
  if (!config || !admin) {
    console.error('Missing QuickBooks integration environment configuration.');
    return json(500, { error: 'QuickBooks integration is not configured.' });
  }
  if (request.method === 'GET') return handleCallback(request, admin, config);
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });

  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Authentication required.' });
  const { data: userResult, error: userError } = await admin.auth.getUser(token);
  const actor = userResult.user;
  if (userError || !actor) return json(401, { error: 'Session is invalid or expired.' });

  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return json(400, { error: 'Invalid request body.' }); }
  const companyId = String(input.companyId ?? '');
  const action = String(input.action ?? 'status');
  if (!isUuid(companyId)) return json(400, { error: 'Company is invalid.' });
  if (![...OWNER_ACTIONS, ...FINANCE_ACTIONS].includes(action)) return json(400, { error: 'Action is invalid.' });

  const access = await memberAccess(admin, companyId, actor.id);
  if (OWNER_ACTIONS.includes(action) ? !access.owner : !access.finance) {
    return json(403, { error: OWNER_ACTIONS.includes(action) ? 'Only the company owner can change the QuickBooks connection and settings.' : 'Owner or accounting access required.' });
  }
  const context = await companyContext(admin, config, companyId);
  if (!context.enabled) return json(403, { error: 'QuickBooks sync is not included in this company’s plan.' });
  const actorAdmin = serviceClient(actor.id)!;

  try {
    if (action === 'status') {
      const { data: connection } = await admin.from('company_qbo_connections').select('connected_at,refresh_token_expires_at').eq('company_id', companyId).maybeSingle();
      return json(200, {
        enabled: true, connected: Boolean(context.qbo), environment: config.environment,
        connectedAt: connection?.connected_at ?? null, refreshTokenExpiresAt: connection?.refresh_token_expires_at ?? null,
        settings: settingsView(context.settings as Record<string, unknown> | null), canManage: access.owner,
      });
    }

    if (action === 'connect') {
      const returnTo = validReturnTo(String(input.returnTo ?? ''), request);
      if (!returnTo) return json(400, { error: 'OAuth return URL is invalid.' });
      await admin.from('company_qbo_oauth_states').delete().eq('company_id', companyId);
      const state = crypto.randomUUID();
      const { error } = await admin.from('company_qbo_oauth_states').insert({ state, company_id: companyId, user_id: actor.id, return_to: returnTo, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() });
      if (error) throw error;
      const authorizationUrl = new URL(QBO_AUTHORIZE_URL);
      authorizationUrl.search = new URLSearchParams({ client_id: config.clientId, response_type: 'code', scope: QBO_SCOPE, redirect_uri: config.redirectUri, state }).toString();
      return json(200, { authorizationUrl: authorizationUrl.toString() });
    }

    if (action === 'disconnect') {
      if (context.qbo) {
        try {
          const refreshToken = await decryptValue(context.qbo.connection.encrypted_refresh_token, context.qbo.connection.refresh_token_iv, config.encryptionKey);
          await fetch(QBO_REVOKE_URL, {
            method: 'POST',
            headers: { Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`, 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ token: refreshToken }), signal: AbortSignal.timeout(10000),
          });
        } catch (failure) { console.warn('QuickBooks token revoke failed', failure instanceof Error ? failure.message : failure); }
      }
      const [{ error }, { error: stateError }, { error: settingsError }] = await Promise.all([
        admin.from('company_qbo_connections').delete().eq('company_id', companyId),
        admin.from('company_qbo_oauth_states').delete().eq('company_id', companyId),
        actorAdmin.from('company_qbo_settings').update({ connected: false, updated_by: actor.id, updated_at: new Date().toISOString() }).eq('company_id', companyId),
      ]);
      if (error || stateError || settingsError) return json(500, { error: 'QuickBooks connection could not be removed.' });
      return json(200, { connected: false });
    }

    if (!context.qbo) return json(409, { error: 'Connect QuickBooks in Settings first.' });
    const qbo = context.qbo;

    if (action === 'options') return json(200, await listOptions(qbo));

    if (action === 'save-settings') {
      const syncMode = input.syncMode === 'on_submit' ? 'on_submit' : input.syncMode === 'manual' ? 'manual' : null;
      const refs = Object.fromEntries(['item', 'taxCode', 'terms', 'class', 'department', 'depositAccount', 'paymentMethod'].map(key => [key, refInput(input[key])]));
      if (!syncMode || Object.values(refs).some(value => value === undefined)) return json(400, { error: 'Settings are invalid.' });
      if (!refs.item) return json(400, { error: 'Choose the QuickBooks Product/Service for invoices.' });
      const item = await qbo.read('item', refs.item.id).catch(() => null);
      if (!item || item.Active === false) return json(400, { error: 'That QuickBooks Product/Service is not available. Choose another.' });
      const values = {
        sync_mode: syncMode,
        item_id: refs.item.id, item_name: refs.item.name,
        tax_code_id: refs.taxCode?.id ?? null, tax_code_name: refs.taxCode?.name ?? null,
        terms_id: refs.terms?.id ?? null, terms_name: refs.terms?.name ?? null,
        class_id: refs.class?.id ?? null, class_name: refs.class?.name ?? null,
        department_id: refs.department?.id ?? null, department_name: refs.department?.name ?? null,
        deposit_account_id: refs.depositAccount?.id ?? null, deposit_account_name: refs.depositAccount?.name ?? null,
        payment_method_id: refs.paymentMethod?.id ?? null, payment_method_name: refs.paymentMethod?.name ?? null,
        updated_by: actor.id, updated_at: new Date().toISOString(),
      };
      const { data, error } = await actorAdmin.from('company_qbo_settings').update(values).eq('company_id', companyId).select('*').single();
      if (error) throw error;
      return json(200, { settings: settingsView(data) });
    }

    if (action === 'search-customers') {
      const query = String(input.query ?? '').trim().slice(0, 100);
      const filter = query ? ` and DisplayName like ${qboQueryValue(`%${query.replace(/%/g, '')}%`)}` : '';
      const rows = await qbo.query('Customer', `select Id, DisplayName, CompanyName, PrimaryEmailAddr from Customer where Active = true${filter} orderby DisplayName maxresults 25`);
      return json(200, {
        customers: rows.map(row => ({
          id: String(row.Id), name: String(row.DisplayName ?? ''),
          companyName: typeof row.CompanyName === 'string' ? row.CompanyName : null,
          email: (row.PrimaryEmailAddr as { Address?: string } | undefined)?.Address ?? null,
        })).filter(row => row.id && row.name),
      });
    }

    const customerId = String(input.customerId ?? '');
    if (!isUuid(customerId)) return json(400, { error: 'Customer is invalid.' });
    const { data: customer } = await admin.from('invoice_customers').select('id').eq('id', customerId).eq('company_id', companyId).maybeSingle();
    if (!customer) return json(404, { error: 'Customer not found.' });

    if (action === 'unmap-customer') {
      const { error } = await actorAdmin.from('company_qbo_customer_mappings').delete().eq('company_id', companyId).eq('customer_id', customerId);
      if (error) throw error;
      return json(200, { mapping: null });
    }

    // map-customer
    const qboCustomerId = String(input.qboCustomerId ?? '');
    if (!/^\d{1,32}$/.test(qboCustomerId)) return json(400, { error: 'QuickBooks customer is invalid.' });
    const qboCustomer = await qbo.read('customer', qboCustomerId).catch(() => null);
    if (!qboCustomer || qboCustomer.Active === false) return json(400, { error: 'That QuickBooks customer is not available.' });
    const mapping = { company_id: companyId, customer_id: customerId, qbo_customer_id: qboCustomerId, qbo_customer_name: String(qboCustomer.DisplayName ?? 'QuickBooks customer').slice(0, 500), mapped_by: actor.id, mapped_at: new Date().toISOString() };
    const { error } = await actorAdmin.from('company_qbo_customer_mappings').upsert(mapping, { onConflict: 'company_id,customer_id' });
    if (error) throw error;
    return json(200, { mapping: { customerId, qboCustomerId, qboCustomerName: mapping.qbo_customer_name } });
  } catch (failure) {
    const message = failure instanceof Error && /^QuickBooks/.test(failure.message) ? failure.message : 'QuickBooks request failed. Try again.';
    console.error(`QuickBooks ${action} failed:`, failure);
    return json(502, { error: message });
  }
});
