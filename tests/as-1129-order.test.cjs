/**
 * tests/as-1129-order.test.cjs - AS-F-03 through routes/chits.js SEND_STEPS in the route's REAL order, from {}, up to and including sendRailNumber (critic 1129, 22 Nov 2026: the step read sendState.is_draft,
 * which sendFanOut sets 12 steps later, so a person saving an India invoice DRAFT with no number was refused). Only the database is a stand-in.
 *   IN: a draft with no number passes and is not numbered; a final invoice with no number is ASSIGNED the next of the seller's series (26-27/0042); invoice_no is read as the number (INV-7 passes, 'bad number' is refused)
 *   a promoted repeat-supply draft (promote_draft_id, final, no number) passes; a typed duplicate is refused in words; the server's own send (kind auto) with no number is left alone; AU (rule not verified) is untouched
 *   a number assigned and then refused by a later step goes back to the series (giveBackNumber)
 * Run: node tests/as-1129-order.test.cjs
 */
'use strict';
const path = require('path');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const HERE = path.join(__dirname, '..');
const dbFile = require.resolve(path.join(HERE, 'db'));
const real = require(dbFile);
const SHOPS = { IN: { country: 'IN', currency_code: 'INR', timezone: 'Asia/Kolkata' }, AU: { country: 'AU', currency_code: 'AUD', timezone: 'Australia/Sydney' } };
let who = 'IN', counter = 42, dup = false;
const returned = [];
const read = async (sql, params) => {
  if (/SELECT country, currency_code, timezone/.test(sql)) return { rows: [SHOPS[who]] };
  if (/SELECT country, gstn/.test(sql)) return { rows: [{ country: who }] };
  if (/INSERT INTO books_counter/.test(sql)) return { rows: [{ n: counter++ }] };
  if (/UPDATE books_counter SET next_no/.test(sql)) { returned.push(params[3]); return { rows: [] }; }
  if (/FROM chit_header/.test(sql) && /sender_entity_id = \$1 AND purpose/.test(sql)) return { rows: dup ? [{ chit_id: 'earlier' }] : [] };
  if (/FROM identities/.test(sql)) return { rows: [{ bridge_id: 'b-1', display_name: 'Shop' }] };
  return { rows: [], rowCount: 0 };
};
require.cache[dbFile].exports = Object.assign({}, real, { query: read, withEntity: async (entity, work) => work({ query: read }) });
const chits = require(path.join(HERE, 'routes', 'chits.js'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

/** the real steps from {} to the number step; → what the route would hold */
async function drive(shop, body, kind) {
  who = shop;
  const req = { body, headers: {}, user: {}, identity: { bridge_id: 'b-1', display_name: 'Shop', entity_id: 'shop-' + shop, identity_id: 'shop-' + shop, identity_type: 'entity' } };
  const listeners = {};
  const res = { locals: { kind }, headersSent: false, statusCode: 200, status(c) { this.code = c; this.statusCode = c; return this; }, set() { return this; }, setHeader() {}, type() { return this; }, once(ev, fn) { listeners[ev] = fn; }, json(b) { this.headersSent = true; this.body = b; return this; }, send(b) { this.headersSent = true; this.body = b; return this; } };
  const state = {};
  const last = chits.SEND_STEPS.indexOf(chits.sendRailNumber);
  let stopped = null;
  for (let i = 0; i <= last && !stopped; i++) {
    const out = await chits.SEND_STEPS[i](state, req, res);
    if (out || res.headersSent) stopped = { at: chits.SEND_STEPS[i].name, code: res.body && res.body.code, status: res.code, said: String((res.body && (res.body.detail || res.body.message)) || '') };
  }
  return Object.assign({ at: null, number: req.body.business_json && req.body.business_json.bill_no, req, finish: (code) => { res.statusCode = code; if (listeners.finish) listeners.finish(); } }, stopped || {});
}
const send = (purpose, business, extra) => Object.assign({ purpose, line_items: [{ name: 'Item', qty: 1, price: 10000, gst_rate: 18 }], business_json: business }, extra || {});
const wait = () => new Promise((resolve) => setTimeout(resolve, 20));

(async () => {
  console.log('\n== AS-F-03 · the rail invoice number, through the real step order ==\n');
  ok('the number step runs before sendFanOut (is_draft is not in the state yet: the body is what it reads)', chits.SEND_STEPS.indexOf(chits.sendRailNumber) < chits.SEND_STEPS.findIndex((step) => step.name === 'sendFanOut'));
  let r = await drive('IN', send('invoice', {}, { is_draft: true }));
  ok('IN invoice DRAFT with no number passes and is not numbered', r.at === null && r.number === undefined, JSON.stringify([r.at, r.code, r.said]));
  r = await drive('IN', send('invoice', {}, { is_draft: 'true' }));
  ok('a draft stated as the text "true" is a draft too (the one boolean reader)', r.at === null && r.number === undefined, JSON.stringify([r.at, r.code]));
  r = await drive('IN', send('invoice', {}));
  ok('IN final invoice with no number is ASSIGNED the next of the series: 26-27/0042 (the counter hands out 42)', r.at === null && r.number === '26-27/0042' && r.req.body.business_json.printed_as === '26-27/0042', JSON.stringify([r.at, r.code, r.number]));
  r = await drive('IN', send('invoice', undefined));
  ok('no business_json at all: the document is numbered too', r.at === null && r.number === '26-27/0043', JSON.stringify([r.at, r.code, r.number]));
  r = await drive('IN', send('credit_note', {}));
  ok('a blank credit note takes a note number CN/26-27/...', r.at === null && /^CN\/26-27\/\d+$/.test(r.number || ''), JSON.stringify([r.at, r.code, r.number]));
  r = await drive('IN', send('invoice', { invoice_no: 'INV-7' }));
  ok('a number carried as invoice_no is the number (the one reader): passes, nothing assigned', r.at === null && r.number === undefined && r.req.body.business_json.invoice_no === 'INV-7', JSON.stringify([r.at, r.code, r.number]));
  r = await drive('IN', send('invoice', { invoice_no: 'bad number' }));
  ok('a bad number typed as invoice_no is refused in words (not read as blank and replaced)', r.at === 'sendRailNumber' && r.code === 'BILL_NO_BAD' && r.status === 422, JSON.stringify([r.at, r.code, r.said]));
  r = await drive('IN', send('invoice', { bill_no: 'ASx walk invoice number one 26 chars' }));
  ok('a 26-character number is refused naming the limit 16', r.code === 'BILL_NO_BAD' && /16/.test(r.said), r.said);
  dup = true;
  r = await drive('IN', send('invoice', { bill_no: 'INV-7' }));
  ok('a typed duplicate is refused, in words', r.code === 'BILL_NO_BAD' && /already on an earlier invoice/.test(r.said), JSON.stringify([r.at, r.code, r.said]));
  dup = false;
  r = await drive('IN', send('invoice', {}, { promote_draft_id: 'draft-1', is_draft: false }));
  ok('a promoted repeat-supply draft (final, no number) passes and is numbered', r.at === null && /^26-27\/\d+$/.test(r.number || ''), JSON.stringify([r.at, r.code, r.said]));
  r = await drive('IN', send('invoice', {}), 'auto');
  ok('the server\'s own send (kind auto) with no number is left to its own series', r.at === null && r.number === undefined, JSON.stringify([r.at, r.code]));
  r = await drive('IN', send('invoice', { till: { id: 'C1' }, bill_no: 'C1/26-27/0001' }));
  ok('a counter bill is judged at the till door, not here', r.at !== 'sendRailNumber', JSON.stringify([r.at, r.code]));
  r = await drive('AU', send('invoice', {}));
  ok('AU (number rule not verified): not judged, not numbered', r.at === null && r.number === undefined, JSON.stringify([r.at, r.code]));
  returned.length = 0;
  r = await drive('IN', send('invoice', {}));
  r.finish(422);
  await wait();
  ok('an assigned number whose send ends refused goes back to the series', returned.length === 1, JSON.stringify(returned));
  returned.length = 0;
  r = await drive('IN', send('invoice', {}));
  r.finish(200);
  await wait();
  ok('...and one whose send went through is kept', returned.length === 0, JSON.stringify(returned));

  console.log(String(pass) + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL threw: ' + (e && e.stack)); process.exit(1); });
