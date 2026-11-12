/**
 * tests/ops83-match-money.test.cjs — OPS-83: GET /api/till/match compares what the door counted WITH tax against what they charge, through the one comparison
 * (lib/their-bill.check, FX-F10W2), on CARRIED figures: the receipts' input_tax (taxable + tax) and the invoice's stated total. Before: received qty x PO price (pre-tax)
 * minus the tax-in invoice total, a float `!==`: S7-4 (120 + 6 = 126) read "-6, differs".
 *
 * OWNS      every figure below is hand-computed (taxable + tax = the bill); the verdict and money_code come from the real route over a stubbed db, never a shortcut:
 *           agrees (exclusive 120+6, 220+11, tax 0, inclusive 100+5) · apart (126 vs 131) · round-off (126.40 is round_off; 127.40 is apart) · partial (lines open, gap shown) ·
 *           two bills keyed 63+63 · one bill keyed on two receipts counted once · another money (never converted) · a receipt with no carried tax (unknown, never 0: no
 *           input_tax, no tax, one of two) · invoice copies that carry different totals (unknown) · +0 on the wire · the cost-blind reader keeps the word and drops the figures ·
 *           the till-written order.from reaches the buyer's invoice copy (sendBillCopyFor) and the match attaches it (the one working invoice-to-order link, pinned: OPS-124).
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/till.js and routes/chits.js over a stubbed db.
 * FLOW      world (orders · receipts · invoices · shop money) → real route → orders[].received_with_tax / money_gap / money_code / verdict
 * CARD      12-suppliers-and-procurement/purchase-order-and-goods-receipt
 *
 * Run: node tests/ops83-match-money.test.cjs
 */
'use strict';
const path = require('path');
const express = require('express');
const http = require('http');

const API = path.join(__dirname, '..');
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(100) + (ok ? '' : JSON.stringify(got) + '   want ' + JSON.stringify(want)));
};
const E1 = 'e1', S = '33333333-3333-4333-8333-333333333333';
const U = (n) => '30000000-0000-4000-8000-' + String(n).padStart(12, '0');
const PO = U(1), LINE = U(101);
const order = (qty) => ({ head: { chit_id: PO, created_at: '2026-10-25T10:00:00Z', purpose: 'order', direction: 'sent', current_status: 'pending', sender_entity_id: E1, all_recipients: [{ entity_id: S }], counterparty_id: S, counterparty_name: 'Mill', summary_json: {}, entity_id: E1 },
  detail: { line_items: [{ line_id: LINE, particulars: 'Rice', quantity: qty, unit: 'kg', price: 10 }], business_json: { side: 'buy' } } });
/* a receipt the door wrote: against the order, carrying what it counted (input_tax) and the bill as keyed (their_bill) */
const receipt = (n, input_tax, their_bill) => ({ chit_id: U(n), created_at: '2026-10-25T12:00:00Z', line_items: [], business_json: Object.assign({ against: { chit_id: PO } }, input_tax === undefined ? {} : { input_tax }, their_bill ? { their_bill } : {}) });
const invoice = (n, summary, business) => ({ chit_id: U(n), created_at: '2026-10-26T10:00:00Z', sender_entity_id: S, summary_json: summary, business_json: Object.assign({ bill_no: 'INV-' + n, order: { from: PO } }, business || {}), line_items: [] });
const bill126 = (n) => invoice(n, { total_value: 126 });
let WORLD = order(12), RECEIPTS = [], INVOICES = [], RECEIVED = 12, SHOP = 'INR';

const mock = (rel, exports) => { require.cache[require.resolve(API + rel)] = { id: rel, filename: rel, loaded: true, exports }; };
mock('/middleware/auth', Object.assign((req, res, next) => { req.identity = { identity_id: E1, identity_type: 'entity' }; next(); }, {
  entityOf: () => E1, requireScope: () => (req, res, next) => next(), userOf: (req) => req.identity }));
const dbq = async (sql) => {
  const text = String(sql).replace(/\s+/g, ' ');
  if (/can_see_costs FROM identities/.test(text)) return { rows: [{ can_see_costs: true }] };
  if (/currency_code, country FROM identities/.test(text)) return { rows: [{ currency_code: SHOP, country: 'IN' }] };
  if (/h[.]purpose = 'receipt'/.test(text)) return { rows: RECEIPTS };
  if (/h[.]direction = 'received' AND h[.]purpose = 'invoice'/.test(text)) return { rows: INVOICES };
  if (/FROM chit_header h LEFT JOIN chit_detail d/.test(text)) return { rows: [Object.assign({ chit_id: PO }, WORLD.detail)] };
  return { rows: [] };
};
mock('/db', { query: dbq, withEntity: async (_id, fn) => fn({ query: dbq }), readBatch: async () => [] });
const get = (port, p) => new Promise((ok, bad) => http.get({ host: '127.0.0.1', port, path: p }, (res) => {
  let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => ok(JSON.parse(raw)));
}).on('error', bad));

(async () => {
  require(API + '/lib/select').rows = async () => [Object.assign({}, WORLD.head)];
  require(API + '/lib/policy').get = async () => ({});
  require(API + '/lib/deliverline').progress = async () => new Map([[LINE, { delivered: RECEIVED }]]);
  const app = express(); app.use('/api/till', require(API + '/routes/till'));
  const srv = app.listen(0), port = srv.address().port;
  const read = async () => (await get(port, '/api/till/match')).orders[0];
  /* world builder: ordered qty, received qty, receipts, invoices, the shop's money */
  const world = (qty, received, receipts, invoices, shop) => { WORLD = order(qty); RECEIVED = received; RECEIPTS = receipts; INVOICES = invoices; SHOP = shop || 'INR'; };
  const seen = (o) => [o.received_with_tax, o.money_gap, o.money_code, o.verdict];
  console.log('\n══ OPS-83 · the match compares tax-in with tax-in, through lib/their-bill ══\n');

  world(12, 12, [receipt(21, { taxable: 120, tax: 6 })], [bill126(31)]);
  let o = await read();
  t('1 S7-4: 12 x 10 = 120 + 5% 6 = 126 vs invoice 126: received_with_tax 126, gap 0 (not -6), agrees, agreed', seen(o), [126, 0, 'agrees', 'agreed']);
  t('1b the pre-tax figure keeps its key (informational): received_total 120', o.received_total, 120);

  world(22, 22, [receipt(21, { taxable: 220, tax: 11 })], [invoice(32, { total_value: 231 })]);
  o = await read();
  t('2 S7-6a family: 22 x 10 = 220 + 11 = 231 vs invoice 231: agrees, gap 0', seen(o), [231, 0, 'agrees', 'agreed']);

  world(10, 10, [receipt(21, { taxable: 100, tax: 0 })], [invoice(33, { total_value: 100 })]);
  o = await read();
  t('3 tax 0: 100 + 0 vs 100: agrees', seen(o), [100, 0, 'agrees', 'agreed']);

  world(10, 10, [receipt(21, { taxable: 100, tax: 5, inclusive: true })], [invoice(34, { total_value: 105 })]);
  o = await read();
  t('4 inclusive pricing, split carried: 100 + 5 vs 105: agrees (nothing re-derived here)', seen(o), [105, 0, 'agrees', 'agreed']);

  world(12, 12, [receipt(21, { taxable: 120, tax: 6 })], [invoice(35, { total_value: 131 })]);
  o = await read();
  t('5 genuinely apart: ours 126, invoice 131: gap -5, apart, differs (the fix did not just mute the check)', seen(o), [126, -5, 'apart', 'differs']);

  world(12, 12, [receipt(21, { taxable: 120, tax: 6 })], [invoice(36, { total_value: 126.4 })]);
  o = await read();
  t('6a round-off: ours 126.00 vs 126.40 (INR unit 1): gap -0.4, round_off, agreed', seen(o), [126, -0.4, 'round_off', 'agreed']);
  world(12, 12, [receipt(21, { taxable: 120, tax: 6 })], [invoice(37, { total_value: 127.4 })]);
  o = await read();
  t('6b 127.40 is 140 minor units, over one INR unit (100): gap -1.4, apart, differs', seen(o), [126, -1.4, 'apart', 'differs']);

  world(12, 6, [receipt(21, { taxable: 60, tax: 3 })], [bill126(38)]);
  o = await read();
  t('7 partial: 6 of 12 received (60 + 3 = 63) vs the whole bill 126: gap -63 carried, the verdict is the short line (differs), the line says short', [...seen(o), o.lines[0].state], [63, -63, 'apart', 'differs', 'short']);

  world(12, 12, [receipt(21, { taxable: 60, tax: 3 }, { no: 'A-1', total: 63 }), receipt(22, { taxable: 60, tax: 3 }, { no: 'A-2', total: 63 })], []);
  o = await read();
  t('8a two receipts, two bills keyed 63 + 63 (A-1, A-2) vs 60+3 twice: 126 both sides, agrees', [o.invoiced_total, ...seen(o)], [126, 126, 0, 'agrees', 'agreed']);
  world(12, 12, [receipt(21, { taxable: 60, tax: 3 }, { no: 'A-1', total: 126 }), receipt(22, { taxable: 60, tax: 3 }, { no: 'A-1', total: 126 })], []);
  o = await read();
  t('8b ONE bill A-1 for 126 keyed on both receipts is one bill: invoiced 126 (not 252), gap 0, agrees', [o.invoiced_total, ...seen(o)], [126, 126, 0, 'agrees', 'agreed']);

  world(12, 12, [receipt(21, { taxable: 120, tax: 6 })], [invoice(39, { total_value: 126, currency_code: 'AED' })], 'INR');
  o = await read();
  t('9a their invoice is in AED, the shop is INR: no gap, currency_mismatch, differs (never converted, never agreed)', seen(o), [126, null, 'currency_mismatch', 'differs']);
  world(12, 12, [receipt(21, { taxable: 120, tax: 6 })], [invoice(40, { total_value: 126, currency_code: 'inr' })], 'INR');
  o = await read();
  t('9b the same money in another case (inr = INR) compares: agrees', seen(o), [126, 0, 'agrees', 'agreed']);

  world(12, 12, [receipt(21, undefined)], [bill126(41)]);
  o = await read();
  t('10a a receipt with no input_tax: unknown, never 0 (not "apart"): no figure, no gap, no_tax_figure, verdict by the lines', seen(o), [null, null, 'no_tax_figure', 'agreed']);
  world(12, 12, [receipt(21, { taxable: 120 })], [bill126(42)]);
  o = await read();
  t('10b taxable carried but tax absent: unknown too (check would read tax as 0 and say 6 apart)', seen(o), [null, null, 'no_tax_figure', 'agreed']);
  world(12, 12, [receipt(21, { taxable: 120, tax: 6 }), receipt(22, null)], [bill126(43)]);
  o = await read();
  t('10c one of two receipts carries no figure: the sum is unknown', seen(o), [null, null, 'no_tax_figure', 'agreed']);

  /* ACC-206: a STAMPED invoice whose copies differ (TotInvVal 130, money.total 126) is counter-bill.pickOf agree:false: no settled figure */
  const split = invoice(44, { money: { total: 126 }, stamps: { money: 'engine' } }, { invoice: { ValDtls: { TotInvVal: 130 } } });
  world(12, 12, [receipt(21, { taxable: 120, tax: 6 })], [split]);
  o = await read();
  t('13 invoice copies carry different totals (130 vs 126): the figure is unknown, no gap, no_total', [o.invoiced_total, o.money_gap, o.money_code, o.verdict, o.invoiced_from], [null, null, 'no_total', 'agreed', 'the copies of their invoice carry different totals']);

  world(12, 12, [receipt(21, { taxable: 120, tax: 6 })], [bill126(45)]);
  o = await read();
  const exact = require(API + '/routes/till').matchMoney({ total: 126, currency: null }, [{ input_tax: { taxable: 120, tax: 6 } }], 'INR');
  t('14 an agreed gap is +0, never -0 (JSON hides the sign, so the function answer is read with Object.is)', [Object.is(exact.gap, 0), exact.code], [true, 'agrees']);
  const out = require(API + '/lib/cost-view').hideMatchCosts(o, 'buy');
  t('15 the cost-blind reader keeps the word and loses every figure: code agrees, no gap, no received_with_tax, no invoiced_total, cost_hidden', [out.money_code, out.verdict, 'money_gap' in out, 'received_with_tax' in out, 'invoiced_total' in out, out.cost_hidden], ['agrees', 'agreed', false, false, false, true]);
  t('15b the owner reader keeps the figures', [o.received_with_tax, o.money_gap, o.money_code], [126, 0, 'agrees']);

  /* OPS-124 pin: the till writes order.from when a supplier bills a PO (web till.html: order: BILL_ORDER ? { type, table: null, kots: [], from: BILL_ORDER.chit_id }); the api carries it to
     the buyer's invoice copy (routes/chits.js sendBjFor → sendBillCopyFor), and the match attaches it. The one working invoice-to-order link must not rot. */
  const chits = require(API + '/routes/chits');
  const tillBody = { bill_no: 'C1/26-27/0041', client_ref: 'C1/26-27/0041', order: { type: 'purchase', table: null, kots: [], from: PO } };
  const copy = chits.sendBillCopyFor({ counterBill: true, is_draft: false, sender_id: S, sender_display_name: 'Mill', client_ref: 'C1/26-27/0041', business_json: tillBody, summary_json: { money: { total: 126 } } }, { kind: 'to', entity_id: E1 });
  t('16a the buyer copy of the supplier till bill is an invoice carrying order.from = the PO (client_ref withheld)', [copy.purpose, copy.business_json.order.from, 'client_ref' in copy.business_json, copy.business_json.counter_bill], ['invoice', PO, false, true]);
  world(12, 12, [receipt(21, { taxable: 120, tax: 6 })], [{ chit_id: U(50), created_at: '2026-10-26T10:00:00Z', sender_entity_id: S, summary_json: { money: { total: 126 } }, business_json: copy.business_json, line_items: [] }]);
  o = await read();
  t('16b the match attaches that very copy: invoiced_from "their invoice", 126, agrees', [o.invoiced_from, o.invoiced_total, o.money_code], ['their invoice', 126, 'agrees']);

  srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
