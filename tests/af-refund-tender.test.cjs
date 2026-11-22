/**
 * af-refund-tender.test.cjs — AF-F-01 (walk AF, 1129): a refund goes back by the tender the bill was paid with. Walk AF-C01: a Card bill (2 Coffee 11.00 + 1 Mug 22.00 = 44.00 with GST 4.00)
 * refunded as CASH 22.00 was accepted: till/summary Cash -22.00, Card 44.00 unchanged — the drawer short, the card never repaid. Now (credit-cap.holdUnderLock, in the send's transaction):
 *   card bill, refund cash          → 409 REFUND_TENDER_MISMATCH in words, nothing written
 *   …with refund.override.reason, sent by a cashier (not a manager)   → refused the same (the seat decides, never the body)
 *   …with refund.override.reason, sent by the owner or a manager       → accepted, the override stays on the note
 *   …override with a blank reason, from a manager                      → refused (a reason is needed)
 *   card bill, refund card · cash bill, refund cash · mixed bill, refund by either part · credit-only refund · bill with no tender recorded → accepted, not judged
 * Run: node tests/af-refund-tender.test.cjs
 */
'use strict';
const cap = require('../lib/credit-cap');
const lock = require('../lib/xact-lock');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-aaaaaaaaaf01', BILL = 'b0000000-0000-4000-8000-000000000f01';
/** a stand-in client: the bill answers with its payment parts, no earlier notes, nothing withdrawn */
const clientFor = (parts) => ({ query: async (sql) => {
  if (sql === lock.LOCK_SQL) return { rows: [] };
  if (/ANY\(\$4::text\[\]\)/.test(sql)) return { rows: [{ chit_id: BILL, invoice_total: 44, money_total: null, legacy_total: null, refund_total: null, bill_no: 'C1/2026/0001', currency_code: 'AUD', till_id: 'C1', withdrawn: false, payment_parts: parts }] };
  if (/AS withdrawn FROM chit_header h WHERE/.test(sql)) return { rows: [{ withdrawn: false }] };
  if (/DISTINCT ON/.test(sql)) return { rows: [] };
  throw new Error('unexpected sql ' + sql.slice(0, 60));
} });
const note = (refundParts, extra) => Object.assign({ sender_id: SHOP, chit_id: 'c0000000-0000-4000-8000-000000000f01', purpose: 'credit_note', currency_code: 'AUD', is_draft: false,
  business_json: { till: { id: 'C1' }, against: { chit_id: BILL, bill_no: 'C1/2026/0001' }, refund: Object.assign({ total: 22, parts: refundParts }, extra && extra.refund), invoice: { ValDtls: { TotInvVal: 22 } } } }, extra && extra.state);
const verdict = (parts, state) => cap.holdUnderLock(clientFor(parts), state).then(() => 'ok', (e) => e.code + ':' + e.status + ':' + e.message);
const CARD = [{ how: 'Card', amount: 44 }], CASH = [{ how: 'Cash', amount: 44 }], MIXED = [{ how: 'Cash', amount: 20 }, { how: 'Card', amount: 24 }];
const CASH22 = [{ how: 'Cash', amount: 22 }], CARD22 = [{ how: 'Card', amount: 22 }];
(async () => {
  const refused = await verdict(CARD, note(CASH22));
  ok('AF-C01 · a card bill refunded as cash: 409 REFUND_TENDER_MISMATCH', /^REFUND_TENDER_MISMATCH:409:/.test(refused), refused);
  ok('…in words: names what the bill was paid by and where the refund must go', /paid by card.*back by card, not cash/.test(refused) && /manager/.test(refused), refused);
  const override = { refund: { override: { reason: 'Customer left the card at home, manager saw the receipt' } } };
  ok('…an override typed at a cashier seat is refused too (the seat decides)', /^REFUND_TENDER_MISMATCH/.test(await verdict(CARD, note(CASH22, { refund: override.refund, state: { seat_manager: false } }))));
  ok('…an override from the owner or a manager is accepted', (await verdict(CARD, note(CASH22, { refund: override.refund, state: { seat_manager: true } }))) === 'ok');
  ok('…a manager override with a blank reason is refused', /^REFUND_TENDER_MISMATCH/.test(await verdict(CARD, note(CASH22, { refund: { override: { reason: '  ' } }, state: { seat_manager: true } }))));
  ok('card bill, refund by card: accepted', (await verdict(CARD, note(CARD22))) === 'ok');
  ok('cash bill, refund cash: accepted', (await verdict(CASH, note(CASH22))) === 'ok');
  ok('mixed bill (cash + card), refund by the card part: accepted', (await verdict(MIXED, note(CARD22))) === 'ok');
  ok('card bill, credit-only refund (no money tender): not judged', (await verdict(CARD, note([{ how: 'Credit', amount: 22 }]))) === 'ok');
  ok('a bill with no tender recorded: not judged', (await verdict(null, note(CASH22))) === 'ok');
  console.log('\n  ' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + pass + ' passed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL ' + (e && e.stack || e)); process.exit(1); });
