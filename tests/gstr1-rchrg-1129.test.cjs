/**
 * gstr1-rchrg-1129.test.cjs — AQ-F-02 (walk AQ, 22 Nov 2026): the seller's GSTR-1 says `rchrg` Y on an invoice whose own TranDtls.RegRev is Y (reverse charge: the buyer pays the tax, table 4B), N on a plain one.
 * Hand: an advocate sells a legal opinion 1 x 1,000.00 at 18% to a registered shop, once as reverse charge (RegRev Y) and a tea bill 10 x 100.00 at 5% (RegRev N).
 * Compared as carried values: each document's own RegRev (the frozen invoice) = the file's rchrg for that invoice number.
 * Run: node tests/gstr1-rchrg-1129.test.cjs
 */
'use strict';
const assert = require('node:assert/strict');
const TL = require('../lib/tax-lines');
let pass = 0, fail = 0;
const test = (name, fn) => { try { fn(); pass++; console.log('   ok   ' + name); } catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + String(e.message).split('\n').slice(0, 6).join('\n          ')); } };
const BUYER = { Gstin: '33AAAAA0000A1Z5', LglNm: 'Tally Test', State: '33', Pos: '33', Country: 'IN', RegType: 'regular' };
const ME = { Gstin: '33BBBBB1111B1Z2', LglNm: 'Chennai Law', State: '33', Country: 'IN', RegType: 'regular' };
const row = (id, line) => ({ chit_id: id, doc_no: id, side: 'output', sells: true, direction: 'sent', purpose: 'invoice', provisional: false, at: '2026-10-05T05:00:00Z', seller: ME, buyer: BUYER,
  invoice: TL.invoiceFor({ lines: [line], seller: ME, buyer: BUYER, currency: 'INR', chit_id: id, at: '2026-10-05' }).invoice });
const rcm = row('LEG-1', { particulars: 'Legal opinion', quantity: 1, price: 1000, hsn: '9982', gst_rate: 18, rcm_category: 'legal' });
const tea = row('TEA-1', { particulars: 'Tea', quantity: 10, price: 100, hsn: '0902', gst_rate: 5 });
test('hand: the legal invoice is RegRev Y and the tea invoice RegRev N', () => assert.deepEqual([rcm.invoice.TranDtls.RegRev, tea.invoice.TranDtls.RegRev], ['Y', 'N']));
test('the GSTR-1 b2b file carries rchrg Y for LEG-1 and N for TEA-1 (the invoice\'s own word)', () => {
  const led = { rows: [rcm, tea], output: {}, itc: {}, net: {}, count: 2, skipped: [] };
  const out = TL.gstr1(led, ME, '102026');
  const invoices = [].concat(...out.b2b.map((party) => party.inv));
  assert.deepEqual(invoices.map((inv) => [inv.inum, inv.rchrg]).sort(), [['LEG-1', 'Y'], ['TEA-1', 'N']]);
});
console.log('\n' + (fail ? fail + ' FAILED, ' : '') + pass + ' passed');
process.exit(fail ? 1 : 0);
