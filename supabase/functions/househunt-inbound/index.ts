// Receives saved-search alert emails (JSON) from an inbound-email relay and stores leads through househunt_ingest_alert.
// Contract (relay maps its own payload to this): POST {from, subject, html?, text?, messageId, receivedAt?}
// Header x-househunt-inbound-secret must equal the HOUSEHUNT_INBOUND_SECRET function secret. Deploy with JWT verification off.
import {processEmail} from '../_shared/alerts.mjs';
import zips from '../_shared/zip-county.json' with {type: 'json'};

const project = Deno.env.get('SUPABASE_URL');
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const secret = Deno.env.get('HOUSEHUNT_INBOUND_SECRET') ?? '';
const SOURCE = 'portal-alerts';

async function db(path: string, method = 'GET', body?: unknown) {
  const r = await fetch(`${project}/rest/v1/${path}`, {method, headers: {apikey: service!, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000)});
  if (!r.ok) throw Error(`database_${r.status}`);
  return r.status === 204 ? null : await r.json();
}
function same(a: string, b: string) { // constant-time comparison
  if (a.length !== b.length || !a.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0;
}
Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('Method not allowed', {status: 405});
  if (secret.length < 32 || !same(req.headers.get('x-househunt-inbound-secret') ?? '', secret)) return new Response('Unauthorized', {status: 401});
  let mail: Record<string, string>;
  try { mail = await req.json(); } catch { return Response.json({error: 'invalid_json'}, {status: 400}); }
  if (!mail.messageId || typeof mail.from !== 'string' || (!mail.html && !mail.text) || String(mail.html ?? mail.text).length > 2_000_000) return Response.json({error: 'invalid_message'}, {status: 400});
  try {
    const [cfg] = await db('househunt_config?limit=1');
    const received = mail.receivedAt && !Number.isNaN(Date.parse(mail.receivedAt)) ? new Date(mail.receivedAt) : new Date();
    const out = processEmail({from: mail.from, subject: mail.subject, html: mail.html, text: mail.text, receivedAt: received}, cfg.settings, zips, new Date());
    const result = await db('rpc/househunt_ingest_alert', 'POST', {p_source: SOURCE, p_message_id: String(mail.messageId).slice(0, 300), p_site: out.site, p_received: received.toISOString(), p_rows: out.rows, p_quarantine: out.quarantine});
    return Response.json(result);
  } catch (e) {
    return Response.json({error: String((e as Error)?.message || 'failure').startsWith('database_') ? String((e as Error).message) : 'inbound_failure'}, {status: 500});
  }
});
