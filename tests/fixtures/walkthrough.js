'use strict';
/**
 * walkthrough.js — a real price list, end to end, with nothing mocked but the database.
 *
 * Athi, 2026-09-02: *"need to see how all fits together… take a real price list and see how we can integrate with
 * real product and pricing and how easy to adopt upload and maintain a running catalogue."*
 *
 * Every step below is the SHIPPING code path, not a demo: csv-preflight reads the file, catalogue-columns decides
 * what becomes a column, sheet projects it back out, defaults resolves what the row did not say, tax determines
 * the invoice. Run: node tests/fixtures/walkthrough.js
 */
const fs = require('fs');
const path = require('path');
const CSV = require('../../lib/csv');
const P = require('../../lib/csv-preflight');
const cols = require('../../lib/catalogue-columns');
const sheet = require('../../lib/sheet');
const defaults = require('../../lib/defaults');
const tax = require('../../lib/tax');
const orderInput = require('../../lib/order-input');

const line = (s) => console.log(s);
const rule = (t) => line('\n══ ' + t + ' ' + '═'.repeat(Math.max(0, 74 - t.length)));

const text = fs.readFileSync(path.join(__dirname, 'pricelist-wholesaler.csv'), 'utf8');
const parsed = CSV.parseCSV(text);
/**
 * ⚠️ TWO SHAPES FOR 'rows', AND THE MISMATCH FAILS SILENTLY. parseCSV returns rows as OBJECTS keyed by header;
 * preflight and applyDecisions index them POSITIONALLY. Pass the objects straight through and every cell reads
 * undefined, so every row is dropped for having no name — 12 products in, 0 out, no error. routes/products.js
 * bridges it with this exact line, twice. A third caller who forgets gets a silent empty import.
 */
const rows = parsed.rows.map((r) => parsed.headers.map((h) => r[h]));

rule('1 · THE FILE, AS A SUPPLIER ACTUALLY SENDS IT');
line('  ' + parsed.headers.join(' | '));
line('  ' + rows.length + ' products');

rule('2 · PREFLIGHT — read it BEFORE it becomes data');
const template = CSV.templateFor({ schema: { properties: { name: {}, unit: {}, price: {} } },
  orderInput: orderInput.resolve(null) });
const pre = P.preflight({ headers: parsed.headers, rows: rows, template });
for (const m of pre.mapping) {
  line('  ' + String(m.incoming).padEnd(18) + '→ ' + String(m.canonical || m.suggest || '—').padEnd(10) + ' ' + m.how);
}
line('');
(pre.notes || []).forEach((n) => line('  · ' + n));

rule('3 · THE MERCHANT ACCEPTS THE SUGGESTIONS');
/* Everything preflight proposed, plus the two it could not name. `Sl` is a row number — dropped on purpose. */
/* ⚠️ 'map' only works for a column the catalogue ALREADY accepts; anything new is 'create'. That distinction is
   the whole adopt story: three of this file's columns did not exist an hour ago. */
const decisions = pre.mapping
  .filter((m) => m.canonical || m.suggest)
  .map((m) => m.canonical
    ? { incoming: m.incoming, action: 'map', field: m.canonical }
    : { incoming: m.incoming, action: 'create', field: m.suggest })
  .concat([{ incoming: 'Brand', action: 'create', field: 'brand' }]);
const applied = P.applyDecisions({ headers: parsed.headers, rows: rows, template, decisions });
line('  mapped   : ' + applied.mappedFields.join(', '));
line('  new cols : ' + applied.newFields.map((f) => f.field_key + ':' + f.field_type).join(', '));
line('  rows in  : ' + applied.items.length);

rule('4 · DECLARE-FIRST — every key that will be stored becomes a column');
const declaredNow = ['name', 'unit', 'price'];
const plan = cols.planWrite({ item_data: applied.items[0], declared: declaredNow, labels: {} });
line('  catalogue had : ' + declaredNow.join(', '));
line('  now declares  : ' + declaredNow.concat(plan.newFields.map((f) => f.field_key)).join(', '));
if (plan.warnings.length) plan.warnings.forEach((w) => line('  ⚠ ' + w));
line('  → the Columns panel, the template and the export now answer identically.');

rule('5 · WHAT THE MERCHANT GETS BACK ON DOWNLOAD');
const face = { defaults: { unit: 'Packet' }, units: ['Packet', 'Bag', 'Box', 'Bottle', 'Pack'] };
const stored = applied.items.slice(0, 3).map((it) => Object.assign({}, it, {
  status: 'available', avail: { qty: Number(it.qty) || 0, source: 'upload', as_of: '2026-09-02T21:00:00.000Z' },
}));
const outRows = stored.map((it) => sheet.toSheet(defaults.effective(it, face)));
const header = Object.keys(outRows[0]);
line('  ' + header.join(','));
outRows.forEach((r) => line('  ' + header.map((h) => r[h] === undefined ? '' : r[h]).join(',')));
line('');
line('  · no JSON in any cell — availability split into available · qty · qty_as_of · qty_source');
const u = defaults.usage(stored, face);
line('  · ' + u.unit.overridden + ' products set their own unit, ' + u.unit.inherited + ' use the catalogue default');

rule('6 · ONE ORDER OFF THIS CATALOGUE, AS AN INVOICE');
const seller = { Gstin: '29ABCDE1234F1Z5', LglNm: 'Alpha Wholesale', State: '29', Loc: 'Bengaluru' };
const buyerSame = { Gstin: '29ZZZZZ9999F1Z5', LglNm: 'Chola Stores', State: '29', Pos: '29' };
const buyerOther = { Gstin: '27YYYYY8888F1Z5', LglNm: 'Mumbai Retail', State: '27', Pos: '27' };
const orderLines = [
  { id: 'a', name: 'Tea, Assam CTC 250g', hsn: '09024090', qty: 24, unit: 'Packet', unit_price: 180, rate: 5 },
  { id: 'b', name: 'Detergent Powder, 1kg', hsn: '34022090', qty: 10, unit: 'Packet', unit_price: 96, rate: 18, discount: 60 },
];
for (const [who, buyer] of [['same state ', buyerSame], ['other state', buyerOther]]) {
  const inv = tax.determine({ seller, buyer, lines: orderLines });
  const v = inv.ValDtls;
  line('  ' + who + ' (' + inv._cb.supply + ')  taxable ' + v.AssVal
    + '   CGST ' + v.CgstVal + '  SGST ' + v.SgstVal + '  IGST ' + v.IgstVal
    + '   round ' + v.RndOffAmt + '   TOTAL ' + v.TotInvVal);
}
line('');
line('  · same goods, same prices — the place of supply alone moves the tax between heads');
line('  · the ₹60 discount is taxed OUT: 18% applies to 900, not 960');
line('  · field names are INV-01 (SellerDtls · BuyerDtls · ItemList · ValDtls), so this maps to e-invoice/Tally');

rule('WHAT IS NOT PROVEN HERE');
line('  · no database — the import COMMIT and the live export are not exercised by this script');
line('  · no rates are ours: GstRt came from the file\'s own "GST %" column');
line('  · migration b198 has not been run, so a live catalogue may still hold undeclared columns');
console.log('');
