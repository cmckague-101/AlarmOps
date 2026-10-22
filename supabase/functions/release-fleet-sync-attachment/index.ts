import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import { parseReleaseRequest, releaseStagingObject } from './logic.ts';

// Explicit user release of an unattached or rejected sync upload. The caller's
// JWT authorizes the release; the service key only deletes the staging object.
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
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return response(500, {error: 'Attachment release is not configured.'});
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
  try {
    const result = await releaseStagingObject({...target, userId: userResult.user.id}, {
      request: (value) => rpc(user, 'request_fleet_sync_attachment_release', {target_company_id: value.companyId, target_attachment_id: value.attachmentId}),
      remove: async (path) => { const {error} = await admin.storage.from('fleet-sync-files').remove([path]); if (error) throw error; },
      confirm: (value) => rpc(admin, 'confirm_fleet_sync_attachment_release', {target_company_id: value.companyId, target_user_id: value.userId, target_attachment_id: value.attachmentId}),
      // Only after the caller's own JWT proved current access and an applied result.
      applied: (value) => rpc(admin, 'request_fleet_sync_attachment_applied_release', {target_company_id: value.companyId, target_user_id: value.userId, target_attachment_id: value.attachmentId}),
    });
    return response(200, result);
  } catch (error) {
    const code = (error as {code?: string}).code;
    if (code === '42501') return response(403, {kind: 'access_revoked', error: 'Company manager access required.'});
    if (code === 'P0002') return response(404, {kind: 'not_found', error: 'Attachment upload reservation not found.'});
    if (code === 'PT409') return response(409, {kind: 'in_use', error: 'This upload is still in use by a document request or verification.'});
    console.error('Attachment release failed:', error);
    return response(500, {error: 'Attachment release failed.'});
  }
});
