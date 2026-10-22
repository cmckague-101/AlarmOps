import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import { parseReleaseRequest } from '../release-fleet-sync-attachment/logic.ts';
import { prepareSlotCopy } from './logic.ts';

// Copies a receipt-verified sync upload into fleet-files for a vehicle file
// slot. Caller JWT authorizes; the service key only reads/writes Storage and
// records the hash proof.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {status, headers: {...corsHeaders, 'Content-Type': 'application/json'}});
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', {headers: corsHeaders});
  if (request.method !== 'POST') return response(405, {error: 'Method not allowed.'});
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return response(500, {error: 'Vehicle file copies are not configured.'});
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return response(401, {error: 'Authentication required.'});
  const admin = createClient(supabaseUrl, serviceRoleKey, {auth: {autoRefreshToken: false, persistSession: false}});
  const {data: userResult, error: userError} = await admin.auth.getUser(token);
  if (userError || !userResult.user) return response(401, {error: 'Session is invalid or expired.'});
  const user = createClient(supabaseUrl, anonKey, {auth: {autoRefreshToken: false, persistSession: false}, global: {headers: {Authorization: `Bearer ${token}`}}});
  let input: unknown;
  try { input = await request.json(); } catch { return response(400, {error: 'Invalid request body.'}); }
  const target = parseReleaseRequest(input);
  if (!target) return response(400, {error: 'Company or attachment is invalid.'});
  const rpc = async (client: typeof admin, name: string, args: Record<string, unknown>) => {
    const {data, error} = await client.rpc(name, args);
    if (error) throw error;
    return data;
  };
  const identity = (value: {companyId: string; userId: string; attachmentId: string}) => ({target_company_id: value.companyId, target_user_id: value.userId, target_attachment_id: value.attachmentId});
  const read = async (bucket: string, path: string) => {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const stored = await fetch(`${supabaseUrl}/storage/v1/object/authenticated/${bucket}/${encoded}`, {headers: {Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey}});
    if (stored.status === 404 || stored.status === 400) { await stored.body?.cancel(); return null; }
    if (!stored.ok || !stored.body) throw new Error(`Storage read failed with ${stored.status}`);
    return stored.body;
  };
  try {
    const result = await prepareSlotCopy({...target, userId: userResult.user.id}, {
      begin: (companyId, attachmentId) => rpc(user, 'begin_fleet_sync_attachment_copy', {target_company_id: companyId, target_attachment_id: attachmentId}),
      open: read,
      put: async (path, bytes, contentType) => {
        const {error} = await admin.storage.from('fleet-files').upload(path, bytes, {contentType, upsert: false});
        if (!error) return 'stored';
        const status = String((error as {statusCode?: unknown}).statusCode ?? '');
        if (status === '409' || /already exists|duplicate/i.test(error.message)) return 'exists';
        throw error;
      },
      remove: async (path) => { const {error} = await admin.storage.from('fleet-files').remove([path]); if (error) throw error; },
      sha256: async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join(''),
      recordCopy: (value, size, digest) => rpc(admin, 'record_fleet_sync_attachment_copy', {...identity(value), observed_size: size, observed_digest: digest}),
      release: {
        request: (value) => rpc(user, 'request_fleet_sync_attachment_release', {target_company_id: value.companyId, target_attachment_id: value.attachmentId}),
        remove: async (path) => { const {error} = await admin.storage.from('fleet-sync-files').remove([path]); if (error) throw error; },
        confirm: (value) => rpc(admin, 'confirm_fleet_sync_attachment_release', identity(value)),
      },
    });
    return response(result.status, result.body);
  } catch (error) {
    const code = (error as {code?: string}).code;
    if (code === '42501') return response(403, {kind: 'access_revoked', error: 'Company manager access required.'});
    if (code === 'P0002') return response(404, {kind: 'not_found', error: 'Attachment upload reservation not found.'});
    if (code === 'PT409') return response(409, {kind: 'conflict', error: 'This upload is already used for another vehicle file.'});
    if (code === '22023') return response(400, {kind: 'invalid', error: 'This upload cannot fill a vehicle file slot.'});
    if (code === '55000') return response(409, {kind: 'not_ready', error: 'Attachment bytes are not verified yet.'});
    console.error('Vehicle file copy failed:', error);
    return response(500, {error: 'Vehicle file copy failed.'});
  }
});
