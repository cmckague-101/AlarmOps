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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', {headers: corsHeaders});
  if (request.method !== 'POST') return response(405, {error: 'Method not allowed.'});

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return response(500, {error: 'File cleanup service is not configured.'});

  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return response(401, {error: 'Authentication required.'});

  const admin = createClient(supabaseUrl, serviceRoleKey, {auth: {autoRefreshToken: false, persistSession: false}});
  const {data: userResult, error: userError} = await admin.auth.getUser(token);
  const actor = userResult.user;
  if (userError || !actor) return response(401, {error: 'Session is invalid or expired.'});

  let input: {companyId?: string; paths?: unknown};
  try { input = await request.json(); }
  catch { return response(400, {error: 'Invalid request body.'}); }

  const companyId = input.companyId?.trim() ?? '';
  const paths = Array.isArray(input.paths) ? [...new Set(input.paths.filter((path): path is string => typeof path === 'string'))] : [];
  if (!/^[0-9a-f-]{36}$/i.test(companyId) || !paths.length || paths.length > 100) {
    return response(400, {error: 'Company or file list is invalid.'});
  }
  if (paths.some(path => !path.startsWith(`${companyId}/`) || path.includes('..'))) {
    return response(400, {error: 'File path is outside this company.'});
  }

  const [{data: ownership, error: ownerError}, {data: scopedAdmin, error: adminError}] = await Promise.all([
    admin.from('company_members').select('user_id').eq('company_id', companyId).eq('user_id', actor.id).eq('role', 'owner').maybeSingle(),
    admin.from('system_admin_company_access').select('user_id').eq('company_id', companyId).eq('user_id', actor.id).gt('expires_at', new Date().toISOString()).maybeSingle(),
  ]);
  if (ownerError || adminError) return response(500, {error: 'File cleanup access could not be verified.'});
  if (!ownership && !scopedAdmin) return response(403, {error: 'Company owner access required.'});

  // Proven offline-sync copies are canonical files that records, reviews and
  // device history may reference; they are retained, never removed here.
  const {data: protectedPaths, error: protectedError} = await admin.rpc('fleet_sync_protected_copy_paths', {target_company_id: companyId, paths});
  if (protectedError || !Array.isArray(protectedPaths)) return response(500, {error: 'File cleanup access could not be verified.'});
  const removable = paths.filter(path => !protectedPaths.includes(path));
  if (removable.length) {
    const {error: removeError} = await admin.storage.from('fleet-files').remove(removable);
    if (removeError) {
      console.error('Fleet file cleanup failed:', removeError);
      return response(500, {error: 'Files could not be removed.'});
    }
  }
  return response(200, {removed: removable.length, retained: protectedPaths.length});
});
