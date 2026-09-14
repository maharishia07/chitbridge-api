'use strict';
/**
 * ── tests/item-kind.test.cjs · A SUPPLY MUST NEVER BE COUNTED AS A PRODUCT ──────────────────────────────────────
 *
 * b217 kept what a shop SELLS and what it USES in two lists rather than behind a flag, and said why:
 *
 *   *"A flag would be less code. It would also mean every storefront query, every counter query and every offer
 *   resolver needs the filter, for ever — and ONE missed WHERE puts floor cleaner on a customer-facing shop
 *   front. A separate table cannot leak by omission."*
 *
 * ⚠️ But the two lists share ONE movement log, and there `item_kind` is the only thing that says which list an
 * id points into. `lib/stock-store.js`: *"a supply and a product could otherwise share an id."* That column is a
 * flag after all — just a narrow one, in a single place — and it carries the whole separation.
 *
 * ── ⚠️⚠️ AND IT DEFAULTS TO 'catalogue', WHICH IS WHY THIS GUARD EXISTS ─────────────────────────────────────────
 *
 * A caller that forgets does not fail. It silently writes a SUPPLY into the product balance, and the error
 * surfaces as a stock figure nobody can explain, weeks later, with nothing pointing back here.
 *
 * ⭐ The default is still right — every movement written before b217 meant 'catalogue', and changing it would
 * have rewritten history. The answer is not a stricter default; it is that somebody notices a new caller.
 *
 * ⚠️ CHECKED 2026-09-14: stock_movement, stock_balance and supply_item are ALL EMPTY. Nothing has ever exercised
 * this path in production, so nothing has ever proven it at runtime. This guard reads the code, which is the
 * only proof available until a shop actually moves stock.
 */
const assert = require('assert'), fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const blank = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:\\])\/\/[^\n]*/g, (m) => m[0] + m.slice(1).replace(/[^\n]/g, ' '));

let pass = 0;
const it = (what, fn) => {
  try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; }
};

console.log('— a supply is never counted as a product —');

it('stock-store is the only thing that writes the movement log', () => {
  const writers = [];
  for (const dir of ['lib', 'routes']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      if (!/\.(js|cjs)$/.test(f)) continue;
      const rel = path.join(dir, f);
      if (rel.endsWith('stock-store.js')) continue;
      if (/INSERT\s+INTO\s+stock_(movement|balance)/i.test(blank(read(rel)))) writers.push(rel);
    }
  }
  assert.deepStrictEqual(writers, [],
    'these write the stock tables directly, bypassing the one place that sets item_kind:\n      '
    + writers.join('\n      ')
    + '\n      Every movement must go through lib/stock-store.js, or the two lists merge silently.');
});

it("the supply path declares item_kind 'supply' on EVERY call it makes", () => {
  const src = blank(read('lib/supply-store.js'));
  const calls = src.match(/stock\.(post|issue)\s*\(/g) || [];
  assert.ok(calls.length >= 2, 'expected at least two stock calls in supply-store, found ' + calls.length);
  const declared = (src.match(/item_kind:\s*'supply'/g) || []).length;
  assert.strictEqual(declared, calls.length,
    'supply-store makes ' + calls.length + " stock call(s) but declares item_kind 'supply' " + declared
    + ' time(s). A supply written without it lands in the PRODUCT balance and is silently counted as stock '
    + 'the shop could sell.');
});

it('the catalogue path relies on the default, and that is correct', () => {
  const src = blank(read('lib/stock-from-chit.js'));
  assert.ok(/store\.(post|issue)\s*\(/.test(src), 'stock-from-chit no longer calls the store — repoint this');
  assert.ok(!/item_kind:\s*'supply'/.test(src),
    "stock-from-chit declares item_kind 'supply'. A chit moves CATALOGUE items — goods bought or sold — and "
    + 'marking them as supplies would take them out of the product balance entirely.');
});

it('the default is still catalogue — history depends on it', () => {
  const src = blank(read('lib/stock-store.js'));
  assert.ok(/item_kind\s*\|\|\s*'catalogue'/.test(src),
    "stock-store no longer defaults item_kind to 'catalogue'. b217 chose that default so every movement "
    + 'written before it kept meaning what it meant. Changing it rewrites history.');
});

it('the database agrees with the code about what is legal', () => {
  const sql = fs.readdirSync(path.join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql'))
    .map((f) => read(path.join('migrations', f))).join('\n');
  assert.ok(/item_kind\s+IN\s*\('catalogue',\s*'supply'\)/.test(sql),
    'no CHECK found constraining item_kind to catalogue|supply. Without it a typo becomes a third list that '
    + 'nothing reads and nothing counts.');
});

console.log('  ' + pass + ' checks');
