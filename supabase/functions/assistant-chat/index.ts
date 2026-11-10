import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.112.4';
import { authedAdmin, isUuid, json, memberRole, profileName } from '../_shared/fireops-edge.ts';
import {
  canSeeAllCrew, canUseTasks, cleanMessages, cleanReply, isRole, parseArguments, parseDraft, parseOpenScreen,
  summarizeIssues, summarizeQualifications, summarizeTasks, summarizeUnpaidInvoices, summarizeVehicles, systemPrompt, tools,
  type Draft, type Role, type RouteId,
} from './logic.ts';

// FireOps Assistant chat (text only). A paid add-on per company
// (companies.assistant_enabled); every member of an enabled company may use it.
// Each message is claimed and logged by claim_assistant_chat (100 per person,
// 1,000 per company per rolling 24 hours) before Grok is called.
//
// Company data questions are answered with fixed read-only queries made with
// the caller's own session, so row-level security decides what they can see;
// the service role is used only to verify the caller, look up their role and
// claim usage. The assistant never writes: open_screen and prepare_draft only
// come back to the app as a button, and the user reviews and submits drafts in
// the existing forms. Chats are not stored here; history stays on the device.
//
// Secrets: XAI_ASSISTANT_API_KEY (required; its own xAI key, separate from auto-fill's XAI_API_KEY, so usage is tracked apart), XAI_ASSISTANT_MODEL (optional chat model).

const DEFAULT_MODEL = 'grok-4.7';
/** Grok calls per message: tool rounds plus the final answer. */
const MAX_ROUNDS = 4;

type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
type GrokMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

function requestToday(value: unknown) {
  const utc = new Date().toISOString().slice(0, 10);
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return utc;
  // The device's local date, within a day of UTC (time zones).
  return Math.abs(Date.parse(`${value}T00:00:00Z`) - Date.parse(`${utc}T00:00:00Z`)) <= 86_400_000 ? value : utc;
}

async function runDataTool(name: string, args: Record<string, unknown>, ctx: { db: SupabaseClient; companyId: string; userId: string; role: Role; today: string }) {
  const { db, companyId, userId, role, today } = ctx;
  const fail = (error: unknown) => {
    console.error(`assistant tool ${name} failed`, error);
    return { error: 'This data could not be read right now.' };
  };
  if (name === 'list_vehicles') {
    const { data, error } = await db.from('fleet_vehicles').select('data').eq('company_id', companyId).limit(1000);
    return error ? fail(error) : summarizeVehicles(data ?? [], args.status);
  }
  if (name === 'list_open_fleet_issues') {
    const [issues, vehicles] = await Promise.all([
      db.from('fleet_issues').select('data').eq('company_id', companyId).filter('data->>status', 'eq', 'Open').limit(1000),
      db.from('fleet_vehicles').select('data').eq('company_id', companyId).limit(1000),
    ]);
    if (issues.error || vehicles.error) return fail(issues.error ?? vehicles.error);
    return summarizeIssues(issues.data ?? [], vehicles.data ?? []);
  }
  if (name === 'list_expiring_qualifications') {
    const everyone = canSeeAllCrew(role);
    let query = db.from('fleet_crew').select('record_id,data').eq('company_id', companyId);
    if (!everyone) query = query.eq('record_id', userId);
    const { data, error } = await query.limit(1000);
    return error ? fail(error) : summarizeQualifications(data ?? [], { today, withinDays: args.within_days, userId, everyone });
  }
  if (name === 'list_unpaid_invoices') {
    const [forms, customers] = await Promise.all([
      db.from('invoice_forms').select('invoice_number,invoice_date,due_date,invoice_amount,customer_id,status,created_by_name').eq('company_id', companyId).eq('status', 'submitted').limit(1000),
      db.from('invoice_customers').select('id,name').eq('company_id', companyId).limit(1000),
    ]);
    if (forms.error || customers.error) return fail(forms.error ?? customers.error);
    return summarizeUnpaidInvoices(forms.data ?? [], customers.data ?? [], today);
  }
  if (name === 'list_my_tasks' && canUseTasks(role)) {
    const { data, error } = await db.from('personal_tasks').select('subject,due_date').eq('company_id', companyId).eq('user_id', userId).order('due_date').limit(200);
    return error ? fail(error) : summarizeTasks(data ?? [], today);
  }
  return { error: 'Unknown tool.' };
}

Deno.serve(async (request) => {
  const auth = await authedAdmin(request);
  if (!auth.ok) return auth.response;
  const { actor, admin, body } = auth;

  const companyId = String(body.companyId ?? '');
  if (!isUuid(companyId)) return json(400, { error: 'Company is invalid.' });
  const messages = cleanMessages(body.messages);
  if (!messages) return json(400, { error: 'Type a message for the assistant.' });

  const apiKey = Deno.env.get('XAI_ASSISTANT_API_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!apiKey || !supabaseUrl || !anonKey) {
    console.error('assistant-chat is missing XAI_ASSISTANT_API_KEY, SUPABASE_URL or SUPABASE_ANON_KEY');
    return json(503, { error: 'The assistant is not configured.' });
  }

  const role = await memberRole(admin, companyId, actor.id);
  if (!isRole(role)) return json(403, { error: 'Company access required.' });

  const { data: claim, error: claimError } = await admin.rpc('claim_assistant_chat', { company: companyId, actor: actor.id });
  if (claimError) {
    console.error('assistant claim failed', claimError);
    return json(500, { error: 'The assistant is unavailable.' });
  }
  if (claim === 'not_member') return json(403, { error: 'Company access required.' });
  if (claim === 'disabled') return json(403, { error: 'The FireOps Assistant is not included for this company.' });
  if (claim === 'limit') return json(429, { error: 'Daily assistant limit reached. Try again tomorrow.' });

  // Company data is read only as the caller: their JWT, the anon key, and RLS.
  const token = request.headers.get('Authorization')!.replace(/^Bearer\s+/i, '');
  const db = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const today = requestToday(body.today);
  const [userName, company] = await Promise.all([
    profileName(admin, actor.id),
    db.from('companies').select('name').eq('id', companyId).maybeSingle<{ name?: string }>(),
  ]);
  const ctx = { db, companyId, userId: actor.id, role, today };

  const conversation: GrokMessage[] = [
    { role: 'system', content: systemPrompt({ role, userName, companyName: company.data?.name?.trim() || 'their company', today }) },
    ...messages,
  ];
  const toolList = tools(role);
  let navigate: RouteId | null = null;
  let draft: Draft | null = null;

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const last = round === MAX_ROUNDS - 1;
    let upstream: Response;
    try {
      upstream = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(40_000),
        body: JSON.stringify({
          model: Deno.env.get('XAI_ASSISTANT_MODEL') || DEFAULT_MODEL,
          temperature: 0.3,
          max_tokens: 900,
          messages: conversation,
          tools: toolList,
          tool_choice: last ? 'none' : 'auto',
        }),
      });
    } catch (error) {
      console.error('xAI request failed', error);
      return json(502, { error: 'The assistant did not respond. Try again.' });
    }
    if (!upstream.ok) {
      console.error('xAI request rejected', upstream.status, await upstream.text().catch(() => ''));
      return json(502, { error: 'The assistant could not answer right now. Try again.' });
    }
    let message: { content?: unknown; tool_calls?: ToolCall[] } | undefined;
    try {
      message = (await upstream.json())?.choices?.[0]?.message;
    } catch (error) {
      console.error('xAI response unreadable', error);
    }
    if (!message) return json(502, { error: 'The assistant could not answer right now. Try again.' });

    const calls = Array.isArray(message.tool_calls) ? message.tool_calls.filter((call) => call?.type === 'function' && call.function?.name) : [];
    if (!calls.length || last) {
      const text = cleanReply(message.content);
      if (!text) return json(502, { error: 'The assistant could not answer right now. Try again.' });
      return json(200, { text, navigate, draft });
    }

    conversation.push({ role: 'assistant', content: typeof message.content === 'string' ? message.content : null, tool_calls: calls });
    for (const call of calls) {
      const args = parseArguments(call.function.arguments);
      let result: unknown;
      if (call.function.name === 'open_screen') {
        const screen = parseOpenScreen(args, role);
        if (screen) navigate = screen;
        result = screen ? { shown: `A button to open ${screen} is shown under your reply.` } : { error: 'That screen is not available to this user.' };
      } else if (call.function.name === 'prepare_draft') {
        const next = parseDraft(args, role);
        if (next) draft = next;
        result = next ? { shown: 'A button that opens the draft is shown under your reply. Remind the user to review and submit it.' } : { error: 'That draft is not available to this user.' };
      } else {
        result = await runDataTool(call.function.name, args, ctx);
      }
      conversation.push({ role: 'tool', tool_call_id: String(call.id ?? ''), content: JSON.stringify(result) });
    }
  }
  return json(502, { error: 'The assistant could not answer right now. Try again.' });
});
