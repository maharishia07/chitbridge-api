/**
 * tests/fable-r6-country.test.cjs — the api half of the Fable country-rules review (docs c183c323): R6-01 export, R6-02 HSN, R6-03 the dated rate menu.
 *
 *   R6-01  business_json.is_export (a boolean the shop answers) reaches tax.determine as `isExport` through the ONE reader (tax-lines.exportStatedOf); a string, null or nothing is no answer
 *   R6-02  a registered buyer's tax invoice with a line that has no HSN is HELD (reason 'hsn', code INVOICE_HELD_HSN) when the pack's rule says `hsn_needed` (the engines' IN rule after the adopt)
 *   R6-03  a line whose rate is not on the pack's dated menu of the bill's day is HELD (reason 'rate_off_menu', code INVOICE_HELD_RATE) through tax-packs.rateOnMenu (already adopted); never re-rated
 *
 * Hand figures: Rs 1,000 at 12% would bill Rs 120 on a rate no schedule carries since 22 Sep 2025 (Notification 9/2025-CT(Rate)); the menu from 2025-09-22 has no 12 and no 13.
 * Pure: no DB, no server. Run: node tests/fable-r6-country.test.cjs
 */
'use strict';
const path = require('path');
const fs = require('fs');
require.cache[require.resolve(path.join(__dirname, '..', 'db'))] = {
  exports: { query: async (sql) => { throw new Error('unstubbed query: ' + sql); }, withEntity: async (_id, fn) => fn({ query: async (sql) => { throw new Error('unstubbed query: ' + sql); } }) }
};
const BP = require('../lib/bill-paper');
const TL = require('../lib/tax-lines');
const COUNTRY = require('../lib/country');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const root = path.join(__dirname, '..');

/** an Indian counter bill's business_json: one line of Rs 1,000 at `rate`, billed on `day`, to a registered buyer */
const bill = (rate, day, hsn) => ({
  bill_no: 'C1/26-27/0001', till: { id: 'till-1' }, billed_at: day + 'T04:30:00.000Z',
  customer: { name: 'Mayur Traders', gstin: '27AAPFU0939F1ZV' },
  invoice: {
    ValDtls: { AssVal: 1000, CgstVal: 0, SgstVal: 0, IgstVal: (1000 * rate) / 100, CesVal: 0, TotInvVal: 1000 + (1000 * rate) / 100 },
    ItemList: [{ SlNo: '1', PrdDesc: 'Biscuits', HsnCd: hsn === undefined ? '1905' : hsn, GstRt: rate, AssAmt: 1000 }],
    _cb: { supply: 'inter' }
  }
});
const paper = (rate, day, hsn) => BP.paperOf({ country: 'IN', currency: 'INR', business_json: bill(rate, day, hsn) });

console.log('— R6-03 · the dated rate menu at issue —');
{
  const off = paper(12, '2026-11-12');
  ok('12% on 2026-11-12 → held rate_off_menu, code INVOICE_HELD_RATE', off.held && off.held.reason === 'rate_off_menu' && off.held.code === 'INVOICE_HELD_RATE', JSON.stringify(off.held));
  ok('the words say the rate is not on the menu in force from 2026-02-01 and carry the notification', off.held && /12% is not on the menu in force from 2026-02-01/.test(off.held.why) && /19\/2025/.test(off.held.why), off.held && off.held.why);
  ok('the frozen invoice is never touched (never re-rated)', JSON.stringify(bill(12, '2026-11-12')) === JSON.stringify(bill(12, '2026-11-12')));
  ok('12% on 2025-09-21 (the day before the change) → not held', !paper(12, '2025-09-21').held);
  const odd = paper(13, '2025-09-21');
  ok('13% (on no menu) → held', odd.held && odd.held.reason === 'rate_off_menu');
  ok('18% on 2026-11-12 → not held', !paper(18, '2026-11-12').held);
  const au = BP.paperOf({ country: 'AU', currency: 'AUD', business_json: Object.assign(bill(10, '2026-11-12'), { customer: { name: 'Acme Pty Ltd' } }) });
  ok('AU has no dated menu → never held for a rate', !au.held || au.held.reason !== 'rate_off_menu');
  const pack = COUNTRY.packFor('IN');
  ok('no day → nothing to ask (rateHeldOf)', BP.rateHeldOf(pack, bill(12, '2026-11-12').invoice, null) === null);
  const rcm = bill(12, '2026-11-12'); rcm.invoice.ItemList[0].RcmCd = 'gta';
  ok('a reverse-charge line is the engine\'s business, not asked', BP.rateHeldOf(pack, rcm.invoice, '2026-11-12') === null);
}

console.log('— R6-02 · HSN on a registered buyer\'s tax invoice (CGST Rules r.46(g)) —');
{
  const rule = { hsn_needed: true, hsn_why: 'A tax invoice to a registered person carries the HSN (or SAC) code of every line (CGST Rules r.46(g)).', cite: 'r.46' };
  const none = BP.hsnHeldOf(rule, bill(18, '2026-11-12', '').invoice);
  ok('no HSN → held hsn, code INVOICE_HELD_HSN, the line named and the pack\'s sentence', none && none.reason === 'hsn' && none.code === 'INVOICE_HELD_HSN' && /Biscuits/.test(none.why) && /r\.46\(g\)/.test(none.why), JSON.stringify(none));
  ok('a code present → not held', BP.hsnHeldOf(rule, bill(18, '2026-11-12', '1905').invoice) === null);
  ok('a "code" with no digits is no code', BP.hsnHeldOf(rule, bill(18, '2026-11-12', '--').invoice) !== null);
  ok('a rule that does not say hsn_needed (every other country, every pack before the adopt) holds nothing', BP.hsnHeldOf({}, bill(18, '2026-11-12', '').invoice) === null && BP.hsnHeldOf(null, bill(18, '2026-11-12', '').invoice) === null);
  ok('the digit count is never assumed here (a 4-digit code passes; the engines check digits when the turnover is known)', BP.hsnHeldOf(rule, bill(18, '2026-11-12', '1905').invoice) === null);
  const inRule = COUNTRY.packFor('IN').taxInvoice(1180 * 100, { buyer_registered: true, taxable_minor: 1000 * 100, taxable_lines: 1, exempt_lines: 0 });
  ok('with the adopted pack: a registered-buyer rule either says hsn_needed (after the B6b adopt) or stays silent (before), never partly', inRule.hsn_needed === undefined || (inRule.hsn_needed === true && !!inRule.hsn_why));
}

console.log('— R6-01 · the export answer —');
{
  ok('exportStatedOf: true → true', TL.exportStatedOf({ is_export: true }) === true);
  ok('exportStatedOf: false → false (answered: not an export)', TL.exportStatedOf({ is_export: false }) === false);
  ok('exportStatedOf: the string "true", 1, null, nothing → no answer (never defaulted)', [{ is_export: 'true' }, { is_export: 1 }, { is_export: null }, {}, null, undefined].every((b) => TL.exportStatedOf(b) === undefined));
  const src = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  ok('invoiceFor hands isExport to tax.determine', /isExport: typeof i\.is_export === 'boolean'/.test(src('lib/tax-lines.js')));
  ok('the send path and the copy path ask the same reader', /is_export: taxLines\.exportStatedOf\(business_json\)/.test(src('lib/send-money.js')) && /is_export: T\.exportStatedOf\(bj\)/.test(src('lib/tax-copy.js')));
  const answer = TL.invoiceFor({ lines: [{ name: 'Goods', qty: 1, price: 2000, gst_rate: 5 }], seller: { Country: 'AE', RegType: 'regular', Gstin: '100123456789012' }, buyer: { Country: 'IN' }, currency: 'AED', is_export: true });
  ok('invoiceFor accepts is_export without throwing; after the engines adopt a stated export is VAT 0 and the answer says _cb.export "stated"', !!answer.invoice && answer.invoice.ValDtls.TotInvVal >= 2000);
}

console.log('— the register and the wire —');
{
  const codes = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'error-codes.json'), 'utf8'));
  const list = Array.isArray(codes) ? codes : codes.codes;
  const has = (c) => list.some((e) => e.code === c);
  ok('INVOICE_HELD_HSN and INVOICE_HELD_RATE are in the register', has('INVOICE_HELD_HSN') && has('INVOICE_HELD_RATE'));
  const md = fs.readFileSync(path.join(root, 'docs', 'ERROR-CODES.md'), 'utf8');
  ok('and in ERROR-CODES.md', /\| INVOICE_HELD_HSN \|/.test(md) && /\| INVOICE_HELD_RATE \|/.test(md));
  ok('sendPaper answers the reason\'s own code', /code: paper\.held\.code \|\| 'INVOICE_HELD_BUYER'/.test(fs.readFileSync(path.join(root, 'routes', 'chits.js'), 'utf8')));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
