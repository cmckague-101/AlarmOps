import { createClient } from 'npm:@supabase/supabase-js@2.112.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const motiveScopes = [
  'companies.read',
  'vehicles.read',
  'assets.read',
  'locations.vehicle_locations_list',
  'locations.vehicle_locations_single',
  'locations.asset_locations',
  'camera_connections.read',
].join(' ');

// Database types are not generated for Edge Functions; keep service client schema-dynamic.
type AdminClient = any;
type EncryptedValue = {encrypted: string; iv: string};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {...corsHeaders, 'Content-Type': 'application/json'},
  });
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey(secret: string, usages: KeyUsage[]) {
  let raw: Uint8Array<ArrayBuffer>;
  try { raw = base64ToBytes(secret); }
  catch { throw new Error('MOTIVE_ENCRYPTION_KEY must be base64 encoded.'); }
  if (raw.byteLength !== 32) throw new Error('MOTIVE_ENCRYPTION_KEY must decode to 32 bytes.');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, usages);
}

async function encryptValue(value: string, secret: string): Promise<EncryptedValue> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(secret, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, key, new TextEncoder().encode(value));
  return {encrypted: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv)};
}

async function decryptValue(encrypted: string, iv: string, secret: string) {
  const key = await encryptionKey(secret, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt({name: 'AES-GCM', iv: base64ToBytes(iv)}, key, base64ToBytes(encrypted));
  return new TextDecoder().decode(decrypted);
}

function redirectWithResult(returnTo: string, values: Record<string, string>) {
  const url = new URL(returnTo);
  Object.entries(values).forEach(([key, value]) => url.searchParams.set(key, value));
  return Response.redirect(url.toString(), 302);
}

function validReturnTo(value: string, request: Request) {
  try {
    const target = new URL(value);
    if (target.protocol === 'fireops:' && target.hostname === 'settings') return target.toString();
    const requestOrigin = request.headers.get('Origin');
    if (requestOrigin && (target.protocol === 'https:' || target.protocol === 'http:') && target.origin === requestOrigin) return target.toString();
    const allowed = (Deno.env.get('MOTIVE_ALLOWED_RETURN_URLS') ?? '').split(',').map(item => item.trim()).filter(Boolean);
    return allowed.some(item => target.toString().startsWith(item)) ? target.toString() : '';
  } catch {
    return '';
  }
}

async function ownerCanManage(admin: AdminClient, companyId: string, userId: string) {
  const [{data: ownership, error: ownerError}, {data: scopedAdmin, error: adminError}] = await Promise.all([
    admin.from('company_members').select('user_id').eq('company_id', companyId).eq('user_id', userId).eq('role', 'owner').maybeSingle(),
    admin.from('system_admin_company_access').select('user_id').eq('company_id', companyId).eq('user_id', userId).gt('expires_at', new Date().toISOString()).maybeSingle(),
  ]);
  if (ownerError || adminError) throw new Error('Motive access could not be verified.');
  return Boolean(ownership || scopedAdmin);
}

async function handleCallback(request: Request, admin: AdminClient, encryptionSecret: string, redirectUri: string) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(state)) return jsonResponse(400, {error: 'OAuth state is invalid.'});

  const {data: pending, error: stateError} = await admin.from('company_motive_oauth_states')
    .delete().eq('state', state).gt('expires_at', new Date().toISOString())
    .select('company_id,user_id,return_to').maybeSingle();
  if (stateError || !pending) return jsonResponse(400, {error: 'OAuth request expired or was already used.'});

  const motiveError = url.searchParams.get('error');
  if (motiveError) return redirectWithResult(pending.return_to, {motive: 'error', motive_error: 'Motive authorization was denied.'});
  const code = url.searchParams.get('code') ?? '';
  if (!code) return redirectWithResult(pending.return_to, {motive: 'error', motive_error: 'Motive did not return an authorization code.'});

  const {data: integration, error: integrationError} = await admin.from('company_motive_integrations')
    .select('encrypted_client_id,client_id_iv,encrypted_client_secret,client_secret_iv')
    .eq('company_id', pending.company_id).maybeSingle();
  if (integrationError || !integration) return redirectWithResult(pending.return_to, {motive: 'error', motive_error: 'Motive credentials are no longer configured.'});

  try {
    const [clientId, clientSecret] = await Promise.all([
      decryptValue(integration.encrypted_client_id, integration.client_id_iv, encryptionSecret),
      decryptValue(integration.encrypted_client_secret, integration.client_secret_iv, encryptionSecret),
    ]);
    const tokenResponse = await fetch('https://api.gomotive.com/oauth/token', {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json'},
      body: new URLSearchParams({grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret}),
      signal: AbortSignal.timeout(12000),
    });
    const tokenBody = await tokenResponse.json().catch(() => null) as {access_token?: string;refresh_token?: string;expires_in?: number;scope?: string}|null;
    if (!tokenResponse.ok || !tokenBody?.access_token || !tokenBody.refresh_token) {
      console.error('Motive token exchange failed with status:', tokenResponse.status);
      return redirectWithResult(pending.return_to, {motive: 'error', motive_error: 'Motive could not complete authorization. Try again.'});
    }
    const [accessToken, refreshToken] = await Promise.all([
      encryptValue(tokenBody.access_token, encryptionSecret),
      encryptValue(tokenBody.refresh_token, encryptionSecret),
    ]);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + Math.max(60, Number(tokenBody.expires_in) || 7200) * 1000).toISOString();
    const {error: saveError} = await admin.from('company_motive_integrations').update({
      encrypted_access_token: accessToken.encrypted,
      access_token_iv: accessToken.iv,
      encrypted_refresh_token: refreshToken.encrypted,
      refresh_token_iv: refreshToken.iv,
      token_expires_at: expiresAt,
      scopes: tokenBody.scope || motiveScopes,
      connected_at: now.toISOString(),
      last_verified_at: now.toISOString(),
      updated_by: pending.user_id,
    }).eq('company_id', pending.company_id);
    if (saveError) throw saveError;
    return redirectWithResult(pending.return_to, {motive: 'connected'});
  } catch (error) {
    console.error('Motive OAuth callback failed:', error);
    return redirectWithResult(pending.return_to, {motive: 'error', motive_error: 'Motive connection could not be saved. Try again.'});
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', {headers: corsHeaders});

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const encryptionSecret = Deno.env.get('MOTIVE_ENCRYPTION_KEY');
  const redirectUri = Deno.env.get('MOTIVE_REDIRECT_URI');
  if (!supabaseUrl || !serviceRoleKey || !encryptionSecret || !redirectUri) {
    console.error('Missing Motive integration environment configuration.');
    return jsonResponse(500, {error: 'Motive integration is not configured.'});
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {auth: {autoRefreshToken: false, persistSession: false}});
  if (request.method === 'GET') return handleCallback(request, admin, encryptionSecret, redirectUri);
  if (request.method !== 'POST') return jsonResponse(405, {error: 'Method not allowed.'});

  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return jsonResponse(401, {error: 'Authentication required.'});
  const {data: userResult, error: userError} = await admin.auth.getUser(token);
  const actor = userResult.user;
  if (userError || !actor) return jsonResponse(401, {error: 'Session is invalid or expired.'});

  let input: {companyId?: string;action?: string;clientId?: string;clientSecret?: string;returnTo?: string};
  try { input = await request.json(); }
  catch { return jsonResponse(400, {error: 'Invalid request body.'}); }

  const companyId = input.companyId?.trim() ?? '';
  const action = input.action ?? 'status';
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) return jsonResponse(400, {error: 'Company is invalid.'});
  if (!['status', 'connect', 'disconnect'].includes(action)) return jsonResponse(400, {error: 'Action is invalid.'});
  try {
    if (!await ownerCanManage(admin, companyId, actor.id)) return jsonResponse(403, {error: 'Company owner access required.'});
  } catch {
    return jsonResponse(500, {error: 'Motive access could not be verified.'});
  }

  if (action === 'status') {
    const {data, error} = await admin.from('company_motive_integrations')
      .select('client_id_last_four,encrypted_access_token,connected_at,last_verified_at,token_expires_at').eq('company_id', companyId).maybeSingle();
    if (error) return jsonResponse(500, {error: 'Motive connection status could not be loaded.'});
    return jsonResponse(200, {
      configured: Boolean(data),
      connected: Boolean(data?.encrypted_access_token),
      clientIdLastFour: data?.client_id_last_four,
      connectedAt: data?.connected_at,
      lastVerifiedAt: data?.last_verified_at,
      tokenExpiresAt: data?.token_expires_at,
    });
  }

  if (action === 'disconnect') {
    const [{error}, {error: stateDeleteError}] = await Promise.all([
      admin.from('company_motive_integrations').delete().eq('company_id', companyId),
      admin.from('company_motive_oauth_states').delete().eq('company_id', companyId),
    ]);
    if (error || stateDeleteError) return jsonResponse(500, {error: 'Motive connection could not be removed.'});
    return jsonResponse(200, {connected: false, configured: false});
  }

  const clientId = input.clientId?.trim() ?? '';
  const clientSecret = input.clientSecret?.trim() ?? '';
  const returnTo = validReturnTo(input.returnTo?.trim() ?? '', request);
  if (clientId.length < 8 || clientId.length > 512 || /\s/.test(clientId)) return jsonResponse(400, {error: 'Enter a valid Motive client ID.'});
  if (clientSecret.length < 8 || clientSecret.length > 1024) return jsonResponse(400, {error: 'Enter a valid Motive client secret.'});
  if (!returnTo) return jsonResponse(400, {error: 'OAuth return URL is invalid.'});

  try {
    const [encryptedClientId, encryptedClientSecret] = await Promise.all([
      encryptValue(clientId, encryptionSecret),
      encryptValue(clientSecret, encryptionSecret),
    ]);
    const now = new Date().toISOString();
    const {error: saveError} = await admin.from('company_motive_integrations').upsert({
      company_id: companyId,
      encrypted_client_id: encryptedClientId.encrypted,
      client_id_iv: encryptedClientId.iv,
      encrypted_client_secret: encryptedClientSecret.encrypted,
      client_secret_iv: encryptedClientSecret.iv,
      client_id_last_four: clientId.slice(-4),
      encrypted_access_token: null,
      access_token_iv: null,
      encrypted_refresh_token: null,
      refresh_token_iv: null,
      token_expires_at: null,
      scopes: motiveScopes,
      connected_at: null,
      last_verified_at: null,
      updated_by: actor.id,
    });
    if (saveError) throw saveError;

    await admin.from('company_motive_oauth_states').delete().eq('company_id', companyId);
    const state = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const {error: stateError} = await admin.from('company_motive_oauth_states').insert({state, company_id: companyId, user_id: actor.id, return_to: returnTo, expires_at: expiresAt});
    if (stateError) throw stateError;

    const authorizationUrl = new URL('https://gomotive.com/oauth/authorize');
    authorizationUrl.search = new URLSearchParams({client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: motiveScopes, state}).toString();
    return jsonResponse(200, {authorizationUrl: authorizationUrl.toString()});
  } catch (error) {
    console.error('Motive OAuth setup failed:', error);
    return jsonResponse(500, {error: 'Motive authorization could not be started.'});
  }
});
