/**
 * tests/ar-1129-order.test.cjs - AR-F-02 through the route's REAL step order (the critic, 22 Nov 2026: the reason step sat before purpose and counterBill were set, so it never fired).
 * The steps are routes/chits.js SEND_STEPS themselves, run from an empty state ({}), in order, up to and including the reason step; only the database is a stand-in.
 *   AE credit note with no reason: 422 CREDIT_NOTE_REASON_MISSING | with a reason, a blank one, an AE invoice, an AU credit note, a draft, a counter return: pass
 *   AR-F-06  a 'declared' clearance with no evidence stays declared; 'gathered' / 'documented' with none is pending
 * Run: node tests/ar-1129-order.test.cjs
 */
'use strict';
const path = require('path');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const HERE = path.join(__dirname, '..');
const dbFile = require.resolve(path.join(HERE, 'db'));
const real = require(dbFile);
let country = 'AE';
const read = async (sql) => {
  if (/SELECT country, currency_code, timezone/.test(sql)) return { rows: [{ country, currency_code: country === 'AE' ? 'AED' : 'AUD', timezone: country === 'AE' ? 'Asia/Dubai' : 'Australia/Sydney' }] };
  if (/SELECT country, gstn/.test(sql)) return { rows: [{ country }] };
  if (/FROM identities/.test(sql)) return { rows: [{ bridge_id: 'b-1', display_name: 'Shop' }] };
  return { rows: [], rowCount: 0 };
};
require.cache[dbFile].exports = Object.assign({}, real, { query: read, withEntity: async (entity, work) => work({ query: read }) });
const chits = require(path.join(HERE, 'routes', 'chits.js'));
const clearance = require(path.join(HERE, 'lib', 'clearance-gather.js'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

/** the real steps from {} up to and including the reason step; → { stoppedAt, code } */
async function drive(shopCountry, body) {
  country = shopCountry;
  const req = { body, headers: {}, user: {}, identity: { bridge_id: 'b-1', display_name: 'Shop', entity_id: 'shop-' + shopCountry, identity_id: 'shop-' + shopCountry, identity_type: 'entity' } };
  const res = { locals: {}, headersSent: false, status(c) { this.code = c; return this; }, set() { return this; }, setHeader() {}, type() { return this; }, json(b) { this.headersSent = true; this.body = b; return this; }, send(b) { this.headersSent = true; this.body = b; return this; } };
  const state = {};
  const last = chits.SEND_STEPS.indexOf(chits.sendCreditReason);
  for (let i = 0; i <= last; i++) {
    const stopped = await chits.SEND_STEPS[i](state, req, res);
    if (stopped || res.headersSent) return { at: chits.SEND_STEPS[i].name, code: res.body && res.body.code, status: res.code };
  }
  return { at: null };
}

(async () => {
  console.log('\n== AR-F-02 · the credit note reason, through the real step order ==\n');
  const last = chits.SEND_STEPS.indexOf(chits.sendCreditReason);
  ok('the reason step runs after the steps that set purpose, is_draft, business_json and counterBill', last > chits.SEND_STEPS.indexOf(chits.sendBody) && last > chits.SEND_STEPS.indexOf(chits.sendFanOut) && last > chits.SEND_STEPS.indexOf(chits.sendSeller));
  let r = await drive('AE', { purpose: 'credit_note', business_json: {} });
  ok('AE credit note, no reason: refused 422 CREDIT_NOTE_REASON_MISSING by the reason step', r.at === 'sendCreditReason' && r.status === 422 && r.code === 'CREDIT_NOTE_REASON_MISSING', JSON.stringify(r));
  r = await drive('AE', { purpose: 'credit_note', business_json: { reason_words: '  ' } });
  ok('a blank reason is no reason', r.code === 'CREDIT_NOTE_REASON_MISSING', JSON.stringify(r));
  r = await drive('AE', { purpose: 'credit_note', business_json: { reason_words: 'goods returned' } });
  ok('with a reason it passes the step', r.at === null, JSON.stringify(r));
  r = await drive('AE', { purpose: 'invoice', business_json: {} });
  ok('an AE invoice is not asked for a reason', r.at === null, JSON.stringify(r));
  r = await drive('AU', { purpose: 'credit_note', business_json: {} });
  ok('an AU credit note is not asked (its pack does not)', r.at === null, JSON.stringify(r));
  r = await drive('AE', { purpose: 'credit_note', is_draft: true, business_json: {} });
  ok('an AE credit-note draft is not judged', r.at === null, JSON.stringify(r));

  console.log('\n== AR-F-06 · a declared clearance stays declared without evidence ==\n');
  ok('no evidence: declared stays declared; gathered and documented go pending', clearance.statusOf(null, 'declared') === 'declared' && clearance.statusOf('', 'gathered') === 'pending' && clearance.statusOf(null, 'documented') === 'pending' && clearance.statusOf('cert-1', 'gathered') === 'gathered');

  console.log(String(pass) + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL threw: ' + (e && e.stack)); process.exit(1); });
