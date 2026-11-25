/**
 * in-v-f07-offrail-itc-3b.test.cjs — WALK V V-F-07 (P2): an off-rail purchase (POST /api/books/events expense with a bill) posts Input IGST 180.00 to the books, but GSTR-3B 4(A)(5)
 * and /api/tax/ledger showed 0: the month's ledger read only chits. Hand: 1,000 + 18% IGST = 180.00 input tax -> 4(A)(5) iamt 180.00 and 4(A) net iamt 180.00 (CGST Act s.16; GSTR-3B Table 4).
 * Blocked credit never posts to an input role (its tax goes to cost), so the same read leaves it out: same basis as the ledger.
 * Run: node tests/in-v-f07-offrail-itc-3b.test.cjs
 * CARD      14-accounting/gst-returns
 * UNIT      lib/offrail-itc.js · lib/tax-copy.js
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
const SHOP = '11111111-1111-4111-8111-111111111111';
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const IDENTITY = { identity_id: SHOP, gstn: '29AABCV7001A1ZT', display_name: 'Shop', country: 'IN', timezone: 'Asia/Kolkata', policy_flags: { price_includes_tax: 'no' } };
const month = new Date().toISOString().slice(0, 7);
function loadWith(eventRows, identity) {
  const dbPath = require.resolve(path.join(API, 'db')), tcPath = require.resolve(path.join(API, 'lib', 'tax-copy'));
  const handle = { query: async (sql) => ({ rows: /source_ref LIKE 'ev:/.test(sql) ? eventRows : [] }) };
  require.cache[dbPath] = { exports: { query: async (sql) => ({ rows: /identities/.test(sql) ? [identity || IDENTITY] : [] }), withEntity: async (e, fn) => fn(handle) } };
  delete require.cache[tcPath]; delete require.cache[require.resolve(path.join(API, 'lib', 'offrail-itc'))];
  return require(tcPath);
}
(async () => {
  console.log('\n== V-F-07: GSTR-3B 4(A)(5) reads the off-rail purchases the books hold ==\n');
  const T = require(path.join(API, 'lib', 'tax-lines'));
  const three = (led) => T.gstr3b(led.ledger, led.me, led.bounds.period);
  const a = await loadWith([{ role: 'input_igst', minor: '18000' }]).ledgerFor(SHOP, month);
  const r = three(a);
  ok('off-rail Input IGST 180.00 -> 4(A)(5) OTH iamt 180', r.itc_elg.itc_avl[0].ty === 'OTH' && r.itc_elg.itc_avl[0].iamt === 180, JSON.stringify(r.itc_elg));
  ok('  and 4 net iamt 180', r.itc_elg.itc_net.iamt === 180, JSON.stringify(r.itc_elg.itc_net));
  ok('  and the ledger ITC (GET /api/tax/ledger) carries it once: igst 180', a.ledger.itc.igst === 180, JSON.stringify(a.ledger.itc));
  const b = await loadWith([{ role: 'input_cgst', minor: '9000' }, { role: 'input_sgst', minor: '9000' }]).ledgerFor(SHOP, month);
  const rb = three(b);
  ok('intra-state 90.00 + 90.00 -> camt 90, samt 90', rb.itc_elg.itc_net.camt === 90 && rb.itc_elg.itc_net.samt === 90, JSON.stringify(rb.itc_elg.itc_net));
  const none = await loadWith([]).ledgerFor(SHOP, month);
  ok('no off-rail purchase changes nothing (4 stays 0)', three(none).itc_elg.itc_net.iamt === 0 && none.ledger.itc.tax === 0);
  const un = await loadWith([{ role: 'input_igst', minor: '18000' }], Object.assign({}, IDENTITY, { policy_flags: { gst_registration: 'composition' } })).ledgerFor(SHOP, month);
  ok('a shop that is not a regular taxpayer claims none', un.ledger.itc.tax === 0, JSON.stringify(un.ledger.itc));
  const au = await loadWith([{ role: 'input_igst', minor: '18000' }], Object.assign({}, IDENTITY, { country: 'AU' })).ledgerFor(SHOP, month);
  ok('an AU shop is not read this way (BAS 1B reads the posted ledger)', au.ledger.itc.tax === 0, JSON.stringify(au.ledger.itc));
  console.log('\n  ' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + pass + ' passed · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})();
