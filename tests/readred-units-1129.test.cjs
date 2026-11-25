/**
 * tests/readred-units-1129.test.cjs — readRed2 (batch 1129): THE SMALL LIB MODULES THAT HAD NO TEST REACHING THEM, ONE UNIT PER RULE.
 * Hand figures: a bad row of an import is rejected once (its first problem) in file order; a credit limit of 3.5 KWD is 3500 fils and "1e400" is refused;
 * a receipt of quantity 0 or of a lot already expired is refused in words; no pack means no off-rail entry; a missing country read answers '' (fail closed to the neutral list), never a 500.
 * Run: node tests/readred-units-1129.test.cjs
 */
'use strict';
const assert = require('node:assert/strict');

let pass = 0, fail = 0;
const results = [];
const test = (name, fn) => results.push(Promise.resolve().then(fn).then(() => { pass++; console.log('   ok   ' + name); }, (e) => { fail++; console.log('   FAIL ' + name + '\n          ' + String(e.message).split('\n').slice(0, 5).join('\n          ')); }));

const rejects = require('../lib/import-rejects');
test('import-rejects: one entry per bad line (its first problem), warnings ignored, file order', () => {
  const issues = [
    { severity: 'error', row: 5, column: 'price', message: 'not a number' },
    { severity: 'warning', row: 2, column: 'name', message: 'long' },
    { severity: 'error', row: 3, column: 'name', message: 'missing' },
    { severity: 'error', row: 5, column: 'qty', message: 'second problem of line 5' }
  ];
  assert.deepEqual(rejects.rejectsOf(issues), [{ line: 3, field: 'name', message: 'missing' }, { line: 5, field: 'price', message: 'not a number' }]);
  assert.deepEqual(rejects.rejectsOf(null), []);
});
test('import-rejects: the rejected rows come back as CSV with the problem last; a line past the file is an empty row, never a throw', () => {
  const csv = rejects.rejectsCsv(['name', 'price'], [{ name: 'a', price: '1' }, { name: 'b,c', price: 'x' }], [{ line: 3, field: 'price', message: 'bad' }, { line: 9, field: 'name', message: 'gone' }]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'name,price,problem');
  assert.ok(lines[1].startsWith('"b,c",x,') && /price: bad/.test(lines[1]));
  assert.ok(/^,,/.test(lines[2]) && lines.length === 4);
});

const credit = require('../lib/party-credit');
const badRequest = (words) => Object.assign(new Error(words), { status: 400 });
test('party-credit: a limit in major units goes through the shop currency exponent (KWD 3 places, INR 2, JPY none)', () => {
  assert.equal(credit.majorToMinor(3.5, 'KWD', badRequest, 'w'), 3500);
  assert.equal(credit.majorToMinor(12.34, 'INR', badRequest, 'w'), 1234);
  assert.equal(credit.majorToMinor(500, 'JPY', badRequest, 'w'), 500);
});
test('party-credit: a non-finite amount or an unknown currency is refused, never stored; no currency is refused in words', () => {
  assert.throws(() => credit.majorToMinor('1e400', 'INR', badRequest, 'refused words'), /refused words/);
  assert.throws(() => credit.majorToMinor(5, 'ZZZ', badRequest, 'refused words'), /ISO 4217/);
  assert.throws(() => credit.majorToMinor(5, '', badRequest, 'w'), /could not tell which currency/);
});

test("profilemap: the engine's name is the same module as lib/profile-map (one door, nothing of its own)", () => {
  assert.strictEqual(require('../lib/profilemap'), require('../lib/profile-map'));
});

const shopCountry = require('../lib/shop-country');
const gov = require('../lib/govresolve');
test('shop-country: the stated country is read; none stated answers the neutral empty list', async () => {
  const keep = gov.resolveEntityGovernance;
  try {
    gov.resolveEntityGovernance = async () => ({ basics: { country: 'AU' } });
    assert.equal(await shopCountry.shopCountryOf('e1'), 'AU');
    gov.resolveEntityGovernance = async () => ({ basics: {} });
    assert.equal(await shopCountry.shopCountryOf('e1'), '');
  } finally { gov.resolveEntityGovernance = keep; }
});
test('shop-country: a read that fails answers the neutral list and does not throw (fail closed, never a 500)', async () => {
  const keep = gov.resolveEntityGovernance;
  const logger = require('../lib/logger'), warn = logger.warn;
  try {
    gov.resolveEntityGovernance = async () => { throw new Error('database down'); };
    logger.warn = () => {};
    assert.equal(await shopCountry.shopCountryOf('e1'), '');
  } finally { gov.resolveEntityGovernance = keep; logger.warn = warn; }
});

const receipt = require('../lib/receipt-lines');
const rc = (line) => ({ purpose: 'receipt', is_draft: false, line_items: [line] });
test('receipt-lines: a quantity of 0, a negative one and one past the ceiling are refused in words with the line named', () => {
  for (const quantity of [0, -3, receipt.RECEIPT_QTY_CEILING]) {
    const out = receipt.refusalOf(rc({ name: 'Rice', quantity, price: 5 }), { today: '2026-11-21' });
    assert.equal(out.code, 'BAD_QTY');
    assert.ok(/Line 1 "Rice"/.test(out.message));
  }
});
test('receipt-lines: an expired lot is refused; a draft is not judged, an order or counter sale of 0 is; a removed line is not a line', () => {
  const lot = { name: 'Milk', quantity: 2, price: 5, item_data: { lot: { batch: 'L1', expiry: '2026-01-01' } } };
  const out = receipt.refusalOf(rc(lot), { today: '2026-11-21' });
  assert.equal(out && out.code, 'RECEIPT_LOT_EXPIRED');
  assert.equal(receipt.refusalOf({ purpose: 'receipt', is_draft: true, line_items: [{ quantity: 0 }] }), null);
  assert.equal(receipt.refusalOf({ purpose: 'order', line_items: [{ quantity: 0 }] }).code, 'BAD_QTY'); /* AY-F-03: an order for nothing is refused */
  assert.equal(receipt.refusalOf({ purpose: 'order', is_draft: true, line_items: [{ quantity: 0 }] }), null);
  assert.equal(receipt.refusalOf({ purpose: 'order', business_json: { bill_no: 'C/1', till: { id: 'C1' } }, line_items: [{ quantity: 0 }] }).code, 'BAD_QTY'); /* AZ-F-01: a counter sale of nothing is refused too */
  assert.deepEqual(receipt.receiptLines(rc({ name: 'gone', quantity: 1, removed: true })), []);
});
test('receipt-lines: a good line passes (no refusal)', () => {
  assert.equal(receipt.refusalOf(rc({ name: 'Rice', quantity: 2, price: 5 }), { today: '2026-11-21' }), null);
});

test('guards-needs-engines: the list names test files, each once, none empty', () => {
  const { NEEDS_ENGINES } = require('../scripts/guards-needs-engines.cjs');
  assert.ok(NEEDS_ENGINES.length > 10);
  assert.equal(new Set(NEEDS_ENGINES).size, NEEDS_ENGINES.length);
  assert.ok(NEEDS_ENGINES.every((name) => /\.test\.(cjs|js)$/.test(name)));
});

test('client-ip: the address is the proxy-counted one; an unreadable or spoofed value answers empty (fail closed), never the typed header', () => {
  const { clientIp } = require('../lib/client-ip');
  assert.equal(clientIp({ ip: '203.0.113.7', headers: { 'x-forwarded-for': '1.1.1.1' } }), '203.0.113.7');
  assert.equal(clientIp({ socket: { remoteAddress: '::1' } }), '::1');
  assert.equal(clientIp({ ip: '<script>' }), '');
  assert.equal(clientIp(null), '');
});

const note = require('../lib/einvoice-note');
test('einvoice-note: no registered buyer means no note, an unknown country is refused as no pack (null), the row in force on the day is read', () => {
  assert.equal(note.einvoiceNoteFor({ country: 'IN', day: '2026-09-30', b2b: 0 }), null);
  assert.equal(note.einvoiceNoteFor({ country: '', day: '2026-09-30', b2b: 2 }), null);
  assert.equal(note.rowOf([{ from: '2020-01-01', to: '2020-12-31' }, { from: '2021-01-01' }], '2026-01-01').from, '2021-01-01');
  assert.equal(note.rowOf([{ from: '2030-01-01' }], '2026-01-01'), null);
  assert.equal(note.rowOf(null, '2026-01-01'), null);
});

const itc = require('../lib/offrail-itc');
test('offrail-itc: with no pack that reads input tax from the books the month gets no entry (closed, nothing invented); a pack with no input ledger likewise', async () => {
  assert.deepEqual(await itc.entriesOf(null, 'shop', '2026-09', { from: '2026-09-01', to: '2026-10-01' }, {}), []);
  assert.deepEqual(await itc.entriesOf({ taxLedgers: {}, currency: 'INR' }, 'shop', '2026-09', { from: '2026-09-01', to: '2026-10-01' }, {}), []);
});

Promise.all(results).then(() => {
  console.log('\n' + pass + ' checks, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
});
