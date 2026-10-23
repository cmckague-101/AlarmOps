import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import { attachFleetSyncDocument, parseAttachRequest } from './logic.ts';
import { removeStorageObject } from '../verify-fleet-sync-attachment/logic.ts';

// Attaches a receipt-verified sync upload as one vehicle document. The service
// key never reaches clients; record changes run with the caller's own JWT.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {status, headers: {...corsHeaders, 'Content-Type': 'application/json'}});
}

function rpcError(error: {code?: string; message?: string}) {
  if (error.code === '42501') return response(403, {kind: 'access_revoked', error: 'Company manager access required.'});
  if (error.code === 'P0002') return response(404, {error: 'Attachment upload reservation not found.'});
  if (error.code === 'PT409') return response(409, {kind: 'conflict', error: 'This attachment already has a different document request.'});
  if (error.code === '22023') return response(400, {kind: 'invalid', error: 'Attachment document request is invalid.'});
  if (error.code === '55000') return response(409, {kind: 'not_ready', error: 'Attachment bytes or copy are not verified yet.'});
  console.error('Attachment document failed:', error);
  return response(500, {error: 'Attachment document failed.'});
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', {headers: corsHeaders});
  if (request.method !== 'POST') return response(405, {error: 'Method not allowed.'});

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return response(500, {error: 'Attachment documents are not configured.'});

  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return response(401, {error: 'Authentication required.'});
  const admin = createClient(supabaseUrl, serviceRoleKey, {auth: {autoRefreshToken: false, persistSession: false}});
  const {data: userResult, error: userError} = await admin.auth.getUser(token);
  if (userError || !userResult.user) return response(401, {error: 'Session is invalid or expired.'});
  const user = createClient(supabaseUrl, anonKey, {
    auth: {autoRefreshToken: false, persistSession: false},
    global: {headers: {Authorization: `Bearer ${token}`}},
  });

  let input: unknown;
  try { input = await request.json(); } catch { return response(400, {error: 'Invalid request body.'}); }
  const target = parseAttachRequest(input);
  if (!target || target.userId !== userResult.user.id) return response(400, {error: 'Attachment document request is invalid.'});

  const rpc = async (client: typeof admin, name: string, args: Record<string, unknown>) => {
    const {data, error} = await client.rpc(name, args);
    if (error) throw error;
    return data;
  };
  try {
    const result = await attachFleetSyncDocument(target, {
      begin: (body) => rpc(user, 'begin_fleet_sync_document_attach', {attach_request: body}),
      complete: (body) => rpc(user, 'complete_fleet_sync_document_attach', {attach_request: body}),
      open: async (bucket, path) => {
        const encoded = path.split('/').map(encodeURIComponent).join('/');
        const stored = await fetch(`${supabaseUrl}/storage/v1/object/authenticated/${bucket}/${encoded}`, {
          headers: {Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey},
        });
        if (stored.status === 404 || stored.status === 400) { await stored.body?.cancel(); return null; }
        if (!stored.ok || !stored.body) throw new Error(`Storage read failed with ${stored.status}`);
        return stored.body;
      },
      put: async (path, bytes, contentType) => {
        const {error} = await admin.storage.from('fleet-files').upload(path, bytes, {contentType, upsert: false});
        if (!error) return 'stored';
        const status = String((error as {statusCode?: unknown}).statusCode ?? '');
        if (status === '409' || /already exists|duplicate/i.test(error.message)) return 'exists';
        throw error;
      },
      authorizeRemoval: (value) => rpc(admin, 'authorize_fleet_sync_copy_removal', {target_company_id: value.companyId, target_user_id: value.userId, target_attachment_id: value.attachmentId}),
      remove: (path) => removeStorageObject(fetch, supabaseUrl, serviceRoleKey, 'fleet-files', path),
      sha256: async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join(''),
      release: {
        request: (value) => rpc(admin, 'request_fleet_sync_attachment_applied_release', {target_company_id: value.companyId, target_user_id: value.userId, target_attachment_id: value.attachmentId}),
        remove: async (path) => { const {error} = await admin.storage.from('fleet-sync-files').remove([path]); if (error) throw error; },
        confirm: (value) => rpc(admin, 'confirm_fleet_sync_attachment_release', {target_company_id: value.companyId, target_user_id: value.userId, target_attachment_id: value.attachmentId}),
      },
      recordCopy: (value, size, digest) => rpc(admin, 'record_fleet_sync_document_copy', {
        target_company_id: value.companyId, target_user_id: value.userId, target_attachment_id: value.attachmentId, observed_size: size, observed_digest: digest,
      }),
    });
    return response(result.status, result.body);
  } catch (error) {
    return rpcError(error as {code?: string; message?: string});
  }
});
