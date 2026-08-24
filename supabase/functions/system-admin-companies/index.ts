import { createClient } from 'npm:@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const siteUrl = Deno.env.get('SITE_URL') ?? '';
const allowedOrigins = new Set(
  (Deno.env.get('ADMIN_ALLOWED_ORIGINS') ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);

type SaveRequest = {
  action: 'save';
  company?: {
    id?: string;
    name?: string;
    companyCode?: string;
    industry?: string;
    ownerEmail?: string;
    ownerFullName?: string;
  };
};

type RequestBody = SaveRequest | { action: 'list' };

function corsHeaders(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : '',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(origin: string | null, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request) => {
  const origin = request.headers.get('Origin');
  if (origin && !allowedOrigins.has(origin)) {
    return json(origin, { error: 'Origin not allowed' }, 403);
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== 'POST') return json(origin, { error: 'Method not allowed' }, 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json(origin, { error: 'Authentication required' }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json(origin, { error: 'Invalid or expired session' }, 401);

  const { data: administrator } = await service
    .from('system_admins')
    .select('user_id')
    .eq('user_id', authData.user.id)
    .maybeSingle();
  if (!administrator) return json(origin, { error: 'System administrator access required' }, 403);

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return json(origin, { error: 'Invalid JSON body' }, 400);
  }

  if (body.action === 'list') {
    const { data, error } = await service
      .from('companies')
      .select('id,name,company_code,industry,owner_user_id,created_at,updated_at,owner:profiles!companies_owner_user_id_fkey(email,full_name)')
      .order('name');
    if (error) return json(origin, { error: 'Unable to load companies' }, 500);
    return json(origin, { companies: data });
  }

  if (body.action !== 'save' || !body.company) return json(origin, { error: 'Unknown action' }, 400);

  const name = body.company.name?.trim() ?? '';
  const companyCode = body.company.companyCode?.trim().toUpperCase() ?? '';
  const industry = body.company.industry?.trim() ?? '';
  const ownerEmail = body.company.ownerEmail?.trim().toLowerCase() ?? '';
  const ownerFullName = body.company.ownerFullName?.trim() ?? '';
  if (name.length < 2 || name.length > 120) return json(origin, { error: 'Company name must be 2 to 120 characters' }, 400);
  if (!/^[A-Z0-9][A-Z0-9-]{2,31}$/.test(companyCode)) return json(origin, { error: 'Company code must be 3 to 32 uppercase letters, numbers, or hyphens' }, 400);
  if (!/^\S+@\S+\.\S+$/.test(ownerEmail)) return json(origin, { error: 'Valid owner email required' }, 400);

  let { data: owner } = await service
    .from('profiles')
    .select('user_id,email,full_name')
    .ilike('email', ownerEmail)
    .maybeSingle();

  if (!owner) {
    const { data: invitation, error: invitationError } = await service.auth.admin.inviteUserByEmail(ownerEmail, {
      data: ownerFullName ? { full_name: ownerFullName } : undefined,
      redirectTo: siteUrl ? `${siteUrl.replace(/\/$/, '')}/accept-invite` : undefined,
    });
    if (invitationError || !invitation.user) {
      return json(origin, { error: invitationError?.message ?? 'Unable to invite owner account' }, 400);
    }
    const { data: invitedProfile, error: profileError } = await service
      .from('profiles')
      .select('user_id,email,full_name')
      .eq('user_id', invitation.user.id)
      .single();
    if (profileError) return json(origin, { error: 'Owner invitation created, but profile setup failed' }, 500);
    owner = invitedProfile;
  }

  const { data: company, error } = await service.rpc('admin_upsert_company', {
    actor_user_id: authData.user.id,
    target_company_id: body.company.id || null,
    company_name: name,
    code: companyCode,
    company_industry: industry,
    owner_id: owner.user_id,
  });
  if (error) {
    const duplicate = error.code === '23505';
    return json(origin, { error: duplicate ? 'Company code already exists' : 'Unable to save company' }, duplicate ? 409 : 400);
  }

  return json(origin, { company, owner: { email: owner.email, fullName: owner.full_name } });
});
