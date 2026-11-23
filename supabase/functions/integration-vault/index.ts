import {createClient} from 'npm:@supabase/supabase-js@2.112.4';
import {IntegrationVault, INTEGRATION_PROVIDERS, type IntegrationProvider, type StoredIntegration} from '../../../packages/domain/src/integrations.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type AdminClient = ReturnType<typeof createClient>;

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {status, headers: {...corsHeaders, 'Content-Type': 'application/json'}});
}

function isProvider(value: string): value is IntegrationProvider {
  return (INTEGRATION_PROVIDERS as readonly string[]).includes(value);
}

async function isAdmin(admin: AdminClient, companyId: string, userId: string) {
  const {data, error} = await admin.from('company_members').select('role').eq('company_id', companyId).eq('user_id', userId).maybeSingle();
  if (error) throw new Error('Integration access could not be verified.');
  return data?.role === 'owner' || data?.role === 'admin';
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', {headers: corsHeaders});
  if (request.method !== 'POST') return jsonResponse(405, {error: 'Method not allowed.'});
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const encryptionSecret = Deno.env.get('INTEGRATION_ENCRYPTION_KEY');
  if (!supabaseUrl || !serviceRoleKey || !encryptionSecret) return jsonResponse(500, {error: 'Integration vault is not configured.'});
  const admin = createClient(supabaseUrl, serviceRoleKey, {auth: {autoRefreshToken: false, persistSession: false}});
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return jsonResponse(401, {error: 'Authentication required.'});
  const {data: userResult, error: userError} = await admin.auth.getUser(token);
  const actor = userResult.user;
  if (userError || !actor) return jsonResponse(401, {error: 'Session is invalid or expired.'});
  let input: {companyId?: string; action?: string; provider?: string; values?: Record<string, string>};
  try { input = await request.json(); } catch { return jsonResponse(400, {error: 'Invalid request body.'}); }
  const companyId = input.companyId?.trim() ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) return jsonResponse(400, {error: 'Company is invalid.'});
  try {
    if (!await isAdmin(admin, companyId, actor.id)) return jsonResponse(403, {error: 'Company admin access required.'});
  } catch {
    return jsonResponse(500, {error: 'Integration access could not be verified.'});
  }
  const {data: profile} = await admin.from('profiles').select('full_name').eq('user_id', actor.id).maybeSingle();
  const actorName = profile?.full_name?.trim() || 'Company admin';
  const {data: rows, error: loadError} = await admin.from('company_integration_credentials').select('provider,status,public_config,encrypted_secrets,updated_by_name,updated_at,last_tested_at,last_test_ok,last_test_message').eq('company_id', companyId);
  if (loadError) return jsonResponse(500, {error: 'Credentials could not be loaded.'});
  const vault = new IntegrationVault(encryptionSecret);
  vault.importSealed((rows ?? []).filter(row => isProvider(row.provider)).map(row => ({
    provider: row.provider as IntegrationProvider,
    status: row.status,
    publicConfig: row.public_config ?? {},
    secrets: row.encrypted_secrets ?? [],
    updatedAt: row.updated_at,
    updatedBy: row.updated_by_name ?? '',
    lastTestedAt: row.last_tested_at,
    lastTestOk: row.last_test_ok,
    lastTestMessage: row.last_test_message,
  }) satisfies StoredIntegration));
  const action = input.action ?? 'list';
  const provider = input.provider ?? '';
  try {
    const {data: auditRows} = await admin.from('company_audit_log').select('id,created_at,actor_name,description').eq('company_id', companyId).order('created_at', {ascending: false}).limit(40);
    const history = (auditRows ?? []).filter(row => typeof row.description === 'string' && row.description.includes('credentials')).map(row => ({id: row.id, at: row.created_at, actor: row.actor_name, provider: 'manitou' as const, action: 'saved' as const, summary: row.description}));
    if (action === 'list') return jsonResponse(200, {integrations: vault.list(), audit: history});
    if (action === 'station') return jsonResponse(200, await vault.loadStation(new Date()));
    if (!isProvider(provider)) return jsonResponse(400, {error: 'Provider is invalid.'});
    if (action === 'save') await vault.save(provider, input.values ?? {}, actorName);
    else if (action === 'delete') await vault.remove(provider, actorName);
    else if (action === 'test') await vault.test(provider, actorName);
    else return jsonResponse(400, {error: 'Action is invalid.'});
    const saved = vault.sealedRecords().find(record => record.provider === provider);
    if (action === 'delete') await admin.from('company_integration_credentials').delete().eq('company_id', companyId).eq('provider', provider);
    else if (saved) {
      const {error: saveError} = await admin.from('company_integration_credentials').upsert({
        company_id: companyId,
        provider: saved.provider,
        status: saved.status,
        public_config: saved.publicConfig,
        encrypted_secrets: saved.secrets,
        updated_by: actor.id,
        updated_by_name: actorName,
        updated_at: saved.updatedAt,
        last_tested_at: saved.lastTestedAt,
        last_test_ok: saved.lastTestOk,
        last_test_message: saved.lastTestMessage,
      }, {onConflict: 'company_id,provider'});
      if (saveError) return jsonResponse(500, {error: 'Credentials could not be saved.'});
    }
    const latest = vault.audit()[0];
    if (latest) await admin.from('company_audit_log').insert({company_id: companyId, actor_user_id: actor.id, actor_name: actorName, description: latest.summary});
    return jsonResponse(200, {integrations: vault.list(), audit: vault.audit()});
  } catch (error) {
    return jsonResponse(400, {error: error instanceof Error ? error.message : 'Credentials could not be changed.'});
  }
});
