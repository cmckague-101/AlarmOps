import type { InvoiceAutofillResult, ReceiptAutofillResult } from '@fireops/domain';
import { supabase } from './supabase';

/** Longest side of the copy sent for auto-fill; enough for receipt text, far smaller than a phone photo. */
const AUTOFILL_MAX_SIDE = 1800;

/** Whether this company's subscription includes auto-fill (receipts and invoices share the switch). False when unknown. */
export async function loadReceiptAutofillEnabled(companyId: string) {
  if (!supabase) return false;
  try {
    const { data, error } = await supabase.from('companies').select('receipt_autofill_enabled').eq('id', companyId).maybeSingle<{ receipt_autofill_enabled?: boolean }>();
    return !error && data?.receipt_autofill_enabled === true;
  } catch {
    return false;
  }
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;base64,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('Photo could not be read.'));
    reader.readAsDataURL(blob);
  });
}

/** A downscaled JPEG of an image the browser can decode, or null for PDFs and formats it cannot (e.g. HEIC outside Safari). */
export async function autofillImage(file: File, mimeType: string): Promise<{ image: string; mimeType: 'image/jpeg' } | null> {
  if (!mimeType.startsWith('image/') || typeof createImageBitmap !== 'function') return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    const scale = Math.min(1, AUTOFILL_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    return blob ? { image: await blobToBase64(blob), mimeType: 'image/jpeg' } : null;
  } finally {
    bitmap.close();
  }
}

/** Call an auto-fill edge function with one photo. Throws with a message fit to show beside the form. */
export async function invokeAutofill<Result>(fn: 'receipt-autofill' | 'invoice-autofill', companyId: string, photo: { image: string; mimeType: string }): Promise<Result> {
  if (!supabase) throw new Error('Auto-fill is unavailable in this build.');
  const { data, error } = await supabase.functions.invoke<Result & { error?: string }>(fn, { body: { companyId, ...photo } });
  if (error) {
    let message = '';
    try { message = (await (error as { context?: Response }).context?.json?.())?.error ?? ''; } catch { /* not JSON */ }
    throw new Error(message || 'Auto-fill could not read this photo. Enter the details.');
  }
  if (!data || data.error) throw new Error(data?.error || 'Auto-fill could not read this photo. Enter the details.');
  return data;
}

/** Ask the receipt-autofill edge function to read one photo. Throws with a message fit to show on the card. */
export const requestReceiptAutofill = (companyId: string, photo: { image: string; mimeType: string }) => invokeAutofill<ReceiptAutofillResult>('receipt-autofill', companyId, photo);

/** Ask the invoice-autofill edge function to read one invoice photo. Never writes the invoice. */
export const requestInvoiceAutofill = (companyId: string, photo: { image: string; mimeType: string }) => invokeAutofill<InvoiceAutofillResult>('invoice-autofill', companyId, photo);
