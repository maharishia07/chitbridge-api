'use strict';
/**
 * csv-preflight.test.js — the file is read BEFORE it becomes data.
 *
 * The load-bearing tests are the ones about what it REFUSES: a blocked column stays blocked at any confidence, an
 * unmatched column is reported rather than invented, and `ready` is false whenever a person still has to look.
 */
const assert = require('assert');
const P = require('../lib/csv-preflight');
const CSV = require('../lib/csv');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
};

const CART = CSV.templateFor({ orderInput: { preset: 'cart', pipeline: 'commerce' },
  schema: { properties: { code: {}, desc: {} } } });
const RANGE = CSV.templateFor({ orderInput: { preset: 'range', pipeline: 'commerce' } });

console.log('\ncsv-preflight · normalising a real header');

t('a currency in the heading is not part of the field name', () => {
  assert.strictEqual(P.normalise('Price (INR)'), 'price');
  assert.strictEqual(P.normalise('₹ Price'), 'price');
});
t('separators, case and punctuation all collapse', () => {
  assert.strictEqual(P.normalise('Unit_Price'), 'unit price');
  assert.strictEqual(P.normalise('  PRODUCT-NAME * '), 'product name');
});

console.log('\ncsv-preflight · placing a column');

t('an exact match is exact', () => {
  const m = P.matchHeader('price', CART.columns);
  assert.strictEqual(m.canonical, 'price');
  assert.strictEqual(m.how, 'exact');
});
t('"Rate" and "MRP" are prices — the names every Indian desk actually uses', () => {
  for (const h of ['Rate', 'MRP', 'Unit Price', 'Selling Price']) {
    const m = P.matchHeader(h, CART.columns);
    assert.strictEqual(m.canonical, 'price', `${h} did not land on price`);
    assert.strictEqual(m.how, 'synonym');
  }
});
t('a typo is matched by similarity and flagged for confirming, not accepted silently', () => {
  // "Prodcut Name" is handled earlier now, by containment — the word `name` survives the typo. A header where NO
  // token lands whole is what actually exercises the fuzzy path.
  const m = P.matchHeader('Prodct', CART.columns);
  assert.strictEqual(m.canonical, 'name');
  assert.strictEqual(m.how, 'fuzzy');
  assert.ok(m.confidence < 1 && m.confidence >= P.FUZZY_ACCEPT);
  assert.ok(/confirm/i.test(m.why), 'a guess must ask');
});
t('two typos in one header is reported, not guessed at', () => {
  // "Prodcut Nmae" scores 0.45. Below the threshold we say we do not know, rather than proposing something a
  // merchant might wave through.
  assert.strictEqual(P.matchHeader('Prodcut Nmae', CART.columns).how, 'unmatched');
});
t('★ a column we cannot place is REPORTED, never invented into the catalogue', () => {
  const m = P.matchHeader('Warehouse Bay', CART.columns);
  assert.strictEqual(m.canonical, null);
  assert.strictEqual(m.how, 'unmatched');
});
t('⚠ order_input is BLOCKED — a mode cannot arrive in a file at any confidence', () => {
  const m = P.matchHeader('order_input', CART.columns);
  assert.strictEqual(m.how, 'blocked');
  assert.strictEqual(m.canonical, null);
  assert.ok(/declared by your catalogue/i.test(m.why));
});
t('⚠ price_currency and quantity are blocked too', () => {
  assert.strictEqual(P.matchHeader('price_currency', CART.columns).how, 'blocked');
  assert.strictEqual(P.matchHeader('Quantity', CART.columns).how, 'blocked');
});
t('a field the CATALOGUE declares beats a generic synonym', () => {
  // `code` is a real column here, so a header of "code" is that field, not a guess at sku.
  const m = P.matchHeader('code', CART.columns);
  assert.strictEqual(m.canonical, 'code');
  assert.strictEqual(m.how, 'exact');
});
t('★ a cart catalogue is TOLD a band column does not apply — not quietly bent onto price', () => {
  // "Min Price" scored 0.67 against `price` and was proposed as the listed price. A merchant who confirmed that
  // would have published their FLOOR as their selling price.
  const m = P.matchHeader('Min Price', CART.columns);
  assert.strictEqual(m.canonical, null, 'price_min is not in a cart catalogue\'s accepted format');
  assert.strictEqual(m.how, 'not-accepted');
  assert.ok(/does not use/.test(m.why), 'the merchant must be told WHY, or they will just rename the column');
});
t('a range catalogue DOES place the band', () => {
  assert.strictEqual(P.matchHeader('Min Price', RANGE.columns).canonical, 'price_min');
  assert.strictEqual(P.matchHeader('Max Price', RANGE.columns).canonical, 'price_max');
});

t('★ a QUALIFIED column is seen through — "Variant SKU" is a sku', () => {
  // Found on a real Medusa-shaped file: bigram similarity scores "variant sku" against "sku" at 0.33, so both
  // `Variant SKU` and `Variant Price` came back unrecognised on the single most likely file anyone will upload.
  const sku = P.matchHeader('Variant SKU', CART.columns);
  assert.strictEqual(sku.canonical, 'sku');
  assert.strictEqual(sku.how, 'contains');
  assert.strictEqual(P.matchHeader('Variant Price', CART.columns).canonical, 'price');
  assert.strictEqual(P.matchHeader('Product Description', CART.columns).canonical, 'desc');
});
t('★ a QUALIFIER is not a field name — "Product Title" beats "Product Handle" for name', () => {
  // Both contain "product". On a straight tie, Handle won `name` by nothing but its column position.
  const title = P.matchHeader('Product Title', CART.columns);
  const handle = P.matchHeader('Product Handle', CART.columns);
  assert.strictEqual(title.canonical, 'name');
  assert.ok(title.confidence > handle.confidence, 'naming a field must outrank merely qualifying one');
});
t('a column that could be two things says so rather than picking one', () => {
  const m = P.matchHeader('Item Code Name', CART.columns);
  assert.strictEqual(m.canonical, null);
  assert.strictEqual(m.how, 'ambiguous');
  assert.ok(/could be/.test(m.why));
});
t('⚠ containment never overrides a block — "Variant Quantity" is still refused', () => {
  const m = P.matchHeader('Quantity', CART.columns);
  assert.strictEqual(m.how, 'blocked');
});

console.log('\ncsv-preflight · what a person typed into a price cell');

t('symbols, separators and a stray currency code are read as a number', () => {
  assert.deepStrictEqual(P.looseNumber('₹ 1,250.00'), { value: 1250, cleaned: true });
  assert.deepStrictEqual(P.looseNumber('1 200 AED'), { value: 1200, cleaned: true });
  assert.deepStrictEqual(P.looseNumber('950'), { value: 950, cleaned: false });
});
t('nonsense stays nonsense — it is not coerced to 0', () => {
  assert.strictEqual(P.looseNumber('on request').value, null, '"on request" as 0 would list the product free');
  assert.strictEqual(P.looseNumber('n/a').value, null);
});

console.log('\ncsv-preflight · the report');

const run = (csvText, template) => {
  const p = CSV.parseCSV(csvText);
  return P.preflight({ headers: p.headers, rows: p.rows.map((r) => p.headers.map((h) => r[h])), template });
};

t('★ a whole MEDUSA-shaped file lands, and still asks before importing', () => {
  const r = run('Variant SKU,Product Title,unit,Variant Price\r\nA1,Tussar,litre,950\r\n', CART);
  assert.deepStrictEqual(r.mapped.sort(), ['name', 'price', 'sku', 'unit']);
  assert.strictEqual(r.ready, false, 'every one of those was an inference — a person confirms them');
  assert.ok(r.needsConfirming.length >= 3);
});
t('★ a clean file that matches exactly is ready', () => {
  const r = run('sku,name,unit,price,code,desc\r\nA1,Tussar,litre,950,C1,nice\r\n', CART);
  assert.strictEqual(r.ready, true);
  assert.strictEqual(r.summary.rows, 1);
  assert.strictEqual(r.summary.importable, 1);
  assert.strictEqual(r.summary.errors, 0);
});
t('★ a file with different NAMES for the same things is understood, but not auto-accepted', () => {
  const r = run('Item Code,Product Name,UOM,Rate\r\nA1,Tussar,litre,950\r\n', CART);
  assert.deepStrictEqual(r.mapped.sort(), ['name', 'price', 'sku', 'unit']);
  assert.strictEqual(r.summary.errors, 0);
});
t('⚠ ready is FALSE while any column was matched only by similarity', () => {
  const r = run('sku,Prodcut Name,unit,price\r\nA1,Tussar,litre,950\r\n', CART);
  assert.strictEqual(r.ready, false, 'a guess must be confirmed by a person before anything is written');
  assert.strictEqual(r.needsConfirming.length, 1);
  assert.strictEqual(r.needsConfirming[0].canonical, 'name');
});
t('a missing required column is named, not discovered on row 300', () => {
  const r = run('sku,unit,price\r\nA1,litre,950\r\n', CART);
  assert.ok(r.missing.includes('name'));
  assert.strictEqual(r.ready, false);
  assert.ok(r.notes.some((n) => /has no column/i.test(n)));
});
t('★ two columns claiming one field is a CONFLICT, not last-one-wins', () => {
  const r = run('name,Price,Rate\r\nTussar,950,900\r\n', CART);
  const conflicted = r.mapping.filter((m) => m.how === 'conflict');
  assert.strictEqual(conflicted.length, 1, 'one of Price/Rate must be stood down');
  assert.ok(/stronger match/.test(conflicted[0].conflict));
  assert.strictEqual(r.mapping.filter((m) => m.canonical === 'price').length, 1);
});
t('the exact match wins the conflict over the synonym', () => {
  const r = run('name,Rate,price\r\nTussar,900,950\r\n', CART);
  const winner = r.mapping.find((m) => m.canonical === 'price');
  assert.strictEqual(winner.incoming, 'price');
});
t('a row with no name is an ERROR and is counted out of importable', () => {
  const r = run('sku,name,unit,price\r\nA1,,litre,950\r\nA2,Ikkat,litre,875\r\n', CART);
  assert.strictEqual(r.summary.rows, 2);
  assert.strictEqual(r.summary.importable, 1);
  assert.ok(r.issues.some((i) => i.row === 2 && i.severity === 'error'));
});
t('a duplicate sku points at the OTHER line', () => {
  const r = run('sku,name,unit,price\r\nA1,One,litre,10\r\nA1,Two,litre,20\r\n', CART);
  const dup = r.issues.find((i) => i.column === 'sku');
  assert.ok(dup && /line 2/.test(dup.message), 'saying "duplicate" without saying where is not help');
});
t('an inverted band is caught before it becomes a product', () => {
  const r = run('sku,name,unit,price_min,price_max\r\nA1,Tussar,tonne,900,500\r\n', RANGE);
  assert.ok(r.issues.some((i) => /above high price/.test(i.message) && i.severity === 'error'));
  assert.strictEqual(r.ready, false);
});
t('a price typed with a symbol is reported as info, not refused', () => {
  const r = run('sku,name,unit,price\r\nA1,Tussar,litre,"₹ 1,250"\r\n', CART);
  assert.strictEqual(r.summary.errors, 0);
  assert.ok(r.issues.some((i) => i.severity === 'info' && /1250/.test(i.message)));
  assert.ok(r.notes.some((n) => /plain numbers/.test(n)));
});
t('"on request" in a price cell is an ERROR — importing it as 0 would list the product free', () => {
  const r = run('sku,name,unit,price\r\nA1,Tussar,litre,on request\r\n', CART);
  assert.ok(r.issues.some((i) => i.severity === 'error' && /not a number/.test(i.message)));
});
t('⚠ an order_input column in an uploaded file is listed as ignored, and says why', () => {
  const r = run('sku,name,unit,price,order_input\r\nA1,Tussar,litre,950,"{""preset"":""range""}"\r\n', CART);
  assert.strictEqual(r.blocked.length, 1);
  assert.strictEqual(r.blocked[0].incoming, 'order_input');
  assert.ok(r.notes.some((n) => /may not set them/.test(n)));
});
t('an unmatched column is named in the notes so nothing vanishes quietly', () => {
  const r = run('sku,name,unit,price,Warehouse Bay\r\nA1,Tussar,litre,950,B12\r\n', CART);
  assert.deepStrictEqual(r.unmatched, ['Warehouse Bay']);
  assert.ok(r.notes.some((n) => /Warehouse Bay/.test(n)));
});
t('an empty file is not "ready" just because it has no errors', () => {
  const r = run('sku,name,unit,price\r\n', CART);
  assert.strictEqual(r.summary.rows, 0);
  assert.strictEqual(r.ready, false, 'importing nothing must not report success');
});

console.log('\ncsv-preflight · the rules it must not drift from');

t('★ the TEMPLATE and the PREFLIGHT agree on what a catalogue accepts', () => {
  // Every column the template offers must be placeable by the preflight, or a merchant would fill our own sheet and
  // be told a column is unrecognised.
  for (const preset of ['cart', 'qty', 'range', 'qtyprice', 'enquiry', 'form']) {
    const tpl = CSV.templateFor({ orderInput: { preset, pipeline: preset === 'enquiry' || preset === 'form' ? 'payload' : 'commerce' } });
    const p = CSV.parseCSV(tpl.csv);
    const r = P.preflight({ headers: p.headers, rows: [], template: tpl });
    assert.strictEqual(r.unmatched.length, 0, `${preset}: our own template has a column the preflight cannot place: ${r.unmatched}`);
    assert.strictEqual(r.blocked.length, 0, `${preset}: our own template offers a blocked column`);
    assert.strictEqual(r.missing.length, 0, `${preset}: our own template is missing ${r.missing}`);
  }
});
t('MONEY_KEYS is in step with csv.js', () => {
  assert.deepStrictEqual(P.SYNONYMS.price_min ? CSV.MONEY_KEYS : null, ['price', 'price_min', 'price_max'],
    'the inlined copy in csv-preflight.js has drifted from csv.js');
});
t('TIER A · zero dependencies', () => {
  const src = require('fs').readFileSync(require.resolve('../lib/csv-preflight'), 'utf8');
  assert.deepStrictEqual([...src.matchAll(/require\(/g)], [], 'csv-preflight.js must stay liftable as a file');
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
