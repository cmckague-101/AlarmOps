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

  const authClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {autoRefreshToken: false, persistSession: false},
  });
  const {data: userResult, error: userError} = await authClient.auth.getUser(token);
  const actor = userResult.user;
  if (userError || !actor) return response(401, {error: 'Session is invalid or expired.'});
  // Forward only the verified identity; audit triggers trust this header solely
  // on service-role requests, never on requests from app clients.
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {autoRefreshToken: false, persistSession: false},
    global: {headers: {'x-fireops-actor-id': actor.id}},
  });

  let input: {action?: 'invite' | 'resend'; companyId?: string; userId?: string; email?: string; name?: string; phone?: string};
  try {
    input = await request.json();
  } catch {
    return response(400, {error: 'Invalid request body.'});
  }

  const action = input.action ?? 'invite';
  if (action !== 'invite' && action !== 'resend') return response(400, {error: 'Invitation action is invalid.'});
  const companyId = input.companyId?.trim() ?? '';
  const userId = input.userId?.trim() ?? '';
  const email = input.email?.trim().toLowerCase() ?? '';
  const phone = input.phone?.trim() ?? '';
  const suppliedName = input.name?.trim() ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) return response(400, {error: 'Company is invalid.'});
  if (action === 'resend' && !/^[0-9a-f-]{36}$/i.test(userId)) return response(400, {error: 'Crew member is invalid.'});
  if (action === 'invite' && (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254)) return response(400, {error: 'Enter a valid email address.'});
  if (suppliedName.length > 120 || phone.length > 30) return response(400, {error: 'Crew details are too long.'});

  const [{data: ownership}, {data: systemAdmin}, {data: company, error: companyError}] = await Promise.all([
    admin.from('company_members').select('user_id').eq('company_id', companyId).eq('user_id', actor.id).eq('role', 'owner').maybeSingle(),
    admin.from('system_admin_company_access').select('user_id').eq('company_id', companyId).eq('user_id', actor.id).gt('expires_at', new Date().toISOString()).maybeSingle(),
    admin.from('companies').select('name').eq('id', companyId).maybeSingle(),
  ]);
  if (companyError || !company) return response(404, {error: 'Company not found.'});
  if (!ownership && !systemAdmin) return response(403, {error: 'Company owner access required.'});

  const redirectTo = `${appUrl.replace(/\/$/, '')}/accept-invite`;
  if (action === 'resend') {
    const [{data: membership, error: membershipError}, {data: crewRow, error: crewError}, userLookup] = await Promise.all([
      admin.from('company_members').select('user_id').eq('company_id', companyId).eq('user_id', userId).neq('role', 'owner').maybeSingle(),
      admin.from('fleet_crew').select('data').eq('company_id', companyId).eq('record_id', userId).maybeSingle(),
      admin.auth.admin.getUserById(userId),
    ]);
    const invitedCrew = crewRow?.data as {status?: string; email?: string} | undefined;
    const invitedUser = userLookup.data.user;
    if (membershipError || crewError || userLookup.error) {
      console.error('Invitation resend lookup failed:', membershipError ?? crewError ?? userLookup.error);
      return response(500, {error: 'Pending invitation could not be verified.'});
    }
    if (!membership || !invitedCrew || invitedCrew.status !== 'Invited' || !invitedUser?.email) {
      return response(409, {error: 'Only pending crew invitations can be resent.'});
    }
    if (invitedUser.email_confirmed_at) return response(409, {error: 'This invitation has already been accepted.'});
    if (invitedCrew.email?.toLowerCase() !== invitedUser.email.toLowerCase()) {
      return response(409, {error: 'Invitation email no longer matches this crew member.'});
    }
    const {error: resendError} = await admin.auth.resend({
      type: 'signup',
      email: invitedUser.email,
      options: {emailRedirectTo: redirectTo},
    });
    if (resendError) {
      console.error('Auth invitation resend failed:', resendError);
      return response(resendError.status === 429 ? 429 : 400, {
        error: resendError.status === 429 ? 'Email rate limit reached. Wait a few minutes and try again.' : 'Invitation email could not be resent.',
      });
    }
    return response(200, {resent: true});
  }

  const fallbackName = email.split('@')[0].split(/[._-]/).filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  const {data: existingProfile, error: profileError} = await admin.from('profiles')
    .select('user_id,full_name').ilike('email', email).maybeSingle();
  if (profileError) {
    console.error('Existing account lookup failed:', profileError);
    return response(500, {error: 'FireOps account could not be checked.'});
  }

  if (existingProfile) {
    const [{data: memberships, error: membershipLookupError}, {data: crew, error: crewLookupError}, userLookup] = await Promise.all([
      admin.from('company_members').select('company_id').eq('user_id', existingProfile.user_id),
      admin.from('fleet_crew').select('record_id').eq('company_id', companyId).eq('record_id', existingProfile.user_id).maybeSingle(),
      admin.auth.admin.getUserById(existingProfile.user_id),
    ]);
    if (membershipLookupError || crewLookupError || userLookup.error || !userLookup.data.user) {
      console.error('Existing account verification failed:', membershipLookupError ?? crewLookupError ?? userLookup.error);
      return response(500, {error: 'FireOps account could not be verified.'});
    }
    if (memberships?.some((membership) => membership.company_id === companyId) || crew) {
      return response(409, {error: 'This person is already on your crew.'});
    }
    if (memberships?.length) return response(409, {error: 'This email already belongs to another FireOps company.'});

    const name = suppliedName || existingProfile.full_name?.trim() || fallbackName || 'Crew member';
    const pending = !userLookup.data.user.email_confirmed_at;
    const member = {id: existingProfile.user_id, name, email, phone, role: 'fire_fighter', status: pending ? 'Invited' : 'Active'};
    const {error: membershipError} = await admin.from('company_members').insert({
      company_id: companyId,
      user_id: existingProfile.user_id,
      role: 'fire_fighter',
    });
    if (membershipError) {
      console.error('Existing account membership creation failed:', membershipError);
      return response(membershipError.code === '23514' ? 409 : 400, {error: messageForDatabaseError(membershipError.message)});
    }

    const {data: crewRow, error: crewError} = await admin.from('fleet_crew').insert({
      company_id: companyId,
      record_id: existingProfile.user_id,
      data: member,
      version: 1,
      updated_by: actor.id,
    }).select('version').single();
    if (crewError) {
      console.error('Existing account crew record creation failed:', crewError);
      await admin.from('company_members').delete().eq('company_id', companyId).eq('user_id', existingProfile.user_id);
      return response(crewError.code === '23514' ? 409 : 400, {error: messageForDatabaseError(crewError.message)});
    }

    if (pending) {
      const {error: resendError} = await admin.auth.resend({
        type: 'signup',
        email,
        options: {emailRedirectTo: redirectTo},
      });
      if (resendError) {
        console.error('Existing account invitation resend failed:', resendError);
        await admin.from('fleet_crew').delete().eq('company_id', companyId).eq('record_id', existingProfile.user_id);
        await admin.from('company_members').delete().eq('company_id', companyId).eq('user_id', existingProfile.user_id);
        return response(resendError.status === 429 ? 429 : 400, {
          error: resendError.status === 429 ? 'Email rate limit reached. Wait a few minutes and try again.' : 'Invitation email could not be sent.',
        });
      }
    }

    return response(200, {member, version: crewRow.version, existingAccount: true, invitationSent: pending});
  }

  const name = suppliedName || fallbackName || 'Invited crew member';
  const {data: invite, error: inviteError} = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: {full_name: name, company_id: companyId, company_name: company.name, role: 'fire_fighter'},
  });
  if (inviteError || !invite.user) {
    console.error('Auth invitation failed:', inviteError);
    return response(inviteError?.status === 429 ? 429 : 400, {
      error: inviteError?.status === 429 ? 'Email rate limit reached. Wait a few minutes and try again.' : 'Invitation email could not be sent.',
    });
  }

  const member = {id: invite.user.id, name, email, phone, role: 'fire_fighter', status: 'Invited'};
  const {error: membershipError} = await admin.from('company_members').insert({
    company_id: companyId,
    user_id: invite.user.id,
    role: 'fire_fighter',
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

  return response(200, {member, version: crewRow.version, existingAccount: false, invitationSent: true});
});
