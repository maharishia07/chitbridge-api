'use strict';
/**
 * tax-slab.test.cjs — the browser really has the API's tax engine, and it really answers the same way.
 *
 * Athi, 2026-09-03: *"in india tax is not simple … define slab and attach the slab to the product"* and, on every
 * attach screen: *"it has to showcase the outcome … so it can be verified then and there."*
 *
 * ── ⚠️⚠️ WHAT THIS FILE IS ACTUALLY GUARDING ───────────────────────────────────────────────────────────────────
 * `public/engine/tax.js` (tax-slab + tax, one bundle) is the ADOPTED mirror of `chitbridge-api/lib/*` — the product
 * page shows the invoice split, and it must be the split the ORDER will produce, not a lookalike. The failure
 * this exists to catch is the quiet one: the API's engine changes, nobody re-runs the generator, and the pane
 * keeps showing last month's arithmetic while looking perfectly healthy.
 *
 * So there are two kinds of assertion here:
 *   1. the mirrors LOAD as classic scripts and publish their globals (a Node `require` runs the same IIFE a
 *      <script> tag does, so this is the real loading path, not a simulation);
 *   2. the mirror is not STALE against the sibling API checkout, when one is present.
 *
 * ⚠️ (2) SKIPS RATHER THAN FAILS WHEN THE API REPO IS NOT BESIDE THIS ONE. CI for the web repo may not check the
 * API out, and a guard that fails for being unable to look is a guard people delete. It says which it did.
 *
 * Run: node e2e/tax-slab.test.cjs
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0, skip = 0;
const t = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) {
    if (e && e.__skip) { console.log('  – ' + name + ' (' + e.message + ')'); skip++; return; }
    console.log('  ✗ ' + name + '\n      ' + e.message); fail++;
  }
};
const skipIf = (cond, why) => { if (cond) { const e = new Error(why); e.__skip = true; throw e; } };

/* ⚠️ REQUIRED FOR THE SIDE EFFECT, exactly as a <script> tag loads them. The files export nothing; they attach a
   global, which is the whole reason they are wrapped in an IIFE — see e2e/dup-functions.cjs. */
/* ⭐ 2026-09-28: the files are ADOPTED chitbridge-engines releases, which hand a page window.CBTax — and in a browser
   `window` IS the global. Node has no window, so say what a browser would. (money-language.test.js does the same.) */
globalThis.window = globalThis.window || globalThis;
/* T2-ENGONCE: ONE file now — engine/tax.js is the adopted bundle, tax-slab (CBTaxSlab) inside it ahead of tax (CBTax) */
require('../public/engine/tax.js');
const T = globalThis.CBTax;
const S = globalThis.CBTaxSlab;

console.log('\ntax mirrors · they load the way the browser loads them');

t('both mirrors publish their global, and NOTHING else', () => {
  assert.ok(T && typeof T.determine === 'function', 'CBTax.determine');
  assert.ok(S && typeof S.resolve === 'function', 'CBTaxSlab.resolve');
  /* ⚠️ The pure modules' own names must NOT be globals. `pick` would collide with app/pick.js today, and
     dup-functions.cjs is right to forbid the class rather than trust anyone to notice. */
  for (const leaked of ['determine', 'supplyType', 'r2', 'pick', 'num', 'itemLine', 'slabOf', 'resolve']) {
    assert.strictEqual(globalThis[leaked], undefined, leaked + ' leaked to the global scope');
  }
});

console.log('\ntax mirrors · the same answer as the server');

const SLABS = [
  { definition_id: 's5', name: 'GST 5%', rules: { rate: 5 } },
  { definition_id: 's28', name: 'GST 28%', rules: { rate: 28, cess: 12 } },
];
const CATS = [{ definition_id: 'cGrain', name: 'Grains', rules: { default_slab: 's5' } }];
const FACE = { tax: { default_slab: 's28' } };

t('product → category → catalogue, and the source is named', () => {
  const at = (d) => S.resolve({ item_data: d, face: FACE, slabs: SLABS, categories: CATS });
  assert.strictEqual(at({ tax_slab: 's5' }).source, 'product');
  assert.strictEqual(at({ categories: ['cGrain'] }).source, 'category');
  assert.strictEqual(at({ categories: ['cGrain'] }).via_category_name, 'Grains');
  assert.strictEqual(at({}).source, 'catalogue');
  assert.strictEqual(at({}).rate, 28);
});

t('⚠️ nothing declared is "none", never 0% — the pane must be able to say so', () => {
  const r = S.resolve({ item_data: {}, face: {}, slabs: SLABS, categories: [] });
  assert.strictEqual(r.source, 'none');
  assert.strictEqual(r.rate, null);
  assert.match(S.describe(r), /Not set/);
});

t('⭐⭐ THE PANE\'S OWN SUM: one unit, intra halves the rate and inter carries all of it', () => {
  /* This is exactly what prodTaxPreviewHTML computes — one line, qty 1, the resolved rate, determined twice. If
     this drifts from the server the product page is lying about the invoice it is previewing. */
  const r = S.resolve({ item_data: { tax_slab: 's5' }, face: {}, slabs: SLABS, categories: [] });
  const line = S.applyToLine({ name: 'Rice', qty: 1, unit_price: 100 }, r);
  const intra = T.determine({ seller: { State: '29', Country: 'IN' }, buyer: { Pos: '29', Country: 'IN' }, lines: [line] }).ItemList[0];
  const inter = T.determine({ seller: { State: '29', Country: 'IN' }, buyer: { Pos: '27', Country: 'IN' }, lines: [line] }).ItemList[0];
  assert.strictEqual(intra.CgstAmt, 2.5);
  assert.strictEqual(intra.SgstAmt, 2.5);
  assert.strictEqual(intra.IgstAmt, 0);
  assert.strictEqual(inter.IgstAmt, 5);
  assert.strictEqual(inter.CgstAmt + inter.SgstAmt, 0);
  /* The two halves must sum to the whole — that is what a counterparty reconciles against. */
  assert.strictEqual(intra.CgstAmt + intra.SgstAmt, inter.IgstAmt);
  assert.strictEqual(intra.TotItemVal, inter.TotItemVal);
});

t('cess from the slab reaches the previewed line', () => {
  const r = S.resolve({ item_data: { tax_slab: 's28' }, face: {}, slabs: SLABS, categories: [] });
  const line = S.applyToLine({ qty: 1, unit_price: 100 }, r);
  const it = T.determine({ seller: { State: '29', Country: 'IN' }, buyer: { Pos: '27', Country: 'IN' }, lines: [line] }).ItemList[0];
  assert.strictEqual(it.CesRt, 12);
  assert.strictEqual(it.CesAmt, 12);
  assert.strictEqual(it.TotItemVal, 140);
});

t('setOn writes the citation AND the travelling copy — what ctReadForm saves', () => {
  const d = S.setOn({ name: 'Rice' }, SLABS[0]);
  assert.strictEqual(d.tax_slab, 's5');
  assert.strictEqual(d.tax_slab_name, 'GST 5%');
  assert.strictEqual(d.gst_rate, 5);
  /* "— inherit —" removes all three. A blank select means INHERIT, and it must never write a zero. */
  const cleared = S.setOn(d, null);
  assert.strictEqual(cleared.tax_slab, undefined);
  assert.strictEqual(cleared.gst_rate, undefined);
});

console.log('\ntax mirrors · not stale against the API');

/**
 * ⚠️⚠️ THE FAILURE THIS EXISTS FOR. Everything above would keep passing indefinitely against a mirror generated
 * six months ago. Only a comparison with the source can catch "the engine moved and the copy did not".
 */
t('the generated mirror matches chitbridge-api/lib, byte for byte', () => {
  /* `CB_API_LIB` so this can be pointed at a worktree — the two repos are branched together and the sibling
     checkout is often on `main` while the change under test is not. */
  const apiLib = process.env.CB_API_LIB || path.join(__dirname, '..', '..', 'chitbridge-api', 'lib');
  skipIf(!fs.existsSync(apiLib), 'chitbridge-api is not checked out beside this repo');
  /* ⚠️ A LIB THAT IS NOT THERE IS A DIFFERENT BRANCH, NOT A STALE MIRROR. Failing here would fail every web-only
     run made while the API side of a paired change sits on a branch — and the message would be a lie. */
  skipIf(!fs.existsSync(path.join(apiLib, 'tax-slab.js')),
    'the sibling checkout has no lib/tax-slab.js — different branch; set CB_API_LIB to the worktree');
  /* ⚠️ LF-NORMALISED FIRST. Two checkouts of one repo can differ in nothing but CRLF on Windows, and my first
     run of this reported a byte-identical file as STALE — a guard that cries wolf is a guard people delete. */
  const lf = (s) => String(s).replace(/\r\n/g, '\n');
  /* ⭐ 2026-09-28: both sides now ADOPT one chitbridge-engines release, so "the same bytes" is the same release —
     the api's copy and this one must be byte-identical, header and all. (mirror-pure-libs.cjs is retired.) */
  for (const f of ['tax.js', 'tax-slab.js']) {
    const src = lf(fs.readFileSync(path.join(apiLib, f), 'utf8'));
    const mirror = lf(fs.readFileSync(path.join(__dirname, '..', 'public', 'engine', 'tax.js'), 'utf8'));
    /* engine/tax.js is a BUNDLE since v1.2.0 (tax-packs + tax) — the api's copy must appear in it whole, header and all */
    assert.ok(/^\/\* ADOPTED (BUNDLE )?from chitbridge-engines/.test(mirror), f + ' is not an adopted file — run: node ../chitbridge-engines/tools/adopt.cjs .');
    assert.ok(mirror.includes(src), f + ' does not carry the release chitbridge-api adopts — the two repos pin different versions');
  }
});

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed'
  + (skip ? ', ' + skip + ' skipped' : ''));
process.exit(fail ? 1 : 0);
