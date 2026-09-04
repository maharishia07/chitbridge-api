/**
 * tax-slab.test.js — the product answers, else its category, else the catalogue, and we know which.
 *
 * Athi, 2026-09-03: *"in india tax is not simple, each product has different tax criteria, so it has to be
 * product specific, but there are slabs, so define slab and attach the slab to the product."*
 *
 * ⭐ THESE ASSERT WHAT THE RULE ANSWERS, NOT WHICH FUNCTION IT CALLS — the lesson from isMatchable, where three
 * source-shape assertions passed while the feature was dead. Every case here reads the resolved rate and the
 * SOURCE, because a rate whose provenance is wrong is a rate nobody can argue with.
 *
 * ⚠️ THE LAST TWO TESTS RUN A RESOLVED SLAB ALL THE WAY THROUGH lib/tax.js. Resolution and determination are
 * separate modules on purpose, and a seam nothing crosses in a test is a seam that breaks in production.
 *
 * Run: node --test tests/tax-slab.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const ts = require('../lib/tax-slab');
const tax = require('../lib/tax');

/* The shelf, in the shape the definitions route returns (a `definition` row with its version's rules joined on). */
const SLAB_5  = { definition_id: 's5',  name: 'GST 5%',  rules: { rate: 5, hsn: ['1006'] } };
const SLAB_18 = { definition_id: 's18', name: 'GST 18%', rules: { rate: 18 } };
const SLAB_28 = { definition_id: 's28', name: 'GST 28%', rules: { rate: 28, cess: 12 } };
const SLABS = [SLAB_5, SLAB_18, SLAB_28];

const CATS = [
  { definition_id: 'cGrain', name: 'Grains', rules: { default_slab: 's5' } },
  { definition_id: 'cMisc',  name: 'Misc',   rules: {} },                      // declares none — must be SKIPPED
];
const FACE = { tax: { default_slab: 's18' } };
const R = (item_data, opts) => ts.resolve(Object.assign({ item_data, face: FACE, slabs: SLABS, categories: CATS }, opts));

/* ── the order ───────────────────────────────────────────────────────────────────────────────────────────────── */

test('the product’s own slab wins outright', () => {
  const r = R({ name: 'Rice', tax_slab: 's28', categories: ['cGrain'] });
  assert.strictEqual(r.source, 'product');
  assert.strictEqual(r.rate, 28);
  assert.strictEqual(r.slab_id, 's28');
  assert.strictEqual(r.name, 'GST 28%');
  /* ⚠️ Cess rides WITH the slab, not one level up — 28% goods differ wildly and a catalogue-level cess would be
     wrong for most of them. */
  assert.strictEqual(r.cess, 12);
});

test('no slab on the product → the first category that declares one', () => {
  const r = R({ name: 'Rice', categories: ['cGrain'] });
  assert.strictEqual(r.source, 'category');
  assert.strictEqual(r.rate, 5);
  /* ⭐ WHICH category answered is part of the answer. "GST 5% — from category Grains" is checkable; a bare 5% is
     a number someone has to trust. */
  assert.strictEqual(r.via_category_name, 'Grains');
});

test('a category that declares no slab is SKIPPED, not treated as an answer', () => {
  /* ⚠️ Misc first, Grains second. A category with no default must not stop the walk — otherwise adding a product
     to a second, unrelated shelf would silently un-tax it. */
  const r = R({ name: 'Rice', categories: ['cMisc', 'cGrain'] });
  assert.strictEqual(r.source, 'category');
  assert.strictEqual(r.rate, 5);
});

test('⚠️ two categories with different slabs: the FIRST the product lists wins, and says which', () => {
  const cats = CATS.concat([{ definition_id: 'cLux', name: 'Luxury', rules: { default_slab: 's28' } }]);
  const a = ts.resolve({ item_data: { categories: ['cGrain', 'cLux'] }, face: FACE, slabs: SLABS, categories: cats });
  const b = ts.resolve({ item_data: { categories: ['cLux', 'cGrain'] }, face: FACE, slabs: SLABS, categories: cats });
  assert.strictEqual(a.rate, 5);
  assert.strictEqual(b.rate, 28);
  /* The ambiguity is real and no rule can settle it honestly, so it is DECLARED (order decides) and the source
     names the category — never hidden behind a max or a min. */
  assert.strictEqual(a.via_category_name, 'Grains');
  assert.strictEqual(b.via_category_name, 'Luxury');
});

test('no slab anywhere on the product or its categories → the catalogue default', () => {
  const r = R({ name: 'Pencil' });
  assert.strictEqual(r.source, 'catalogue');
  assert.strictEqual(r.rate, 18);
});

test('a flat face.default_tax_slab resolves too — a face written either way answers', () => {
  const r = ts.resolve({ item_data: {}, face: { default_tax_slab: 's5' }, slabs: SLABS, categories: CATS });
  assert.strictEqual(r.source, 'catalogue');
  assert.strictEqual(r.rate, 5);
});

/* ── none, and the difference between none and nil ───────────────────────────────────────────────────────────── */

test('⚠️⚠️ nothing declared anywhere is “none”, and none is NOT 0%', () => {
  const r = ts.resolve({ item_data: { name: 'Pencil' }, face: {}, slabs: SLABS, categories: CATS });
  assert.strictEqual(r.source, 'none');
  /* A caller must be able to refuse or ask. Returning 0 would make "nobody said" indistinguishable from
     "nil-rated", and the invoice would look correct while charging nothing. Same rule as tax.js's 'unknown'. */
  assert.strictEqual(r.rate, null);
  assert.strictEqual(r.slab_id, null);
});

test('a slab with rate 0 is a REAL answer — nil-rated goods exist', () => {
  const zero = [{ definition_id: 'z', name: 'Nil-rated', rules: { rate: 0 } }];
  const r = ts.resolve({ item_data: { tax_slab: 'z' }, face: {}, slabs: zero, categories: [] });
  assert.strictEqual(r.source, 'product');
  assert.strictEqual(r.rate, 0);
  assert.notStrictEqual(r.rate, null);
});

test('a slab authored with no rate yet resolves to rate null, not 0', () => {
  const draft = [{ definition_id: 'd', name: 'GST ?', rules: {} }];
  const r = ts.resolve({ item_data: { tax_slab: 'd' }, face: {}, slabs: draft, categories: [] });
  assert.strictEqual(r.rate, null);
  assert.strictEqual(r.source, 'product');
});

/* ── the counterparty's copy: an id nobody here can resolve ──────────────────────────────────────────────────── */

test('⭐⭐ an unresolvable slab id falls back to the TRAVELLING COPY, never to the category', () => {
  /* A counterparty holding my product in their copy cannot resolve my definition_id and never will. Inheriting
     THEIR category's slab would silently re-rate my goods under their tax rules — the wrong answer, and it looks
     completely reasonable. */
  const r = R({ name: 'Rice', tax_slab: 'theirs', tax_slab_name: 'GST 12%', gst_rate: 12, categories: ['cGrain'] });
  assert.strictEqual(r.rate, 12);
  assert.strictEqual(r.source, 'product');
  assert.strictEqual(r.unresolved, true);
  assert.strictEqual(r.name, 'GST 12%');
});

test('an unresolvable id with NO copy is NAMED and falls through (2026-09-05: a dead citation must not hide a good default)', () => {
  const r = R({ name: 'Rice', tax_slab: 'theirs', categories: ['cGrain'] });
  assert.strictEqual(r.unresolved, true);
  assert.strictEqual(r.cited, 'theirs');
  assert.notStrictEqual(r.source, 'product');
  assert.ok(/theirs/.test(require('../lib/tax-slab').describe(r)) && /not active/.test(require('../lib/tax-slab').describe(r)));
});

test('a bare gst_rate with no slab is the PRODUCT’s own answer — an imported sheet has answered', () => {
  /* `gst_rate` is a declarable column with a full synonym set in csv-preflight, so a merchant importing HSN codes
     and rates has stated the answer. Returning "none" beside a row that plainly says 18 would be the software
     disagreeing with the data in front of it. */
  const r = R({ name: 'Bolt', gst_rate: 18, categories: ['cGrain'] });
  assert.strictEqual(r.rate, 18);
  assert.strictEqual(r.source, 'product');
  assert.strictEqual(r.slab_id, null);
});

test('the legacy single `category` key still resolves — both shapes live in the data', () => {
  const r = R({ name: 'Rice', category: 'cGrain' });
  assert.strictEqual(r.source, 'category');
  assert.strictEqual(r.rate, 5);
});

/* ── effective_from ──────────────────────────────────────────────────────────────────────────────────────────── */

test('⚠️ a future slab is REPORTED as pending, never silently skipped', () => {
  const later = [{ definition_id: 'f', name: 'GST 5% (new)', rules: { rate: 5, effective_from: '2099-01-01' } }];
  const r = ts.resolve({ item_data: { tax_slab: 'f' }, face: {}, slabs: later, categories: [], asOf: '2026-09-03' });
  /* Falling through to the catalogue default because a rate starts next month would charge the OLD rate with
     nothing on screen to say why. The answer stands; the caller is told it is not in force. */
  assert.strictEqual(r.rate, 5);
  assert.strictEqual(r.pending, true);
  assert.strictEqual(r.effective_from, '2099-01-01');
});

test('a slab already in force is not pending', () => {
  const past = [{ definition_id: 'p', name: 'GST 5%', rules: { rate: 5, effective_from: '2017-07-01' } }];
  const r = ts.resolve({ item_data: { tax_slab: 'p' }, face: {}, slabs: past, categories: [], asOf: '2026-09-03' });
  assert.strictEqual(r.pending, false);
});

/* ── setOn: the citation and the copy, written together or not at all ────────────────────────────────────────── */

test('⭐⭐ setOn writes the id AND the travelling copy — the two can never be written apart', () => {
  const d = ts.setOn({ name: 'Rice' }, SLAB_5);
  assert.strictEqual(d.tax_slab, 's5');
  assert.strictEqual(d.tax_slab_name, 'GST 5%');
  assert.strictEqual(d.gst_rate, 5);
});

test('⚠️ clearing means INHERIT — all three keys go, and none becomes a zero', () => {
  const d = ts.setOn({ name: 'Rice', tax_slab: 's5', tax_slab_name: 'GST 5%', gst_rate: 5 }, null);
  assert.strictEqual(d.tax_slab, undefined);
  assert.strictEqual(d.tax_slab_name, undefined);
  assert.strictEqual(d.gst_rate, undefined);
  /* And the cleared product now inherits rather than being nil-rated. */
  assert.strictEqual(R(Object.assign(d, { categories: ['cGrain'] })).rate, 5);
});

test('a rateless slab does not stamp gst_rate: 0 onto a product', () => {
  /* That copy is what a counterparty reads, and 0 would read as "nil-rated" rather than "not stated". */
  const d = ts.setOn({ name: 'X' }, { definition_id: 'd', name: 'GST ?', rules: {} });
  assert.strictEqual(d.tax_slab, 'd');
  assert.strictEqual(d.gst_rate, undefined);
});

/* ── applyToLine ─────────────────────────────────────────────────────────────────────────────────────────────── */

test('⚠️ applyToLine NEVER overwrites a rate the line already carries', () => {
  /* A stamped chit line holds the rate that was frozen onto it; re-resolving at read time is exactly how a
     stamped document starts changing after the fact. Resolution fills a GAP. */
  const l = ts.applyToLine({ qty: 1, unit_price: 100, gst_rate: 5 }, { rate: 18, source: 'catalogue' });
  assert.strictEqual(l.gst_rate, 5);
  assert.strictEqual(l.tax_source, undefined);
});

test('applyToLine writes nothing when the answer is “none”', () => {
  const l = ts.applyToLine({ qty: 1, unit_price: 100 }, { rate: null, source: 'none' });
  assert.strictEqual(l.gst_rate, undefined);
  /* Writing 0 would make "nobody declared one" and "nil-rated" indistinguishable on the line. */
  assert.strictEqual(l.cess_rate, undefined);
});

test('applyToLine carries the SOURCE onto the line, so a dispute can tell inherited from explicit', () => {
  const l = ts.applyToLine({ qty: 2, unit_price: 100 }, R({ categories: ['cGrain'] }));
  assert.strictEqual(l.gst_rate, 5);
  assert.strictEqual(l.tax_source, 'category');
  assert.strictEqual(l.tax_slab, 's5');
});

/* ── the seam: a resolved slab, all the way through lib/tax.js ───────────────────────────────────────────────── */

test('⭐⭐ a resolved slab → tax.js → the INTRA-state split is the rate halved', () => {
  const line = ts.applyToLine({ name: 'Rice', qty: 10, unit_price: 100 }, R({ categories: ['cGrain'] }));
  const out = tax.determine({ seller: { State: '29' }, buyer: { Pos: '29' }, lines: [line] });
  const it = out.ItemList[0];
  assert.strictEqual(out._cb.supply, 'intra');
  assert.strictEqual(it.AssAmt, 1000);
  assert.strictEqual(it.GstRt, 5);
  assert.strictEqual(it.CgstAmt, 25);
  assert.strictEqual(it.SgstAmt, 25);
  assert.strictEqual(it.IgstAmt, 0);
  assert.strictEqual(it.TotItemVal, 1050);
});

test('⭐⭐ the same line to another state is IGST at the FULL rate — the slab did not change', () => {
  const line = ts.applyToLine({ name: 'Rice', qty: 10, unit_price: 100 }, R({ categories: ['cGrain'] }));
  const out = tax.determine({ seller: { State: '29' }, buyer: { Pos: '27' }, lines: [line] });
  const it = out.ItemList[0];
  assert.strictEqual(out._cb.supply, 'inter');
  assert.strictEqual(it.IgstAmt, 50);
  assert.strictEqual(it.CgstAmt, 0);
  assert.strictEqual(it.SgstAmt, 0);
  assert.strictEqual(it.TotItemVal, 1050);
});

test('cess from the slab reaches the invoice line', () => {
  /* ⚠️ tax.js already emits CesRt/CesAmt per line and CesVal in the totals — nothing had to be added there. The
     only missing half was getting the rate ONTO the line, which is what applyToLine does. */
  const line = ts.applyToLine({ name: 'Cola', qty: 1, unit_price: 100 }, R({ tax_slab: 's28' }));
  const out = tax.determine({ seller: { State: '29' }, buyer: { Pos: '27' }, lines: [line] });
  const it = out.ItemList[0];
  assert.strictEqual(it.IgstAmt, 28);
  assert.strictEqual(it.CesRt, 12);
  assert.strictEqual(it.CesAmt, 12);
  assert.strictEqual(it.TotItemVal, 140);
  assert.strictEqual(out.ValDtls.CesVal, 12);
});

test('an odd rate halves exactly across CGST and SGST, and the two still sum to the total', () => {
  /* 12% of 833.33 is 99.9996 → 100.00; the halves must not both round to 50.00 and lose a paise against the sum
     a counterparty reconciles. This is tax.js's rule; the test guards that a slab-fed line still meets it. */
  const slab = [{ definition_id: 'x', name: 'GST 12%', rules: { rate: 12 } }];
  const line = ts.applyToLine({ qty: 3, unit_price: 33.33 },
    ts.resolve({ item_data: { tax_slab: 'x' }, face: {}, slabs: slab, categories: [] }));
  const it = tax.determine({ seller: { State: '29' }, buyer: { Pos: '29' }, lines: [line] }).ItemList[0];
  assert.strictEqual(Math.round((it.CgstAmt + it.SgstAmt) * 100) / 100, Math.round(it.AssAmt * 12) / 100);
});

/* ── the shape the screens depend on ─────────────────────────────────────────────────────────────────────────── */

test('describe() names the source, because a rate without provenance cannot be argued with', () => {
  assert.match(ts.describe(R({ tax_slab: 's5' })), /GST 5%.*on this product/);
  assert.match(ts.describe(R({ categories: ['cGrain'] })), /from category Grains/);
  assert.match(ts.describe(R({})), /catalogue default/);
  assert.match(ts.describe(ts.resolve({ item_data: {}, face: {}, slabs: [], categories: [] })), /Not set/);
});

test('the GST rate menu is the scheme’s, and it maps no product to anything', () => {
  for (const r of [0, 5, 12, 18, 28]) assert.ok(ts.GST_SLAB_RATES.includes(r), String(r));
  /* ⚠️ It is a MENU. Nothing in this module reads it to decide a rate for a product — that question is per-HSN
     and the merchant's. A rate table in our repository would be wrong silently, for everyone, until filing. */
  assert.strictEqual(ts.resolve({ item_data: { hsn: '1006' }, face: {}, slabs: SLABS, categories: [] }).source, 'none');
});

test('⚠️⚠️ tax_slab is a SYSTEM field and can never become an editable column', () => {
  const catcols = require('../lib/catalogue-columns');
  const rules = require('../lib/column-rules');
  /* If it were declarable somebody would eventually type "18%" into the cell — a string where a definition_id
     belongs — and the product would resolve to no slab while LOOKING answered. */
  assert.strictEqual(catcols.fold('tax_slab', [], {}).how, 'reserved');
  assert.strictEqual(catcols.fold('tax_slab_name', [], {}).how, 'reserved');
  assert.ok(rules.SYSTEM_FIELDS.some((f) => f.field_key === 'tax_slab'));
  /* ⭐ And `gst_rate` is deliberately NOT reserved: it is a real, importable column (csv-preflight carries its
     synonyms) and the travelling copy a counterparty reads. Reserving it would refuse both. */
  assert.notStrictEqual(catcols.fold('gst_rate', [], {}).how, 'reserved');
});

test('a reserved slab still REACHES item_data — it is not a column, it is still a value', () => {
  const catcols = require('../lib/catalogue-columns');
  const p = catcols.planWrite({ item_data: { name: 'Rice', tax_slab: 's5', tax_slab_name: 'GST 5%', gst_rate: 5 },
                                declared: ['name'], labels: {} });
  assert.strictEqual(p.item_data.tax_slab, 's5');
  assert.strictEqual(p.item_data.tax_slab_name, 'GST 5%');
  assert.ok(!p.newFields.some((f) => f.field_key === 'tax_slab'));
  assert.ok(!p.newFields.some((f) => f.field_key === 'tax_slab_name'));
  /* ⭐ …while `gst_rate` DOES earn a column, because a merchant genuinely maintains it per product. */
  assert.ok(p.newFields.some((f) => f.field_key === 'gst_rate'));
});

test('slabOf tolerates both shapes the shelf comes in', () => {
  assert.strictEqual(ts.slabOf({ definition_id: 'a', name: 'n', rules: { rate: 5 } }).rate, 5);
  assert.strictEqual(ts.slabOf({ id: 'a', name: 'n', rules: { rate: 5 } }).id, 'a');
  assert.strictEqual(ts.slabOf({ name: 'no id' }), null);
  /* An hsn written as one string, not a list, still reads as a list — a merchant types one code more often than
     several, and a shape that only half-works is worse than one that refuses. */
  assert.deepStrictEqual(ts.slabOf({ id: 'a', rules: { hsn: '0902' } }).hsn, ['0902']);
});

/* 2026-09-05 — a product in two categories that name DIFFERENT slabs: the first answers, the conflict is carried and said. */
test('categories that disagree → conflict carried, first answers, describe() says so', () => {
  const slabs = [{ definition_id: 'g5', name: 'GST 5%', rules: { rate: 5 } }, { definition_id: 'g0', name: 'GST 0%', rules: { rate: 0 } }];
  const cats = [{ definition_id: 'a', name: 'Grains', rules: { default_slab: 'g5' } }, { definition_id: 'b', name: 'Rice', rules: { default_slab: 'g0' } }];
  const r = require('../lib/tax-slab').resolve({ item_data: { categories: ['a', 'b'] }, slabs, categories: cats });
  assert.strictEqual(r.source, 'category'); assert.strictEqual(r.rate, 5); assert.strictEqual(r.conflict.length, 2);
  assert.ok(/disagree/.test(require('../lib/tax-slab').describe(r)));
  const same = require('../lib/tax-slab').resolve({ item_data: { categories: ['a'] }, slabs, categories: cats });
  assert.strictEqual(same.conflict, undefined);
});
