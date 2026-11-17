'use strict';
/**
 * tests/r103-reverse-live-bill.realstack.cjs — R1-03 (DEC-267): REVERSE ON A LIVE BILL IS REFUSED (real Postgres, api as cb_app, RLS on). Scenario ids R103-AU / R103-AE
 * (web docs/16-finance/fable-risk1-scenarios.json): two live bills, the owner reverses one → before: 200, its sale left the return (1A/G1 and Box 1 fell to one bill);
 * now: 409 ENTRY_OF_LIVE_BILL, the books unchanged. The refusal sits at the route, so the bill's own cancel (PUT /void → books-hooks.takeBackCancelled) still reverses it.
 * Column 13 (it adds up): the return reads sales ledgers; a bill still live must stay in them until a credit note or a cancel takes it out. The route is country-blind; this run
 * is IN (hand figures below, the same shop as ACC-265); the AU / AE return boxes are read by the SIT business run (toolset/sitfull/biz-r1-box.sh, R103-AU / R103-AE).
 * Hand figures (IN): a credit sale 1 x 1,000.00 + 18% = 118000 minor (4000 Sales -100000 · 2200 CGST -9000 · 2201 SGST -9000 · 1300 Receivables +118000); two of them = double.
 *   RV-1 the owner reverses bill A's entry → 409 ENTRY_OF_LIVE_BILL, the trial balance still holds two bills (1300 +236000, 4000 -200000)
 *   RV-2 the day book says may_reverse false + why.code ENTRY_OF_LIVE_BILL on A, true on a credit note's entry
 *   RV-3 bill B is cancelled through its own door (PUT /void): 200, its entry is reversed (B nets 0: one bill left, 1300 +118000)
 *   RV-4 B's original entry is now reversed: a second Reverse answers ALREADY_REVERSED, not the live-bill refusal
 *   RV-5 a credit note against A (0.3 x 1,000.00 + 18% = 35400) stays reversible: its entry reverses with 200 (1300 back to +118000)
 * Run: node tests/r103-reverse-live-bill.realstack.cjs   (API_BASE / TRUTH_DB as tests/lib/truth-harness.cjs says; LOCAL OR A NAMED SIT BOX ONLY)
 * CARD 14-accounting (R1 slice C)
 */
const H = require('./lib/truth-harness.cjs');
const { API, j, ok, pause, kase, expect, bill, creditNote, freshShop, finish } = H;
const RUN = 'r103' + (Date.now() % 1e9).toString(36);
const piece = { id: undefined, name: 'Steel box ' + RUN, unit: 'piece', price: 1000, gst_rate: 18 };
const tax = require('../lib/tax');
const ON_CREDIT = [{ how: 'On credit', amount: 1180 }];
const gstinOf = (pan) => { const base = '33' + pan + '1Z'; return base + require('../lib/profile-map').gstinChecksum(base + '0').expected; };
const SHOP_GSTIN = gstinOf('AAKCK' + String(Date.now()).slice(-4) + 'F'), BUYER_GSTIN = gstinOf('AABFS4821K');
const invoiceOf = (qty) => tax.determine({ seller: { Gstin: SHOP_GSTIN, LglNm: 'Reverse live', TrdNm: 'Reverse live', Addr1: '', Ph: '', State: '33', Country: 'IN', RegType: 'regular' }, buyer: { LglNm: 'Murugan', Gstin: BUYER_GSTIN, State: '33', RegType: 'regular', Country: 'IN', Pos: '33' }, lines: [{ id: '1', name: 'Steel box', unit: 'piece', hsn: '7323', qty, unit_price: 1000, discount: 0, gst_rate: 18, cess_rate: 0 }], priceIncludesTax: false });
/** the shop's own day (this shop is IN: Asia/Kolkata), never the UTC day: between 18:30 and 24:00 UTC the shop's day is already tomorrow's and the books hold the entries under it (the test went red from 19:20 UTC on 17 Nov with the books read as at the UTC day) */
const shopToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const WORDS = 'This entry is a bill that is still live. Make a credit note instead.';
const send = (shop, body) => j('/api/chits/send', { method: 'POST', token: shop.token, body });
const idOf = (r) => r.b.chit_id || (r.b.chit && r.b.chit.chit_id);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function tb(token) {
  await pause(3500);
  const r = ok(await j('/api/books/trial-balance?asOf=' + shopToday(), { token }), 'trial balance').b;
  const out = {};
  (r.rows || []).forEach((row) => { const net = (row.dr_minor || 0) - (row.cr_minor || 0); if (net) out[row.code] = net; });
  return out;
}
const dayBook = async (token) => ok(await j('/api/books/daybook?from=' + shopToday() + '&to=' + shopToday(), { token }), 'day book').b.entries || [];
const entryOfChit = async (token, chitId, notType) => (await dayBook(token)).find((e) => String(e.source_chit_id) === String(chitId) && e.event_type !== 'reversal' && !e.reverses_entry_id && (!notType || e.event_type !== notType));
const reverse = (shop, entryId) => j('/api/books/entries/' + entryId + '/reverse', { method: 'POST', token: shop.token, body: { reason: 'owner pressed Reverse' } });

(async () => {
  console.log('\n── R1-03 reverse on a live bill · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  const S = await freshShop(RUN, 'Reverse live', { tax: { registered: true, number: SHOP_GSTIN, scheme: 'regular' } });
  ok(await j('/api/books/enable', { method: 'POST', token: S.token, body: { walkin_grain: 'bill' } }), 'books on');
  const made = ok(await j('/api/relationships/customers', { method: 'POST', token: S.token, body: { name: 'Murugan ' + RUN, phone: '98400' + String(Date.now()).slice(-5), gstin: BUYER_GSTIN } }), 'customer').b;
  const customer = { name: 'Murugan ' + RUN, identity_id: made.customer && made.customer.customer_identity_id, gstin: BUYER_GSTIN, phone: null };
  const saleOf = (no) => bill(no, [[piece, 1]], { invoice: invoiceOf(1), customer, parts: ON_CREDIT, slip: 'credit', terms: { due_date: '2099-12-01' } });
  const A = idOf(ok(await send(S, saleOf('A/' + RUN)), 'bill A')), B = idOf(ok(await send(S, saleOf('B/' + RUN)), 'bill B'));
  const two = await tb(S.token);
  let entryA, entryB, twoBills;
  await kase('RV-0', 'two live bills: the books hold both (hand: 1300 +236000, 4000 -200000, 2200/2201 -18000 each)', async () => {
    twoBills = { 1300: 236000, 4000: -200000, 2200: -18000, 2201: -18000 };
    expect(same(two, twoBills), 'books ' + JSON.stringify(two) + ' expected ' + JSON.stringify(twoBills) + ' · day book ' + (await dayBook(S.token)).length + ' entries');
    entryA = await entryOfChit(S.token, A); entryB = await entryOfChit(S.token, B);
    expect(entryA && entryB && entryA.event_type === 'sale_bill', 'the two bill entries were not found in the day book: ' + JSON.stringify([entryA && entryA.event_type, entryB && entryB.event_type]));
  });
  await kase('RV-1', 'Reverse on live bill A: 409 ENTRY_OF_LIVE_BILL with the sentence, the books unchanged (R103-AU / AE: two bills stay)', async () => {
    const r = await reverse(S, entryA.entry_id);
    expect(r.status === 409 && r.b.code === 'ENTRY_OF_LIVE_BILL' && String(r.b.detail || r.b.message) === WORDS, 'expected 409 ENTRY_OF_LIVE_BILL + the sentence, got ' + r.status + ' ' + JSON.stringify(r.b).slice(300, 1100) + ' · waiting ' + JSON.stringify((await j('/api/books/waiting', { token: S.token })).b).slice(0, 500));
    expect(same(await tb(S.token), twoBills), 'the books moved after a refused Reverse');
  });
  await kase('RV-2', 'the day book answers may/why: A may_reverse false + why.code, so the Reverse button is greyed with the server sentence', async () => {
    const e = await entryOfChit(S.token, A);
    expect(e.may_reverse === false && e.why && e.why.code === 'ENTRY_OF_LIVE_BILL' && e.why.words === WORDS, 'A: ' + JSON.stringify([e.may_reverse, e.why]));
  });
  await kase('RV-3', "bill B cancelled through its own door (PUT /void) still reverses: 200, then only A is left (hand: 1300 +118000, 4000 -100000)", async () => {
    const r = await j('/api/chits/' + B + '/void', { method: 'PUT', token: S.token, body: { reason: 'cancel B' } });
    expect(r.status === 200, 'the cancel path was refused: ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 240));
    const now = await tb(S.token);
    expect(same(now, { 1300: 118000, 4000: -100000, 2200: -9000, 2201: -9000 }), 'after the cancel the books are ' + JSON.stringify(now));
  });
  await kase('RV-4', "B's original entry is already reversed: a second Reverse answers ALREADY_REVERSED, not the live-bill refusal", async () => {
    const r = await reverse(S, entryB.entry_id);
    expect(r.status === 409 && r.b.code === 'ALREADY_REVERSED', 'expected 409 ALREADY_REVERSED, got ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 240));
  });
  await kase('RV-5', 'a credit note against A stays reversible (200); the day book says may_reverse true for it', async () => {
    const note = idOf(ok(await send(S, creditNote('CN/' + RUN, 'A/' + RUN, [[piece, 0.3]], { againstId: A, invoice: invoiceOf(0.3), parts: [], customer })), 'credit note'));
    await pause(3500);
    const e = await entryOfChit(S.token, note);
    expect(e && e.may_reverse === true && e.why === null, 'the note entry says ' + JSON.stringify(e && [e.event_type, e.may_reverse, e.why]));
    const r = await reverse(S, e.entry_id);
    expect(r.status === 200, 'the credit note could not be reversed: ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 240));
    expect((await tb(S.token))[1300] === 118000, 'after reversing the note the receivable is not back at 118000');
  });
  finish('r103');
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1); });
