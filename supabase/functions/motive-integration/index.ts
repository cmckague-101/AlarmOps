import { createClient } from 'npm:@supabase/supabase-js@2.112.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function response(status: number, body: Record<string, unknown>) {
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

async function encryptionKey(secret: string) {
  let raw: Uint8Array;
  try { raw = base64ToBytes(secret); }
  catch { throw new Error('MOTIVE_ENCRYPTION_KEY must be base64 encoded.'); }
  if (raw.byteLength !== 32) throw new Error('MOTIVE_ENCRYPTION_KEY must decode to 32 bytes.');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
}

async function encryptApiKey(apiKey: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(secret);
  const encrypted = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, key, new TextEncoder().encode(apiKey));
  return {encrypted: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv)};
}

async function verifyMotiveKey(apiKey: string) {
  let motiveResponse: Response;
  try {
    motiveResponse = await fetch('https://api.gomotive.com/v1/assets?per_page=1&page_no=1', {
      headers: {'X-API-Key': apiKey, 'Accept': 'application/json'},
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    return {ok: false, status: 502, error: 'Motive could not be reached. Try again.'};
  }
  if (motiveResponse.status === 401 || motiveResponse.status === 403) {
    return {ok: false, status: 400, error: 'Motive rejected this API key. Check key and permissions.'};
  }
  if (!motiveResponse.ok) {
    console.error('Motive verification failed:', motiveResponse.status, await motiveResponse.text());
    return {ok: false, status: 502, error: 'Motive could not verify this key. Try again.'};
  }
  return {ok: true, status: 200, error: ''};
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', {headers: corsHeaders});
  if (request.method !== 'POST') return response(405, {error: 'Method not allowed.'});

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const encryptionSecret = Deno.env.get('MOTIVE_ENCRYPTION_KEY');
  if (!supabaseUrl || !serviceRoleKey || !encryptionSecret) {
    console.error('Missing Motive integration environment configuration.');
    return response(500, {error: 'Motive integration is not configured.'});
  }

  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return response(401, {error: 'Authentication required.'});

  const admin = createClient(supabaseUrl, serviceRoleKey, {auth: {autoRefreshToken: false, persistSession: false}});
  const {data: userResult, error: userError} = await admin.auth.getUser(token);
  const actor = userResult.user;
  if (userError || !actor) return response(401, {error: 'Session is invalid or expired.'});

  let input: {companyId?: string; action?: string; apiKey?: string};
  try { input = await request.json(); }
  catch { return response(400, {error: 'Invalid request body.'}); }

  const companyId = input.companyId?.trim() ?? '';
  const action = input.action ?? 'status';
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) return response(400, {error: 'Company is invalid.'});
  if (!['status', 'save', 'disconnect'].includes(action)) return response(400, {error: 'Action is invalid.'});

  const [{data: ownership, error: ownerError}, {data: scopedAdmin, error: adminError}] = await Promise.all([
    admin.from('company_members').select('user_id').eq('company_id', companyId).eq('user_id', actor.id).eq('role', 'owner').maybeSingle(),
    admin.from('system_admin_company_access').select('user_id').eq('company_id', companyId).eq('user_id', actor.id).gt('expires_at', new Date().toISOString()).maybeSingle(),
  ]);
  if (ownerError || adminError) return response(500, {error: 'Motive access could not be verified.'});
  if (!ownership && !scopedAdmin) return response(403, {error: 'Company owner access required.'});

  if (action === 'status') {
    const {data, error} = await admin.from('company_motive_integrations')
      .select('key_last_four,connected_at,last_verified_at').eq('company_id', companyId).maybeSingle();
    if (error) return response(500, {error: 'Motive connection status could not be loaded.'});
    return response(200, {connected: Boolean(data), lastFour: data?.key_last_four, connectedAt: data?.connected_at, lastVerifiedAt: data?.last_verified_at});
  }

  if (action === 'disconnect') {
    const {error} = await admin.from('company_motive_integrations').delete().eq('company_id', companyId);
    if (error) return response(500, {error: 'Motive connection could not be removed.'});
    return response(200, {connected: false});
  }

  const apiKey = input.apiKey?.trim() ?? '';
  if (apiKey.length < 8 || apiKey.length > 512 || /\s/.test(apiKey)) return response(400, {error: 'Enter a valid Motive API key.'});
  const verification = await verifyMotiveKey(apiKey);
  if (!verification.ok) return response(verification.status, {error: verification.error});

  let encrypted: {encrypted: string; iv: string};
  try { encrypted = await encryptApiKey(apiKey, encryptionSecret); }
  catch (error) {
    console.error('Motive key encryption failed:', error);
    return response(500, {error: 'Motive credential encryption is not configured.'});
  }
  const now = new Date().toISOString();
  const {error: saveError} = await admin.from('company_motive_integrations').upsert({
    company_id: companyId,
    encrypted_api_key: encrypted.encrypted,
    encryption_iv: encrypted.iv,
    key_last_four: apiKey.slice(-4),
    connected_at: now,
    last_verified_at: now,
    updated_by: actor.id,
  });
  if (saveError) {
    console.error('Motive integration save failed:', saveError);
    return response(500, {error: 'Motive API key could not be saved.'});
  }
  return response(200, {connected: true, lastFour: apiKey.slice(-4), connectedAt: now, lastVerifiedAt: now});
});
