'use strict';
/**
 * tests/sandbox-load.test.cjs — the sandbox trial's pure parts (tools/sandbox/maps.cjs · compare.cjs · load.cjs args/guard), on a tiny
 * fixture written HERE (the saved pulls live outside the repo and are never a test input).
 * Proves: a Xero open invoice becomes the move-in's own open_bills row (a draft does not) · a credit note goes in negative · a field no lane reads
 * is listed with its count · a line whose qty × rate disagrees with its amount is caught in minor units · the load refuses a remote database.
 * Run: node tests/sandbox-load.test.cjs · no DB, no network.
 */
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { LANES, laneRows } = require('../tools/sandbox/maps.cjs');
const C = require('../tools/sandbox/compare.cjs');
const L = require('../tools/sandbox/load.cjs');

const INVOICES = [
  { Type: 'ACCREC', InvoiceID: 'a', InvoiceNumber: 'INV-1', Status: 'AUTHORISED', Contact: { ContactID: 'c1', Name: 'Ridgeway' }, DateString: '2026-09-01T00:00:00', DueDateString: '2026-09-30T00:00:00',
    AmountDue: 115, Total: 115, SubTotal: 100, TotalTax: 15, LineAmountTypes: 'Exclusive', BrandingThemeID: 'x',
    LineItems: [{ Quantity: 3, UnitAmount: 33.335, LineAmount: 100 }] },
  { Type: 'ACCREC', InvoiceID: 'b', InvoiceNumber: 'INV-2', Status: 'DRAFT', Contact: { Name: 'Ridgeway' }, AmountDue: 50, Total: 50, LineItems: [] },
];
const CREDITS = [{ Type: 'ACCRECCREDIT', CreditNoteID: 'n', CreditNoteNumber: 'CN-1', Status: 'AUTHORISED', Contact: { Name: 'Nobody Known' }, RemainingCredit: 20, Total: 20 }];
const CONTACTS = [{ ContactID: 'c1', Name: 'Ridgeway', IsCustomer: true, IsSupplier: false, ContactStatus: 'ACTIVE', Website: 'ridgeway.example' }];
const DATA = { invoices: INVOICES, bills: [], credit_notes: CREDITS, contacts: CONTACTS };
const recordsOf = (e) => DATA[e] || [];
const lane = (kind, side, label) => LANES.xero.find((l) => l.kind === kind && l.side === side && (l.label || null) === (label || null));

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };

t('an open Xero invoice → one open_bills row in the move-in shape; the draft is left out', () => {
  const { rows } = laneRows(lane('open_bills', 'receivable'), recordsOf);
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(rows[0], { line: 2, contact: 'Ridgeway', invoice_no: 'INV-1', date: '2026-09-01T00:00:00', due_date: '2026-09-30T00:00:00', amount_due: '115', total: '115' });
});
t('a credit note with credit left goes in negative (the move-in\'s "a credit")', () => {
  const { rows } = laneRows(lane('open_bills', 'receivable', 'credit notes (customers)'), recordsOf);
  assert.strictEqual(rows[0].amount_due, '-20');
});
t('a field no lane reads has no home, with its count', () => {
  const nh = C.noHome('xero', recordsOf, ['contacts', 'invoices']);
  assert.ok(nh.contacts.fields.some((f) => f.path === 'Website' && f.records === 1));
  assert.ok(nh.invoices.fields.some((f) => f.path === 'BrandingThemeID'));
  assert.ok(!nh.invoices.fields.some((f) => f.path === 'InvoiceNumber'));
});
t('their line that disagrees with its own qty × rate is caught in minor units', () => {
  const r = C.rounding('xero', recordsOf, 'AUD');
  assert.strictEqual(r.with_lines, 1);
  assert.strictEqual(r.values_finer_than_a_minor_unit, 1);
  assert.ok(r.differences.some((d) => d.check === 'line 1 qty × rate' && d.diff === -1), JSON.stringify(r.differences));
});
t('a document naming a contact the pull does not hold is listed', () => {
  const lanes = LANES.xero.map((l) => Object.assign({ kind: l.kind, side: l.side }, laneRows(l, recordsOf)));
  const p = C.parties(lanes);
  assert.deepStrictEqual(p.docs_naming_unknown_contact, [{ side: 'receivable', doc: 'CN-1', contact: 'Nobody Known' }]);
});
t('args: vendor, pull, --entity, --keep', () => {
  assert.deepStrictEqual(L.args(['node', 'load', 'xero', '2026-10-18', '--entity', 'e1', '--keep']), { vendor: 'xero', pull: '2026-10-18', entity: 'e1', keep: true });
  assert.strictEqual(L.args(['node', 'load', 'qbo', '--entity', 'e1']).pull, null);
});
t('the load refuses any database but the local one (exit 3, before it connects)', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'sandbox', 'load.cjs'), 'xero'], { env: Object.assign({}, process.env, { DATABASE_URL: 'postgres://u:p@db.example.com:5432/x' }), encoding: 'utf8' });
  assert.strictEqual(r.status, 3); assert.ok(/REFUSED/.test(r.stderr));
});

/* tools/sandbox/vendors.cjs + pull.cjs — the addresses and the page readers */
const { VENDORS, records } = require('../tools/sandbox/vendors.cjs');
const pull = require('../tools/sandbox/pull.cjs');
t('each vendor pages the way its API does, and the Zoho organisation rides on every call', () => {
  const token = { realm_id: '123', organization_id: '9', api_domain: 'https://www.zohoapis.in' };
  assert.ok(/startposition%201001%20maxresults%201000/.test(pull.urlOf(VENDORS.qbo, token, VENDORS.qbo.entities[0].path(2))));
  assert.ok(/Invoices\?where=Type%3D%3D%22ACCPAY%22&page=1&pageSize=100$/.test(pull.urlOf(VENDORS.xero, token, VENDORS.xero.entities.find((e) => e.name === 'bills').path(1))));
  assert.strictEqual(pull.urlOf(VENDORS.zoho, token, VENDORS.zoho.entities[0].path(1)), 'https://www.zohoapis.in/books/v3/contacts?contact_type=customer&page=1&per_page=200&organization_id=9');
});
t('a saved body is read back with the reader that fetched it (docs and endpoint key both read for Zoho payments)', () => {
  assert.strictEqual(records('zoho', 'customer_payments', { customer_payments: [1, 2] }).length, 2);
  assert.strictEqual(records('zoho', 'customer_payments', { customerpayments: [1] }).length, 1);
  assert.strictEqual(records('qbo', 'invoice', { QueryResponse: { Invoice: [{ Id: '1' }] } }).length, 1);
  assert.ok(VENDORS.qbo.entities[0].more({ QueryResponse: { Customer: new Array(1000).fill({}) } }));
  assert.deepStrictEqual(records('xero', 'nope', {}), []);
});
t('page 1 keeps the entity name; later pages are numbered', () => {
  assert.strictEqual(path.basename(pull.fileOf('/d', 'items', 1)), 'items.json');
  assert.strictEqual(path.basename(pull.fileOf('/d', 'items', 3)), 'items.p3.json');
});

console.log('sandbox-load: ' + n + ' passed');
