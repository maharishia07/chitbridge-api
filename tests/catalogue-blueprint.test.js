'use strict';
/**
 * catalogue-blueprint.test.js — TWO TRADES, ONE AXIOM, AND A SEQUENCE THAT CANNOT COLLIDE ([TILL-107]).
 *
 * Athi, 2026-09-19: *"can we have a proper two catalogue, one for Veg Store and another one for Hotel… we have
 * many means and complexities in the world, but how do we bring the axiom out of the lot? so we can start the
 * store in no time."*
 *
 * Run: node tests/catalogue-blueprint.test.js   · no DB, no network.
 */
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');
const B = require(path.join(API, 'lib', 'catalogue-blueprint'));
const U = require(path.join(API, 'lib', 'units'));
const P = require(path.join(API, 'lib', 'csv-preflight'));

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

console.log('— two trades, one axiom —');

/**
 * ⭐⭐⭐ THE AXIOM IS TWO FIELDS, and the counter is what decided that: driven with a product carrying only a
 * name and a price, till.html draws a key, prices a line and totals the bill. Adding item_id, unit, category
 * and code changed nothing. If this ever needs a third field, the counter has gained a dependency nobody
 * intended and a shop has to answer one more question before it can sell anything.
 */
it('⭐⭐⭐ the axiom is name + price, and nothing else', () => {
  assert.deepStrictEqual(B.AXIOM, ['name', 'price'],
    'the axiom has changed — a shop is being asked for more before it may sell');
  /* and every enrichment says what it BUYS, or it has no business on a setup form */
  for (const e of B.ENRICH) {
    assert.ok(e.key && e.buys && e.buys.length > 10, e.key + ' does not say what it buys');
    assert.ok(B.AXIOM.indexOf(e.key) < 0, e.key + ' is in both the axiom and the enrichment list');
  }
});

/**
 * ⭐⭐ A BLUEPRINT WITHOUT AN OUTCOME IS NOT A BLUEPRINT — [[project-blueprint-lifecycle-feature]], which is
 * where that test was settled: *"a Blueprint is defined by having a defined OUTCOME."* Without this assertion
 * these are starter lists wearing the wrong word.
 */
it('⭐⭐ every blueprint names the outcome it mints', () => {
  const keys = Object.keys(B.BLUEPRINTS);
  assert.ok(keys.indexOf('veg') >= 0 && keys.indexOf('hotel') >= 0, 'the two trades Athi asked for are not both here');
  for (const k of keys.concat(['general'])) {
    const bp = B.blueprint(k);
    assert.ok(bp.outcome && bp.outcome.length > 15, k + ' has no outcome — it is not a blueprint');
    assert.ok(bp.prefix && /^[A-Z]+$/.test(bp.prefix), k + ' has no code prefix');
    assert.ok(bp.defaultUnit, k + ' has no default unit');
  }
  /* ⚠️ an unknown trade must never throw at setup time */
  assert.strictEqual(B.blueprint('fishmonger').key, 'general');
  assert.strictEqual(B.blueprint(null).key, 'general');
});

/**
 * ⭐⭐⭐ THE ONE THING THAT MAKES THEM DIFFERENT TRADES, AND IT IS DATA. [TILL-104] proved the counter's only
 * vertical difference is counted vs measured, decided by the UNIT. So a veg blueprint must sell in measured
 * units and a hotel in counted ones — and if that ever stops being true, a greengrocer's bill starts reading
 * "2.25 items" again. This asserts it through units.js rather than by restating the list.
 */
it('⭐⭐⭐ veg sells in measured units, hotel in counted ones', () => {
  const veg = B.blueprint('veg'), hotel = B.blueprint('hotel');
  assert.ok(U.isMeasured(veg.defaultUnit), 'a greengrocer whose default unit is counted cannot weigh anything');
  assert.ok(!U.isMeasured(hotel.defaultUnit), 'a hotel whose default unit is measured will offer a third of a plate');
  /* the starter lists have to agree with that, or the blueprint says one thing and ships another */
  assert.ok(veg.starter.some((p) => U.isMeasured(p.unit)), 'no weighed product in the greengrocer starter');
  for (const p of hotel.starter)
    assert.ok(!U.isMeasured(p.unit), 'hotel starter sells ' + p.name + ' by ' + p.unit + ', a measured unit');
  /* ⚠️ AND EVERY UNIT IS ONE units.js KNOWS — an unknown unit silently counts, which is how "0.25 items" returns */
  for (const bp of [veg, hotel])
    for (const p of bp.starter)
      assert.ok(U.unitOf(p.unit), bp.key + ' sells ' + p.name + ' in "' + p.unit + '", which units.js does not know');
});

it('⭐ and a starter list is a real shop\'s goods, priced and complete', () => {
  for (const k of ['veg', 'hotel']) {
    const bp = B.blueprint(k);
    assert.ok(bp.starter.length >= 8, k + ' has only ' + bp.starter.length + ' products — not enough to open with');
    for (const p of bp.starter) {
      assert.ok(p.name && p.name.trim(), k + ' has a nameless product');
      assert.ok(Number(p.price) > 0, k + ': ' + p.name + ' has no price');
      assert.ok(bp.categories.indexOf(p.category) >= 0, k + ': ' + p.name + ' is in "' + p.category + '", not a declared category');
    }
  }
});

/**
 * ⚠️⚠️⚠️ THE SEQUENCE IS THE PART THAT CAN GO WRONG SILENTLY AND EXPENSIVELY. Two products answering to one
 * code is the catalogue's version of two counters both numbering as C1 — and that one reached a shop's books.
 */
it('⚠️⚠️ the sequence reads what exists and never repeats', () => {
  assert.strictEqual(B.nextCode('V', []), 'V0001');
  assert.strictEqual(B.nextCode('V', ['V0001', 'V0007']), 'V0008', 'it counted instead of reading the highest');
  /* ⚠️ a gap is NOT reused — V0004 belonged to something once and a reprint may still name it */
  assert.strictEqual(B.nextCode('V', ['V0001', 'V0002', 'V0009']), 'V0010');
  /* ⚠️ a shop's OWN codes are left alone and never renumbered */
  assert.strictEqual(B.nextCode('V', ['TOM-1', 'ONI-2']), 'V0001');
  /* ⚠️ case does not create a second series */
  assert.strictEqual(B.nextCode('V', ['v0003']), 'V0004');
  /* ⚠️ past the width it GROWS rather than wraps — a wrap is a collision */
  assert.strictEqual(B.nextCode('V', ['V9999']), 'V10000');
});

it('⚠️⚠️ a batch is numbered in one pass, without repeating itself', () => {
  const got = B.codesFor(4, 'H', ['H0002']);
  assert.deepStrictEqual(got, ['H0003', 'H0004', 'H0005', 'H0006'],
    'the batch repeated a code — nextCode was called in a loop against an unchanged list');
  assert.strictEqual(new Set(got).size, got.length, 'duplicate codes in one batch');
});

it('⭐ minting a blueprint numbers it against what the shop already has', () => {
  const v = B.mint('veg', ['V0001', 'V0002']);
  assert.strictEqual(v.length, B.blueprint('veg').starter.length);
  assert.strictEqual(v[0].code, 'V0003', 'the mint reused codes the shop already has');
  assert.strictEqual(new Set(v.map((p) => p.code)).size, v.length, 'the mint issued a duplicate code');
  for (const p of v) assert.ok(p.name && p.price > 0 && p.unit, 'a minted product is missing part of the axiom');
});

/**
 * ⚠️⚠️⚠️ THE GATE. An upload that quietly loses rows is the worst outcome available here: nobody finds out
 * until a customer asks for a product that is not on the till.
 */
it('⚠️⚠️⚠️ a row that cannot be sold is refused BY NUMBER, never dropped', () => {
  const out = B.rowsToProducts([
    { name: 'Tomato', price: '40', unit: 'Kg' },
    { name: '', price: '55' },                    /* no name */
    { name: 'Beans', price: '' },                 /* ⚠️ blank price — Number('') is 0, and 0 is finite */
    { name: 'Ghee', price: 'n/a' },
    { name: 'Free sample', price: '0' },          /* ⭐ an explicit zero IS a price */
  ], 'veg', []);
  assert.strictEqual(out.kept, 2, 'kept ' + out.kept + ' — expected Tomato and the free sample only');
  assert.strictEqual(out.lost, 3);
  assert.deepStrictEqual(out.refused.map((r) => r.row), [2, 3, 4], 'the refusals do not carry their row numbers');
  assert.ok(/no price/.test(out.refused[1].why), 'a blank price was read as zero rather than refused');
  /* ⚠️ AND THE EXPLICIT ZERO SURVIVED — a free sample is a deliberate price, not a missing one */
  assert.ok(out.products.some((p) => p.name === 'Free sample' && p.price === 0));
  /* every kept row is sellable by the axiom */
  for (const p of out.products) for (const k of B.AXIOM)
    assert.ok(p[k] !== undefined && p[k] !== null && p[k] !== '', 'a kept product has no ' + k);
});

it('⭐ a file\'s own codes are kept; only the rest are numbered', () => {
  const out = B.rowsToProducts([
    { name: 'Onion', price: '30', code: 'ONI-9' },
    { name: 'Tomato', price: '40' },
  ], 'veg', ['V0001']);
  assert.strictEqual(out.products[0].code, 'ONI-9', 'a shop\'s own code was overwritten');
  /* ⚠️ THE ORIGIN AND THE PIN, both — [TILL-107] added 'veg@1' so a shop can be found when veg@2 ships,
     and an assertion that checked only the origin would not notice the pin going missing again. */
  assert.ok(/^file:own-code/.test(out.products[0].from), 'the origin is no longer recorded');
  assert.ok(/veg@\d+$/.test(out.products[0].from), 'the blueprint pin is missing: ' + out.products[0].from);
  assert.strictEqual(out.products[1].code, 'V0002');
  assert.ok(/^file:numbered/.test(out.products[1].from) && /veg@\d+$/.test(out.products[1].from),
    'a numbered row lost its origin or its pin: ' + out.products[1].from);
});

it('⭐ units are folded to one spelling when units.js is handed in', () => {
  const out = B.rowsToProducts([{ name: 'A', price: 1, unit: 'Kg' }, { name: 'B', price: 1, unit: 'KGM' },
                                { name: 'C', price: 1 }], 'veg', [], { unitOf: U.unitOf });
  assert.strictEqual(out.products[0].unit, 'kg');
  assert.strictEqual(out.products[1].unit, 'kg', 'KGM and Kg became two different units');
  assert.strictEqual(out.products[2].unit, 'kg', 'a missing unit did not take the blueprint default');
});

/**
 * ⭐⭐⭐ AND THE WORLD'S SPELLINGS REACH IT. This is the "axiom out of the lot" in one assertion: a spreadsheet
 * written the way an Indian wholesaler or a Tally export actually writes one must land on the canonical fields
 * with no human mapping. ⚠️ "Group" is Tally's own word for a category and had NO synonym until [TILL-107].
 */
it('⭐⭐ a real-world sheet lands on the axiom with nobody mapping it', () => {
  const cols = ['name', 'price', 'unit', 'sku', 'hsn', 'category'];
  const want = { 'Particulars': 'name', 'Rate (INR)': 'price', 'UOM': 'unit', 'Item Code': 'sku',
                 'HSN/SAC': 'hsn', 'Group': 'category', 'Stock Group': 'category', 'Menu': 'category',
                 'Selling Price': 'price', 'Product Name': 'name' };
  for (const [h, canon] of Object.entries(want)) {
    const m = P.matchHeader(h, cols, {});
    assert.strictEqual(m.canonical, canon, '"' + h + '" landed on ' + m.canonical + ', not ' + canon);
  }
  /* ⚠️ AND THE GREEDY ONES STAY OUT — a synonym that is usually wrong is worse than a missing one */
  for (const h of ['Type', 'Class']) {
    assert.strictEqual(P.matchHeader(h, cols, {}).canonical, null, '"' + h + '" is being claimed by a field');
  }
});

console.log(pass + ' checks');
