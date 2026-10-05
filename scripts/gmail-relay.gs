/**
 * Relays saved-search emails from a dedicated Gmail mailbox to househunt-inbound.
 * Set INBOUND_URL and INBOUND_SECRET as Apps Script properties. Run every 10 minutes.
 * The server deduplicates messageId. A local per-message checkpoint avoids resending
 * every message in a thread and still sees newly arriving replies in labeled threads.
 * Validate with real portal samples before turning on the alert source.
 */
function relayAlerts() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('INBOUND_URL');
  const secret = props.getProperty('INBOUND_SECRET');
  if (!url || !secret || secret.length < 32) throw new Error('Set INBOUND_URL and a 32+ character INBOUND_SECRET');
  const now = Date.now();
  const retention = 8 * 24 * 60 * 60 * 1000;
  const sent = props.getProperties();
  // Script-property storage is finite; expire checkpoints after the search window.
  for (const [key, value] of Object.entries(sent)) {
    if (key.startsWith('HH_SENT_') && Number(value) < now - retention) props.deleteProperty(key);
  }
  const query = '(from:redfin.com OR from:zillow.com OR from:realtor.com) newer_than:7d';
  const pageSize = 100;
  for (let offset = 0; offset < 500; offset += pageSize) {
    const threads = GmailApp.search(query, offset, pageSize);
    for (const thread of threads) {
      for (const msg of thread.getMessages()) {
        if (now - msg.getDate().getTime() > 7 * 24 * 60 * 60 * 1000) continue;
        const marker = 'HH_SENT_' + msg.getId();
        if (props.getProperty(marker)) continue;
        try {
          const res = UrlFetchApp.fetch(url, {
            method: 'post', contentType: 'application/json', muteHttpExceptions: true,
            headers: {'x-househunt-inbound-secret': secret},
            payload: JSON.stringify({from: msg.getFrom(), subject: msg.getSubject(),
              html: msg.getBody(), messageId: msg.getId(), receivedAt: msg.getDate().toISOString()})
          });
          const code = res.getResponseCode();
          Logger.log(code + ' ' + msg.getId() + ' ' + res.getContentText().slice(0, 150));
          if (code >= 200 && code < 300) props.setProperty(marker, String(now));
        } catch (err) {
          Logger.log('Relay retry needed for ' + msg.getId() + ': ' + String(err).slice(0, 150));
        }
      }
    }
    if (threads.length < pageSize) break;
  }
}
