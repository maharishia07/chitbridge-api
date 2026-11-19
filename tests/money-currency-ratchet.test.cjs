'use strict';
/**
 * tests/money-currency-ratchet.test.cjs — CUR-10 slice 2: A MONEY HELPER CALL WITH NO CURRENCY MAY ONLY FALL IN NUMBER.
 *
 * OWNS      the count of money-helper calls in routes/*.js and lib/*.js that name no currency: money.round(n) / round2(n) / roundMoney(n) (second argument absent),
 *           money.decimals() with nothing, pricing unitPrice(d, qty, list) (fourth absent), addedPrice(mods) (second absent). Each such call rounds at the
 *           2-place shim today (decimalsShimCalls); once the engines drop the shim it throws MONEY_CURRENCY_MISSING. The count is frozen in
 *           tests/money-currency-ratchet.baseline.json and may never rise (a new call passes its currency: the shop's, from regional.currencyFor / the chit's).
 *           Skipped: files whose line 1 says ADOPTED (engine copies move with the engines), *.browser.js, lib/money.js itself, comments.
 * CALLED BY scripts/guards.cjs
 * CARD      14-accounting/README
 * USAGE     node tests/money-currency-ratchet.test.cjs [--write]   (--write only after the count FELL; it refuses to raise the baseline)
 * ⚠️ A count that fell below the baseline fails too, so the gain is locked in the same PR: run --write.
 */
const fs = require('fs');
const path = require('path');
const API = path.join(__dirname, '..');
const BASELINE = path.join(__dirname, 'money-currency-ratchet.baseline.json');

/* name → the fewest arguments that name a currency */
const NEED = { round: 2, round2: 2, roundMoney: 2, decimals: 1, unitPrice: 4, addedPrice: 2 };
const CALL = /(?:^|[^\w$.])((?:(?:money|M|MONEY|Money|CBMoney|moneyEngine|moneyModule\(\)|require\(['"]\.\/money['"]\)|_pe|pricing|CBPricing|variant|CBVariant|engine)\s*\.\s*)?)(round2|roundMoney|round|decimals|unitPrice|addedPrice)\s*\(/g;
/* a bare round( / decimals( is some local helper; only a money receiver counts for those. round2/roundMoney/unitPrice/addedPrice count bare or with a receiver. */
const RECEIVER_ONLY = new Set(['round', 'decimals']);

function strip(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}
function argCount(text, open) {
  let depth = 0, n = 0, seen = false, q = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; seen = true; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; if (depth > 1) seen = true; continue; }
    if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) return seen ? n + 1 : 0; continue; }
    if (c === ',' && depth === 1) { n++; continue; }
    if (!/\s/.test(c)) seen = true;
  }
  return 99;
}
function scan() {
  const found = {};
  for (const dir of ['routes', 'lib']) {
    for (const f of fs.readdirSync(path.join(API, dir)).filter((x) => x.endsWith('.js') && !x.endsWith('.browser.js')).sort()) {
      const rel = dir + '/' + f;
      const raw = fs.readFileSync(path.join(API, rel), 'utf8');
      if (rel === 'lib/money.js' || /^\/\*\s*ADOPTED/.test(raw)) continue;
      const text = strip(raw);
      let m, n = 0;
      CALL.lastIndex = 0;
      while ((m = CALL.exec(text))) {
        const recv = m[1], name = m[2];
        if (RECEIVER_ONLY.has(name) && !recv) continue;
        if (/^(?:function|async)\s*$/.test(text.slice(Math.max(0, m.index - 9), m.index + 1).trim())) continue;
        const before = text.slice(Math.max(0, m.index), m.index + m[0].length).trim();
        if (/^function\b/.test(before)) continue;
        if (argCount(text, m.index + m[0].length - 1) < NEED[name]) n++;
      }
      if (n) found[rel] = n;
    }
  }
  return found;
}

const found = scan();
const total = Object.values(found).reduce((a, b) => a + b, 0);
let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else { fail++; console.log('  FAIL ' + msg); } };

if (process.argv.includes('--write')) {
  const old = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : null;
  if (old && total > old.total) { console.log('  refused: ' + total + ' is above the baseline ' + old.total + '; pass the currency instead'); process.exit(1); }
  fs.writeFileSync(BASELINE, JSON.stringify({ total, files: found }, null, 2) + '\n');
  console.log('  baseline written: ' + total + ' no-currency money calls in ' + Object.keys(found).length + ' files');
  process.exit(0);
}

const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
check(total <= base.total, 'no-currency money calls rose ' + base.total + ' -> ' + total + ' (a new call must pass its currency)');
check(total >= base.total, 'the count fell ' + base.total + ' -> ' + total + ': lock the gain with node tests/money-currency-ratchet.test.cjs --write');
for (const f of Object.keys(found)) check(found[f] <= (base.files[f] || 0), f + ' has ' + found[f] + ' no-currency money calls, its baseline is ' + (base.files[f] || 0));
/* the scanner bites: it counts a planted bare call and ignores one that names its currency */
const probe = (s) => { const t = strip(s); let c = 0, m; CALL.lastIndex = 0; while ((m = CALL.exec(t))) { if (RECEIVER_ONLY.has(m[2]) && !m[1]) continue; if (argCount(t, m.index + m[0].length - 1) < NEED[m[2]]) c++; } return c; };
check(probe('const a = money.round(x * 2);') === 1, 'selftest: a bare money.round(x) is counted');
check(probe("const a = money.round(x * 2, 'INR');") === 0, 'selftest: money.round(x, cur) is not');
check(probe('const a = money.round(f(x, y));') === 1, 'selftest: nested commas do not count as a second argument');
check(probe('pricing.unitPrice(d, q, p)') === 1 && probe('pricing.unitPrice(d, q, p, cur)') === 0, 'selftest: unitPrice needs its fourth');
check(probe('// money.round(x)\n/* money.round(y) */') === 0, 'selftest: comments are not code');
console.log('  ' + total + ' no-currency money calls (baseline ' + base.total + ')');
console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
console.log('  ' + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
