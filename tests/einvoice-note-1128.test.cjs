/**
 * tests/einvoice-note-1128.test.cjs — F13 (VERIFY-GF-TAX, batch 1128): THE GSTR-1 WARNS ABOUT E-INVOICING (IRN) WHEN THE MONTH HOLDS INVOICES TO REGISTERED BUYERS.
 * The limit is the pack's dated row (reg-in einvoice.aato_thresholds), never a number in code; the warning says IF the shop's turnover is above it (the api does not hold aggregate turnover) and names an unconfirmed row as unconfirmed.
 * Hand figures: September 2026 (row from 2023-08-01, Rs 5 crore, confirmed) holds 2 B2B invoices to buyers 29B and 33C → note: 2 invoices, limit 5 crore, confirmed, words quote "above Rs 5 crore".
 *   · a month with only a walk-in (B2C) sale → no note (null)      · December 2020 (row 2020-10-01..2020-12-31, Rs 500 crore, unconfirmed) → words name no figure and say the limit is not confirmed
 * No IRN is built or checked; nothing else in the file moves (the B2B table keeps its 2 invoices). Run: node tests/einvoice-note-1128.test.cjs
 */
'use strict';
const assert = require('node:assert/strict');
const T = require('../lib/tax-lines');
const N = require('../lib/einvoice-note');

let pass = 0, fail = 0;
const test = (name, fn) => { try { fn(); pass++; console.log('   ok   ' + name); } catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + String(e.message).split('\n').slice(0, 5).join('\n          ')); } };
const ME = { Gstin: '33AAAAA0000A1Z5', Country: 'IN', RegType: 'regular' };
const inv = (buyer, rate, id) => T.invoiceFor({ lines: [{ name: 'x', quantity: 1, price: 100, gst_rate: rate, hsn: '1006' }], seller: { Country: 'IN', Gstin: '33AAAAA0000A1Z5', State: '33' }, buyer, chit_id: id, at: '2026-09-04' }).invoice;
const sale = (id, buyer, rate) => ({ chit_id: id, direction: 'sent', sells: true, invoice: inv(buyer, rate, id), provisional: false, seller: { Country: 'IN', entity_id: 'me' }, buyer: { entity_id: 'b' + id }, at: '2026-09-04T05:00:00Z' });
const ledger = (rows) => T.ledger(rows, { RegType: 'regular' });

test('two invoices to registered buyers: the note counts them, quotes the confirmed Rs 5 crore row and its notification', () => {
  const out = T.gstr1(ledger([sale('a', { Gstin: '29AAAAA0000A1Z5', Pos: '29' }, 18), sale('b', { Gstin: '33BBBBB1111B1Z2', Pos: '33' }, 18)]), ME, '092026');
  const note = out._cb.einvoice;
  assert.deepEqual([note.b2b_invoices, note.limit_crore, note.limit_status, note.from], [2, 5, 'confirmed', '2023-08-01']);
  assert.ok(/above Rs 5 crore/.test(note.words) && /2 invoice\(s\)/.test(note.words) && /does not issue that number/.test(note.words));
  assert.ok(/10\/2023-Central Tax/.test(note.cite));
  assert.equal(out.b2b.reduce((n, b) => n + b.inv.length, 0), 2, 'the B2B table is untouched');
});
test('a month with only a walk-in sale has no registered buyer waiting on an IRN: no note', () => {
  assert.equal(T.gstr1(ledger([sale('c', { Pos: '33' }, 5)]), ME, '092026')._cb.einvoice, null);
});
test('December 2020 reads the 2020 row (Rs 500 crore, unconfirmed): the words name no figure and say the limit is not confirmed', () => {
  const note = N.einvoiceNoteFor({ country: 'IN', day: '2020-12-31', b2b: 1 });
  assert.deepEqual([note.limit_crore, note.limit_status], [500, 'unconfirmed']);
  assert.ok(/not confirmed yet/.test(note.words) && !/500/.test(note.words));
});
test('a day before any row (e-invoicing not in force), a country with no pack, and no invoices all answer null', () => {
  assert.equal(N.einvoiceNoteFor({ country: 'IN', day: '2019-01-31', b2b: 3 }), null);
  assert.equal(N.einvoiceNoteFor({ country: 'ZZ', day: '2026-09-30', b2b: 3 }), null);
  assert.equal(N.einvoiceNoteFor({ country: 'IN', day: '2026-09-30', b2b: 0 }), null);
});

console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
