'use strict';
/**
 * field-ledger.test.cjs — NO FIELD LEFT UNTURNED (Athi, 2026-10-09). The guard for the PRODUCT field ledger.
 *
 *   "assuming for a particular item we have say 100 different views with 100 different fields, the entire structure has to
 *    be filled and should be checked that each field makes sense … we should not be leaving any field unturned."
 *   "if a field is not being useful, then it should not be there in the database or should be marked as not used"
 *
 * The ledger is the CMDB record CAP-FIELDS-PRODUCT (data/cmdb/CAP-FIELDS-PRODUCT-<n>.json, lib/cmdb.js `fields`), generated from
 * C:/dev/toolset/fields (build.cjs). This guard fails when:
 *   1 · a column of catalogue_items / catalogue_item_version / schema_fields / catalogue_item_schedule exists in the
 *       migrations and has no row ("table.column") — it names the column;
 *   2 · a row names a column that no migration creates;
 *   3 · the product form (web app.html, when a checkout is next to this repo or CB_WEB is set) has an input ct_… no row lists;
 *   4 · a field marked "not used" has gained a reader (its `watch` pattern now matches code outside the ledger) — change its
 *       status first, in the ledger, with the reason;
 *   5 · a row does not fit the shape (lib/cmdb.js refuses it, by name).
 *
 * Run: node tests/field-ledger.test.cjs   · no DB, no network.
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
const FL = require('../lib/field-ledger');
const cmdb = require('../lib/cmdb');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

/** the pure half, so the guard can be shown to bite: which columns have no row */
function unledgered(cols, keys) {
  const have = new Set(keys), out = [];
  for (const t of Object.keys(cols)) for (const c of cols[t]) if (!have.has(t + '.' + c)) out.push(t + '.' + c);
  return out;
}
function phantoms(cols, keys) {
  const out = [];
  for (const k of keys) {
    const t = k.split('.')[0];
    if (cols[t] && k.indexOf('.') > 0 && cols[t].indexOf(k.slice(t.length + 1)) < 0) out.push(k);
  }
  return out;
}

console.log('\nTHE LEDGER IS THERE, AND EVERY ROW FITS\n');
const { files, rows } = FL.loadLedger(API, 'PRODUCT');
const keys = rows.map((r) => r.key);
it('the product ledger ships (CAP-FIELDS-PRODUCT-1…)', () => assert.ok(files.length >= 1 && rows.length >= 100, files.length + ' part(s), ' + rows.length + ' rows'));
files.forEach((n) => it(n + ' passes cmdb.shape', () => {
  const v = cmdb.shape(JSON.parse(fs.readFileSync(path.join(API, 'data', 'cmdb', n), 'utf8')));
  assert.ok(v.ok, v.why);
}));
it('no field is listed twice across the parts', () => {
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
  assert.deepStrictEqual(dup, [], 'listed twice: ' + dup.join(', '));
});
it('the index record CAP-FIELDS-PRODUCT links the parts and the capability CIs that show or set the fields', () => {
  const idx = JSON.parse(fs.readFileSync(path.join(API, 'data', 'cmdb', 'CAP-FIELDS-PRODUCT.json'), 'utf8'));
  assert.ok(cmdb.shape(idx).ok);
  const thats = (idx.relationships || []).map((x) => x.that).join(' | ');
  for (const p of files.filter((n) => /-\d+\.json$/.test(n))) assert.ok(thats.indexOf(p.replace('.json', '')) >= 0, p + ' is not linked from the index');
  for (const ci of ['CAP-CATSETUP', 'CAP-CATEGORIES', 'CAP-ADOPT']) {
    assert.ok(thats.indexOf(ci) >= 0, ci + ' is not linked');
    assert.ok(fs.existsSync(path.join(API, 'data', 'cmdb', ci + '.json')), ci + ' has no CMDB record to link to');
  }
});

console.log('\nA NEW COLUMN NEEDS A ROW\n');
const cols = FL.columns(API, FL.PRODUCT_TABLES);
it('every column of the product tables has a row, and names it when not', () => {
  const missing = unledgered(cols, keys);
  assert.deepStrictEqual(missing, [], 'product column(s) with no ledger row: ' + missing.join(', ')
    + ' — add a row to C:/dev/toolset/fields/rows.cjs, run build.cjs, and commit the CMDB seeds');
});
it('no row names a column that no migration creates', () => {
  const ph = phantoms(cols, keys);
  assert.deepStrictEqual(ph, [], 'ledger row(s) for a column that does not exist: ' + ph.join(', '));
});
it('the guard bites: an invented column is named, a ledgered one is not', () => {
  const fake = Object.assign({}, cols, { catalogue_items: cols.catalogue_items.concat(['colour_swatch']) });
  assert.deepStrictEqual(unledgered(fake, keys), ['catalogue_items.colour_swatch']);
  assert.deepStrictEqual(phantoms(cols, keys.concat(['catalogue_items.gone'])), ['catalogue_items.gone']);
});

console.log('\nA NEW FORM INPUT NEEDS A ROW\n');
const webCandidates = [process.env.CB_WEB, path.join(API, '..', 'chitbridge-web'), path.join(API, '..', 'wt-fields-web')].filter(Boolean);
const web = webCandidates.find((d) => fs.existsSync(path.join(d, 'public', 'app.html')));
const ledgerInputs = new Set(rows.reduce((a, r) => a.concat(r.inputs || []), []));
if (web) {
  it('every ct_… input on the product form (' + web + ') is listed by some row', () => {
    const found = FL.formInputs(fs.readFileSync(path.join(web, 'public', 'app.html'), 'utf8'));
    assert.ok(found.length >= 15, 'the form scan found only ' + found.length + ' inputs — the scan is broken, not the form');
    const missing = found.filter((i) => !ledgerInputs.has(i));
    assert.deepStrictEqual(missing, [], 'product form input(s) with no ledger row: ' + missing.join(', '));
  });
} else {
  console.log('  --  SKIPPED here: no web checkout found (set CB_WEB). The web repo runs the same check on its own copy (e2e/field-ledger-guard.cjs).');
}
it('the form-input scan understands a tag and a val("ct_…") read', () => {
  assert.deepStrictEqual(FL.formInputs('<input class="inp" id="ct_a1"> <select id=\\"ct_b2\\"></select> x val("ct_c3") <input id="ct_f_${k}">'), ['ct_a1', 'ct_b2', 'ct_c3']);
});

console.log('\nA FIELD MARKED "NOT USED" GAINS NO READER\n');
const notUsed = rows.filter((r) => r.status === 'not-used');
it('there are not-used fields recorded (the ledger found some)', () => assert.ok(notUsed.length >= 1));
notUsed.forEach((r) => {
  if (!(r.watch || []).length) { console.log('  --  ' + r.key + ': not used, but no watch pattern (a common word, e.g. created_at) — reviewed by eye'); return; }
  it(r.key + ' still has no reader outside the ledger', () => {
    const hits = FL.readers(API, r.watch, r.allow || []);
    assert.deepStrictEqual(hits, [], r.key + ' is marked "not used" but is now read/written by: ' + hits.join(' · ')
      + ' — change its status in the ledger first (with the reason), then this guard follows');
  });
});
it('the guard bites: a new reader of a not-used field is named', () => {
  const os = require('os'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-'));
  fs.mkdirSync(path.join(tmp, 'lib'));
  fs.writeFileSync(path.join(tmp, 'lib', 'newreader.js'), 'const x = row.max_value;');
  assert.deepStrictEqual(FL.readers(tmp, ['\\bmax_value\\b'], []).map((h) => h.split(' ~ ')[0]), ['lib/newreader.js']);
  assert.deepStrictEqual(FL.readers(tmp, ['\\bmax_value\\b'], ['lib/newreader.js']), []);
});
it('every not-used row says what to do about it (retire or mark)', () => {
  const vague = notUsed.filter((r) => !/retire|MARK|mark/.test(r.finding || ''));
  assert.deepStrictEqual(vague.map((r) => r.key), [], 'a not-used field needs a decision (retire vs mark) in its finding');
});

console.log('\n' + pass + ' checks passed\n');
