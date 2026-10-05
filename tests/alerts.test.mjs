// All emails below are SYNTHETIC fixtures written to exercise the parser's rules. No real Redfin, Zillow or Realtor.com
// email has been parsed yet; layouts must be validated against real captured alerts before relying on this in production.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {senderSite, extractListings, processEmail, listingLink, parsePrice, parseAcres, htmlToText} from '../supabase/functions/_shared/alerts.mjs';
const rules = JSON.parse(readFileSync(new URL('../config/search.json', import.meta.url)));
const zips = JSON.parse(readFileSync(new URL('../supabase/functions/_shared/zip-county.json', import.meta.url)));
const now = new Date('2026-10-04T15:00:00Z');
const after = `<table><tr><td><a href="https://www.redfin.com/CA/Redding/12-Oak-Rd-96001/home/111">12 Oak Rd, Redding, CA 96001</a></td></tr>
<tr><td>$449,000 3 beds 2 baths 1,800 sq ft 6.5 acres lot</td></tr>
<tr><td><a href="https://www.redfin.com/OR/Roseburg/9-Pine-Ln-97470/home/222">9 Pine Ln, Roseburg, OR 97470</a></td></tr>
<tr><td>$389,500 2 beds 1 bath 5 acres</td></tr><tr><td>Unsubscribe</td></tr></table>`;
const mail = (o = {}) => ({from: 'Redfin <listings@redfin.com>', subject: '2 new homes', html: after, receivedAt: now, ...o});

test('sender must be a recognized portal domain', () => {
  assert.equal(senderSite('Redfin <a@redfin.com>'), 'redfin');
  assert.equal(senderSite('x@mail.zillow.com'), 'zillow');
  assert.equal(senderSite('a@redfin.com.evil.example'), null);
  assert.equal(senderSite('a@notredfin.com'), null);
  assert.equal(extractListings({from: 'a@evil.example', html: after}).quarantine, 'sender_not_recognized');
});
test('price-after cards: identity, price, acreage, county by ZIP, never active', () => {
  const {rows} = processEmail(mail(), rules, zips, now);
  assert.equal(rows.length, 2);
  const [a, b] = rows;
  assert.deepEqual([a.providerId, a.price, a.acres, a.county, a.region], ['redfin:111', 449000, 6.5, 'Shasta', 'CA:Shasta']);
  assert.deepEqual([b.providerId, b.price, b.acres, b.county, b.region], ['redfin:222', 389500, 5, 'Douglas', 'OR:Douglas']);
  for (const r of rows) { assert.equal(r.status, 'unverified'); assert.equal(r.eligible, false); assert.ok(r.reasons.includes('site_built_unverified')); }
  assert.equal(a.listingUrl, 'https://www.redfin.com/CA/Redding/12-Oak-Rd-96001/home/111');
});
test('price-before cards', () => {
  const html = `<p>$250,000 4 acres</p><p>5 Elm St, Sequim, WA 98382</p><p>$310,000 12.2 acres</p><p>77 Cedar Way, Sequim, WA 98382</p>`;
  const {rows} = processEmail({from: 'a@zillow.com', subject: 'New', html, receivedAt: now}, rules, zips, now);
  assert.deepEqual(rows.map(r => [r.price, r.acres]), [[250000, 4], [310000, 12.2]]);
});
test('no alert can ever be active, whatever the content', () => {
  for (const extra of ['Active', 'Just listed', 'Price drop', 'Active - no contingencies', 'ContingentYN false', 'verified active']) {
    const {rows} = processEmail(mail({html: after.replace('Unsubscribe', extra)}), rules, zips, now);
    for (const r of rows) assert.notEqual(r.status, 'active');
  }
});
test('negative status words withdraw only the listing they sit in; "household" is not "hold"', () => {
  const html = after.replace('6.5 acres lot', '6.5 acres lot Pending').replace('5 acres', 'Great household layout 5 acres');
  const {rows} = processEmail(mail({html}), rules, zips, now);
  assert.deepEqual(rows.map(r => r.status), ['unavailable', 'unverified']);
});
test('single-listing subject can withdraw; multi-listing subject cannot', () => {
  const one = `<a href="https://www.redfin.com/CA/Redding/12-Oak-Rd-96001/home/111">12 Oak Rd, Redding, CA 96001</a> $449,000`;
  assert.equal(processEmail(mail({subject: 'Status update: Pending', html: one}), rules, zips, now).rows[0].status, 'unavailable');
  assert.deepEqual(processEmail(mail({subject: '2 homes sold nearby'}), rules, zips, now).rows.map(r => r.status), ['unverified', 'unverified']);
});
test('footer sections such as recently sold homes are ignored', () => {
  const html = after + '<p>Recently sold homes</p><p>1 Old Rd, Redding, CA 96001 Sold $300,000</p>';
  const {rows} = processEmail(mail({html}), rules, zips, now);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(r => r.status === 'unverified'));
});
test('tracking links: recover only when the listing URL is visible, else fall back to address identity', () => {
  const real = 'https://www.redfin.com/CA/Redding/12-Oak-Rd-96001/home/111';
  assert.equal(listingLink('https://click.example.com/x?u=' + encodeURIComponent(real) + '&s=1').id, '111');
  assert.equal(listingLink('https://www.zillow.com/homedetails/12-Oak-Rd-Redding-CA-96001/2054321_zpid/').site, 'zillow');
  assert.equal(listingLink('https://www.realtor.com/realestateandhomes-detail/12-Oak-Rd_Redding_CA_96001_M12345-67890').id, 'M12345-67890');
  assert.equal(listingLink('https://click.example.com/opaque?token=abc'), null);
  assert.equal(listingLink('https://evil.example/CA/x/home/1'), null);
  const html = '<a href="https://click.example.com/opaque?token=abc">12 Oak Rd, Redding, CA 96001</a> $449,000 5 acres';
  const [r] = processEmail(mail({html}), rules, zips, now).rows;
  assert.match(r.providerId, /^alert:redfin:12-oak-rd/); assert.equal(r.listingUrl, null);
});
test('regions outside the configured counties are marked out of region', () => {
  const html = '12 Oak Rd, Bakersfield, CA 93301 $300,000 5 acres';
  const [r] = processEmail(mail({html}), rules, zips, now).rows;
  assert.equal(r.region, null); assert.ok(r.reasons.includes('outside_configured_region'));
});
test('price and acreage parsing', () => {
  assert.deepEqual(parsePrice('$1.2M or $449K or $499,000 or $5 off'), [1200000, 449000, 499000]);
  assert.equal(parseAcres('7.25 acres'), 7.25);
  assert.ok(Math.abs(parseAcres('Lot size: 217,800 sqft') - 5) < 1e-9);
  assert.equal(parseAcres('1,800 sq ft home'), null);
});
test('over-cap prices become compound candidates, not home matches', () => {
  const [r] = processEmail(mail({html: '5 Elm St, Sequim, WA 98382 $1,500,000 12 acres'}), rules, zips, now).rows;
  assert.equal(r.track, 'compound'); assert.ok(r.reasons.includes('two_legal_livable_detached_homes_unverified'));
});
test('emails without parseable addresses are quarantined, not guessed', () => {
  assert.equal(extractListings({from: 'a@redfin.com', html: '<p>Your weekly update</p>'}).quarantine, 'no_addresses_found');
});
test('html conversion keeps link targets and decodes entities', () => {
  assert.match(htmlToText('<a href="https://x.example/?a=1&amp;b=2">A &amp; B</a>'), /⟦https:\/\/x\.example\/\?a=1&b=2⟧ A & B/);
});
