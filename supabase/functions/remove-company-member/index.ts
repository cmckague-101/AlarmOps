import { createClient } from 'npm:@supabase/supabase-js@2.112.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type AttributionChange = {
  collection: 'vehicles' | 'issues' | 'crew' | 'activities';
  record: Record<string, unknown>;
  version: number;
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
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing Supabase Edge Function environment variables');
    return response(500, {error: 'Crew removal service is not configured.'});
  }

  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return response(401, {error: 'Authentication required.'});

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

  const [ownershipResult, actorAdminResult, targetResult, targetAdminResult, membershipCountResult] = await Promise.all([
    admin.from('company_members').select('user_id').eq('company_id', companyId).eq('user_id', actor.id).eq('role', 'owner').maybeSingle(),
    admin.from('system_admins').select('user_id').eq('user_id', actor.id).maybeSingle(),
    admin.from('company_members').select('role').eq('company_id', companyId).eq('user_id', userId).maybeSingle(),
    admin.from('system_admins').select('user_id').eq('user_id', userId).maybeSingle(),
    admin.from('company_members').select('company_id', {count: 'exact', head: true}).eq('user_id', userId),
  ]);
  const lookupError = ownershipResult.error ?? actorAdminResult.error ?? targetResult.error ?? targetAdminResult.error ?? membershipCountResult.error;
  if (lookupError) {
    console.error('Crew removal authorization lookup failed:', lookupError);
    return response(500, {error: 'Crew member could not be verified.'});
  }
  if (!ownershipResult.data && !actorAdminResult.data) return response(403, {error: 'Company owner access required.'});
  if (!targetResult.data) return response(404, {error: 'Crew membership was not found.'});
  if (targetResult.data.role !== 'member') return response(403, {error: 'Company owner cannot be removed.'});

  const {error: crewError} = await admin.from('fleet_crew').delete()
    .eq('company_id', companyId).eq('record_id', userId);
  if (crewError) console.error('Crew record cleanup failed:', crewError);

  const accountEligible = (membershipCountResult.count ?? 0) === 1 && !targetAdminResult.data;
  const attributionChanges: AttributionChange[] = [];
  let accountDeleted = false;
  let accountCleanupFailed = false;

  if (accountEligible) {
    // Auth deletion cascades profile deletion. Transfer technical updated_by
    // references first, and return new versions so current UI cannot save stale rows.
    const normalizedTables = [
      {table: 'fleet_vehicles', collection: 'vehicles' as const},
      {table: 'fleet_issues', collection: 'issues' as const},
      {table: 'fleet_crew', collection: 'crew' as const},
      {table: 'fleet_activities', collection: 'activities' as const},
    ];
    const [legacyResult, ...normalizedResults] = await Promise.all([
      admin.from('fleet_state').update({updated_by: actor.id}).eq('updated_by', userId),
      ...normalizedTables.map(({table}) => admin.from(table).update({updated_by: actor.id}).eq('updated_by', userId).select('data,version')),
    ]);
    const attributionError = legacyResult.error ?? normalizedResults.find((result) => result.error)?.error;
    normalizedResults.forEach((result, index) => {
      if (result.error) return;
      for (const row of result.data ?? []) {
        attributionChanges.push({collection: normalizedTables[index].collection, record: row.data, version: row.version});
      }
    });

    if (attributionError) {
      accountCleanupFailed = true;
      console.error('Record attribution cleanup failed:', attributionError);
    } else {
      const {error: deleteUserError} = await admin.auth.admin.deleteUser(userId);
      if (deleteUserError) {
        accountCleanupFailed = true;
        console.error('Auth account deletion failed:', deleteUserError);
      } else {
        accountDeleted = true;
      }
    }
  }

  // Auth deletion cascades membership. Otherwise revoke only this company.
  if (!accountDeleted) {
    const {error: membershipError} = await admin.from('company_members').delete()
      .eq('company_id', companyId).eq('user_id', userId).eq('role', 'member');
    if (membershipError) {
      console.error('Membership removal failed:', membershipError);
      return response(500, {error: 'Company access could not be revoked.'});
    }
  }

  return response(200, {
    removed: true,
    accountDeleted,
    accountRetained: !accountDeleted,
    accountCleanupFailed,
    crewDeleted: !crewError,
    attributionChanges,
  });
});
