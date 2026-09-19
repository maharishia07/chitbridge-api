'use strict';
/**
 * categories.test.js — A PRODUCT CITES ITS CATEGORY; NOTHING WRITES THE LEGACY KEY ([TILL-114]).
 *
 * Athi: *"fix the legacy category key."* And then: *"we need to have those relations in local systems as well,
 * so mapping shouldn't be an issue."*
 *
 * ── ⚠️⚠️⚠️ THE DEFECT, WHICH WAS SILENT ──────────────────────────────────────────────────────────────────────
 * `lib/catalogue-columns.js` RESERVED says it outright:
 *     `categories`  "the Categories screen owns these; a product cites them by id"
 *     `category`    "the legacy single-category key — read, never written again"
 *
 * The till snapshot read `d.category`. So a product categorised the CORRECT way reached the counter with no
 * category at all and fell out of the chips and the By-category view — with nothing failing anywhere. And
 * [TILL-107]'s blueprint was WRITING that legacy key onto every starter catalogue.
 *
 * Run: node tests/categories.test.js   · no DB, no network (the pure half; the SQL is exercised by the route).
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
const C = require(path.join(API, 'lib', 'categories'));
const B = require(path.join(API, 'lib', 'catalogue-blueprint'));

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

const NAMES = new Map([['9c33', 'Vegetables'], ['7b21', 'Greens']]);

console.log('— a product cites its category —');

/**
 * ⚠️⚠️ THE ORDER IS THE HISTORY, and every step is real data somewhere. Getting it wrong in either direction
 * is a live defect: master-last loses today's model, legacy-never loses every product written before the
 * Categories screen existed.
 */
it('⚠️⚠️ the master first, then a counterparty\'s copy, then the legacy key', () => {
  assert.strictEqual(C.nameOf({ categories: ['9c33'] }, NAMES), 'Vegetables', 'a cited category did not resolve');
  assert.strictEqual(C.nameOf({ categories: ['7b21'], category: 'Old' }, NAMES), 'Greens',
    'the legacy key beat the master — a renamed category would never take effect');
  assert.strictEqual(C.nameOf({ category_names: ['Spices'] }, NAMES), 'Spices',
    'a counterparty copy was ignored — their ids are not ours to resolve');
  assert.strictEqual(C.nameOf({ category: 'Grains' }, NAMES), 'Grains',
    'the legacy key stopped being READ — every product written before the Categories screen lost its group');
  assert.strictEqual(C.nameOf({}, NAMES), null);
  /* ⚠️ an id we cannot resolve is not a name. Returning the raw uuid would put "9c33-…" on a chip. */
  assert.strictEqual(C.nameOf({ categories: ['nope'] }, NAMES), null, 'an unresolvable id leaked to the screen');
});

it('⭐ and it never throws on the shapes a real record takes', () => {
  for (const bad of [null, undefined, {}, { categories: null }, { categories: 'x' }, { category_names: 'x' }])
    assert.doesNotThrow(() => C.nameOf(bad, NAMES));
  /* ⚠️ and with no master at all — an entity whose definitions are unprovisioned must still bill */
  assert.strictEqual(C.nameOf({ category: 'Grains' }, new Map()), 'Grains');
  assert.strictEqual(C.nameOf({ categories: ['9c33'] }, null), null);
});

/**
 * ⚠️⚠️⚠️ NOTHING WRITES THE LEGACY KEY. This is the assertion that stops [TILL-107] happening again: the
 * blueprint hands over a NAME for the caller to resolve, and the word `category` never appears as a field on
 * anything it produces.
 */
it('⚠️⚠️⚠️ the blueprint emits a NAME to resolve, never the stored key', () => {
  for (const out of [B.mint('veg', []), B.mint('hotel', []),
                     B.rowsToProducts([{ name: 'X', price: 1, category: 'Greens' }], 'veg', []).products]) {
    for (const p of out) {
      assert.ok(!Object.prototype.hasOwnProperty.call(p, 'category'),
        'a product carries `category` — the key catalogue-columns says is never written again');
      assert.ok(Object.prototype.hasOwnProperty.call(p, 'categoryName'),
        'the category name is not offered for the caller to resolve');
    }
  }
  assert.strictEqual(B.mint('veg', [])[0].categoryName, 'Vegetables');
});

/** ⚠️ and the route must turn that name into a citation rather than passing it through */
it('⚠️⚠️ the route resolves names to ids and strips the name', () => {
  const src = fs.readFileSync(path.join(API, 'routes', 'till.js'), 'utf8');
  const at = src.indexOf("router.post('/catalogue'");
  assert.ok(at > 0, 'the mint route is gone');
  const route = src.slice(at, src.indexOf("router.get('/catalogue/blueprints'", at));
  assert.ok(/ensureCategories/.test(route), 'the mint does not create the shop\'s categories');
  assert.ok(/delete out\.categoryName/.test(route), 'the name is written through to the record as a field');
  assert.ok(/out\.categories = \[id\]/.test(route), 'the product does not cite its category by id');
});

/**
 * ⚠️⚠️ AND THE SNAPSHOT SENDS BOTH SIDES. Athi: *"we need to have those relations in local systems as well, so
 * mapping shouldn't be an issue."* A name alone lets the counter DISPLAY a group and nothing else — it could
 * not cite one back without sending a string and hoping the server matched it, which is how a master acquires
 * a second "vegetables".
 */
it('⚠️⚠️ the counter receives the relation, not just the answer', () => {
  const src = fs.readFileSync(path.join(API, 'routes', 'till.js'), 'utf8');
  assert.ok(/category: categories\.nameOf\(d, catNames\)/.test(src), 'the snapshot no longer resolves the name');
  assert.ok(/category_id:/.test(src), 'a product reaches the counter without its category id');
  assert.ok(/categories: catList\.map/.test(src), 'the category master does not travel with the snapshot');
  /* ⚠️ THE LEGACY READ MUST NOT COME BACK as the only source */
  assert.ok(!/category: d\.category \|\| null/.test(src),
    'the snapshot reads the legacy key directly again — a correctly categorised product will vanish from the chips');
});

/**
 * ⚠️⚠️⚠️ AND IT IS NOT READ THROUGH THE TAX SHELF. taxShelf.readShelf() also returns categories and answers
 * NULL for a seller with no GSTIN — so an unregistered shop, which is most small shops, would have had no
 * categories for the same reason it has no tax. A category is not a tax fact.
 */
it('⚠️⚠️⚠️ the category master is read without the tax gate', () => {
  const src = fs.readFileSync(path.join(API, 'lib', 'categories.js'), 'utf8');
  /* ⚠️ STRIP BOTH KINDS OF COMMENT. This file EXPLAINS the tax gate it avoids, in a // @stage-note as well
     as a block — and a scan that strips only one reads the explanation as the offence. The same trap
     scripts/dbfree.cjs records. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
  assert.ok(!/tax-shelf|readShelf/.test(code),
    'lib/categories reads through the tax shelf — an unregistered shop loses its categories');
  assert.ok(/kind = 'category'/.test(src), 'it no longer selects categories by kind');
  const till = fs.readFileSync(path.join(API, 'routes', 'till.js'), 'utf8');
  assert.ok(/categories\.listCategories\(entity_id/.test(till),
    'the snapshot gets its categories from somewhere other than the master');
});

console.log(pass + ' checks');
