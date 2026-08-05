'use strict';
/**
 * csv.test.js — the round trip, and the three details everyone gets wrong.
 *
 * The load-bearing test is the ROUND TRIP: what comes out must go back in. Everything else is a detail that would
 * corrupt it — an unescaped quote, a comma inside a description, a price that loses its currency.
 */
const assert = require('assert');
const CSV = require('../lib/csv');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
};

console.log('\ncsv');

// ── escaping · RFC 4180 ─────────────────────────────────────────────────────────────────────────────────────
t('a plain value needs no quotes', () => assert.strictEqual(CSV.cell('Tussar'), 'Tussar'));
t('a comma forces quoting', () => assert.strictEqual(CSV.cell('Matt, interior'), '"Matt, interior"'));
t('a quote is DOUBLED, not backslash-escaped', () => assert.strictEqual(CSV.cell('He said "hi"'), '"He said ""hi"""'));
t('a newline inside a field is quoted, not split', () => assert.strictEqual(CSV.cell('line1\nline2'), '"line1\nline2"'));
t('null and undefined are empty, not the words', () => {
  assert.strictEqual(CSV.cell(null), '');
  assert.strictEqual(CSV.cell(undefined), '');
});

// ── the spreadsheet attack ──────────────────────────────────────────────────────────────────────────────────
t('⚠ a formula is de-fanged — Excel would EXECUTE this', () => {
  assert.strictEqual(CSV.cell('=cmd|calc'), "'=cmd|calc");
  assert.strictEqual(CSV.cell('+1234'), "'+1234");
  assert.strictEqual(CSV.cell('@SUM(A1)'), "'@SUM(A1)");
  assert.strictEqual(CSV.cell('-1+1'), "'-1+1");
});
t('a legitimate negative NUMBER is not mangled', () => {
  // Numbers arrive as numbers, not strings, so the guard never sees them.
  assert.strictEqual(CSV.cell(-50), '-50');
});

// ── money keeps its currency, in its own column ─────────────────────────────────────────────────────────────
const ITEMS = [
  { sku: 'RP-1L', name: 'Tussar', unit: 'litre', price: { amount: 950, currency: 'INR' }, finish: 'Matt' },
  { sku: 'RP-4L', name: 'Ikkat, textured', unit: 'litre', price: { amount: 875, currency: 'INR' }, finish: 'Sheen' },
];

t('a stamped price splits into amount and currency columns', () => {
  const out = CSV.toCSV(ITEMS);
  const [head, r1] = out.split('\r\n');
  assert.ok(head.includes('price'), 'no price column');
  assert.ok(head.includes('price_currency'), 'the currency was dropped — the file would not say what 950 means');
  assert.ok(r1.includes('950'), 'the amount is not a plain number');
  assert.ok(r1.includes('INR'));
});
t('the amount stays ARITHMETIC — not "INR 950" in one cell', () => {
  const { rows } = CSV.parseCSV(CSV.toCSV(ITEMS));
  assert.strictEqual(rows[0].price, '950', 'a spreadsheet must be able to sum this column');
});
t('a comma inside a product name survives', () => {
  const { rows } = CSV.parseCSV(CSV.toCSV(ITEMS));
  assert.strictEqual(rows[1].name, 'Ikkat, textured');
});

// ── THE ROUND TRIP ──────────────────────────────────────────────────────────────────────────────────────────
t('★ ROUND TRIP — what comes out goes back in', () => {
  const back = CSV.toItems(CSV.parseCSV(CSV.toCSV(ITEMS)));
  assert.strictEqual(back.length, 2);
  assert.strictEqual(back[0].sku, 'RP-1L');
  assert.strictEqual(back[0].name, 'Tussar');
  assert.strictEqual(back[0].unit, 'litre');
  assert.strictEqual(back[0].price, 950, 'the price came back as a bare number for the server to stamp');
  assert.strictEqual(back[0].finish, 'Matt');
  assert.strictEqual(back[1].name, 'Ikkat, textured');
});
t('★ the round trip survives quotes, commas and newlines together', () => {
  const nasty = [{ sku: 'X1', name: 'A "quoted", multi\nline name', unit: 'kg', price: { amount: 5, currency: 'USD' } }];
  const back = CSV.toItems(CSV.parseCSV(CSV.toCSV(nasty)));
  assert.strictEqual(back[0].name, 'A "quoted", multi\nline name');
  assert.strictEqual(back[0].price, 5);
});
t('★ a de-fanged formula comes back as the ORIGINAL text', () => {
  const back = CSV.toItems(CSV.parseCSV(CSV.toCSV([{ sku: 'X', name: '=danger', unit: 'ea' }])));
  assert.strictEqual(back[0].name, '=danger', 'the apostrophe must be stripped on the way back in');
});

// ── import does not trust the file about currency ───────────────────────────────────────────────────────────
t('⚠ price_currency is DROPPED on import — the server stamps it', () => {
  const csv = 'sku,name,price,price_currency\r\nX1,Thing,100,USD\r\n';
  const back = CSV.toItems(CSV.parseCSV(csv));
  assert.strictEqual(back[0].price, 100);
  assert.strictEqual(back[0].price_currency, undefined,
    'editing a currency column in Excel must not change what a business is priced in');
});

// ── parsing details ─────────────────────────────────────────────────────────────────────────────────────────
t('accepts CRLF and LF alike', () => {
  assert.strictEqual(CSV.parseCSV('a,b\r\n1,2\r\n').rows.length, 1);
  assert.strictEqual(CSV.parseCSV('a,b\n1,2\n').rows.length, 1);
});
t('an empty cell is ABSENT, not an empty string', () => {
  const back = CSV.toItems(CSV.parseCSV('sku,name,unit\r\nX1,,kg\r\n'));
  assert.strictEqual(back[0].name, undefined, 'a blank cell must not overwrite a value with ""');
  assert.strictEqual(back[0].unit, 'kg');
});
t('"12A" stays a string — only unambiguous numbers are coerced', () => {
  const back = CSV.toItems(CSV.parseCSV('sku,code\r\nX1,12A\r\n'));
  assert.strictEqual(back[0].code, '12A');
});
t('empty input yields empty output, not a crash', () => {
  assert.deepStrictEqual(CSV.parseCSV(''), { headers: [], rows: [] });
});
t('an EMPTY catalogue exports a header row — a template, not a blank file', () => {
  // My first expectation here was '' and the code was right: a merchant exporting an empty catalogue wants the
  // column names to fill in. A zero-byte file tells them nothing and looks like a failure.
  const out = CSV.toCSV([]);
  assert.strictEqual(out, 'sku,name,unit\r\n');
});
t('a negative number stays a NUMBER, not text', () => {
  assert.strictEqual(CSV.cell(-50), '-50');
  assert.strictEqual(CSV.cell('-50'), '-50', 'a numeric string from a form must not be quoted either');
  assert.strictEqual(CSV.cell('-1+1'), "'-1+1", 'but a real formula still is');
});
t('a column an item carries but the schema does not is still exported', () => {
  const out = CSV.toCSV([{ sku: 'A', name: 'n', extra: 'kept' }], { schema: { properties: { name: {} } } });
  assert.ok(out.includes('extra'), 'a dropped column is data lost on the round trip');
});
t('identity columns come first — a person scans WHAT before HOW MUCH', () => {
  const cols = CSV.columnsFor(ITEMS, null);
  assert.deepStrictEqual(cols.slice(0, 3), ['sku', 'name', 'unit']);
});

// ── the tier rule ───────────────────────────────────────────────────────────────────────────────────────────
t('TIER A · zero dependencies', () => {
  const src = require('fs').readFileSync(require.resolve('../lib/csv'), 'utf8');
  assert.deepStrictEqual([...src.matchAll(/require\(/g)], [], 'csv.js must stay liftable as a file');
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
