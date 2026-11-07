/**
 * tests/ctry-77-till-cash-parts.test.cjs — CTRY-77: THE TILL TAKES EVERY CASH PART ON THE PACK'S COIN STEP.
 *
 * OWNS      addPart ("+ part") and tenderParts (the partial-cash push) lifted from tools/tally-connector/till.html and run with the REAL packs:
 *           a cash part typed 10.02 on an AU bill of 10.02 goes out 10.00 with cash_round -0.02; card and India stay exact.
 * CALLED BY scripts/guards.cjs · by hand: node tests/ctry-77-till-cash-parts.test.cjs
 * FLOW      till.html functions ──▶ vm with lib/regulation + lib/country + lib/money ──▶ PARTS / tenderParts ──▶ cashRoundOf
 * CARD      counter/bill-slip
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
const FNS = ['r2', 'shopCur', 'docCountry', 'shopPack', 'shopMinor', 'booksMajor', 'cashRule', 'payWayId', 'cashDue', 'restBeforeLast', 'cashRoundOf', 'addPart', 'tenderParts'];

/** a till page for one shop: net = the bill, picked = the tender way, typed = the amount box */
function page(country, currency, net, picked, typed) {
  const MONEY = require('../lib/money');
  const box = { value: String(typed) };
  const ctx = {
    window: { CBRegulation: require('../lib/regulation'), CBCountries: require('../lib/country'), CBMoney: MONEY },
    Number, String, Math, Object, Array, JSON, isFinite,
    S: { shop: { country, currency, name: 'Test Shop' } }, MONEY: () => MONEY, cbQuiet: () => {},
    PICKED: picked, PAY_ASKED: false, PARTS: [], said: [],
    billMoney: () => ({ net }), say: (words) => ctx.said.push(words), money: (n) => String(n), creditCust: () => null,
    document: { getElementById: () => box }, paintParts: () => {}, paintTotals: () => {}, draftSave: () => {}
  };
  ctx.CBMoney = MONEY; ctx.CBRegulation = ctx.window.CBRegulation; ctx.CBCountries = ctx.window.CBCountries;
  vm.createContext(ctx);
  vm.runInContext(FNS.map(grab).join('\n') + '\nthis.__f = { addPart, tenderParts, cashRoundOf };', ctx);
  return { f: ctx.__f, ctx };
}

console.log('\n== CTRY-77 · the till: "+ part" cash and the partial-cash push ==\n');
ok('AU · "+ part" Cash 10.02 on a 10.02 bill → part 10.00, cash_round -0.02 (hand: 1002 mod 5 = 2, nearest 1000)', () => {
  const p = page('AU', 'AUD', 10.02, 'Cash', 10.02); p.f.addPart();
  assert.strictEqual(JSON.stringify(p.ctx.PARTS), JSON.stringify([{ how: 'Cash', amount: 10 }]));
  assert.strictEqual(p.f.cashRoundOf(p.ctx.PARTS, 10.02), -0.02);
});
ok('AU · "+ part" Cash 10.03 on a 10.03 bill → 10.05, cash_round +0.02', () => {
  const p = page('AU', 'AUD', 10.03, 'Cash', 10.03); p.f.addPart();
  assert.strictEqual(JSON.stringify(p.ctx.PARTS), JSON.stringify([{ how: 'Cash', amount: 10.05 }]));
  assert.strictEqual(p.f.cashRoundOf(p.ctx.PARTS, 10.03), 0.02);
});
ok('AU · "+ part" Card 10.02 stays exact', () => {
  const p = page('AU', 'AUD', 10.02, 'Card', 10.02); p.f.addPart();
  assert.strictEqual(JSON.stringify(p.ctx.PARTS), JSON.stringify([{ how: 'Card', amount: 10.02 }]));
});
ok('IN control · "+ part" Cash 10.02 stays 10.02 (no cashRounding in reg-in)', () => {
  const p = page('IN', 'INR', 10.02, 'Cash', 10.02); p.f.addPart();
  assert.strictEqual(JSON.stringify(p.ctx.PARTS), JSON.stringify([{ how: 'Cash', amount: 10.02 }]));
});
ok('AU · a card part, then a typed Cash 5.03 below the rest 5.05 → the cash pushed is on the step (tenderParts)', () => {
  /* bill 10.03: card 5.00 taken, rest 5.03 → cashDue 5.05; typed 5.03 < rest 5.05 → pushed amount is cashDue(min(5.03, 5.05)) = 5.05 */
  const p = page('AU', 'AUD', 10.03, 'Cash', 5.03);
  const out = p.f.tenderParts([{ how: 'Card', amount: 5 }], 10.03, 5.03);
  assert.strictEqual(JSON.stringify(out), JSON.stringify([{ how: 'Card', amount: 5 }, { how: 'Cash', amount: 5.05 }]));
});
ok('AU · the partial-cash push of a typed 3.33 when 5.05 is owed → 3.35 (a coin amount)', () => {
  const p = page('AU', 'AUD', 10.03, 'Cash', 3.33);
  const out = p.f.tenderParts([{ how: 'Card', amount: 5 }], 10.03, 3.33);
  assert.strictEqual(out[1].amount, 3.35);
});
ok('IN control · the partial-cash push stays as typed', () => {
  const p = page('IN', 'INR', 100.03, 'Cash', 33.33);
  assert.strictEqual(p.f.tenderParts([{ how: 'UPI', amount: 50 }], 100.03, 33.33)[1].amount, 33.33);
});
console.log('\n' + pass + ' ok, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
