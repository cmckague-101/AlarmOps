import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.112.4';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export const shopStatuses = ['parts', 'approval', 'blocked', 'progress', 'queued', 'ready', 'done'] as const;
export const shopBlockerStatuses = ['parts', 'approval', 'blocked'] as const;
export const shopPriorities = ['critical', 'high', 'medium', 'low'] as const;

export function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Verify the caller, then return a service-role client that forwards only the verified identity. */
export async function authedAdmin(request: Request) {
  if (request.method === 'OPTIONS') return { ok: false, response: new Response('ok', { headers: corsHeaders }) } as const;
  if (request.method !== 'POST') return { ok: false, response: json(405, { error: 'Method not allowed.' }) } as const;
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing Supabase Edge Function environment variables');
    return { ok: false, response: json(500, { error: 'Shop service is not configured.' }) } as const;
  }
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return { ok: false, response: json(401, { error: 'Authentication required.' }) } as const;
  const authClient = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: userResult, error: userError } = await authClient.auth.getUser(token);
  const actor = userResult.user;
  if (userError || !actor) return { ok: false, response: json(401, { error: 'Session is invalid or expired.' }) } as const;
  // Shop triggers and the audit log trust this header only on service-role requests.
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { 'x-fireops-actor-id': actor.id } },
  });
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    body = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, response: json(400, { error: 'Invalid request body.' }) } as const;
  }
  return { ok: true, actor, admin, body } as const;
}

/** Owners, admins and shop techs work the shop board. */
export async function requireShopWriter(admin: SupabaseClient, companyId: string, userId: string) {
  const { data } = await admin.from('company_members').select('role').eq('company_id', companyId).eq('user_id', userId).maybeSingle();
  return data?.role === 'owner' || data?.role === 'admin' || data?.role === 'shop_tech';
}

export async function profileName(admin: SupabaseClient, userId: string) {
  const { data } = await admin.from('profiles').select('full_name').eq('user_id', userId).maybeSingle();
  return (data?.full_name as string | undefined)?.trim() || 'FireOps user';
}

export function optionalText(value: unknown, max: number) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}
