/**
 * tests/acc-278-gstr3b-no-gstin.test.cjs — ACC-278: A GSTR-3B FOR A SHOP WITH NO (OR A SHORT) GSTIN IS REFUSED IN THE ENGINE'S OWN WORDS, NOT ANSWERED 200 WITH ZEROS.
 *
 * OWNS      the proof that lib/tax-lines gstr3b asks the SAME rule gstr1 asks (the engine's, gst-returns.js: "A return needs the shop GSTIN (15 characters)."),
 *           by calling the engine with no documents — no second regex, no second sentence — and that it puts the India-only refusal (ACC-254) first, as gstr1 does.
 *           Hand example (INR, paise): a sale of 3000.00 at 18% = 300000 taxable, 54000 tax (270.00 CGST + 270.00 SGST); a shop with a GSTIN files it, one without is refused.
 * CALLED BY scripts/guards.cjs · CI. No database.
 * Run: node tests/acc-278-gstr3b-no-gstin.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const T = require('../lib/tax-lines');

let pass = 0,
  fail = 0;
const check = (name, fn) => {
  try {
    fn();
    pass++;
    console.log('   ok   ' + name);
  } catch (e) {
    fail++;
    console.log('   FAIL ' + name + '\n          ' + String(e.message).split('\n')[0]);
  }
};

const GSTIN = '33AAAAA0000A1Z5';
const ledger = T.ledger(
  [{ chit_id: 'a', direction: 'sent', invoice: T.invoiceFor({ lines: [{ name: 'Brake pad', quantity: 1, price: 3000, gst_rate: 18, hsn: '8708' }], seller: { Country: 'IN', Gstin: GSTIN, State: '33' }, buyer: { Pos: '33' }, chit_id: 'a', at: '2026-09-04' }).invoice, provisional: false, seller: { Country: 'IN', entity_id: 'me' }, buyer: { entity_id: 'b' }, at: '2026-09-04' }],
  { RegType: 'regular' }
);
const GSTIN_WORDS = 'A return needs the shop GSTIN (15 characters).';

console.log('\n== ACC-278: GSTR-3B WITHOUT A GSTIN ==\n');
check('hand example: a shop WITH a GSTIN files 3000.00 taxable, 270.00 + 270.00 tax', () => {
  const out = T.gstr3b(ledger, { Country: 'IN', Gstin: GSTIN }, '092026');
  assert.equal(out.ok, undefined);
  assert.equal(out.gstin, GSTIN);
  assert.deepEqual([out.sup_details.osup_det.txval, out.sup_details.osup_det.camt, out.sup_details.osup_det.samt], [3000, 270, 270]);
});
check('an IN shop with NO GSTIN is refused in the engine\'s words, not answered with zeros', () => {
  const out = T.gstr3b(ledger, { Country: 'IN' }, '092026');
  assert.equal(out.ok, false);
  assert.equal(out.why, GSTIN_WORDS);
  assert.equal(out.sup_details, undefined);
});
check('a null party and a short GSTIN are refused the same way', () => {
  assert.equal(T.gstr3b(ledger, null, '092026').why, GSTIN_WORDS);
  assert.equal(T.gstr3b(ledger, { Country: 'IN', Gstin: '33S' }, '092026').why, GSTIN_WORDS);
  assert.equal(T.gstr3b(ledger, { Country: 'IN', Gstin: '' }, '092026').ok, false);
});
check('GSTR-3B and GSTR-1 refuse with the very same answer (one rule)', () => {
  [{ Country: 'IN' }, { Country: 'IN', Gstin: '33S' }].forEach((shop) => assert.deepEqual(T.gstr3b(ledger, shop, '092026'), T.gstr1(ledger, shop, '092026')));
});
check('a shop in another country is refused as India-only FIRST, naming its country (as gstr1 does), even with a 15-character id', () => {
  const shop = { Country: 'AE', Gstin: '100123456700003' };
  const out = T.gstr3b(ledger, shop, '092026');
  assert.equal(out.ok, false);
  assert.match(out.why, /GSTR returns are for shops registered for GST in India\. This shop is in /);
  assert.deepEqual(out, T.gstr1(ledger, shop, '092026'));
});
check('no second copy of the rule: tax-lines holds neither the sentence nor a 15-character regex', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'tax-lines.js'), 'utf8');
  assert.equal(source.indexOf('A return needs the shop GSTIN'), -1);
  assert.equal(/\{13\}/.test(source), false);
});
check('the parallel-run boxes refuse a refused return ("could not be read"), never read it as zero boxes', () => {
  const PR = require('../lib/parallel-run');
  assert.throws(() => PR.gstr3bBoxes(T.gstr3b(ledger, { Country: 'IN' }, '092026')), /GSTIN/);
  assert.equal(PR.gstr3bBoxes(T.gstr3b(ledger, { Country: 'IN', Gstin: GSTIN }, '092026')).boxes[0].amount_minor, 300000);
});

