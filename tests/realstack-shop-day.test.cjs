/**
// @type: unit
 * realstack-shop-day.test.cjs — A REALSTACK NEVER USES THE UTC DAY AS A SHOP'S BUSINESS DAY (tzsweep, 18 Nov 2026).
 * WHY: the IN test shop posts under its own Asia/Kolkata day; a test that reads the books "as at" `new Date().toISOString().slice(0, 10)` (the UTC day)
 * reads an empty day from 18:30 to 24:00 UTC (R1-03 went red that way on 17 Nov). The one source is tests/lib/shop-day.cjs (shopToday · shopDayAt, over
 * books-hooks.dayOf). This guard fails a clock-derived UTC day (`new Date()` / `Date.now()` then `.toISOString().slice(0, 10|7)` or `.split('T')`) in
 * tests/*.realstack.cjs and the harnesses under tests/lib. A line that is UTC on purpose (a fixed fixture calendar, never "today") says `utc-ok: <why>`.
 * Run: node tests/realstack-shop-day.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path');
const TESTS = __dirname;
const files = fs.readdirSync(TESTS).filter((f) => /\.realstack\.cjs$/.test(f)).map((f) => path.join(TESTS, f))
  .concat(['truth-harness.cjs', 'run-target.cjs', 'shop-day.cjs'].map((f) => path.join(TESTS, 'lib', f)));
/** the shape that reads the runner's UTC day as text: a clock read and a cut of its ISO string on one line */
const UTC_DAY = /(new Date\(\s*\)|new Date\(\s*Date\.now\(\)[^)]*\)|Date\.now\(\))[^;]*\.toISOString\(\)\s*\.(slice|substr|substring|split)\(\s*(0\s*,\s*(10|7)|'T')/;
const hits = (text) => text.split('\n').map((l, i) => ({ l, n: i + 1 })).filter((x) => !/^\s*(\/\/|\*|\/\*)/.test(x.l) && !/utc-ok/.test(x.l) && UTC_DAY.test(x.l));
let fail = 0;
const ok = (name, cond, why) => { if (!cond) fail++; console.log((cond ? '   ok   ' : '   FAIL ') + name + (cond ? '' : '\n          ' + why)); };

ok('the pattern catches the three forms that went red / were swept', [
  'const day = new Date().toISOString().slice(0, 10);',
  'const DAY = new Date(Date.now() - 864e5).toISOString().slice(0, 10);',
  "const d = new Date().toISOString().split('T')[0];"].every((s) => hits(s).length === 1), 'a form slipped the pattern');
ok('a deliberate UTC line with utc-ok, a comment, and a fixed fixture calendar pass', hits('x = new Date().toISOString().slice(0, 10); // utc-ok: a file name').length === 0
  && hits('// new Date().toISOString().slice(0, 10)').length === 0 && hits('const d = new Date(Date.UTC(2019, 6, 3)).toISOString().slice(0, 10);').length === 0, 'the allowances broke');
for (const f of files) {
  const bad = hits(fs.readFileSync(f, 'utf8'));
  ok(path.relative(TESTS, f) + ': no UTC day as the shop day (use tests/lib/shop-day.cjs)', !bad.length, bad.map((x) => 'line ' + x.n + ': ' + x.l.trim().slice(0, 100)).join('\n          '));
}
ok('shop-day.cjs: shopToday follows the shop zone, not UTC (18:30Z is already the next day in Kolkata; Sydney too)', (() => {
  const S = require('./lib/shop-day.cjs'), real = Date.now;
  try {
    Date.now = () => Date.parse('2026-11-17T19:20:00Z');
    return S.shopToday() === '2026-11-18' && S.shopDayAt(-1) === '2026-11-17' && S.shopToday('UTC') === '2026-11-17' && S.shopToday('Australia/Sydney') === '2026-11-18';
  } finally { Date.now = real; }
})(), 'shopToday read the UTC day or the wrong zone');
console.log(fail ? '\n' + fail + ' failed' : '\nrealstack shop-day: ' + (files.length + 3) + ' checks, none failed');
process.exit(fail ? 1 : 0);
