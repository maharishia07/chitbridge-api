'use strict';
/* tests/till-money-grain.test.cjs — THE TILL ROUNDS A MONEY AMOUNT TO THE SHOP CURRENCY'S OWN DECIMALS (public/till.html: rmoney, booksMajor, shopMinor)
 * UNIT      09 COUNTER / BILL / money helpers (CUR-1b found: r2 rounded to 2 decimals, so 1234 minor KWD answered 1.23, not 1.234)
 * OWNS      booksMajor and shopMinor on 3-decimal (KWD BHD OMR JOD TND LYD), 0-decimal (JPY) and 2-decimal (INR) shops · rmoney = the engine's
 *           CBMoney.round(n, shop currency), never a table of the till's own · r2 stays 2 decimals for QUANTITIES · no currency -> 2 · cashDue
 *           (the pack's cash step) answers as before on a 2-decimal shop.
 * CALLED BY .github/workflows/ci.yml (web guards). No browser: the helpers are LIFTED from the page by name and run against the real
 *           public/engine/money.js. TILL_FILE=<path> points it at another copy (the break check runs it on the old page).
 * FLOW      read till.html → lift MONEY, shopCur, r2, rmoney, booksMajor, shopMinor, cashDue → vm with window.CBMoney → assert
 * Run: node tests/till-money-grain.test.cjs */
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
let n = 0;
const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };
const eq = (a, b, m) => { assert.strictEqual(a, b, m + ' (got ' + a + ', want ' + b + ')'); n++; console.log('  ok  ' + m); };

const html = fs.readFileSync(process.env.TILL_FILE || path.join(__dirname, '..', 'public', 'till.html'), 'utf8');
/* a top-level function: from "function NAME(" to the first line that is exactly "}" (or the one line it sits on) */
function liftFn(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert(at >= 0, 'the page has function ' + name);
  const rest = html.slice(at + 1);
  const oneLine = rest.split('\n')[0];
  if (/\}\s*$/.test(oneLine) && !/\{\s*$/.test(oneLine)) return oneLine;
  return rest.slice(0, rest.indexOf('\n}\n') + 2);
}
function liftVar(name) {
  const m = html.match(new RegExp('\nvar ' + name + ' = function[^\n]*', ''));
  return m ? m[0] : '';
}
function shop(currency, rule) {
  const cx = vm.createContext({ console, S: { shop: { currency } }, cashRule: () => rule || null, payWayId: (x) => String(x || '') });
  cx.window = cx; cx.CBMoney = require(path.join(__dirname, '..', 'public', 'engine', 'money.js'));
  vm.runInContext([liftFn('MONEY'), liftFn('shopCur'), liftVar('r2'), liftVar('rmoney'), liftFn('booksMajor'), liftFn('shopMinor'), liftFn('cashDue')].join('\n'), cx);
  vm.runInContext('this.api = { r2: r2, booksMajor: booksMajor, shopMinor: shopMinor, cashDue: cashDue, rmoney: typeof rmoney === "function" ? rmoney : null }', cx);
  return cx.api;
}

console.log('3-decimal shops');
for (const cur of ['KWD', 'BHD', 'OMR', 'JOD', 'TND', 'LYD']) {
  const t = shop(cur);
  eq(t.booksMajor(1234), 1.234, cur + ': 1234 minor is 1.234');
  eq(t.shopMinor(1.234), 1234, cur + ': 1.234 is 1234 minor');
  eq(t.shopMinor(t.booksMajor(7)), 7, cur + ': 7 minor round-trips');
}
{
  const t = shop('KWD');
  eq(t.rmoney(1.2346), 1.235, 'KWD: rmoney rounds to 3 decimals (half away from zero)');
  eq(t.rmoney(0.1 + 0.2), 0.3, 'KWD: float dust is rounded off');
  eq(t.rmoney(-1.2346), -1.235, 'KWD: a negative rounds away from zero');
  eq(t.r2(1.2346), 1.23, 'r2 is still 2 decimals (a quantity must not take the currency grain)');
}
console.log('0-decimal and 2-decimal shops');
{
  const j = shop('JPY');
  eq(j.booksMajor(1234), 1234, 'JPY: 1234 minor is 1234');
  eq(j.shopMinor(1234), 1234, 'JPY: 1234 is 1234 minor');
  eq(j.rmoney(12.5), 13, 'JPY: rmoney rounds to a whole yen');
  eq(j.r2(1.5), 1.5, 'JPY: a quantity of 1.5 stays 1.5');
  const i = shop('INR');
  eq(i.booksMajor(1234), 12.34, 'INR: 1234 minor is 12.34');
  eq(i.shopMinor(12.34), 1234, 'INR: 12.34 is 1234 minor');
  eq(i.rmoney(1.005 + 0.001), 1.01, 'INR: rmoney is the 2-decimal answer');
  eq(i.rmoney(10.236), i.r2(10.236), 'INR: rmoney equals r2 on a 2-decimal shop');
}
console.log('unknown currency and cash rounding');
{
  const u = shop(null);
  eq(u.rmoney(1.2346), 1.23, 'no currency: the engine\'s 2 decimals');
  eq(u.booksMajor(1234), 12.34, 'no currency: booksMajor keeps 2');
  const aud = shop('AUD', { tender: 'cash', step_minor: 5 });
  eq(aud.cashDue(10.03, 'cash'), 10.05, 'AUD cash 10.03 rounds to 10.05');
  eq(aud.cashDue(10.02, 'cash'), 10, 'AUD cash 10.02 rounds to 10.00');
  eq(aud.cashDue(10.03, 'card'), 10.03, 'AUD card is not rounded');
  const none = shop('INR', null);
  eq(none.cashDue(10.03, 'cash'), 10.03, 'no cash rule: unchanged');
}
console.log(n + ' checks');
