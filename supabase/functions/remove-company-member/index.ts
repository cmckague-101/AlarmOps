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
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error('Missing Supabase Edge Function environment variables');
    return response(500, {error: 'Crew removal service is not configured.'});
  }

  const authorization = request.headers.get('Authorization');
  const token = authorization?.replace(/^Bearer\s+/i, '');
  if (!authorization || !token) return response(401, {error: 'Authentication required.'});

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {autoRefreshToken: false, persistSession: false},
  });
  const {data: userResult, error: userError} = await admin.auth.getUser(token);
  const actor = userResult.user;
  if (userError || !actor) return response(401, {error: 'Session is invalid or expired.'});

  let input: {companyId?: string; userId?: string};
  try {
    input = await request.json();
  } catch {
    return response(400, {error: 'Invalid request body.'});
  }
  const companyId = input.companyId?.trim() ?? '';
  const userId = input.userId?.trim() ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(companyId) || !/^[0-9a-f-]{36}$/i.test(userId)) {
    return response(400, {error: 'Company or crew member is invalid.'});
  }
  if (userId === actor.id) return response(403, {error: 'Company owners cannot remove themselves.'});

  // Run existing security-definer function with caller JWT so database remains
  // source of truth for owner/admin authorization and owner protection.
  const caller = createClient(supabaseUrl, anonKey, {
    global: {headers: {Authorization: authorization}},
    auth: {autoRefreshToken: false, persistSession: false},
  });
  const {data: removed, error: removeError} = await caller.rpc('remove_company_member', {
    target_company_id: companyId,
    target_user_id: userId,
  });
  if (removeError) return response(removeError.code === '42501' ? 403 : 400, {error: removeError.message});
  if (!removed) return response(404, {error: 'Crew membership was not found.'});

  const {error: crewError} = await admin.from('fleet_crew').delete()
    .eq('company_id', companyId).eq('record_id', userId);
  if (crewError) console.error('Crew record cleanup failed:', crewError);

  const [{count: membershipCount, error: countError}, {data: systemAdmin, error: adminError}] = await Promise.all([
    admin.from('company_members').select('company_id', {count: 'exact', head: true}).eq('user_id', userId),
    admin.from('system_admins').select('user_id').eq('user_id', userId).maybeSingle(),
  ]);
  if (countError || adminError) {
    console.error('Account cleanup eligibility check failed:', countError ?? adminError);
    return response(200, {removed: true, accountDeleted: false, crewDeleted: !crewError});
  }

  let accountDeleted = false;
  if ((membershipCount ?? 0) === 0 && !systemAdmin) {
    // Profile deletion is restricted while fleet rows reference it. Transfer
    // technical updated_by ownership to remover while preserving record data.
    const attributionTables = ['fleet_state', 'fleet_vehicles', 'fleet_issues', 'fleet_crew', 'fleet_activities'];
    const attributionResults = await Promise.all(
      attributionTables.map((table) => admin.from(table).update({updated_by: actor.id}).eq('updated_by', userId)),
    );
    const attributionError = attributionResults.find((result) => result.error)?.error;
    if (attributionError) {
      console.error('Record attribution cleanup failed:', attributionError);
    } else {
      const {error: deleteUserError} = await admin.auth.admin.deleteUser(userId);
      if (deleteUserError) console.error('Auth account deletion failed:', deleteUserError);
      else accountDeleted = true;
    }
  }

  return response(200, {
    removed: true,
    accountDeleted,
    accountRetained: !accountDeleted,
    crewDeleted: !crewError,
  });
});
