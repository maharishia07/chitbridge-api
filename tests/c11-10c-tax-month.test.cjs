#!/usr/bin/env node
// @type: unit
/**
 * c11-10c-tax-month.test.cjs — C11 input-shape sweep, batch 10c (12 Nov 2026): ACC-302 one unreadable expense chit no longer fails a whole GST month; SPD-18 the month's parties are read in ONE statement.
 *
 * OWNS      the proof on lib/tax-copy.js ledgerFor: (ACC-302) a month with one expense chit whose input tax cannot be read keeps every other bill's ITC as it was, NAMES the bad one in dropped / dropped_why,
 *           never carries on with no ITC at all, and still fails when no chit can be read (the database is down, not one copy); (SPD-18) the identities of a month of copies are one statement, and the ledger is
 *           byte for byte the one the per-copy path gives (the golden is the same month with the one read made to fail, so every copy reads its own).
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real lib/tax-copy over a stand-in db.
 * FLOW      stand-in db (rows, posted input tax, identities by id, a counter of statements) → real ledgerFor → dropped · ITC · statement count · ledger equality
 * CARD      14-accounting/gst-returns
 * MIN unit — a bad expense chit is named and the rest unchanged; one identities read per month; ledger equal to the per-copy path.
 * TRACE     lib/tax-copy.js expenseTaxOfMonth, identityRowsOfMonth ← this test
 */
'use strict';
process.env.NODE_ENV = 'test';
const path = require('path');
const API = path.join(__dirname, '..');
const SHOP = '11111111-1111-4111-8111-111111111111';
let failed = 0, checks = 0;
const ok = (name, cond, why) => {
  checks++;
  if (!cond) {
    failed++;
    console.log('   FAIL ' + name + (why ? '\n          ' + why : ''));
  }
};
const IDENTITY = { identity_id: SHOP, gstn: '33AAAAA0000A1Z5', display_name: 'Mayur Traders', country: 'IN', timezone: 'Asia/Kolkata', policy_flags: { price_includes_tax: 'no' } };
const AT = new Date().toISOString();
const month = AT.slice(0, 7);
const id = (n) => 'a0000000-0000-4000-8000-' + String(n).padStart(12, '0');
const party = { role: 'sender', entity_id: SHOP, display_name: 'Mayur Traders' };
const invoice = (taxable, tax) => ({ currency: 'INR', DocDtls: { Typ: 'INV' }, ItemList: [{ GstRt: 18, AssAmt: taxable, CgstAmt: tax / 2, SgstAmt: tax / 2, IgstAmt: 0, CesAmt: 0 }], ValDtls: { AssVal: taxable, CgstVal: tax / 2, SgstVal: tax / 2, IgstVal: 0, CesVal: 0, TotInvVal: taxable + tax } });
const BUYERS = [1, 2, 3].map((n) => ({ identity_id: '22222222-2222-4222-8222-22222222222' + n, gstn: null, display_name: 'Buyer ' + n, country: 'IN', policy_flags: {} }));
/** a counter bill sent to one of three buyers on the rail: its copy needs that buyer's identity row */
const bill = (n) => {
  const buyer = BUYERS[n % 3];
  return { chit_id: id(n), sender_entity_id: SHOP, purpose: 'order', all_recipients: [party, { role: 'receiver', entity_id: buyer.identity_id, display_name: buyer.display_name }], business_json: { customer: { name: 'Walk-in', entity_id: buyer.identity_id }, till: { id: 'C1' }, bill_no: 'T' + n, billed_at: AT, invoice: invoice(100 * n, 18 * n) }, summary_json: { money: { total: 118 * n } }, sent_at: AT, created_at: AT, line_items: [], currency_code: 'INR' };
};
const expense = (n) => ({ chit_id: id(n), sender_entity_id: SHOP, purpose: 'expense', all_recipients: [party], business_json: { till: { id: 'T1' }, doc: 'expense', slip: 'expense', bill_no: 'EXP-' + n, billed_at: AT, expense: { what: 'Repairs', mode: 'Cash', amount: 11800, input_tax: { cgst: 900, sgst: 900 } } }, summary_json: {}, sent_at: AT, created_at: AT, line_items: [], currency_code: 'INR' });
const POSTED = { input_cgst: 90000, input_sgst: 90000 };
const POSTED_FOR = [id(1), id(2), id(3)];

/** the real tax-copy on a fresh load; plan: { rows, badChit (a chit whose input-tax read throws), failFirstBatch (the first many-party identities read throws) } */
function loadWith(plan) {
  const dbPath = require.resolve(path.join(API, 'db')),
    tcPath = require.resolve(path.join(API, 'lib', 'tax-copy'));
  const stats = { identityReads: 0, batchReads: 0 };
  let batchFailed = false;
  const known = [IDENTITY].concat(BUYERS);
  const handle = {
    query: async (sql, args) => {
      if (!/a\.role = ANY/.test(sql)) return { rows: plan.rows };
      if (plan.badChit && args[1].includes(plan.badChit)) throw new Error('could not read ' + plan.badChit);
      return { rows: [].concat(...args[1].map((chit) => Object.entries(POSTED_FOR.includes(chit) ? POSTED : {}).map(([role, minor]) => ({ chit_id: chit, role, minor })))) };
    }
  };
  const query = async (sql, args) => {
    if (!/identities/.test(sql)) return { rows: [] };
    stats.identityReads++;
    if (!/ANY\(\$1::uuid\[\]\)/.test(sql)) return { rows: [IDENTITY] };
    stats.batchReads++;
    if (plan.failFirstBatch && !batchFailed) {
      batchFailed = true;
      throw new Error('the month read failed');
    }
    return { rows: known.filter((row) => args[0].includes(row.identity_id)) };
  };
  require.cache[dbPath] = { exports: { query, withEntity: async (entity, run) => run(handle) } };
  delete require.cache[tcPath];
  return Object.assign(require(tcPath), { stats });
}
const itcOf = (led) => require(path.join(API, 'lib', 'tax-lines')).gstr3b(led.ledger, led.me, led.bounds.period).itc_elg.itc_net;

(async () => {
  /* ACC-302 */
  const good = [expense(1), expense(2), bill(7)];
  const bad = expense(3);
  const control = await loadWith({ rows: good }).ledgerFor(SHOP, month);
  const withBad = await loadWith({ rows: good.concat(bad), badChit: bad.chit_id }).ledgerFor(SHOP, month);
  ok('ACC-302: the control month has its ITC (900 + 900 twice)', itcOf(control).camt === 1800 && itcOf(control).samt === 1800, JSON.stringify(itcOf(control)));
  ok('ACC-302: one unreadable expense chit does not fail the month: the other bills keep their ITC', itcOf(withBad).camt === 1800 && itcOf(withBad).samt === 1800, JSON.stringify(itcOf(withBad)));
  ok('ACC-302: the bad one is NAMED in dropped, with words', withBad.dropped.includes(bad.chit_id) && withBad.dropped_why.some((item) => item.chit_id === bad.chit_id && /could not be read/.test(item.why)), JSON.stringify([withBad.dropped, withBad.dropped_why]));
  ok('ACC-302: nothing else is dropped', withBad.dropped.length === control.dropped.length + 1, JSON.stringify(withBad.dropped));
  let thrown = null;
  try {
    await loadWith({ rows: [bad], badChit: bad.chit_id }).ledgerFor(SHOP, month);
  } catch (e) {
    thrown = e;
  }
  ok('ACC-302: when no expense chit can be read the month still fails (not a return with no ITC in silence)', !!thrown, 'answered without throwing');

  /* SPD-18 */
  const copies = [bill(1), bill(2), bill(3), bill(4), bill(5), bill(6)];
  const batched = loadWith({ rows: copies });
  const ledger = await batched.ledgerFor(SHOP, month);
  ok('SPD-18: the parties of six copies are read in ONE statement (plus the shop own row)', batched.stats.batchReads === 1 && batched.stats.identityReads === 2, JSON.stringify(batched.stats));
  const golden = loadWith({ rows: copies, failFirstBatch: true });
  const perCopy = await golden.ledgerFor(SHOP, month);
  ok('SPD-18: the golden path (the one read failed, each copy reads its own) really read more than once', golden.stats.batchReads > 2, JSON.stringify(golden.stats));
  ok('SPD-18: the month ledger is byte for byte the per-copy path ledger', JSON.stringify(ledger) === JSON.stringify(perCopy), 'ledgers differ');
  ok('SPD-18: six bills read, none dropped', ledger.dropped.length === 0, JSON.stringify(ledger.dropped_why));

  /* ACC-276 (premise already built, 12 Nov: lib/books-manual wholeMinor): only the missing test is added here */
  const { givenLines } = require(path.join(API, 'lib', 'books-manual'));
  const lineOf = (more) => [Object.assign({ account: 'cash' }, more)];
  ok('ACC-276: a whole number of minor units is read (100050 paise = 1000.50)', givenLines(lineOf({ dr_minor: 100050 }), 'INR')[0].dr === 1000.5);
  const refusal = (more) => {
    try {
      givenLines(lineOf(more), 'INR');
      return null;
    } catch (e) {
      return e;
    }
  };
  const fraction = refusal({ dr_minor: 1000.5 });
  ok('ACC-276: a fraction of a minor unit is refused in words, never rounded', !!fraction && /not a whole number of minor units/.test(fraction.message), fraction && fraction.message);
  const huge = refusal({ cr_minor: 1e20 });
  ok('ACC-276: a figure past what a ledger line holds is refused in words', !!huge && /beyond what a ledger line holds/.test(huge.message), huge && huge.message);

  console.log(failed ? '\n  ' + failed + ' failed' : '\n  every check held');
  console.log('  ' + checks + ' checks'); /* scripts/guards.cjs counts a guard by this line */
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
