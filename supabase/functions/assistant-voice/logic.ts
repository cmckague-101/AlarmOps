// Supabase functions.invoke decodes octet-stream as Blob; audio/* is decoded as text.
export const VOICE_AUDIO_CONTENT_TYPE = 'application/octet-stream';
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export function validAudio(type: string, size: number, duration: number) {
 return ['audio/webm','audio/mp4','audio/ogg','audio/wav','audio/mpeg','audio/x-wav'].includes(type.split(';')[0].toLowerCase()) && size > 0 && size <= MAX_AUDIO_BYTES && Number.isFinite(duration) && duration > 0 && duration <= 60;
}
export function validText(value: unknown): value is string {
 return typeof value === 'string' && value.trim().length > 0 && value.length <= 2000;
}
export function claimFailure(claim: unknown): {status: number; error: string} | null {
 if (claim === 'ok') return null;
 if (claim === 'limit') return {status:429,error:'Daily assistant voice limit reached. Try again tomorrow, or use text chat.'};
 return {status:403,error:'Assistant voice is not included for this company.'};
}

/** Keep provider credentials and response bodies out of client errors. */
export function providerFailure(kind: 'stt'|'tts', status: number) {
 if (status === 401 || status === 403) return {
  status:503,error:'Assistant voice access is not configured. Ask your company administrator to check speech access for the assistant API key.',
 };
 if (status === 429) return {
  status:503,error:'Assistant voice is busy. Try again shortly or use text chat.',
 };
 return {
  status:502,error:kind === 'stt'
   ? 'The recording could not be transcribed. Try recording again or use text chat.'
   : 'The voice reply could not be played. You can read the reply in chat.',
 };
}
