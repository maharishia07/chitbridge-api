/**
 * tests/sec3-s16-ask-cap.test.cjs - S16 (VERIFY-EL-SECURITY): POST /api/integrations/ask/:handle/stock is public and made the shop's connector re-read its stock on every call.
 * ATTACK    an anonymous caller (or many, each under the per-address limiter) calls it in a loop: the connector re-reads the shop's whole stock again and again.
 * RULE      at most 6 asks a minute PER SHOP; the rest answer asked:false ("already on its way") and emit nothing.
 * RUN       node tests/sec3-s16-ask-cap.test.cjs        STANDARD  OWASP API4:2023 (unrestricted resource consumption) · ASVS 4.0.3 V11.1.4
 * CARD      23-connectors-and-integrations
 */
const assert = require('assert');
const G = require('./support/route-golden.cjs');
const SHOP = '11111111-1111-4111-8111-111111111111';
const h = G.harness({ known: { [SHOP]: 'SHOP' }, rows: (sql) => (/FROM identities WHERE \(user_id/.test(sql) ? [{ identity_id: SHOP }] : []) });
const view = require.resolve('../lib/catalogue-view');
const real = require('../lib/catalogue-view');
require.cache[view].exports = Object.assign({}, real, { catalogueVisibility: async () => 'public' });
const events = require('../lib/events');
let emitted = 0;
events.emit = () => { emitted++; return 1; };
const app = h.app('/api/integrations', require('../routes/integrations'));
(async () => {
  let asked = 0;
  for (let k = 0; k < 40; k++) {
    const r = await h.run(app, { method: 'POST', url: '/api/integrations/ask/shopx/stock', body: {}, identity: null, settle: 1 });
    if (r.status === 200 && r.body && r.body.asked) asked++;
  }
  const ok = asked === 6 && emitted === 6;
  console.log((ok ? '  ok  ' : '  FAIL ') + '40 anonymous asks in a minute: ' + asked + ' reach the connector (cap 6, was 40), events emitted ' + emitted);
  assert.ok(ok);
  process.exit(0);
})().catch((e) => { console.log('  FAIL ' + e.message); process.exit(1); });
