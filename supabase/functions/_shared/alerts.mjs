// Saved-search alert emails -> normalized lead records.
// Hard rule: an alert can never make a property 'active'. An email proves what a portal said when it was sent,
// not that no contingency exists today. Alerts may discover (status 'unverified') or withdraw (status 'unavailable').
import {criteria, normalizeAddress} from '../househunt-worker/rules.mjs';

export const SITES = {redfin: /(^|\.)redfin\.com$/i, zillow: /(^|\.)zillow\.com$/i, realtor: /(^|\.)realtor\.com$/i};
// Word-bounded on purpose: 'hold' must not match 'household'.
export const NEGATIVE = /\b(pending|contingent|under contract|sale pending|accepting backup|backup offers?|sold|off[- ]market|no longer (?:for sale|available|on the market)|withdrawn|cancell?ed|expired|temporarily off)\b/i;
const CUT = /(unsubscribe|similar homes|recommended for you|recently sold|homes you may like|you may also like|manage (?:your )?(?:email|alerts)|view all)/i;
const ADDRESS = /(\d{1,6}[A-Za-z]?\s[^,\n⟦⟧$]{3,60}?),\s*([A-Za-z][A-Za-z .'-]{1,40}),\s*(CA|OR|WA)\s+(\d{5})(?!\d)/g;

export function senderSite(from) {
  const m = String(from || '').match(/<?([A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,}))>?\s*$/i) || String(from || '').match(/([A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,}))/i);
  if (!m) return null;
  return Object.entries(SITES).find(([, re]) => re.test(m[2]))?.[0] || null;
}
const ENT = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#36': '$'};
export function decode(s) {
  return String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, e) => {
    if (ENT[e.toLowerCase()] !== undefined) return ENT[e.toLowerCase()];
    if (/^#x/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e[0] === '#') return String.fromCodePoint(parseInt(e.slice(1), 10));
    return all;
  });
}
// Real alert links are often click-tracking redirects. Recover a listing URL only when it is visible in the URL itself.
export function listingLink(raw) {
  let urls = [raw];
  try { const u = new URL(raw); for (const v of u.searchParams.values()) if (/^https?:/i.test(v)) urls.push(v); } catch { return null; }
  urls.push(...urls.map(u => { try { return decodeURIComponent(u); } catch { return u; } }));
  for (const u of urls) {
    let m;
    if ((m = u.match(/^https:\/\/(?:www\.)?redfin\.com\/[A-Z]{2}\/[^\s?#]+\/home\/(\d+)/i))) return {site: 'redfin', id: m[1], url: m[0]};
    if ((m = u.match(/^https:\/\/(?:www\.)?zillow\.com\/homedetails\/[^\s?#]*?\/?(\d+)_zpid/i))) return {site: 'zillow', id: m[1], url: m[0]};
    if ((m = u.match(/^https:\/\/(?:www\.)?realtor\.com\/realestateandhomes-detail\/[^\s?#]*?_(M\d{5}-\d{5})/i))) return {site: 'realtor', id: m[1], url: m[0]};
  }
  return null;
}
export function htmlToText(html) {
  return decode(String(html || '')
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, h, inner) => ` ⟦${decode(h)}⟧ ${inner} `)
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')).replace(/[ \t\u00a0]+/g, ' ').replace(/\n\s*/g, '\n');
}
export function parsePrice(text) {
  const out = [];
  for (const m of text.matchAll(/\$\s?(\d+(?:\.\d+)?)\s?([kKmM])\b|\$\s?(\d{1,3}(?:,\d{3})+|\d{5,})/g)) {
    const v = m[3] ? Number(m[3].replaceAll(',', '')) : Number(m[1]) * (/k/i.test(m[2]) ? 1e3 : 1e6);
    if (v >= 10000) out.push(Math.round(v));
  }
  return out;
}
export function parseAcres(text) {
  const a = text.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:acres?|ac)\b(?!\s*(?:feet|ft))/i);
  if (a) return Number(a[1].replaceAll(',', ''));
  const sq = text.match(/(?:lot(?: size)?[:\s]+)(\d[\d,]*)\s*(?:sq\.?\s?ft\.?|sqft)|(\d[\d,]*)\s*(?:sq\.?\s?ft\.?|sqft)\s*lot/i);
  const v = sq && Number((sq[1] || sq[2]).replaceAll(',', ''));
  return v ? v / 43560 : null;
}
// Splits the text into one segment per address. Price may sit before or after the address on a card, so the layout is
// detected from the first price in the email; ambiguous segments simply yield an unknown price (a safe, ineligible lead).
export function extractListings(email) {
  const site = senderSite(email.from);
  if (!site) return {site: null, listings: [], quarantine: 'sender_not_recognized'};
  const full = email.html ? htmlToText(email.html) : decode(String(email.text || ''));
  const cut = full.search(CUT);
  const text = cut > 200 ? full.slice(0, cut) : full;
  // A link wrapping the address is rendered just before it; keep that marker with its own listing.
  const hits = [...text.matchAll(ADDRESS)].map(m => {
    const lead = text.slice(0, m.index).match(/⟦[^⟧]+⟧\s*$/);
    return {m, start: lead ? m.index - lead[0].length : m.index, end: m.index + m[0].length};
  });
  if (!hits.length) return {site, listings: [], quarantine: 'no_addresses_found'};
  const firstPrice = text.search(/\$\s?\d/);
  const priceBefore = firstPrice >= 0 && firstPrice < hits[0].start;
  const listings = [];
  hits.forEach((h, i) => {
    const prevEnd = i ? hits[i - 1].end : Math.max(0, h.start - 400);
    const nextStart = i + 1 < hits.length ? hits[i + 1].start : Math.min(text.length, h.end + 400);
    const seg = priceBefore ? text.slice(prevEnd, h.end) : text.slice(h.start, nextStart);
    const prices = parsePrice(seg);
    const links = [...seg.matchAll(/⟦([^⟧]+)⟧/g)].map(x => listingLink(x[1])).filter(Boolean);
    const [, street, city, state, zip] = h.m;
    listings.push({site, street: street.trim(), city: city.trim(), state, zip, price: prices.length === 1 ? prices[0] : null,
      acres: parseAcres(seg), link: links[0] || null, negative: NEGATIVE.test(seg.replace(/⟦[^⟧]+⟧/g, ' '))});
  });
  if (listings.length === 1 && NEGATIVE.test(String(email.subject || ''))) listings[0].negative = true;
  const seen = new Set();
  return {site, listings: listings.filter(l => { const k = normalizeAddress(`${l.street}, ${l.city}, ${l.state}, ${l.zip}`); if (seen.has(k)) return false; seen.add(k); return true; })};
}
export function normalizeAlert(l, rules, zipCounty, receivedAt) {
  const full = [l.street, l.city, l.state, l.zip].join(', ');
  const key = normalizeAddress(full);
  const z = zipCounty[l.zip];
  const county = z && z[0] === l.state ? z[1] : null; // ZIP-derived county is approximate near county lines
  const n = {providerId: l.link ? `${l.link.site}:${l.link.id}` : `alert:${l.site}:${key.replaceAll(' ', '-')}`.slice(0, 120),
    address: l.street, fullAddress: full, canonicalKey: key, state: l.state, city: l.city, zip: l.zip, county,
    price: l.price ?? NaN, acres: l.acres ?? NaN, siteBuilt: null, existingDwelling: false, legalDetachedHomes: 0,
    track: (l.price ?? 0) > rules.homes.max_price ? 'compound' : 'home', locationConfirmed: false,
    status: l.negative ? 'unavailable' : 'unverified', checkedAt: new Date(receivedAt).toISOString(),
    sourceUpdatedAt: new Date(receivedAt).toISOString(), listingUrl: l.link?.url || null, alertSite: l.site};
  return {...n, ...criteria(n, rules), reasons: [...criteria(n, rules).reasons, 'alert_lead_requires_licensed_verification']};
}
export function processEmail(email, rules, zipCounty, now = new Date()) {
  const r = extractListings(email);
  const received = email.receivedAt || now;
  return {site: r.site, quarantine: r.quarantine || null, rows: r.listings.map(l => normalizeAlert(l, rules, zipCounty, received))};
}
