import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import { parseVerificationRequest, removeStorageObject, verifyAttachmentUpload } from './logic.ts';

// Verifies stored bytes of a reserved fleet sync upload. The service key stays
// server-side; current access is rechecked with the caller's own JWT.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const bucket = 'fleet-sync-files';

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {status, headers: {...corsHeaders, 'Content-Type': 'application/json'}});
}

function rpcError(error: {code?: string; message?: string}) {
  if (error.code === '42501') return response(403, {error: 'Company manager access required.'});
  if (error.code === 'P0002') return response(404, {error: 'Attachment upload reservation not found.'});
  if (error.code === 'PT409') return response(409, {kind: 'in_progress', error: 'Attachment verification is already in progress.'});
  console.error('Attachment verification failed:', error);
  return response(500, {error: 'Attachment verification failed.'});
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', {headers: corsHeaders});
  if (request.method !== 'POST') return response(405, {error: 'Method not allowed.'});

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return response(500, {error: 'Attachment verification is not configured.'});

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
  const target = parseVerificationRequest(input);
  if (!target) return response(400, {error: 'Company or attachment is invalid.'});

  const rpc = async (client: typeof admin, name: string, args: Record<string, unknown>) => {
    const {data, error} = await client.rpc(name, args);
    if (error) throw error;
    return data;
  };
  try {
    const result = await verifyAttachmentUpload(target, {
      begin: (companyId, attachmentId) => rpc(user, 'begin_fleet_sync_attachment_verification', {target_company_id: companyId, target_attachment_id: attachmentId}),
      open: async (path) => {
        const encoded = path.split('/').map(encodeURIComponent).join('/');
        const stored = await fetch(`${supabaseUrl}/storage/v1/object/authenticated/${bucket}/${encoded}`, {
          headers: {Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey},
        });
        if (stored.status === 404 || stored.status === 400) { await stored.body?.cancel(); return null; }
        if (!stored.ok || !stored.body) throw new Error(`Storage read failed with ${stored.status}`);
        return stored.body;
      },
      sha256: async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join(''),
      complete: (lease, objectId, size, digest) => rpc(admin, 'complete_fleet_sync_attachment_verification', {lease, observed_object_id: objectId, observed_size: size, observed_digest: digest}),
      authorizeRemoval: (lease) => rpc(admin, 'authorize_fleet_sync_attachment_mismatch_removal', {lease}),
      remove: (path) => removeStorageObject(fetch, supabaseUrl, serviceRoleKey, bucket, path),
      release: (lease, removed) => rpc(admin, 'release_fleet_sync_attachment_verification', {lease, removed}),
    });
    return response(result.status, result.body);
  } catch (error) {
    return rpcError(error as {code?: string; message?: string});
  }
});
