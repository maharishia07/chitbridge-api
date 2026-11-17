/* one-price-reader.cjs — A STORED PRICE HAS ONE READER: CBMoney.priceOf (engine/money.js). (2026-09-28, M20)
 *
 * The backlog item "ONE READER FOR A STAMPED PRICE — there are five, and one of them was broken". Five places read
 * `x.price.amount` raw with their own fallback; four happened to give the right number through `Number(raw) || 0`,
 * and one (pick.js's item mapper) passed a price stored as "12.50" into the cart as TEXT — review §21's case, where
 * the counter billed ₹12.50 and the storefront called the same product unpriced.
 *
 * ⚠️ THE FAILURE MODE IS A SIXTH COPY. Each copy is right the day it is written, and the one that drifts is found by
 * a customer. So this fails on the IDIOM, wherever it reappears: a raw `.price.amount` read with its own fallback to
 * the bare value. money.js itself (and the adopted engine copies) are the only place it may live.
 *
 * Run: node e2e/one-price-reader.cjs
 */
'use strict';
const fs = require('fs'), path = require('path');
const PUB = path.join(__dirname, '..', 'public');

/* the two shapes the copies took: `x.price && x.price.amount != null ? x.price.amount : x.price` and
   `(x.price && typeof x.price === 'object') ? x.price.amount : x.price` */
const IDIOMS = [
  /\.price\s*&&\s*[\w$.]*\.price\.amount\s*!==?\s*null\s*\)?\s*\?\s*[\w$.]*\.price\.amount/,
  /typeof\s+[\w$.]*\.price\s*===?\s*'object'\s*\)?\s*\?\s*[\w$.]*\.price\.amount/,
];
const SKIP_DIR = new Set(['engine', 'node_modules']);

function walk(dir, out) {
  for (const n of fs.readdirSync(dir)) {
    const f = path.join(dir, n);
    const st = fs.statSync(f);
    if (st.isDirectory()) { if (!SKIP_DIR.has(n)) walk(f, out); continue; }
    if (/\.(js|html)$/.test(n)) out.push(f);
  }
  return out;
}

const hits = [];
let scanned = 0;
for (const f of walk(PUB, [])) {
  scanned++;
  const lines = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').split('\n');
  lines.forEach((l, i) => {
    if (/^\s*(\*|\/\/|\/\*)/.test(l)) return;            /* a comment may NAME the idiom; only code is a reader */
    if (IDIOMS.some((re) => re.test(l))) hits.push(path.relative(PUB, f) + ':' + (i + 1) + '  ' + l.trim().slice(0, 110));
  });
}

/* ⚠️ a guard that finds no files is measuring nothing */
if (scanned < 50) { console.log('✗ scanned only ' + scanned + ' files — the walk is broken, not the app clean'); process.exit(1); }
const usesOne = fs.readFileSync(path.join(PUB, 'app', 'pick.js'), 'utf8').indexOf('money_().priceOf(') >= 0;
if (!usesOne) { console.log('✗ pick.js no longer reads prices through money.priceOf'); process.exit(1); }

console.log('── a stored price has one reader: CBMoney.priceOf ──');
console.log('  scanned ' + scanned + ' files under public/ (engine/ is money\'s own)');
if (hits.length) {
  console.log('  ✗ ' + hits.length + ' raw reader(s) with their own fallback — use CBMoney.priceOf:');
  hits.forEach((h) => console.log('     ' + h));
  process.exit(1);
}
console.log('  OK — no raw price reader outside money');

/* ⭐ AND THE BEHAVIOUR, not only the text: the real money engine and the real pick.js, in a sandbox. The case that
   was broken — a price stored as the STRING "12.50" — must reach the cart as the NUMBER 12.5. */
const vm = require('vm');
const sb = { console }; sb.window = sb; sb.self = sb; sb.globalThis = sb; vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(PUB, 'engine', 'money.js'), 'utf8'), sb);
vm.runInContext(fs.readFileSync(path.join(PUB, 'app', 'pick.js'), 'utf8') + '\n;this.CBPick = CBPick;', sb);
const got = sb.CBPick.toItems([
  { item_id: 'a', item_data: { name: 'Stored as text', price: { amount: '12.50', currency: 'INR' } } },
  { item_id: 'b', item_data: { name: 'Stored as money', price: { amount: 40, currency: 'INR' } } },
  { item_id: 'c', item_data: { name: 'Bare number', price: 7 } },
  { item_id: 'd', item_data: { name: 'No price' } },
]).map((x) => x.item_data.price);
const want = [12.5, 40, 7, undefined];
const same = got.length === want.length && got.every((v, i) => v === want[i]);
console.log('  ' + (same ? 'OK' : '✗') + ' pick.toItems reads every stored shape: ' + JSON.stringify(got.map((v) => v === undefined ? 'absent' : v)));
if (!same) process.exit(1);
