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

function messageForDatabaseError(message: string) {
  if (message.includes('crew invite limit reached')) return 'Company crew invite limit reached.';
  if (message.includes('duplicate key')) return 'This person is already on your crew.';
  return 'Invitation could not be created.';
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', {headers: corsHeaders});
  if (request.method !== 'POST') return response(405, {error: 'Method not allowed.'});

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const appUrl = Deno.env.get('APP_URL');
  if (!supabaseUrl || !serviceRoleKey || !appUrl) {
    console.error('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or APP_URL');
    return response(500, {error: 'Invitation service is not configured.'});
  }

  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return response(401, {error: 'Authentication required.'});

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {autoRefreshToken: false, persistSession: false},
  });
  const {data: userResult, error: userError} = await admin.auth.getUser(token);
  const actor = userResult.user;
  if (userError || !actor) return response(401, {error: 'Session is invalid or expired.'});

  let input: {companyId?: string; email?: string; name?: string; phone?: string};
  try {
    input = await request.json();
  } catch {
    return response(400, {error: 'Invalid request body.'});
  }

  const companyId = input.companyId?.trim() ?? '';
  const email = input.email?.trim().toLowerCase() ?? '';
  const phone = input.phone?.trim() ?? '';
  const suppliedName = input.name?.trim() ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) return response(400, {error: 'Company is invalid.'});
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) return response(400, {error: 'Enter a valid email address.'});
  if (suppliedName.length > 120 || phone.length > 30) return response(400, {error: 'Crew details are too long.'});

  const [{data: ownership}, {data: systemAdmin}, {data: company, error: companyError}] = await Promise.all([
    admin.from('company_members').select('user_id').eq('company_id', companyId).eq('user_id', actor.id).eq('role', 'owner').maybeSingle(),
    admin.from('system_admins').select('user_id').eq('user_id', actor.id).maybeSingle(),
    admin.from('companies').select('name').eq('id', companyId).maybeSingle(),
  ]);
  if (companyError || !company) return response(404, {error: 'Company not found.'});
  if (!ownership && !systemAdmin) return response(403, {error: 'Company owner access required.'});

  const {data: existingProfile} = await admin.from('profiles').select('user_id').ilike('email', email).maybeSingle();
  if (existingProfile) return response(409, {error: 'This email already belongs to a FireOps account.'});

  const fallbackName = email.split('@')[0].split(/[._-]/).filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  const name = suppliedName || fallbackName || 'Invited crew member';
  const redirectTo = `${appUrl.replace(/\/$/, '')}/accept-invite`;
  const {data: invite, error: inviteError} = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: {full_name: name, company_id: companyId, company_name: company.name, role: 'member'},
  });
  if (inviteError || !invite.user) {
    console.error('Auth invitation failed:', inviteError);
    return response(inviteError?.status === 429 ? 429 : 400, {
      error: inviteError?.status === 429 ? 'Email rate limit reached. Wait a few minutes and try again.' : 'Invitation email could not be sent.',
    });
  }

  const member = {id: invite.user.id, name, email, phone, role: 'member', status: 'Invited'};
  const {error: membershipError} = await admin.from('company_members').insert({
    company_id: companyId,
    user_id: invite.user.id,
    role: 'member',
  });
  if (membershipError) {
    console.error('Membership creation failed:', membershipError);
    await admin.auth.admin.deleteUser(invite.user.id);
    return response(membershipError.code === '23514' ? 409 : 400, {error: messageForDatabaseError(membershipError.message)});
  }

  const {data: crewRow, error: crewError} = await admin.from('fleet_crew').insert({
    company_id: companyId,
    record_id: invite.user.id,
    data: member,
    version: 1,
    updated_by: actor.id,
  }).select('version').single();
  if (crewError) {
    console.error('Crew record creation failed:', crewError);
    await admin.from('company_members').delete().eq('company_id', companyId).eq('user_id', invite.user.id);
    await admin.auth.admin.deleteUser(invite.user.id);
    return response(crewError.code === '23514' ? 409 : 400, {error: messageForDatabaseError(crewError.message)});
  }

  return response(200, {member, version: crewRow.version});
});
