// deploy/proof-health.cjs — run by deploy/proof.sh and every cloud spin's test.sh (HX2, moved out of proof.sh): the api's /health says
// production with its database up, the web serves Home, and an unknown path is rewritten to the app (vercel.json / deploy/nginx.conf).
//   API_BASE=https://api… WEB_BASE=https://web… node deploy/proof-health.cjs      exit 0 = all three
'use strict';
const API = String(process.env.API_BASE).replace(/\/+$/, ''), WEB = String(process.env.WEB_BASE).replace(/\/+$/, '');
(async () => {
  const h = await (await fetch(API + '/health')).json();
  const w = await fetch(WEB + '/'), rw = await fetch(WEB + '/no/such/page');
  const ok = h.environment === 'production' && h.db === 'ok' && w.status === 200 && rw.status === 200 && (await rw.text()).includes('<title>ChitBridge</title>');
  console.log('    api /health environment=' + h.environment + ' db=' + h.db + ' commit=' + (h.commit || '-') + ' · web / ' + w.status + ' · rewrite ' + rw.status);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
