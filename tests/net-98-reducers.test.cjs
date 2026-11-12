'use strict';
/**
 * tests/net-98-reducers.test.cjs — NET-98 (S1): the pure halves split out of the libs that buildPublicView reads through, and the ONE-REDUCER GUARD.
 * Each reducer is the single definition of "these rows → this answer"; the old per-shop read calls it, and the bulk read (S2) will call the same one, so the
 * two paths cannot drift. No database. The real-Postgres proof that nothing changed is tests/net-98-differential.realstack.cjs.
 *   gateOfRow · offersOfRows · categoriesOfRows (catalogue-view) · fromRow (policy) · foldSheet (stock-store) · flagsOfRows (stocked)
 *   containersOfRows (container) · sourceFromRow (catalogue-build) · shelfFromRows (tax-shelf)
 *   GUARD: each reducer is defined exactly once under lib/ and its own lib's reading path calls it.
 * CARD      06-catalogue-pim/README
 * Run: node tests/net-98-reducers.test.cjs
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const LIB = path.join(__dirname, '..', 'lib');
let n = 0;
const ok = (what, fn) => { fn(); n++; console.log('  ok   ' + what); };

const view = require('../lib/catalogue-view');
const cap = (max) => ({ capOf: () => ({ max }) });
ok('gateOfRow: closed overrides everything, even a public choice under an open cap', () => {
  assert.deepStrictEqual(view.gateOfRow({ catalogue_visibility: 'public', business_status: 'closed' }, cap('public')), { visibility: 'private' });
});
ok('gateOfRow: no cap injected closes network, never opens; public stays public', () => {
  assert.deepStrictEqual(view.gateOfRow({ catalogue_visibility: 'network' }, null), { visibility: 'private' });
  assert.deepStrictEqual(view.gateOfRow({ catalogue_visibility: 'public' }, null), { visibility: 'public' });
});
ok('gateOfRow: a cap of private closes public and network; private stays private', () => {
  assert.deepStrictEqual(view.gateOfRow({ catalogue_visibility: 'public' }, cap('private')), { visibility: 'private' });
  assert.deepStrictEqual(view.gateOfRow({ catalogue_visibility: 'network', bridge_id: 'B' }, cap('private')), { visibility: 'private' });
});
ok('gateOfRow: network under an open cap leaves ONLY the same-network question, carrying the bridge id', () => {
  assert.deepStrictEqual(view.gateOfRow({ catalogue_visibility: 'network', bridge_id: 'B1' }, cap('public')), { network: true, bridge_id: 'B1' });
});
ok('gateOfRow: an unset or unknown choice is null (the b114 caller keeps the pre-b114 behaviour)', () => {
  assert.deepStrictEqual(view.gateOfRow({ catalogue_visibility: null }, cap('public')), { visibility: null });
  assert.deepStrictEqual(view.gateOfRow({ catalogue_visibility: 'banana' }, cap('public')), { visibility: null });
});
ok('offersOfRows: the alias is the only name that leaves; a row with no kind is not an offer', () => {
  const rows = [{ definition_id: 'd1', name: 'Tier1 internal', sub_kind: 'percent_off', rules: { alias: 'Festival', percent: 5 } }, { definition_id: 'd2', name: 'x', sub_kind: null, rules: {} }];
  const got = view.offersOfRows(rows);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].label, 'Festival');
  assert.strictEqual(got[0].alias, undefined);
  assert.deepStrictEqual(view.offersOfRows(null), []);
});
ok('categoriesOfRows: id, name, parent (null when none)', () => {
  assert.deepStrictEqual(view.categoriesOfRows([{ definition_id: 'c1', name: 'A', rules: { parent: 'c0' } }, { definition_id: 'c2', name: 'B', rules: null }]), [{ id: 'c1', name: 'A', parent: 'c0' }, { id: 'c2', name: 'B', parent: null }]);
});

const policy = require('../lib/policy');
ok('policy.fromRow: no stored flags answers the defaults; stored flag wins; country and asked ride along', () => {
  const blank = policy.fromRow({}, false);
  assert.strictEqual(blank.country, null);
  assert.strictEqual(blank.flags._migrated, true);
  const stored = policy.fromRow({ policy_flags: { qty_zero_hides: 'on' }, country: 'AU' }, true);
  assert.strictEqual(stored.flags.qty_zero_hides, 'on');
  assert.strictEqual(stored.country, 'AU');
  assert.notStrictEqual(blank.flags.qty_zero_hides, 'on');
});

const stock = require('../lib/stock-store');
ok('foldSheet: sums a product over its lots, remembers its kind, sorts lots earliest expiry first, untracked pool left out of lots', () => {
  const rows = [
    { item_id: 'i1', item_kind: 'catalogue', lot: 'B', expires_at: '2026-12-01', qty: 2, value: 20 },
    { item_id: 'i1', item_kind: 'catalogue', lot: 'A', expires_at: '2026-11-01', qty: 1, value: 10 },
    { item_id: 'i1', item_kind: 'catalogue', lot: '', expires_at: null, qty: 3, value: 30 },
    { item_id: 'i2', item_kind: 'supply', lot: '', expires_at: null, qty: 4, value: 8 }
  ];
  const plain = stock.foldSheet(rows, {});
  assert.deepStrictEqual(plain.by.i1, { qty: 6, value: 60 });
  assert.deepStrictEqual(plain.kinds, { i1: 'catalogue', i2: 'supply' });
  const lots = stock.foldSheet(rows, { lots: true });
  assert.deepStrictEqual(lots.by.i1.lots.map((l) => l.lot), ['A', 'B']);
});

const stocked = require('../lib/stocked');
ok('flagsOfRows: one entry per item id, booleans read through the one reader', () => {
  const m = stocked.flagsOfRows([{ item_id: 7, batch_tracked: true, stocked: false }]);
  assert.deepStrictEqual([...m.keys()], ['7']);
  assert.strictEqual(m.get('7').stocked, false);
});

const container = require('../lib/container');
ok('containersOfRows: a pointer with no version row is skipped, never invented', () => {
  const out = container.containersOfRows(
    [{ container_id: 'c1', owner_entity_id: 'o', source_key: 's', name: 'n', current_version: 2 }, { container_id: 'c2', current_version: 1 }],
    [{ container_id: 'c1', version: 2, content: null, schema: null, minted_at: 't' }]
  );
  assert.deepStrictEqual(Object.keys(out), ['c1']);
  assert.deepStrictEqual(out.c1.content, {});
  assert.strictEqual(out.c1.is_current, true);
});

const build = require('../lib/catalogue-build');
ok('sourceFromRow: null without items (the caller then uses the code seed); a row with items becomes the source object', () => {
  assert.strictEqual(build.sourceFromRow(null), null);
  assert.strictEqual(build.sourceFromRow({ source_key: 'k', items: [] }), null);
  const s = build.sourceFromRow({ source_key: 'k', title: 'T', items: [{ name: 'a' }], owner_entity_id: null });
  assert.strictEqual(s._fromDb, true);
  assert.strictEqual(s.source, 'k');
  assert.strictEqual(s.is_member, null);
  assert.strictEqual(s.version, build.VERSION);
});

const shelf = require('../lib/tax-shelf');
ok('shelfFromRows: NO GSTIN, NO GST (no shelf) unless a governed slab names another scheme; with a GSTIN the shelf carries slabs, categories, face, items', () => {
  const defs = { rows: [{ kind: 'category', name: 'C' }] };
  assert.strictEqual(shelf.shelfFromRows({ defs, items: { rows: [] }, gstn: '  ', face: null, gov: [] }), null);
  const got = shelf.shelfFromRows({ defs, items: { rows: [{ item_id: 1 }] }, gstn: '29ABCDE1234F1Z5', face: null, gov: [] });
  assert.deepStrictEqual(got.face, {});
  assert.strictEqual(got.categories.length, 1);
  assert.strictEqual(got.items.length, 1);
  const vat = shelf.shelfFromRows({ defs, items: { rows: [] }, gstn: '', face: {}, gov: [{ scheme: 'VAT', id: 'v' }] });
  assert.ok(vat, 'a VAT-type governed slab is not gated on a GSTIN');
});

/* ── THE GUARD: one definition each, and the shop's own read goes through it ───────────────────────────────────────────── */
const REDUCERS = [
  ['gateOfRow', 'catalogue-view.js'], ['offersOfRows', 'catalogue-view.js'], ['categoriesOfRows', 'catalogue-view.js'], ['fromRow', 'policy.js'],
  ['foldSheet', 'stock-store.js'], ['flagsOfRows', 'stocked.js'], ['containersOfRows', 'container.js'], ['sourceFromRow', 'catalogue-build.js'], ['shelfFromRows', 'tax-shelf.js']
];
/** the source with block and line comments removed, so a name in a doc comment is not a call site */
function withoutComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}
const libs = fs.readdirSync(LIB).filter((f) => f.endsWith('.js'));
for (const [name, home] of REDUCERS) {
  ok('guard: ' + name + ' is defined once (in ' + home + ') and its own read calls it', () => {
    const def = new RegExp('(?:^|\\n)\\s*(?:async\\s+)?function\\s+' + name + '\\s*\\(|(?:const|let|var)\\s+' + name + '\\s*=');
    const homes = libs.filter((f) => def.test(fs.readFileSync(path.join(LIB, f), 'utf8')));
    assert.deepStrictEqual(homes, [home], name + ' must have exactly one definition under lib/ (found in: ' + homes.join(', ') + ')');
    const code = withoutComments(fs.readFileSync(path.join(LIB, home), 'utf8')).replace(def, '');
    const calls = code.split(new RegExp('\\b' + name + '\\s*\\(')).length - 1;
    assert.ok(calls >= 1, name + ' is defined but no CODE in its own lib calls it (a doc comment does not count): the old path must run the reducer, not hold a copy of its logic');
  });
}
console.log('net-98-reducers: ' + n + ' passed');
