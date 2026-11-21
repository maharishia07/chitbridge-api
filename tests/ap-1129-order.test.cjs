/**
 * tests/ap-1129-order.test.cjs - AP-F-08 rate check judges the DOCUMENT'S OWN DAY (critic 1129, 22 Nov 2026), through routes/chits.js SEND_STEPS in the real order from {}, up to and including sendLineRates; only the database is a stand-in.
 *   IN: 12% on a bill billed_at 2025-06-01 passes; 28% on it passes; today's bill at 12% is refused; a credit note against a 2025-06-01 bill at 12% passes; a note with no original day is not judged;
 *       a stated export (the 0.1% merchant-export rate) passes; 18% today passes. AU 15% still refused, AU 10% passes.
 * Run: node tests/ap-1129-order.test.cjs
 */
'use strict';
const path = require('path');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const HERE = path.join(__dirname, '..');
const dbFile = require.resolve(path.join(HERE, 'db'));
const real = require(dbFile);
const SHOPS = { IN: { country: 'IN', currency_code: 'INR', timezone: 'Asia/Kolkata' }, AU: { country: 'AU', currency_code: 'AUD', timezone: 'Australia/Sydney' } };
let who = 'IN';
const read = async (sql) => {
  if (/SELECT country, currency_code, timezone/.test(sql)) return { rows: [SHOPS[who]] };
  if (/SELECT country, gstn/.test(sql)) return { rows: [{ country: who }] };
  if (/FROM identities/.test(sql)) return { rows: [{ bridge_id: 'b-1', display_name: 'Shop' }] };
  return { rows: [], rowCount: 0 };
};
require.cache[dbFile].exports = Object.assign({}, real, { query: read, withEntity: async (entity, work) => work({ query: read }) });
const chits = require(path.join(HERE, 'routes', 'chits.js'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

async function drive(shop, body) {
  who = shop;
  const req = { body, headers: {}, user: {}, identity: { bridge_id: 'b-1', display_name: 'Shop', entity_id: 'shop-' + shop, identity_id: 'shop-' + shop, identity_type: 'entity' } };
  const res = { locals: {}, headersSent: false, status(c) { this.code = c; return this; }, set() { return this; }, setHeader() {}, type() { return this; }, json(b) { this.headersSent = true; this.body = b; return this; }, send(b) { this.headersSent = true; this.body = b; return this; } };
  const state = {};
  const last = chits.SEND_STEPS.indexOf(chits.sendLineRates);
  for (let i = 0; i <= last; i++) {
    const stopped = await chits.SEND_STEPS[i](state, req, res);
    if (stopped || res.headersSent) return { at: chits.SEND_STEPS[i].name, code: res.body && res.body.code, status: res.code };
  }
  return { at: null };
}
const line = (rate) => ({ name: 'Item', qty: 1, price: 10000, gst_rate: rate });
const send = (purpose, rate, business) => ({ purpose, line_items: [line(rate)], business_json: business || {} });
const refusedAs = (r) => r.at === 'sendLineRates' && r.code === 'TAX_RATE_NOT_IN_PACK';

(async () => {
  console.log('\n== AP-F-08 · the rate list of the document\'s own day, through the real step order ==\n');
  ok('the step sits after sendBody, sendFanOut and sendSeller (the state it reads is set)', chits.SEND_STEPS.indexOf(chits.sendLineRates) > chits.SEND_STEPS.indexOf(chits.sendSeller));
  let r = await drive('IN', send('invoice', 12, { billed_at: '2025-06-01T10:00:00+05:30' }));
  ok('IN invoice dated 2025-06-01 at 12% passes (12 was on the menu then)', r.at === null, JSON.stringify(r));
  r = await drive('IN', send('invoice', 28, { billed_at: '2025-06-01T10:00:00+05:30' }));
  ok('IN invoice dated 2025-06-01 at 28% passes', r.at === null, JSON.stringify(r));
  r = await drive('IN', send('invoice', 12, { billed_at: '2026-11-20T10:00:00+05:30' }));
  ok('IN invoice dated 2026-11-20 at 12% is refused TAX_RATE_NOT_IN_PACK (not on today\'s menu)', refusedAs(r), JSON.stringify(r));
  r = await drive('IN', send('invoice', 18, { billed_at: '2026-11-20T10:00:00+05:30' }));
  ok('IN invoice today at 18% passes', r.at === null, JSON.stringify(r));
  r = await drive('IN', send('credit_note', 12, { against: { billed_at: '2025-06-01T10:00:00+05:30' } }));
  ok('IN credit note against a 2025-06-01 bill at 12% passes (a note carries the original bill\'s rate)', r.at === null, JSON.stringify(r));
  r = await drive('IN', send('credit_note', 28, { against: { billed_at: '2025-06-01T10:00:00+05:30' } }));
  ok('IN credit note against that bill at 28% passes', r.at === null, JSON.stringify(r));
  r = await drive('IN', send('credit_note', 12, {}));
  ok('a note that names no original day is not judged here', r.at === null, JSON.stringify(r));
  r = await drive('IN', send('invoice', 0.1, { is_export: true, billed_at: '2026-11-20T10:00:00+05:30' }));
  ok('IN stated export at 0.1% (merchant export) passes', r.at === null, JSON.stringify(r));
  r = await drive('IN', send('invoice', 0.1, { billed_at: '2026-11-20T10:00:00+05:30' }));
  ok('0.1% with no export stated is still refused (not on the domestic menu)', refusedAs(r), JSON.stringify(r));
  r = await drive('AU', send('invoice', 15, {}));
  ok('AU 15% still refused', refusedAs(r), JSON.stringify(r));
  r = await drive('AU', send('invoice', 10, {}));
  ok('AU 10% passes', r.at === null, JSON.stringify(r));

  console.log(String(pass) + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL threw: ' + (e && e.stack)); process.exit(1); });
