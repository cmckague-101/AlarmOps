import { authedAdmin, isUuid, json } from '../_shared/fireops-edge.ts';
import { invoiceSchema, parseInvoiceExtraction, systemPrompt } from './logic.ts';

// Reads invoice number, invoice date, due date, total and the billed customer
// from one invoice photo with xAI Grok vision, with a confidence per field.
// Uses the receipt auto-fill switch (companies.receipt_autofill_enabled) and
// shares its daily limits: each call is claimed and logged (kind 'invoice') by
// claim_invoice_autofill. Never writes the invoice; the app fills the caller's
// draft for review. The photo is sent in the request body and is not stored
// here; the app attaches the original file to the draft itself.
//
// Secrets: XAI_API_KEY (required), XAI_INVOICE_MODEL or XAI_RECEIPT_MODEL (optional vision model).

const MAX_IMAGE_BYTES = 7 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png'];
const DEFAULT_MODEL = 'grok-4.7';

function base64Bytes(value: string) {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

const isoToday = () => new Date().toISOString().slice(0, 10);

Deno.serve(async (request) => {
  const auth = await authedAdmin(request);
  if (!auth.ok) return auth.response;
  const { actor, admin, body } = auth;

  const companyId = String(body.companyId ?? '');
  const mimeType = String(body.mimeType ?? '');
  const image = typeof body.image === 'string' ? body.image.replace(/^data:[^;]+;base64,/, '') : '';
  if (!isUuid(companyId)) return json(400, { error: 'Company is invalid.' });
  if (!IMAGE_TYPES.includes(mimeType)) return json(415, { error: 'Auto-fill reads JPG or PNG photos.' });
  if (!image || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) return json(400, { error: 'Invoice photo is missing.' });
  if (base64Bytes(image) > MAX_IMAGE_BYTES) return json(413, { error: 'Invoice photo is too large to auto-fill.' });

  const apiKey = Deno.env.get('XAI_API_KEY');
  if (!apiKey) {
    console.error('XAI_API_KEY is not set');
    return json(503, { error: 'Invoice auto-fill is not configured.' });
  }

  const { data: claim, error: claimError } = await admin.rpc('claim_invoice_autofill', { company: companyId, actor: actor.id });
  if (claimError) {
    console.error('invoice auto-fill claim failed', claimError);
    return json(500, { error: 'Invoice auto-fill is unavailable.' });
  }
  if (claim === 'not_member') return json(403, { error: 'Company access required.' });
  if (claim === 'disabled') return json(403, { error: 'Invoice auto-fill is not included for this company.' });
  if (claim === 'limit') return json(429, { error: 'Daily auto-fill limit reached. Enter details by hand.' });

  const today = isoToday();
  let upstream: Response;
  try {
    upstream = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model: Deno.env.get('XAI_INVOICE_MODEL') || Deno.env.get('XAI_RECEIPT_MODEL') || DEFAULT_MODEL,
        temperature: 0,
        response_format: { type: 'json_schema', json_schema: { name: 'invoice', strict: true, schema: invoiceSchema } },
        messages: [
          { role: 'system', content: systemPrompt(today) },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${image}`, detail: 'high' } },
              { type: 'text', text: 'Extract this invoice.' },
            ],
          },
        ],
      }),
    });
  } catch (error) {
    console.error('xAI request failed', error);
    return json(502, { error: 'Invoice auto-fill did not respond. Enter details by hand or retry.' });
  }
  if (!upstream.ok) {
    console.error('xAI request rejected', upstream.status, await upstream.text().catch(() => ''));
    return json(502, { error: 'Invoice auto-fill could not read this photo. Enter details by hand or retry.' });
  }

  let parsed: Record<string, unknown>;
  try {
    const result = await upstream.json();
    const content = result?.choices?.[0]?.message?.content;
    parsed = JSON.parse(typeof content === 'string' ? content : '');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
  } catch (error) {
    console.error('xAI response unreadable', error);
    return json(502, { error: 'Invoice auto-fill could not read this photo. Enter details by hand or retry.' });
  }

  return json(200, parseInvoiceExtraction(parsed, today));
});
