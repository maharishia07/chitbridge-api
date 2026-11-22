/**
 * tests/till-tender-sum-1129.test.cjs — P-F-01 + TAX-EXPLICIT at the till: A BILL IS NOT SAVED SHORT OF ITS TENDERS, AND NOT WITH A LINE THAT HAS NO TAX ANSWER.
 *
 * OWNS      tenderShortWords (lifted from tools/tally-connector/till.html, run with the REAL AU/IN packs), the order of finish()'s two stops, the sentence for a line with no tax answer.
 * CALLED BY scripts/guards.cjs · by hand: node tests/till-tender-sum-1129.test.cjs
 * FLOW      till.html functions ──▶ vm with lib/regulation + lib/country + lib/money ──▶ parts ──▶ tenderShortWords
 * CARD      counter/bill-slip
 * Hand figures in cents (AUD): 22.00 = 2200 = cash 1000 + card 1200; the A$11.00 item with no tax answer is 1100.
 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const HTML = fs.readFileSync(path.join(__dirname, '../tools/tally-connector/till.html'), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('   ok   ' + name); } catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + e.message); } };
function grab(name) {
  let at = HTML.indexOf('\nfunction ' + name + '(');
  if (at < 0) at = HTML.indexOf('\nvar ' + name + ' = ');
  assert.ok(at >= 0, name + ' is gone from till.html');
  let i = HTML.indexOf('{', at), depth = 0;
  for (; i < HTML.length; i++) { if (HTML[i] === '{') depth++; else if (HTML[i] === '}' && --depth === 0) break; }
  return HTML.slice(at, i + 1);
}
const FNS = ['r2', 'rmoney', 'shopCur', 'docCountry', 'shopPack', 'shopMinor', 'booksMajor', 'cashRule', 'payWayId', 'cashDue', 'restBeforeLast', 'cashRoundOf', 'tenderShortWords', 'noTaxAnswerWords'];
function page(country, currency) {
  const MONEY = require('../lib/money');
  const ctx = {
    window: { CBRegulation: require('../lib/regulation'), CBCountries: require('../lib/country'), CBMoney: MONEY },
    Number, String, Math, Object, Array, JSON, isFinite, S: { shop: { country, currency, name: 'T' } }, MONEY: () => MONEY, cbQuiet: () => {},
    money: (n) => currency + ' ' + Number(n).toFixed(2), schemeWord: () => 'GST'
  };
  ctx.CBMoney = MONEY; ctx.CBRegulation = ctx.window.CBRegulation; ctx.CBCountries = ctx.window.CBCountries;
  vm.createContext(ctx);
  vm.runInContext(FNS.map(grab).join('\n') + '\nthis.__f = { tenderShortWords, noTaxAnswerWords };', ctx);
  return ctx.__f;
}
console.log('\n== P-F-01 · the till does not save short tenders ==\n');
const au = page('AU', 'AUD');
ok('A$22.00 = cash 10.00 + card 12.00 (2200 = 1000 + 1200): nothing to say', () => assert.strictEqual(au.tenderShortWords([{ how: 'Cash', amount: 10 }, { how: 'Card', amount: 12 }], 22), ''));
ok('A$22.00 with cash 10.00 only: AUD 12.00 is still to take (the walk)', () => assert.ok(/AUD 12\.00 is still to take/.test(au.tenderShortWords([{ how: 'Cash', amount: 10 }], 22))));
ok('over by 1.00: said as over', () => assert.ok(/AUD 1\.00 over/.test(au.tenderShortWords([{ how: 'Cash', amount: 10 }, { how: 'Card', amount: 13 }], 22))));
ok('cash rounding: 0.37 kg apples, bill 5.99, cash 6.00 as the last part: rounding +0.01 is not a gap (599 + 1 = 600)', () => assert.strictEqual(au.tenderShortWords([{ how: 'Cash', amount: 6 }], 5.99), ''));
ok('card 5.00 + cash 0.99 → 1.00 on a 5.99 bill (cash rounds up to 1.00, +0.01): accepted', () => assert.strictEqual(au.tenderShortWords([{ how: 'Card', amount: 5 }, { how: 'Cash', amount: 1 }], 5.99), ''));
ok('float noise: 0.1 + 0.2 on a 0.30 bill (30 = 10 + 20)', () => assert.strictEqual(au.tenderShortWords([{ how: 'Cash', amount: 0.1 }, { how: 'Card', amount: 0.2 }], 0.3), ''));
ok('On credit counts as a tender (cash 10.00 + On credit 12.00 on 22.00)', () => assert.strictEqual(au.tenderShortWords([{ how: 'Cash', amount: 10 }, { how: 'On credit', amount: 12 }], 22), ''));
const inr = page('IN', 'INR');
ok('IN control: UPI 50.00 + cash 50.03 on 100.03 is exact', () => assert.strictEqual(inr.tenderShortWords([{ how: 'UPI', amount: 50 }, { how: 'Cash', amount: 50.03 }], 100.03), ''));
console.log('\n== TAX-EXPLICIT · no tax answer is said, never a 0 line ==\n');
ok('A$11.00 item with no tax answer: "No tax answer for Muffin — set its GST in Catalogue"', () => assert.strictEqual(au.noTaxAnswerWords(['Muffin']), 'No tax answer for Muffin — set its GST in Catalogue'));
ok('two items are named together', () => assert.strictEqual(au.noTaxAnswerWords(['Muffin', 'Tea']), 'No tax answer for Muffin, Tea — set its GST in Catalogue'));
ok('finish() stops on a line with no tax answer BEFORE the tender is read, and on short tenders BEFORE the send', () => {
  const fin = HTML.slice(HTML.indexOf('\nasync function finish(){'), HTML.indexOf('\nasync function finish(){') + 9000);
  const a = fin.indexOf('noTaxAnswerWords(noTax)'), b = fin.indexOf("document.getElementById('tendered')"), c = fin.indexOf('tenderShortWords(parts, m.net)'), d = fin.indexOf('HOST.bill(body)');
  assert.ok(a > 0 && b > a && c > b && d > c, [a, b, c, d].join(','));
});
ok('a refusal that cannot change (TAX_LINE_UNAVAILABLE, TENDER_SUM_MISMATCH) is held, not retried', () => assert.ok(/var NEVER_OK = \[[^\]]*'TAX_LINE_UNAVAILABLE'[^\]]*'TENDER_SUM_MISMATCH'/.test(HTML)));
ok('the warn row uses the sentence', () => assert.ok(HTML.includes("billWarnLine('norate', noTaxAnswerWords(noRateNames)")));
ok('P-F-06: the till asks for no invoice block when the snapshot says the shop has none (invoice_blocks false); the snapshot carries it from lease.leasesFor', () => {
  assert.ok(HTML.split(String.fromCharCode(10)).some((l) => l.startsWith("function leaseApplies(tag)") && l.includes("invoice_blocks === false")));
  assert.ok(fs.readFileSync(path.join(__dirname, '../routes/till.js'), 'latin1').includes('invoice_blocks: invoiceLease.leasesFor(country)'));
});
console.log(String(pass) + ' ok, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
