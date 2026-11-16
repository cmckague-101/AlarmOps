import {extractText} from 'npm:unpdf@1.8.1';
import {activeRedFlagCount,parseNationalFireActivity} from './logic.ts';

const SOURCE_URL = 'https://www.nifc.gov/nicc-files/sitreprt.pdf';
const RED_FLAG_URL = 'https://api.weather.gov/alerts/active?event=Red%20Flag%20Warning';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const CACHE_MS = 15 * 60 * 1000;
let cache: {expiresAt: number; value: ReturnType<typeof parseNationalFireActivity>} | undefined;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=300'},
  });
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', {headers: corsHeaders});
  if (!['GET', 'POST'].includes(request.method)) return json(405, {error: 'Method not allowed.'});
  if (cache && cache.expiresAt > Date.now()) return json(200, cache.value);

  try {
    const redFlags=fetch(RED_FLAG_URL,{
      headers:{Accept:'application/geo+json','User-Agent':'FireOps news@fireops.app'},
      signal:AbortSignal.timeout(15000),
    }).then(async response=>response.ok?activeRedFlagCount(await response.json()):null).catch(error=>{console.warn('NWS red flag lookup failed:',error);return null});
    const source = await fetch(SOURCE_URL, {
      headers: {'Accept': 'application/pdf', 'User-Agent': 'FireOps/1.0 national fire activity'},
      signal: AbortSignal.timeout(15000),
    });
    if (!source.ok) throw new Error(`NIFC returned ${source.status}.`);
    const bytes = new Uint8Array(await source.arrayBuffer());
    const extracted = await extractText(bytes, {mergePages: false});
    const firstPage = Array.isArray(extracted.text) ? extracted.text[0] : extracted.text;
    if (!firstPage) throw new Error('NIFC report first page was empty.');
    const value = {...parseNationalFireActivity(firstPage),redFlagCount:await redFlags};
    cache = {value, expiresAt: Date.now() + CACHE_MS};
    return json(200, value);
  } catch (error) {
    console.error('National fire activity extraction failed:', error);
    return json(502, {error: 'National fire activity could not be loaded from NIFC. Try again shortly.'});
  }
});
