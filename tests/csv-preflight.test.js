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
t('the trade names for a selling price all land on price', () => {
  for (const h of ['Rate', 'Unit Price', 'Selling Price', 'Trade Price', 'Net Rate']) {
    const m = P.matchHeader(h, CART.columns);
    assert.strictEqual(m.canonical, 'price', `${h} did not land on price`);
    assert.strictEqual(m.how, 'synonym');
  }
});
/**
 * ⚠️⚠️ THIS TEST REVERSES AN EARLIER DECISION ON PURPOSE, AND THE REASON IS A REAL FILE.
 *
 * It used to assert MRP → price unconditionally — "the names every Indian desk actually uses", which is true of a
 * small retailer and false of a wholesaler. On tests/fixtures/pricelist-wholesaler.csv, which carries BOTH "MRP"
 * and "Rate (INR)", MRP won the match and Rate was reported as the redundant duplicate: that wholesaler would
 * have published RETAIL prices to trade customers on every line, silently.
 *
 * ⭐ Neither 'always' nor 'never' is right. The FILE says which case it is.
 */
t('⭐ MRP alone IS the selling price — a retailer is not asked a question with one answer', () => {
  const r = P.preflight({ headers: ['Item', 'MRP'], rows: [['Tea', '220']], template: CART });
  const m = r.mapping.find((x) => x.incoming === 'MRP');
  assert.strictEqual(m.canonical, 'price');
  assert.ok(/only price column/i.test(m.why || ''), 'and it says why it read it that way');
});
t('⭐⭐ MRP beside a trade price is a CEILING, and must not become the price', () => {
  const r = P.preflight({ headers: ['Item', 'MRP', 'Rate (INR)'], rows: [['Tea', '220', '180']], template: CART });
  const rate = r.mapping.find((x) => x.incoming === 'Rate (INR)');
  const mrp = r.mapping.find((x) => x.incoming === 'MRP');
  assert.strictEqual(rate.canonical, 'price', 'the trade price is the selling price');
  assert.notStrictEqual(mrp.canonical, 'price', 'publishing MRP to trade customers is the whole margin');
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
  /* ⭐ A MODE CONFLICT IS THE ONE REAL REFUSAL, and it is now distinguished from "you have not declared that
     column yet" (how: 'addable'). A band column in a fixed-price shop contradicts a declaration the merchant has
     already made; an HSN column is simply one they have not added. Saying the harsh sentence to both is what
     made a real wholesaler's price list read as unimportable — see the note in matchHeader. */
  assert.ok(/contradicts|does not use/.test(m.why), 'the merchant must be told WHY, or they will just rename the column');
  assert.ok(/no price_min column/.test(m.why), 'and told which column it is refusing');
});
t('⭐⭐ a column the catalogue simply does not have YET is offered, not refused', () => {
  /* HSN, MRP and GST% all came back "your catalogue does not use this" on an ordinary wholesaler's sheet. Every
     one is a column they could add in a tick — telling them their own price list is unusable is how adoption
     dies at the first upload. */
  for (const h of ['HSN Code', 'GST %', 'MRP']) {
    const m = P.matchHeader(h, CART.columns);
    assert.strictEqual(m.how, 'addable', h + ' should be offered as a new column');
    assert.ok(m.suggest, h + ' should name the column it would become');
    assert.ok(/map it to add it/.test(m.why), h + ' should say what to do next');
  }
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
t('★ an OPTIONAL column the catalogue declares does not make a file "incomplete"', () => {
  // This was the flaw: required was inferred as "every accepted column that is not an optional trade extra", so a
  // catalogue declaring code and desc — both optional — told every upload it was missing something, forever.
  const r = run('sku,name,unit,price\r\nA1,Tussar,litre,950\r\n', CART);
  assert.deepStrictEqual(r.missing, [], 'code and desc are optional in the schema; their absence is not a problem');
  assert.strictEqual(r.ready, true);
});
t('the SCHEMA decides what is required, not the preflight', () => {
  const r = P.preflight({ headers: ['name', 'unit'], rows: [['Tussar', 'litre']], template: CART,
    required: ['name', 'code'] });
  assert.deepStrictEqual(r.missing, ['code'], 'a catalogue that insists on a code must say so and be believed');
  assert.strictEqual(r.ready, false);
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

console.log('\ncsv-preflight · the commit half — a decision per column');

const decide = (csvText, decisions, template) => {
  const p = CSV.parseCSV(csvText);
  return P.applyDecisions({ headers: p.headers, rows: p.rows.map((r) => p.headers.map((h) => r[h])), template: template || CART, decisions });
};

t('a mapped column lands on the field the person chose', () => {
  const r = decide('Particulars,Rate\r\nTussar,950\r\n',
    [{ incoming: 'Particulars', action: 'map', field: 'name' }, { incoming: 'Rate', action: 'map', field: 'price' }]);
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.items, [{ name: 'Tussar', price: 950 }]);
});
t('★ a column with NO decision is ignored — never imported on the strength of a suggestion', () => {
  const r = decide('Particulars,Rate\r\nTussar,950\r\n', [{ incoming: 'Particulars', action: 'map', field: 'name' }]);
  assert.deepStrictEqual(r.items, [{ name: 'Tussar' }], 'Rate was suggested but nobody chose it, so it stays out');
});
t('★ CREATE extends the declaration — this is how an entity keeps its own format', () => {
  const r = decide('name,Warehouse Bay\r\nTussar,B12\r\n',
    [{ incoming: 'name', action: 'map', field: 'name' }, { incoming: 'Warehouse Bay', action: 'create' }]);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.newFields.length, 1);
  assert.strictEqual(r.newFields[0].field_key, 'warehouse_bay');
  assert.strictEqual(r.newFields[0].field_name, 'Warehouse Bay', 'the heading a person recognises is kept as the label');
  assert.deepStrictEqual(r.items, [{ name: 'Tussar', warehouse_bay: 'B12' }]);
});
t('⚠ a new field is created OPTIONAL — a required one would invalidate every product already stored', () => {
  const r = decide('name,Bay\r\nTussar,B12\r\n',
    [{ incoming: 'name', action: 'map', field: 'name' }, { incoming: 'Bay', action: 'create' }]);
  assert.strictEqual(r.newFields[0].required, false);
});
t('a created column is typed from its values', () => {
  const r = decide('name,Shelf Life\r\nTussar,24\r\nIkkat,36\r\n',
    [{ incoming: 'name', action: 'map', field: 'name' }, { incoming: 'Shelf Life', action: 'create' }]);
  assert.strictEqual(r.newFields[0].field_type, 'number');
  assert.strictEqual(r.items[0].shelf_life, 24, 'and the value arrives as a number, not "24"');
});
t('a column of mixed values is text, not a number with holes', () => {
  const r = decide('name,Grade\r\nTussar,A1\r\nIkkat,2\r\n',
    [{ incoming: 'name', action: 'map', field: 'name' }, { incoming: 'Grade', action: 'create' }]);
  assert.strictEqual(r.newFields[0].field_type, 'text');
});
t('⚠ a BLOCKED column cannot be mapped, however the client asks', () => {
  const r = decide('name,order_input\r\nTussar,"{""preset"":""range""}"\r\n',
    [{ incoming: 'name', action: 'map', field: 'name' }, { incoming: 'order_input', action: 'map', field: 'order_input' }]);
  assert.ok(r.errors.some((e) => /order_input/.test(e)));
  assert.strictEqual(r.items[0].order_input, undefined, 'the mode must not arrive even when the decision asks for it');
});
t('⚠ a BLOCKED column cannot be smuggled in by CREATING it under its own name', () => {
  const r = decide('name,quantity\r\nTussar,5\r\n',
    [{ incoming: 'name', action: 'map', field: 'name' }, { incoming: 'quantity', action: 'create' }]);
  assert.ok(r.errors.length, 'creating `quantity` as a product column must be refused');
  assert.strictEqual(r.items[0].quantity, undefined);
});
t('two columns mapped to one field is refused, not silently resolved', () => {
  const r = decide('Rate,Price,name\r\n900,950,Tussar\r\n', [
    { incoming: 'Rate', action: 'map', field: 'price' },
    { incoming: 'Price', action: 'map', field: 'price' },
    { incoming: 'name', action: 'map', field: 'name' }]);
  assert.ok(r.errors.some((e) => /Pick one/.test(e)));
});
t('creating a column the catalogue already has says "map to it instead"', () => {
  const r = decide('name,Price\r\nTussar,950\r\n',
    [{ incoming: 'name', action: 'map', field: 'name' }, { incoming: 'Price', action: 'create', field: 'price' }]);
  assert.ok(r.errors.some((e) => /already has a price column/.test(e)));
});
t('mapping to a field the catalogue does not accept is refused', () => {
  const r = decide('name,Floor\r\nTussar,800\r\n',
    [{ incoming: 'name', action: 'map', field: 'name' }, { incoming: 'Floor', action: 'map', field: 'price_min' }]);
  assert.ok(r.errors.some((e) => /does not accept/.test(e)), 'a cart shop has no price_min to map onto');
});
t('a decision naming a column the file does not have is an error, not a shrug', () => {
  const r = decide('name\r\nTussar\r\n', [{ incoming: 'Colour', action: 'map', field: 'name' }]);
  assert.ok(r.errors.some((e) => /no column called "Colour"/.test(e)));
});
console.log('\ncsv-preflight · updating what is already there');

t('★ a file of sku + price is a legitimate UPDATE, not an empty import', () => {
  // Found live: this -- the most ordinary update there is, today's prices -- was refused outright with "no row had
  // a product name", so changing one number meant resending every column of every row.
  const r = decide('sku,price\r\nZZ-U1,150\r\n',
    [{ incoming: 'sku', action: 'map', field: 'sku' }, { incoming: 'price', action: 'map', field: 'price' }]);
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.items, [{ sku: 'ZZ-U1', price: 150 }]);
});
t('a row with neither a name nor a code is still left out', () => {
  const r = decide('sku,price\r\n,150\r\n',
    [{ incoming: 'sku', action: 'map', field: 'sku' }, { incoming: 'price', action: 'map', field: 'price' }]);
  assert.strictEqual(r.items.length, 0, 'there is nothing to find it by and nothing to create it from');
});
t('⚠ a file with NO identity column says every row will be ADDED', () => {
  // Proved live: a second upload of one unchanged product created a second identical row and reported "1 added".
  const r = run('name,unit,price\r\nWidget,litre,100\r\n', CART);
  assert.ok(r.notes.some((n) => /No sku column/i.test(n) && /duplicates/i.test(n)),
    'silently duplicating a catalogue is the worst outcome this tool can have');
});
t('a file WITH one says nothing of the sort', () => {
  const r = run('sku,name,unit,price\r\nA1,Widget,litre,100\r\n', CART);
  assert.ok(!r.notes.some((n) => /No sku column/i.test(n)));
});
t('★ the warning names the merchant\'s OWN identity field, not "sku"', () => {
  // A pharma desk identifies a lot by its batch. Telling them "no sku column" would be telling them about a field
  // they do not have and do not use.
  const tpl = CSV.templateFor({ schema: { properties: { batch_no: {} } },
    orderInput: { preset: 'cart', pipeline: 'commerce' } });
  const p = CSV.parseCSV('name,price\r\nLot A,100\r\n');
  const r = P.preflight({ headers: p.headers, rows: p.rows.map((x) => p.headers.map((h) => x[h])),
    template: tpl, identity: { key: ['batch_no'] } });
  assert.ok(r.notes.some((n) => /No batch_no column/.test(n)));
});
t('★ duplicates are detected on the DECLARED key, not on sku', () => {
  const tpl = CSV.templateFor({ schema: { properties: { batch_no: {} } },
    orderInput: { preset: 'cart', pipeline: 'commerce' } });
  const p = CSV.parseCSV('batch_no,name,price\r\nB1,Lot A,100\r\nB1,Lot A again,120\r\n');
  const r = P.preflight({ headers: p.headers, rows: p.rows.map((x) => p.headers.map((h) => x[h])),
    template: tpl, identity: { key: ['batch_no'] } });
  assert.ok(r.issues.some((i) => i.severity === 'error' && /also appears on line 2/.test(i.message)));
});
t('★ VARIANTS are not duplicates — three pack sizes of one paint are three lines', () => {
  const r = run('sku,name,unit,price\r\nRP-1L,Tussar,litre,950\r\nRP-4L,Tussar,litre,3400\r\nRP-10L,Tussar,litre,7900\r\n', CART);
  assert.strictEqual(r.summary.errors, 0, 'same name, different codes — that is a product with three sizes');
  assert.strictEqual(r.summary.importable, 3);
});

t('a nameless row is left out of the import', () => {
  const r = decide('name,Rate\r\nTussar,950\r\n,875\r\n',
    [{ incoming: 'name', action: 'map', field: 'name' }, { incoming: 'Rate', action: 'map', field: 'price' }]);
  assert.strictEqual(r.items.length, 1);
  assert.deepStrictEqual(r.lines, [2], 'the line numbers must still point at the ORIGINAL file');
});
t('a heading becomes a safe field key', () => {
  assert.strictEqual(P.toFieldKey('Warehouse Bay'), 'warehouse_bay');
  assert.strictEqual(P.toFieldKey('Price (INR)'), 'price');
  assert.strictEqual(P.toFieldKey('  3-Year Stock! '), 'year_stock');
});

console.log('\nstarter-fields · an empty catalogue is not a blank page');

const S = require('../lib/starter-fields');

t('a new catalogue in a trade starts with that trade\'s columns', () => {
  const gold = S.starterFor('gold');
  const keys = gold.fields.map((f) => f.field_key);
  for (const k of ['name', 'unit', 'price', 'fineness', 'assay_cert', 'bar_serial', 'hs_code']) {
    assert.ok(keys.includes(k), `a gold catalogue without ${k} cannot describe a gold bar`);
  }
  assert.strictEqual(gold.unit, 'g');
});
t('⚠ a CUSTOMER field never becomes a product column', () => {
  // room_area_sqft is what the buyer tells you at order time; litres_needed is computed from it. Neither is a
  // property of the paint, and a product form asking for them is a modelling mistake.
  const keys = S.starterFor('paint').fields.map((f) => f.field_key);
  assert.ok(!keys.includes('room_area_sqft'));
  assert.ok(!keys.includes('litres_needed'));
  assert.ok(keys.includes('coverage_sqft_per_litre'), 'but coverage IS a property of the paint');
});
t('an unknown trade gets the base set, not an empty one', () => {
  const g = S.starterFor('nonsense');
  assert.strictEqual(g.vertical, null);
  assert.ok(g.fields.map((f) => f.field_key).includes('name'));
});
t('every starter field carries a leg — where the value comes FROM', () => {
  for (const [key, v] of Object.entries(S.VERTICALS)) {
    for (const f of v.fields) assert.ok(f.leg, `${key}.${f.field_key} does not say where its value comes from`);
  }
});
t('★ every starter column survives its own template and preflight', () => {
  // A standard set that our own preflight cannot place would be a trap: adopt the set, download the template, and
  // be told your columns are unrecognised.
  for (const key of Object.keys(S.VERTICALS)) {
    const set = S.starterFor(key);
    const tpl = CSV.templateFor({ schema: { properties: Object.fromEntries(set.fields.map((f) => [f.field_key, {}])) },
      orderInput: { preset: 'cart', pipeline: 'commerce' } });
    for (const f of set.fields) {
      if (f.field_key === 'quantity') continue;
      assert.ok(tpl.columns.includes(f.field_key), `${key}: the template does not offer ${f.field_key}`);
      const labels = Object.fromEntries(set.fields.map((x) => [x.field_key, x.field_name]));
      const m = P.matchHeader(f.field_name, tpl.columns, labels);
      assert.ok(m.canonical || m.how === 'contains' || m.how === 'fuzzy',
        `${key}: "${f.field_name}" comes back as ${m.how} against a catalogue that declares it`);
    }
  }
});
t('TIER A · zero dependencies', () => {
  const src = require('fs').readFileSync(require.resolve('../lib/starter-fields'), 'utf8');
  assert.deepStrictEqual([...src.matchAll(/require\(/g)], []);
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

/**
 * ⚠️⚠️ FOUND BY IMPORTING A REAL WHOLESALER'S PRICE LIST, not by reasoning about types.
 * tests/fixtures/pricelist-wholesaler.csv carries HSN 09024090 for tea. inferType read the column, saw digits,
 * declared it a number — and looseNumber turned it into 9024090. An HSN code without its leading zero is not a
 * slightly wrong number, it is an invalid code, and chapters 01–09 are live animals, vegetables, coffee, tea and
 * spices: the entire Indian grocery trade sits in the range that breaks.
 */
t('⭐⭐ an identifier stays TEXT even when every value is digits — the leading zero survives', () => {
  const tpl = CSV.templateFor({ schema: { properties: { name: {} } }, orderInput: { preset: 'cart', pipeline: 'commerce' } });
  const out = P.applyDecisions({
    headers: ['Item', 'HSN Code'],
    rows: [['Tea', '09024090'], ['Coffee', '09011110']],
    template: tpl,
    decisions: [{ incoming: 'Item', action: 'map', field: 'name' },
                { incoming: 'HSN Code', action: 'create', field: 'hsn' }],
  });
  const f = out.newFields.find((x) => x.field_key === 'hsn');
  assert.strictEqual(f.field_type, 'text', 'an HSN code identifies, it does not measure');
  assert.strictEqual(out.items[0].hsn, '09024090', 'the leading zero is the difference between valid and invalid');
});

t('a genuine measure is still inferred as a number', () => {
  const tpl = CSV.templateFor({ schema: { properties: { name: {} } }, orderInput: { preset: 'cart', pipeline: 'commerce' } });
  const out = P.applyDecisions({
    headers: ['Item', 'Net Weight'],
    rows: [['Tea', '250'], ['Coffee', '500']],
    template: tpl,
    decisions: [{ incoming: 'Item', action: 'map', field: 'name' },
                { incoming: 'Net Weight', action: 'create', field: 'net_weight' }],
  });
  assert.strictEqual(out.newFields.find((x) => x.field_key === 'net_weight').field_type, 'number');
});
