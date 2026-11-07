/**
 * tests/acc-269-live-expense.test.cjs — ACC-269 LIVE PATH: the till's REAL expense chit (SIT P1 run part 16) has NO summary_json.money and NO total_value:
 * only business_json.expense{what, mode, amount} and line_items []. It must (1) not block the shop's whole GSTR-3B month (ACC-268 names a bill that states no total),
 * (2) show its posted input tax in 4A once, and (3) with no tax stated claim nothing and SAY so (expense_no_tax), never a silent 0.
 *
 * OWNS      the proof on the live body (tools/tally-connector/till.html chitOfExpense), beside tests/acc-269-expense-itc.test.cjs (which gave the chit a money block).
 * CALLED BY the test library (api T1). Run: node tests/acc-269-live-expense.test.cjs
 * CARD      14-accounting/gst-returns
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
const SHOP = '11111111-1111-4111-8111-111111111111';
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const IDENTITY = { identity_id: SHOP, gstn: '33AAAAA0000A1Z5', display_name: 'Mayur Traders', country: 'IN', timezone: 'Asia/Kolkata', policy_flags: { price_includes_tax: 'no' } };
const AT = new Date().toISOString();
const month = AT.slice(0, 7);
const id = (n) => 'a0000000-0000-4000-8000-' + String(n).padStart(12, '0');
const party = { role: 'sender', entity_id: SHOP, display_name: 'Mayur Traders' };
/** the body chitOfExpense builds, as the send stores it: NO summary_json, NO total_value, line_items [] */
const liveExpense = (n, amount, extra) => ({ chit_id: id(n), sender_entity_id: SHOP, purpose: 'expense', all_recipients: [party], business_json: { till: { id: 'T1' }, doc: 'expense', slip: 'expense', bill_no: 'EXP-' + n, billed_at: AT, expense: Object.assign({ what: 'Repairs', mode: 'Cash', amount }, extra || {}) }, summary_json: {}, sent_at: AT, created_at: AT, line_items: [], currency_code: 'INR' });
function loadWith(rows, posted) {
  const dbPath = require.resolve(path.join(API, 'db')), tcPath = require.resolve(path.join(API, 'lib', 'tax-copy'));
  const handle = { query: async (sql, args) => { if (!/a\.role = ANY/.test(sql)) return { rows }; return { rows: [].concat(...args[1].map((chit) => Object.entries((posted || {})[chit] || {}).map(([role, minor]) => ({ chit_id: chit, role, minor })))) }; } };
  require.cache[dbPath] = { exports: { query: async (sql) => ({ rows: /identities/.test(sql) ? [IDENTITY] : [] }), withEntity: async (e, fn) => fn(handle) } };
  delete require.cache[tcPath];
  return require(tcPath);
}
(async () => {
  console.log('\n== ACC-269 live path: the till expense body ==\n');
  const T = require(path.join(API, 'lib', 'tax-lines'));
  const itc = (led) => T.gstr3b(led.ledger, led.me, led.bounds.period).itc_elg.itc_net;

  const taxed = await loadWith([liveExpense(1, 11800, { input_tax: { cgst: 900, sgst: 900 } })], { [id(1)]: { input_cgst: 90000, input_sgst: 90000 } }).ledgerFor(SHOP, month);
  ok('till expense (no total stored) with cgst 900 + sgst 900 posted: not blocked', taxed.dropped.length === 0, JSON.stringify(taxed.dropped_why));
  ok('  4A shows 900 + 900', itc(taxed).camt === 900 && itc(taxed).samt === 900, JSON.stringify(itc(taxed)));

  const bare = await loadWith([liveExpense(2, 500)], {}).ledgerFor(SHOP, month);
  ok('till expense with no tax stated: does NOT block the month', bare.dropped.length === 0, JSON.stringify(bare.dropped_why));
  ok('  claims nothing in 4A', itc(bare).camt === 0 && itc(bare).samt === 0 && itc(bare).iamt === 0, JSON.stringify(itc(bare)));
  ok('  and says so: expense_no_tax names the chit with its amount', (bare.expense_no_tax || []).length === 1 && bare.expense_no_tax[0].chit_id === id(2) && /500/.test(bare.expense_no_tax[0].words) && /no ITC/i.test(bare.expense_no_tax[0].words), JSON.stringify(bare.expense_no_tax));

  const mixed = await loadWith([liveExpense(1, 11800, { input_tax: { cgst: 900, sgst: 900 } }), liveExpense(2, 500)], { [id(1)]: { input_cgst: 90000, input_sgst: 90000 } }).ledgerFor(SHOP, month);
  ok('a taxed and an untaxed expense in one month: 4A 900 + 900, one named, nothing dropped', mixed.dropped.length === 0 && itc(mixed).camt === 900 && (mixed.expense_no_tax || []).length === 1, JSON.stringify([itc(mixed), mixed.expense_no_tax]));

  /* a non-expense bill with no total is STILL named (ACC-268 unchanged) */
  const stranger = Object.assign(liveExpense(3, 0), { purpose: 'note', business_json: { bill_no: 'X-3' } });
  const still = await loadWith([stranger], {}).ledgerFor(SHOP, month);
  ok('ACC-268 unchanged: a non-expense chit that states no total is still named', still.dropped.length === 1, JSON.stringify([still.dropped, still.expense_no_tax]));

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n\n' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
