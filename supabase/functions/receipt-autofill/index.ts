import { authedAdmin, isUuid, json } from '../_shared/fireops-edge.ts';

// Reads merchant, purchase date and total from one receipt photo with xAI Grok
// vision. Only for members of companies with receipts auto-fill turned on
// (companies.receipt_autofill_enabled); each call is claimed and logged by
// claim_receipt_autofill, which also enforces the daily limits. The photo is
// sent in the request body and is not stored here; the app uploads the
// original file itself when the receipt is submitted.
//
// Secrets: XAI_API_KEY (required), XAI_RECEIPT_MODEL (optional vision model).

const MAX_IMAGE_BYTES = 7 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png'];
const DEFAULT_MODEL = 'grok-4.7';

const receiptSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['is_receipt', 'merchant', 'purchase_date', 'total', 'confidence'],
  properties: {
    is_receipt: { type: 'boolean', description: 'False when the image is not a receipt or invoice.' },
    merchant: { type: ['string', 'null'], description: 'Business name as printed, without addresses or store numbers.' },
    purchase_date: { type: ['string', 'null'], description: 'Transaction date as YYYY-MM-DD.' },
    total: { type: ['number', 'null'], description: 'Final amount paid in US dollars, including tax and tip.' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
} as const;

function base64Bytes(value: string) {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function cleanMerchant(value: unknown) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  return text || null;
}

function cleanDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  // Allow one day ahead for time zones; older than 2000 is a misread.
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  return value >= '2000-01-01' && value <= tomorrow ? (value > isoToday() ? isoToday() : value) : null;
}

function cleanAmount(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const cents = Math.round(value * 100);
  return cents >= 1 && cents <= 100_000_000 ? cents : null;
}

Deno.serve(async (request) => {
  const auth = await authedAdmin(request);
  if (!auth.ok) return auth.response;
  const { actor, admin, body } = auth;

  const companyId = String(body.companyId ?? '');
  const mimeType = String(body.mimeType ?? '');
  const image = typeof body.image === 'string' ? body.image.replace(/^data:[^;]+;base64,/, '') : '';
  if (!isUuid(companyId)) return json(400, { error: 'Company is invalid.' });
  if (!IMAGE_TYPES.includes(mimeType)) return json(415, { error: 'Auto-fill reads JPG or PNG photos.' });
  if (!image || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) return json(400, { error: 'Receipt photo is missing.' });
  if (base64Bytes(image) > MAX_IMAGE_BYTES) return json(413, { error: 'Receipt photo is too large to auto-fill.' });

  const apiKey = Deno.env.get('XAI_API_KEY');
  if (!apiKey) {
    console.error('XAI_API_KEY is not set');
    return json(503, { error: 'Receipt auto-fill is not configured.' });
  }

  const { data: claim, error: claimError } = await admin.rpc('claim_receipt_autofill', { company: companyId, actor: actor.id });
  if (claimError) {
    console.error('receipt auto-fill claim failed', claimError);
    return json(500, { error: 'Receipt auto-fill is unavailable.' });
  }
  if (claim === 'not_member') return json(403, { error: 'Company access required.' });
  if (claim === 'disabled') return json(403, { error: 'Receipt auto-fill is not included for this company.' });
  if (claim === 'limit') return json(429, { error: 'Daily receipt auto-fill limit reached. Enter details by hand.' });

  let upstream: Response;
  try {
    upstream = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model: Deno.env.get('XAI_RECEIPT_MODEL') || DEFAULT_MODEL,
        temperature: 0,
        response_format: { type: 'json_schema', json_schema: { name: 'receipt', strict: true, schema: receiptSchema } },
        messages: [
          {
            role: 'system',
            content: `You read expense receipts for a wildland fire company. Today is ${isoToday()}. Return the merchant name, the transaction date and the final total paid. Use null for anything you cannot read clearly; never guess. Set confidence to low when the photo is blurry, cropped or ambiguous.`,
          },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${image}`, detail: 'high' } },
              { type: 'text', text: 'Extract this receipt.' },
            ],
          },
        ],
      }),
    });
  } catch (error) {
    console.error('xAI request failed', error);
    return json(502, { error: 'Receipt auto-fill did not respond. Enter details by hand or retry.' });
  }
  if (!upstream.ok) {
    console.error('xAI request rejected', upstream.status, await upstream.text().catch(() => ''));
    return json(502, { error: 'Receipt auto-fill could not read this photo. Enter details by hand or retry.' });
  }

  let parsed: Record<string, unknown>;
  try {
    const result = await upstream.json();
    const content = result?.choices?.[0]?.message?.content;
    parsed = JSON.parse(typeof content === 'string' ? content : '');
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
  } catch (error) {
    console.error('xAI response unreadable', error);
    return json(502, { error: 'Receipt auto-fill could not read this photo. Enter details by hand or retry.' });
  }

  if (parsed.is_receipt === false) {
    return json(200, { merchant: null, purchasedOn: null, amountCents: null, confidence: 'low', notReceipt: true });
  }
  const confidence = ['high', 'medium', 'low'].includes(String(parsed.confidence)) ? String(parsed.confidence) : 'low';
  return json(200, {
    merchant: cleanMerchant(parsed.merchant),
    purchasedOn: cleanDate(parsed.purchase_date),
    amountCents: cleanAmount(parsed.total),
    confidence,
  });
});
