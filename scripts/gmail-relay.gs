/**
 * Relays saved-search alert emails from a dedicated Gmail account to the househunt-inbound Edge Function.
 * UNTESTED: written against the documented Apps Script API; run once manually and check the log before trusting it.
 *
 * Setup: script.google.com (signed in as the alert mailbox) -> new project -> paste this file ->
 * Project Settings -> Script properties: INBOUND_URL (https://<project>.supabase.co/functions/v1/househunt-inbound)
 * and INBOUND_SECRET (the same value as the HOUSEHUNT_INBOUND_SECRET function secret) -> Triggers: run relayAlerts every 10 minutes.
 */
function relayAlerts() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('INBOUND_URL'), secret = props.getProperty('INBOUND_SECRET');
  if (!url || !secret) throw new Error('Set INBOUND_URL and INBOUND_SECRET script properties');
  const label = GmailApp.getUserLabelByName('househunt-sent') || GmailApp.createLabel('househunt-sent');
  const threads = GmailApp.search('(from:redfin.com OR from:zillow.com OR from:realtor.com) -label:househunt-sent newer_than:3d', 0, 25);
  for (const thread of threads) {
    let allOk = true;
    for (const msg of thread.getMessages()) {
      const res = UrlFetchApp.fetch(url, {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: {'x-househunt-inbound-secret': secret},
        payload: JSON.stringify({from: msg.getFrom(), subject: msg.getSubject(), html: msg.getBody(), messageId: msg.getId(), receivedAt: msg.getDate().toISOString()})
      });
      const code = res.getResponseCode();
      Logger.log(code + ' ' + msg.getSubject() + ' ' + res.getContentText().slice(0, 200));
      if (code < 200 || code >= 300) allOk = false;
    }
    if (allOk) thread.addLabel(label); // failed threads are retried on the next run; the server ignores duplicate message ids
  }
}
