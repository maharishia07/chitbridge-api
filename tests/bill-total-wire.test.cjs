'use strict';
/**
 * tests/bill-total-wire.test.cjs — ACC-348a: THE `bill_total` KEY OF A CHIT LIST ROW AND THE CHIT DETAIL (critic ACC-206-G2G3, 348 points 2-6).
 * No database. For every stored shape in tests/lib/bill-total-fixtures.cjs (the hand figures) and for IN / AU / AE (and a 3-decimal currency):
 *   · the LIST path (a row carrying summary_json + invoice_total + invoice_currency, no business_json: lib/money-check.headerOfListRow) and the DETAIL path
 *     (the full header) answer THE SAME { total, agree, source, currency_code, says? } — a list that said agree:true where the detail says false is the failure the rule forbids;
 *   · a stamped chit whose copies differ answers agree:false with the shop's sentence; two currency codes among the copies are a disagreement too;
 *   · the currency is present; the stored copies are never shipped (no `copies`, no `differs`); a TR-6 operator copy answers { total: null, agree: true, source: 'withheld' };
 *   · a cost-blind reader's list row and chit answer carry no `bill_total` on a cost side (the allowlists drop it);
 *   · nothing in lib/money-check.js raises or writes on this path (never behind a GET).
 * The same agreement on real Postgres, per country, is tests/bill-total-wire.realstack.cjs (CI integration job).
 * Run: node tests/bill-total-wire.test.cjs
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const moneyCheck = require('../lib/money-check');
const costView = require('../lib/cost-view');
const { FIXTURES, INVOICE_FIXTURES } = require('./lib/bill-total-fixtures.cjs');

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks += 1; };
const same = (got, want, msg) => { assert.deepStrictEqual(got, want, msg); checks += 1; };
/** the list select's columns for one header: summary_json beside the invoice's total and currency (what the SQL fragment returns) */
const listRowOf = (header) => ({
  summary_json: header.summary_json,
  invoice_total: header.business_json && header.business_json.invoice && header.business_json.invoice.ValDtls ? header.business_json.invoice.ValDtls.TotInvVal : null,
  invoice_currency: (header.business_json && header.business_json.invoice && header.business_json.invoice.currency) || null
});
const COUNTRIES = [['IN', 'INR'], ['AU', 'AUD'], ['AE', 'AED'], ['OM', 'OMR']];

for (const [country, code] of COUNTRIES) {
  for (const fx of [...FIXTURES, ...INVOICE_FIXTURES]) {
    const summary = Object.assign({}, fx.summary, { currency_code: code });
    const business = fx.business ? { invoice: Object.assign({ currency: code }, fx.business.invoice) } : null;
    const header = { summary_json: summary, business_json: business };
    const detail = moneyCheck.billTotalWire(header);
    const list = moneyCheck.billTotalWire(moneyCheck.headerOfListRow(listRowOf(header)));
    same(list, detail, `${country} ${fx.id}: the list row and the detail answer the same`);
    same(detail.agree, counterPickAgree(header), `${country} ${fx.id}: agree is the one pick's`);
    if (fx.withheld || fx.id === 'withheld-with-invoice') same([detail.total, detail.agree, detail.source, detail.currency_code], [null, true, 'withheld', null], `${country} ${fx.id}: withheld`);
    else same(detail.currency_code, code, `${country} ${fx.id}: the currency is present`);
    ok(!('copies' in detail) && !('differs' in detail) && !('legacy_net' in detail), `${country} ${fx.id}: the stored copies are never shipped`);
  }
}
function counterPickAgree(header) { return require('../lib/counter-bill').pickOf(header).agree; }

/* a stamped chit whose copies differ: agree false, the shop's sentence, the standing figure (the invoice's 189) */
const red = INVOICE_FIXTURES.find((fx) => fx.id === 'invoice-differs-money');
const redHeader = { summary_json: Object.assign({ currency_code: 'INR' }, red.summary), business_json: red.business };
const redWire = moneyCheck.billTotalWire(redHeader);
same([redWire.total, redWire.agree, redWire.source], [189, false, 'invoice'], 'a stamped disagreement answers agree:false beside the standing 189');
ok(/call the help desk/i.test(redWire.says), 'a disagreement carries the shop\'s sentence (the web paints it, never composes one)');
same(moneyCheck.billTotalWire(moneyCheck.headerOfListRow(listRowOf(redHeader))), redWire, 'the list row says agree:false too (the credit-cap pattern, not pickOf over two copies)');
/* the two-copy trap the critic named: a list row WITHOUT the invoice column would see two copies and agree */
ok(counterPickAgree({ summary_json: red.summary, business_json: null }) === true, 'without the invoice column the two header copies agree: why the list select carries it');
same(moneyCheck.billTotalWire({ summary_json: { total_value: 180, money: { total: 189 } }, business_json: null }).agree, true, 'a pre-2-Nov chit (no stamps, route net beside the engine figure) is not a disagreement');

/* two currencies beside equal numbers are not equal */
const mixed = moneyCheck.billTotalWire({ summary_json: { currency_code: 'INR', money: { total: 189 } }, business_json: { invoice: { currency: 'AUD', ValDtls: { TotInvVal: 189 } } } });
same([mixed.agree, mixed.total], [false, 189], 'equal figures in two currencies: agree:false');
ok(!!mixed.says, 'and the sentence is there');
same(moneyCheck.billTotalWire({ summary_json: { currency_code: 'inr', money: { total: 189 } }, business_json: { invoice: { currency: 'INR', ValDtls: { TotInvVal: 189 } } } }).agree, true, 'the same code in two cases is one currency');

/* cost-blind: a buy-side list row and chit answer lose the key by the allowlists; a sale keeps it */
const row = { chit_id: 'c1', purpose: 'invoice', bill_total: redWire };
ok(!('bill_total' in costView.hideRowCosts(row, 'buy')), 'a blind reader\'s buy-side list row has no bill_total');
const answer = { header: { chit_id: 'c1' }, detail: {}, bill_total: redWire };
ok(!('bill_total' in costView.hideChitCosts(answer, { side: 'buy', mine: new Set() })), 'a blind reader\'s buy-side chit answer has no bill_total');

/* never behind a GET: this path reads and answers; it raises nothing */
const wireSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'money-check.js'), 'utf8');
const fn = wireSrc.slice(wireSrc.indexOf('function billTotalWire'), wireSrc.indexOf('/** a chit LIST row'));
ok(!/raise|raiseticket|\.query\(|INSERT/.test(fn), 'billTotalWire raises and writes nothing');

/* the routes carry it: three lists and the detail, the sort alias renamed */
const chitsSrc = require('../tools/chits-files.cjs').read(path.join(__dirname, '..'));
ok((chitsSrc.match(/costView\.listRows\(result\.rows\.map\(withBillTotal\)/g) || []).length === 3, 'sent, folder and inbox lists map every row through withBillTotal');
ok(chitsSrc.includes('bill_total: moneyCheck.billTotalWire(data.header.rows[0])'), 'the detail carries the same key from the full header');
ok(!/AS bill_total\b(?!_)/.test(chitsSrc), 'the sort alias is bill_total_sort, not the wire key');
console.log('bill-total-wire: ' + checks + ' checks pass');
