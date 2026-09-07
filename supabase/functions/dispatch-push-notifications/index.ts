import { createClient } from 'npm:@supabase/supabase-js@2.115.0';
import {chunks, isInvalidTokenError, retryDelayMinutes} from './logic.ts';

const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const MAX_BATCH = 100;

type ClaimedJob = {
  job_id: string;
  notification_id: string;
  user_id: string;
  event_type: string;
  title: string;
  body: string;
  path: string;
  group_key: string;
  entity_id: string | null;
  badge_count: number | string;
  attempts: number;
};

type PushToken = {id: string; user_id: string; expo_push_token: string};
type Delivery = {id: string; expo_ticket_id: string; expo_push_token: string; push_token_id: string | null; created_at: string};
type ExpoTicket = {status: 'ok'; id: string} | {status: 'error'; message?: string; details?: {error?: string}};
type ExpoReceipt = {status: 'ok'} | {status: 'error'; message?: string; details?: {error?: string}};
type MessageReference = {job: ClaimedJob; token: PushToken};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
}

function expoHeaders() {
  const headers: Record<string, string> = {'Content-Type': 'application/json', Accept: 'application/json'};
  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

function retryAt(attempts: number) {
  const minutes = retryDelayMinutes(attempts);
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function errorText(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}

async function disableInvalidToken(admin: ReturnType<typeof createClient>, expoPushToken: string) {
  const {error} = await admin.from('push_tokens').update({enabled: false}).eq('expo_push_token', expoPushToken);
  if (error) console.error('Could not disable invalid Expo token:', error.message);
}

async function updateJob(
  admin: ReturnType<typeof createClient>,
  job: ClaimedJob,
  status: 'pending' | 'sent' | 'skipped' | 'failed',
  lastError?: string,
) {
  const terminal = status !== 'pending';
  const {error} = await admin.from('push_notification_jobs').update({
    status,
    locked_at: null,
    next_attempt_at: status === 'pending' ? retryAt(job.attempts) : new Date().toISOString(),
    last_error: lastError?.slice(0, 1000) ?? null,
    ...(terminal ? {} : {updated_at: new Date().toISOString()}),
  }).eq('id', job.job_id);
  if (error) console.error('Could not update push job:', job.job_id, error.message);
}

async function processReceipts(admin: ReturnType<typeof createClient>) {
  const {data, error} = await admin.from('push_notification_deliveries')
    .select('id,expo_ticket_id,expo_push_token,push_token_id,created_at')
    .eq('status', 'ticketed')
    .not('expo_ticket_id', 'is', null)
    .order('created_at', {ascending: true})
    .limit(300);
  if (error) throw new Error(`Delivery receipts could not load: ${error.message}`);

  let delivered = 0;
  let receiptErrors = 0;
  for (const batch of chunks((data ?? []) as Delivery[])) {
    const response = await fetch(EXPO_RECEIPTS_URL, {
      method: 'POST', headers: expoHeaders(), body: JSON.stringify({ids: batch.map((item) => item.expo_ticket_id)}),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Expo receipt request failed (${response.status}).`);
    const payload = await response.json() as {data?: Record<string, ExpoReceipt>; errors?: unknown};
    if (!payload.data) throw new Error(`Expo receipt response was invalid: ${JSON.stringify(payload.errors ?? {})}`);

    for (const delivery of batch) {
      const receipt = payload.data[delivery.expo_ticket_id];
      if (!receipt) {
        if (Date.now() - Date.parse(delivery.created_at) > 24 * 60 * 60_000) {
          receiptErrors += 1;
          await admin.from('push_notification_deliveries').update({
            status: 'error', error_code: 'ReceiptUnavailable', error_detail: 'Expo receipt was unavailable after 24 hours.',
          }).eq('id', delivery.id);
        }
        continue;
      }
      if (receipt.status === 'ok') {
        delivered += 1;
        await admin.from('push_notification_deliveries').update({status: 'delivered', error_code: null, error_detail: null})
          .eq('id', delivery.id);
        continue;
      }
      receiptErrors += 1;
      const code = receipt.details?.error ?? 'UnknownExpoReceiptError';
      await admin.from('push_notification_deliveries').update({
        status: 'error', error_code: code, error_detail: receipt.message?.slice(0, 1000) ?? null,
      }).eq('id', delivery.id);
      if (isInvalidTokenError(code)) await disableInvalidToken(admin, delivery.expo_push_token);
    }
  }
  return {checked: data?.length ?? 0, delivered, errors: receiptErrors};
}

async function dispatchJobs(admin: ReturnType<typeof createClient>) {
  const {data, error} = await admin.rpc('claim_push_notification_jobs', {p_limit: MAX_BATCH});
  if (error) throw new Error(`Push jobs could not be claimed: ${error.message}`);
  const jobs = (data ?? []) as ClaimedJob[];
  if (!jobs.length) return {claimed: 0, ticketed: 0, skipped: 0, retried: 0};

  const userIds = [...new Set(jobs.map((job) => job.user_id))];
  const {data: tokenData, error: tokenError} = await admin.from('push_tokens')
    .select('id,user_id,expo_push_token').in('user_id', userIds).eq('enabled', true);
  if (tokenError) {
    await Promise.all(jobs.map((job) => updateJob(admin, job, job.attempts >= 5 ? 'failed' : 'pending', tokenError.message)));
    throw new Error(`Push tokens could not load: ${tokenError.message}`);
  }

  const tokens = (tokenData ?? []) as PushToken[];
  const references: MessageReference[] = [];
  let skipped = 0;
  for (const job of jobs) {
    const recipients = tokens.filter((token) => token.user_id === job.user_id);
    if (!recipients.length) {
      skipped += 1;
      await updateJob(admin, job, 'skipped', 'No enabled Expo push tokens');
      continue;
    }
    recipients.forEach((token) => references.push({job, token}));
  }

  let ticketed = 0;
  let retried = 0;
  const results = new Map<string, {sent: number; invalid: number; errors: string[]}>();
  for (const batch of chunks(references)) {
    const messages = batch.map(({job, token}) => ({
      to: token.expo_push_token,
      title: job.title,
      body: job.body,
      sound: 'default',
      priority: 'high',
      channelId: 'default',
      badge: Number(job.badge_count),
      data: {
        path: job.path,
        notificationId: job.notification_id,
        eventType: job.event_type,
        entityId: job.entity_id,
        groupKey: job.group_key,
      },
    }));

    let tickets: ExpoTicket[];
    try {
      const response = await fetch(EXPO_SEND_URL, {
        method: 'POST', headers: expoHeaders(), body: JSON.stringify(messages), signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Expo push request failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
      const payload = await response.json() as {data?: ExpoTicket[]; errors?: unknown};
      if (!Array.isArray(payload.data) || payload.data.length !== batch.length) {
        throw new Error(`Expo push response was invalid: ${JSON.stringify(payload.errors ?? {})}`);
      }
      tickets = payload.data;
    } catch (sendError) {
      const detail = errorText(sendError);
      batch.forEach(({job}) => {
        const state = results.get(job.job_id) ?? {sent: 0, invalid: 0, errors: []};
        state.errors.push(detail);
        results.set(job.job_id, state);
      });
      continue;
    }

    for (let index = 0; index < batch.length; index += 1) {
      const {job, token} = batch[index];
      const ticket = tickets[index];
      const state = results.get(job.job_id) ?? {sent: 0, invalid: 0, errors: []};
      results.set(job.job_id, state);

      if (ticket.status === 'ok' && ticket.id) {
        state.sent += 1;
        ticketed += 1;
        const {error: deliveryError} = await admin.from('push_notification_deliveries').upsert({
          job_id: job.job_id,
          push_token_id: token.id,
          expo_push_token: token.expo_push_token,
          expo_ticket_id: ticket.id,
          status: 'ticketed',
          error_code: null,
          error_detail: null,
        }, {onConflict: 'job_id,expo_push_token'});
        if (deliveryError) console.error('Could not save Expo ticket:', deliveryError.message);
        continue;
      }

      const code = ticket.status === 'error' ? ticket.details?.error ?? 'UnknownExpoTicketError' : 'InvalidExpoTicket';
      const detail = ticket.status === 'error' ? ticket.message ?? code : code;
      state.errors.push(detail);
      if (isInvalidTokenError(code)) {
        state.invalid += 1;
        await disableInvalidToken(admin, token.expo_push_token);
      }
      await admin.from('push_notification_deliveries').upsert({
        job_id: job.job_id,
        push_token_id: token.id,
        expo_push_token: token.expo_push_token,
        expo_ticket_id: null,
        status: 'error',
        error_code: code,
        error_detail: detail.slice(0, 1000),
      }, {onConflict: 'job_id,expo_push_token'});
    }
  }

  for (const job of jobs) {
    const state = results.get(job.job_id);
    if (!state) continue;
    if (state.sent > 0) await updateJob(admin, job, 'sent', state.errors.length ? state.errors.join('; ') : undefined);
    else if (state.invalid > 0 && state.invalid === state.errors.length) {
      skipped += 1;
      await updateJob(admin, job, 'skipped', 'All Expo tokens are no longer registered');
    } else {
      retried += 1;
      await updateJob(admin, job, job.attempts >= 5 ? 'failed' : 'pending', state.errors.join('; '));
    }
  }

  return {claimed: jobs.length, ticketed, skipped, retried};
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, {error: 'Method not allowed.'});
  const expectedSecret = Deno.env.get('PUSH_DISPATCH_SECRET');
  const suppliedSecret = request.headers.get('x-dispatch-secret') ?? request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!expectedSecret || suppliedSecret !== expectedSecret) return json(401, {error: 'Invalid dispatch credentials.'});

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json(500, {error: 'Push dispatcher is not configured.'});
  const admin = createClient(supabaseUrl, serviceRoleKey, {auth: {autoRefreshToken: false, persistSession: false}});

  try {
    const receipts = await processReceipts(admin);
    const dispatch = await dispatchJobs(admin);
    return json(200, {receipts, dispatch});
  } catch (dispatchError) {
    console.error('Push dispatch failed:', dispatchError);
    return json(500, {error: errorText(dispatchError)});
  }
});
