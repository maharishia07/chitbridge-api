/**
 * as-rcm-1129.test.cjs — AS-F-01 (walk AS, 22 Nov 2026): reverse charge from an UNREGISTERED supplier with NO state records its tax at the buyer's state.
 * Hand figures, rupees (walk AS-C01, the shop in state 33, the supplier unregistered, no GSTIN, no state):
 *   U1 GTA 1,000.00 at 5%        = 50.00 = CGST 25.00 + SGST 25.00, no ITC
 *   U2 GTA 1,050.00 at 5%        = 52.50 = CGST 26.25 + SGST 26.25, no ITC
 *   U3 legal 1,000.00 at 18%     = 180.00 = CGST 90.00 + SGST 90.00, ITC yes
 * The supplier's bill stays flat (the supplier charged none). A REGISTERED supplier with no state is not guessed.
 * NEEDS the engines tax change adopted (engines fix/as-engines-1129 src/tax.js: the recipient's state is the place of supply); red on the parent and until the engines tag is adopted.
 * ⛔ HELD FOR ATHI (critic 1129, AS-F-01): the engines change is a TAX RULE (place of supply of an RCM supply from an unregistered supplier with no state) with no Athi yes and no IGST s.10/12 citation, so it stays on
 * engines fix/as-engines-1129 and the api side does not depend on it. This file exits 0 saying HELD until Athi decides; set AS_RCM_RUN=1 to run the cases (red until the engines tag is adopted).
 * Run: node tests/as-rcm-1129.test.cjs   (AS_RCM_RUN=1 to run the held cases)
 */
'use strict';
if (!process.env.AS_RCM_RUN) {
  console.log('HELD (AS-F-01): the engines place-of-supply change waits for Athi; the cases are not run. AS_RCM_RUN=1 runs the cases.');
  /* the one check a held run makes: this file still carries the hold, so it cannot be mistaken for a green run of the cases (guards read the last "<n> checks" line) */
  require('assert').ok(/HELD FOR ATHI/.test(require('fs').readFileSync(__filename, 'utf8')));
  console.log('1 checks (the hold is in force; the cases did not run)');
  process.exit(0);
}
const TL = require('../lib/tax-lines');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const BUYER = { Gstin: '33AAAAA0000A1Z5', LglNm: 'Tally Test', State: '33', Pos: '33', Country: 'IN', RegType: 'regular' };
const UNREG = { LglNm: 'Walk-in Supplier', Country: 'IN', RegType: 'unregistered' };
const bill = (line, seller) => TL.invoiceFor({ lines: [line], seller: seller || UNREG, buyer: BUYER, currency: 'INR', chit_id: 'as', rcmFlag: true });
const heads = (answer) => { const item = answer.invoice.ItemList[0]; return [answer.invoice.TranDtls.RegRev, item.RcmCgstAmt, item.RcmSgstAmt, item.RcmIgstAmt, item.RcmItc, answer.invoice.ValDtls.TotInvVal]; };

console.log('\n== AS-F-01 · RCM from an unregistered supplier with no state ==\n');
eq('U1 GTA 1,000.00 @5: RegRev Y, CGST 25 + SGST 25 in the RCM heads, no ITC, bill 1,000 flat', heads(bill({ particulars: 'Freight', quantity: 1, price: 1000, hsn: '996511', gst_rate: 5, rcm_category: 'gta' })), ['Y', 25, 25, 0, false, 1000]);
eq('U2 GTA 1,050.00 @5: 26.25 + 26.25', heads(bill({ particulars: 'Freight', quantity: 1, price: 1050, hsn: '996511', gst_rate: 5, rcm_category: 'gta' })), ['Y', 26.25, 26.25, 0, false, 1050]);
eq('U3 legal 1,000.00 @18: 90 + 90, ITC yes', heads(bill({ particulars: 'Legal', quantity: 1, price: 1000, hsn: '9982', gst_rate: 18, rcm_category: 'legal' })), ['Y', 90, 90, 0, true, 1000]);
const answer = bill({ particulars: 'Legal', quantity: 1, price: 1000, hsn: '9982', gst_rate: 18, rcm_category: 'legal' });
ok('the invoice says in words that the buyer state was the place of supply', (answer.invoice._cb.notes || []).some((note) => /recipient's own state/.test(note)), JSON.stringify(answer.invoice._cb.notes));
eq('a REGISTERED supplier with no state is not guessed: no tax is recorded', heads(bill({ particulars: 'Legal', quantity: 1, price: 1000, hsn: '9982', gst_rate: 18, rcm_category: 'legal' }, { Gstin: '33BBBBB1111B1Z2', LglNm: 'Reg Advocate', Country: 'IN', RegType: 'regular' })).slice(1, 4), [0, 0, 0]);
console.log('\n' + (fail ? 'FAILED ' + fail : 'all ok') + ' (' + pass + ' passed)');
process.exit(fail ? 1 : 0);
