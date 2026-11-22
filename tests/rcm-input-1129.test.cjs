/**
 * rcm-input-1129.test.cjs — AQ-F-01 (walk AQ, 22 Nov 2026): ONE resolver says "this line is reverse charge" (lib/rcm-lines).
 * The words the shop can use: the line's `rcm_category`; `reverse_charge: true` on the line or the bill (with the pack's HSN list); HSN alone only ASKS; an input it cannot read is REFUSED.
 * Hand figures, rupees: a legal opinion 1 x 1,000.00 at 18% from a registered advocate to a registered shop.
 *   reverse charge: the buyer owes CGST 90.00 + SGST 90.00 in the RCM heads, the supplier's bill is 1,000.00 flat, RegRev Y.
 *   forward charge: the supplier charges CGST 90.00 + SGST 90.00, bill 1,180.00, RegRev N.
 * Run: node tests/rcm-input-1129.test.cjs
 */
'use strict';
const TL = require('../lib/tax-lines');
const RL = require('../lib/rcm-lines');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const BUYER = { Gstin: '33AAAAA0000A1Z5', LglNm: 'Tally Test', State: '33', Pos: '33', Country: 'IN', RegType: 'regular' };
const ADVOCATE = { Gstin: '33BBBBB1111B1Z2', LglNm: 'Chennai Law', State: '33', Country: 'IN', RegType: 'regular' };
const legal = (extra) => Object.assign({ particulars: 'Legal opinion', quantity: 1, price: 1000, hsn: '9982', gst_rate: 18 }, extra || {});
const tea = { particulars: 'Tea', quantity: 1, price: 100, hsn: '0902', gst_rate: 5 };
const bill = (lines, flag, seller) => TL.invoiceFor({ lines, seller: seller || ADVOCATE, buyer: BUYER, currency: 'INR', chit_id: 'aq', rcmFlag: flag });
const shape = (answer) => { const item = answer.invoice.ItemList[0]; return [answer.invoice.TranDtls.RegRev, item.RcmCd || null, item.RcmCgstAmt || 0, item.CgstAmt, answer.invoice.ValDtls.TotInvVal]; };

console.log('\n== AQ-F-01 · one resolver for "this line is reverse charge" ==\n');
eq('the line NAMES its category: reverse charge (as before)', shape(bill([legal({ rcm_category: 'legal' })])), ['Y', 'legal', 90, 0, 1000]);
eq('the line SAYS reverse_charge:true and its HSN 9982 is on the list: reverse charge, category legal', shape(bill([legal({ reverse_charge: true })])), ['Y', 'legal', 90, 0, 1000]);
eq('the BILL says reverse_charge:true (business_json or the body): the same', shape(bill([legal()], true)), ['Y', 'legal', 90, 0, 1000]);
const alone = bill([legal()]);
eq('HSN alone is NOT switched on: forward charge (CGST 90 charged, bill 1,180)', shape(alone), ['N', null, 0, 90, 1180]);
ok('...but it ASKS: a note names the line, the list entry and both answers', alone.invoice._cb.notes.some((note) => /Line 1: HSN 9982 is on the reverse-charge list/.test(note) && /reverse_charge: true/.test(note) && /reverse_charge: false/.test(note)), JSON.stringify(alone.invoice._cb.notes));
const optedOut = bill([legal({ reverse_charge: false })]);
eq('reverse_charge:false = forward charge on purpose (a GTA that opted for it): forward, and no question asked', [shape(optedOut), (optedOut.invoice._cb.notes || []).some((note) => /reverse-charge list/.test(note))], [['N', null, 0, 90, 1180], false]);
eq('a line with no HSN on the list and no word is untouched and silent', [shape(bill([tea]))[0], (bill([tea]).invoice._cb.notes || []).some((note) => /reverse-charge list/.test(note))], ['N', false]);
const mixed = bill([legal(), tea], true);
eq('the bill-wide word marks only the lines the list has: legal is reverse charge, tea stays forward (CGST 2.50), no refusal', [mixed.invoice.ItemList.map((item) => item.RcmCd || null), mixed.invoice.ItemList[1].CgstAmt, mixed.rcm_refusals], [['legal', null], 2.5, []]);

console.log('\n== an input it cannot read is refused in words, never ignored ==\n');
const reasons = (answer) => answer.rcm_refusals.map((item) => item.code);
eq('reverse_charge:"yes" (not a boolean) on the line', reasons(bill([legal({ reverse_charge: 'yes' })])), ['rcm_flag_unreadable']);
eq('a bill-wide word that is not a boolean', reasons(bill([legal()], 1)), ['rcm_flag_unreadable']);
eq('a category the pack does not have', reasons(bill([legal({ rcm_category: 'lawyers' })])), ['rcm_category_unknown']);
eq('the line says reverse charge but its HSN is on no list (tea 0902)', reasons(bill([tea].map((line) => Object.assign({}, line, { reverse_charge: true })))), ['rcm_no_category']);
eq('the bill says reverse charge and NO line is on the list', reasons(bill([tea], true)), ['rcm_no_category']);
eq('a category AND reverse_charge:false on one line: say one', reasons(bill([legal({ rcm_category: 'legal', reverse_charge: false })])), ['rcm_flag_conflict']);
const AU_SHOP = { Gstin: '', LglNm: 'Sydney Law', State: '', Country: 'AU', RegType: 'regular', Abn: '51824753556' };
eq('a country whose pack has no reverse-charge list (AU) is told so, not ignored', reasons(TL.invoiceFor({ lines: [legal({ reverse_charge: true })], seller: AU_SHOP, buyer: Object.assign({}, BUYER, { Country: 'AU' }), currency: 'AUD', rcmFlag: undefined })), ['rcm_not_in_pack']);
let thrown = null;
try { RL.refusalOf(bill([legal({ reverse_charge: 'yes' })]).rcm_refusals); } catch (e) { thrown = e; }
eq('the door throws a 422 refusal with a code and the words', [thrown && thrown.status, thrown && thrown.code, thrown && thrown.refused, thrown && /Line 1 \(Legal opinion\) has a reverse-charge answer that is not true or false\. Nothing was saved\./.test(thrown.message)], [422, 'RCM_INPUT_UNREADABLE', true, true]);
eq('no refusals: the door passes', (() => { try { RL.refusalOf(bill([legal({ rcm_category: 'legal' })]).rcm_refusals); return 'passed'; } catch (e) { return e.message; } })(), 'passed');

console.log('\n' + (fail ? fail + ' FAILED, ' : '') + pass + ' passed');
process.exit(fail ? 1 : 0);
