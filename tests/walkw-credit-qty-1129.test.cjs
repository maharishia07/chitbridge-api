/**
 * tests/walkw-credit-qty-1129.test.cjs — WALK W (AE, batch 1129) W-F-03: a credit note for more of a line than the bill invoiced is REFUSED in words (409 CREDIT_NOTE_OVER_BILL), counter and rail.
 * Walk figures: WKW-INV-1 had 4 Coffee 21.00, 1 already returned (WKW-CN-1); WKW-CN-2 asks 6 → refused, "only 3 can be credited". A note for 3 passes; a note that matches no bill line is not judged; a second
 * note for the last 3 after 3 came back is refused ("nothing is left"). The note's line says "returned" after the name; the bill's does not — the key drops that word.
 * Before the fix a rail note (no till) was never judged: 200 and 200, Purchase returns 14000 against Coffee purchases 8000, Input VAT flipped to a credit.
 * Run: node tests/walkw-credit-qty-1129.test.cjs
 */
'use strict';
const cap = require('../lib/credit-cap');
const Q = require('../lib/credit-qty');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const BILL = '11111111-1111-4111-8111-111111111111', CN1 = '22222222-2222-4222-8222-222222222222', SELLER = '33333333-3333-4333-8333-333333333333';
const billLines = [{ particulars: 'WKW Coffee 250g', quantity: 4, price: 21 }, { particulars: 'WKW Rice 5kg (exempt)', quantity: 1, price: 30 }];
const cn1Lines = [{ particulars: 'WKW Coffee 250g returned', quantity: 1, price: 21 }];
/** a client that answers the three reads in order: the bill, the earlier notes' headers, their lines; the lock statement answers nothing */
const client = (earlier) => ({
  query: async (sql) => {
    if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
    if (/FROM chit_header h LEFT JOIN chit_detail d/.test(sql)) return { rows: [{ chit_id: BILL, bill_no: 'WKW-INV-1', line_items: billLines }] };
    if (/SELECT DISTINCT ON/.test(sql)) return { rows: earlier.map((e) => ({ chit_id: e.id })) };
    if (/SELECT line_items FROM chit_detail/.test(sql)) return { rows: earlier.map((e) => ({ line_items: e.lines })) };
    throw new Error('unexpected read: ' + sql.slice(0, 60));
  }
});
const note = (quantity, extra) => Object.assign({ sender_id: SELLER, chit_id: 'c2', purpose: 'credit_note', is_draft: false, business_json: { bill_no: 'WKW-CN-2', against: { chit_id: BILL } }, line_items: [{ particulars: 'WKW Coffee 250g returned', quantity, price: 21 }] }, extra);
const refusal = async (c, state) => { try { await cap.holdUnderLock(c, state); return null; } catch (e) { return { code: e.code, status: e.status, text: e.message }; } };

(async () => {
  console.log('\n== WALK W · W-F-03 a credit note cannot take back more of a line than the bill invoiced ==\n');
  eq('pure: 6 against 4 with 1 already back → only 3 left, in words', Q.quantityRefusal(billLines, cn1Lines, note(6).line_items), 'The bill had 4 of WKW Coffee 250g and 1 already came back, so only 3 can be credited. This note credits 6.');
  eq('pure: 3 is exactly what is left → passes', Q.quantityRefusal(billLines, cn1Lines, note(3).line_items), null);
  eq('pure: a note line that matches no bill line is not judged', Q.quantityRefusal(billLines, [], [{ particulars: 'Something else', quantity: 99 }]), null);
  eq('pure: a product id beats the name', Q.quantityRefusal([{ product_id: 'P1', particulars: 'Tea', quantity: 2 }], [], [{ product_id: 'P1', particulars: 'Chai', quantity: 3 }]) !== null, true);
  const over = await refusal(client([{ id: CN1, lines: cn1Lines }]), note(6));
  eq('rail note 6 vs 4 (1 back): refused 409 CREDIT_NOTE_OVER_BILL, "only 3 can be credited"', [over && over.status, over && over.code, over && /only 3 can be credited/.test(over.text)], [409, 'CREDIT_NOTE_OVER_BILL', true]);
  eq('rail note 3 vs 4 (1 back): passes', await refusal(client([{ id: CN1, lines: cn1Lines }]), note(3)), null);
  const none = await refusal(client([{ id: CN1, lines: cn1Lines }, { id: 'x', lines: note(3).line_items }]), note(1));
  eq('the last 3 already came back: one more is refused, "nothing is left"', [none && none.code, none && /nothing is left to credit/.test(none.text)], ['CREDIT_NOTE_OVER_BILL', true]);
  eq('a draft is not judged', await refusal(client([]), note(60, { is_draft: true })), null);
  const unnamed = await refusal(client([]), note(60, { business_json: { bill_no: 'X' } }));
  eq('a note with no bill id is not judged on quantity: AI-F-02 refuses it 422 CREDIT_NOTE_NEEDS_BILL (a rail note names one of the sender\'s bills)', [unnamed && unnamed.code, unnamed && unnamed.status], ['CREDIT_NOTE_NEEDS_BILL', 422]);
  console.log('\n' + (fail ? '  FAIL ' + fail + ' failed' : '  ok ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL threw: ' + (e && e.stack)); process.exit(1); });
