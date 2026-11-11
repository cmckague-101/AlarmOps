import { authedAdmin, corsHeaders, isUuid, json, memberRole } from '../_shared/fireops-edge.ts';
import { claimFailure, MAX_AUDIO_BYTES, VOICE_AUDIO_CONTENT_TYPE, providerFailure, validAudio, validText } from './logic.ts';
import { transcriptionUpload } from './upstream.ts';

Deno.serve(async request => {
 // Authenticate before parsing an upload. The shared helper normally parses JSON.
 const auth = await authedAdmin(request, {});
 if (!auth.ok) return auth.response;
 const {admin, actor} = auth;
 try {
  // Bound the stream too: Content-Length alone is not trustworthy.
  const reader = request.body?.getReader();
  if (!reader) return json(400,{error:'Voice input is missing.'});
  const chunks: ArrayBuffer[] = []; let size = 0;
  while (true) {
   const {done,value} = await reader.read(); if (done) break;
   size += value.byteLength;
   if (size > MAX_AUDIO_BYTES + 65536) { await reader.cancel(); return json(413,{error:'Record up to 60 seconds and 10 MB.'}); }
   chunks.push(new Uint8Array(value).buffer);
  }
  const copy = new Request(request.url,{method:'POST',headers:request.headers,body:new Blob(chunks)});
  const multipart = request.headers.get('content-type')?.includes('multipart/form-data');
  let form: FormData | null;
  let body: Record<string,unknown>;
  try {
   form = multipart ? await copy.formData() : null;
   const parsed = form ? Object.fromEntries(form) : await copy.json();
   if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid body');
   body = parsed;
  } catch { return json(400,{error:'Invalid voice request.'}); }
  const companyId = String(body.companyId ?? '');
  const kind = body.kind;
  if (!isUuid(companyId) || (kind !== 'stt' && kind !== 'tts')) return json(400,{error:'Invalid voice request.'});
  const file = form?.get('file');
  if (kind === 'stt' && (!(file instanceof File) || !validAudio(file.type,file.size,Number(body.duration)))) return json(400,{error:'Use an audio recording up to 60 seconds and 10 MB.'});
  if (kind === 'tts' && !validText(body.text)) return json(400,{error:'Voice replies must be between 1 and 2000 characters.'});
  if (!await memberRole(admin,companyId,actor.id)) return json(403,{error:'Company access required.'});
  const {data:claim,error} = await admin.rpc('claim_assistant_voice',{company:companyId,actor:actor.id,kind});
  if (error) return json(500,{error:'Assistant voice is unavailable. Try text chat.'});
  const failure = claimFailure(claim);
  if (failure) return json(failure.status,{error:failure.error});
  const key = Deno.env.get('XAI_ASSISTANT_API_KEY');
  if (!key) return json(503,{error:'Assistant voice is not configured.'});
  const upload = kind === 'stt' ? transcriptionUpload(file as File) : null;
  const response = await fetch(`https://api.x.ai/v1/${kind}`,{
   method:'POST',headers:{Authorization:`Bearer ${key}`,...(kind === 'tts' ? {'Content-Type':'application/json'} : {})},
   body:kind === 'stt' ? upload : JSON.stringify({text:body.text,voice_id:'helix',language:'en'}),signal:AbortSignal.timeout(45000),
  });
  if (!response.ok) {
   // Log only operation/status: provider bodies can contain user audio text.
   console.error('assistant-voice upstream rejected',{kind,status:response.status});
   const failure = providerFailure(kind,response.status);
   return json(failure.status,{error:failure.error});
  }
  if (kind === 'stt') { const data = await response.json(); return json(200,{text:typeof data.text === 'string' ? data.text.trim().slice(0,2000) : ''}); }
  return new Response(response.body,{headers:{...corsHeaders,'Content-Type':VOICE_AUDIO_CONTENT_TYPE,'Cache-Control':'no-store'}});
 } catch { return json(502,{error:'Assistant voice is unavailable. Check your connection or use text chat.'}); }
});
