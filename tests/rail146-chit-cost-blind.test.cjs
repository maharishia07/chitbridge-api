/**
 * tests/rail146-chit-cost-blind.test.cjs — RAIL-146: the shop's cost never reaches a cost-blind co-assist through the chit reads.
 *
 * OWNS      the proof, per read (GET /api/chits/:chit_id · /inbox · /folder · /sent · /rollup), that an actor without can_see_costs sees no cost-named key at any
 *           depth and, on a chit the shop BUYS on, no price, total or header money; that a SALES chit stays priced for him; that an order with no declared side
 *           hides when its counterparty is a supplier or unknown and keeps its price when it is a customer; that his OWN `add` amount stays; and that the owner and
 *           a cost-allowed actor read byte-identical answers (the rows behind them untouched).
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/chits.js over a stand-in db and auth.
 * FLOW      world (who · the rows each statement gets) → real route → body → no SECRET value, no cost key, cost_hidden where it applies, the rest equal to the owner's
 * CARD      01-rail-core-the-chit/chits-routes
 *
 * Run: node tests/rail146-chit-cost-blind.test.cjs
 */
'use strict';
const path = require('path');
const express = require('express');
const http = require('http');
const API = path.join(__dirname, '..');
process.env.OUTPUT_ALLOWLIST = 'report'; /* the sweep test (api-problem-chits) runs the allow-list in enforce; here the answers must be what production sends */
let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(84) + (ok ? '' : JSON.stringify(got).slice(0, 300) + '   want ' + JSON.stringify(want).slice(0, 200)));
};
const SHOP = '11111111-1111-4111-8111-111111111111';
const CHIT = '22222222-2222-4222-8222-222222222222';
const SUPPLIER = '33333333-3333-4333-8333-333333333333';
const CUSTOMER = '55555555-5555-4555-8555-555555555555';
const STRANGER = '66666666-6666-4666-8666-666666666666';
const BLIND_ID = '44444444-4444-4444-8444-444444444444';
const GRANTED_ID = '77777777-7777-4777-8777-777777777777';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Owner', bridge_id: 'SHOP' };
const BLIND = { identity_id: BLIND_ID, identity_type: 'actor', access_level: 'editor', parent_entity_id: SHOP, hat: 'manager', display_name: 'Blind', bridge_id: 'SHOP' };
const GRANTED = Object.assign({}, BLIND, { identity_id: GRANTED_ID, display_name: 'Granted' });
const GRANTS = { [GRANTED_ID]: true };
const AT = '2026-10-01T10:00:00.000Z';
/* figures no other field could carry: the supplier's rate, the landed rate, the bill total, a payment */
const SECRET = { price: 4242.5, unit_cost: 4141.25, landed: 4040.75, total: 8485, money_total: 9999.5, invoice_total: 8888.25, their_total: 7777.75, add: 1212.5, other_add: 1313.5, gap: 1515.5, theirs: 5151.5, planted: 4747 };
const SECRETS = Object.values(SECRET).map((n) => String(n));

const call = (port, p, who) => new Promise((done) => {
  WHO = who;
  http.get({ host: '127.0.0.1', port, path: p }, (res) => { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { j = { raw }; } done({ status: res.statusCode, body: j, raw }); }); });
});
/** a cost-named key (lib/cost COST_KEYS, spelt here on purpose so the test does not trust the list it checks); cost_hidden is the marker, not a cost */
const COST_KEY = /^(?!cost_hidden$)(cost|unit_cost|landed_cost|landed|purchase_cost|last_cost)(_|$)/;
/** every cost-named key anywhere */
const costKeys = (v) => (v && typeof v === 'object' ? Object.keys(v).flatMap((k) => (COST_KEY.test(k) ? [k] : costKeys(v[k]))) : []);
/** the secret figures found as values anywhere in the raw body */
const leaked = (raw) => SECRETS.filter((s) => new RegExp('(^|[^0-9.])' + s.replace('.', '\\.') + '([^0-9]|$)').test(raw));
/** the owner's answer minus the cost-named keys at any depth (half i) */
const stripNamed = (v) => JSON.parse(JSON.stringify(v, (k, x) => (COST_KEY.test(k) ? undefined : x)));
/** a chit read minus its `actions`: the rail answers those by the reader's LEVEL (owner vs editor), so an actor's read differs there by design, never elsewhere */
const sansActions = (body) => JSON.stringify(Object.assign({}, body, { actions: undefined }));
/** the rail's actions minus the books' sentence (`say`), which a cost-side prune drops */
const sansSay = (actions) => JSON.parse(JSON.stringify(actions, (k, x) => (k === 'say' ? undefined : x)));
/** THE WHOLE-TEXT SCAN of a blind answer: no ₹ anywhere and none of the planted secret figures (but the ones a scene allows, e.g. the actor's own add or a sale's) */
const noLeak = (label, raw, allowed) => t(label + ' | whole-text scan: no ₹, no secret figure anywhere in the body', [/₹/.test(raw), leaked(raw).filter((s) => !(allowed || []).includes(s))], [false, []]);
/** the top-level keys two bodies differ on (a failure's own words) */
const differing = (left, right) => Array.from(new Set(Object.keys(left || {}).concat(Object.keys(right || {})))).filter((k) => JSON.stringify(left[k]) !== JSON.stringify(right[k]));

/* ── the copies ──────────────────────────────────────────────────────────────────────────────────────────────── */
const LINES = [
  { line_id: CHIT, particulars: 'Basmati rice 1kg', quantity: 10, unit: 'kg', price: SECRET.price, total: SECRET.total, gst_rate: 5, cgst: 2.5, sgst: 2.5, mrp: 4343.5, unit_price: SECRET.price, item_data: { unit_cost: SECRET.unit_cost, landed: SECRET.landed, lot: 'L1' } },
  { line_id: SUPPLIER, particulars: 'Toor dal 1kg', quantity: 5, unit: 'kg', price: 12, gst_rate: 5 }
];
const SUMMARY = { line_item_count: 2, total_value: SECRET.total, currency_code: 'INR', money: { gross: SECRET.money_total, net: SECRET.money_total, total: SECRET.money_total }, purpose: 'order' };
const header = (over) => Object.assign({ chit_id: CHIT, entity_id: SHOP, direction: 'received', role: 'Received', purpose: 'order', sender_entity_id: SUPPLIER, sender_entity_display_name: 'Mill', all_recipients: [{ entity_id: SUPPLIER, display_name: 'Mill' }, { entity_id: SHOP, display_name: 'Shop' }], summary_json: SUMMARY, business_json: null, created_by_actor_id: null, created_at: AT, schema_version: 2 }, over);
const DETAIL = { detail_type: 'order', line_item_count: 2, total_value: String(SECRET.total), currency_code: 'INR', line_items: LINES, payload_delivered_at: AT, payload_deleted_at: null };
const LINE_ROW = (l, seq) => ({ line_id: l.line_id, seq, particulars: l.particulars, quantity: String(l.quantity), unit: l.unit, unit_size: null, price: l.price == null ? null : String(l.price), comment: null, asked_as: null, asked_unit: null, raw_phrase: null, removed: false, removed_reason: null, needs_human: false, flags: null });
const DELIVERY = (id, actor, amount) => ({ line_id: CHIT, particulars: 'Basmati rice 1kg', ordered_unit: 'kg', ordered: '10', removed: false, delivery_id: id, dq: '1', du: 'piece', reference: null, note: null, recorded_by_entity_id: SHOP, recorded_by_name: 'Shop', recorded_by_actor_name: actor === BLIND_ID ? 'Blind' : 'Other', recorded_by_actor_id: actor, delivered_at: AT, dkind: 'add', damount: String(amount), dparticulars: 'Gunny bag' });
const bundle = (deliveries) => ({ participants: [{ entity_id: SHOP, current_status: 'pending', read_at: null, display_name: 'Shop', bridge_id: 'SHOP' }], amendments: [], lines: LINES.map(LINE_ROW), assignments: [], deliveries, my_received: 'pending', books_wait: SCENE.books_wait || null, order_billed: false });
/** a bill received from the supplier: Bills · Received (docOf), the frozen invoice and their bill on the header */
const BILL = header({ purpose: 'invoice', business_json: { invoice: { total: SECRET.invoice_total, lines: [{ price: SECRET.price }] }, their_bill: { no: 'INV-7', total: SECRET.their_total } } });
/** the counter's goods receipt, sent to self */
const RECEIPT = header({ purpose: 'receipt', direction: 'received', sender_entity_id: SHOP, all_recipients: [{ entity_id: SHOP, display_name: 'Shop', self: true }], business_json: { costs: { transport: 100 }, landed_total: SECRET.landed, goods: SECRET.total } });
/** a customer's order to me: a SALE */
const SALE = header({ sender_entity_id: CUSTOMER, sender_entity_display_name: 'Ravi', all_recipients: [{ entity_id: CUSTOMER, display_name: 'Ravi' }, { entity_id: SHOP, display_name: 'Shop' }] });
/** my own order SENT, no declared side: the counterparty's list decides */
const sentTo = (party) => header({ direction: 'sent', role: 'Sent', sender_entity_id: SHOP, all_recipients: [{ entity_id: SHOP, display_name: 'Shop' }, { entity_id: party, display_name: 'Party' }] });

/* ── the stand-in db ─────────────────────────────────────────────────────────────────────────────────────────── */
let WHO = OWNER, SCENE = {}, LAST_LIST_SQL = '';
const UUID = /[0-9a-f-]{36}/g;
const rolesOf = (ids) => ids.map((id) => ({ id, customer: id === CUSTOMER, supplier: id === SUPPLIER }));
function handle(sql, params) {
  const s = String(sql);
  if (/can_see_costs FROM identities/.test(s)) return { rows: [{ can_see_costs: !!GRANTS[params[0]] }] };
  if (/FROM unnest\(\$2::uuid\[\]\)/.test(s)) return { rows: rolesOf(params[1]) };
  if (/SELECT \* FROM chit_header/.test(s)) return { rows: SCENE.header ? [SCENE.header] : [] };
  if (/FROM chit_detail/.test(s)) return { rows: SCENE.header ? [SCENE.detail || DETAIL] : [] };
  if (/AS participants,/.test(s)) {
    if (SCENE.fallback) throw Object.assign(new Error('relation "chit_line_assignment" does not exist'), { code: '42P01' }); /* the one-shot fails: the route takes its per-read path */
    return { rows: [bundle(SCENE.deliveries || [])] };
  }
  if (/FROM chit_header ch\s+JOIN chit_status cs|FROM chit_status cs\s+JOIN chit_header ch/.test(s) && /LIMIT \$/.test(s)) LAST_LIST_SQL = s;
  if (/LEFT JOIN chit_line_delivery d/.test(s)) return { rows: SCENE.deliveries || [] }; /* the bill's own delivery picture (lib/bill-privacy path) */
  if (/COUNT\(\*\)::int AS chits/.test(s)) return { rows: SCENE.groups || [] }; /* the rollup statement, with or without the blind actor's members column */
  if (/SELECT ch\.chit_id, ch\.all_recipients/.test(s) || /SELECT DISTINCT ON/.test(s) || /SELECT\s+ch\.chit_id,/.test(s)) return { rows: SCENE.rows || [] };
  if (/SELECT COUNT\(/i.test(s)) return { rows: [{ count: '1' }] };
  if (/information_schema/.test(s)) return { rows: [{ '?column?': 1 }] };
  return { rows: [] };
}
/** a list row as the three statements select it (the S34 columns plus the two RAIL-146 side columns) */
const listRow = (h) => ({ chit_id: h.chit_id, sender_entity_display_name: h.sender_entity_display_name, sender_entity_bridge_id: 'X', all_recipients: h.all_recipients, purpose: h.purpose, auto_subject: 'Order', manual_subject: null, summary_json: h.summary_json, created_at: AT, role: h.role, current_status: 'pending', read_at: null, star_flag: false, priority_flag: null, deleted_at: null, archived_at: null, direction: h.direction, customer_priority: false, open_dispute_count: '0', resolved_dispute_count: '0', message_count: '0', _after: null, _sender: h.sender_entity_id, _bj: h.business_json || {} });

/* ── the lib on its own: one case per rule of lib/cost-view.js ──────────────────────────────────────────────── */
function unitCases() {
  const view = require(API + '/lib/cost-view');
  console.log('   lib/cost-view · costSideOf, one case per kind');
  const SUP = { customer: false, supplier: true }, CUS = { customer: true, supplier: false }, BOTH = { customer: true, supplier: true };
  const cases = [
    ['a bill received (invoice from another)', BILL, null, 'buy'],
    ['a counter bill I issued (bill_no + till, sent by me)', header({ sender_entity_id: SHOP, business_json: { bill_no: 'B-1', till: { id: 't1' } } }), null, 'sell'],
    ['the counter\'s goods receipt (sent to self)', RECEIPT, null, 'buy'],
    ['a receipt carrying their bill (their_bill no + total)', header({ purpose: 'receipt', sender_entity_id: SHOP, business_json: { their_bill: { no: 'X', total: 5 } } }), null, 'buy'],
    ['a credit note I received (purchase return)', header({ purpose: 'credit_note' }), null, 'buy'],
    ['a credit note I issued', header({ purpose: 'credit_note', sender_entity_id: SHOP }), null, 'sell'],
    ['an expense', header({ purpose: 'expense', sender_entity_id: SHOP }), null, 'buy'],
    ['a payment "received" on a RECEIVED copy from a party on no list: the sender wrote the kind — hidden', header({ purpose: 'general', business_json: { kind: 'payment_received' } }), null, 'unknown'],
    ['a payment received I recorded myself (sent by me)', header({ purpose: 'general', sender_entity_id: SHOP, business_json: { kind: 'payment_received' } }), null, 'sell'],
    ['a received chit from a party on my customer list only: a sale by MY list, whatever the sender wrote', header({ purpose: 'general', business_json: { kind: 'payment_received' } }), CUS, 'sell'],
    ['a payment made', header({ purpose: 'general', business_json: { kind: 'payment_made' } }), null, 'buy'],
    ['stock to own use', header({ purpose: 'own_use', sender_entity_id: SHOP }), null, 'buy'],
    ['an order from a supplier', header({}), SUP, 'buy'],
    ['an order from a customer', SALE, CUS, 'sell'],
    ['an order with a SENDER-declared "sell": ignored (the sender wrote it), the supplier role hides', header({ business_json: { side: 'sell' } }), SUP, 'buy'],
    ['an order with a sender-declared "buy": hides even for a customer (a declared side can only hide more)', header({ business_json: { side: 'buy' } }), CUS, 'buy'],
    ['an order whose counterparty is on both lists: the supplier role wins (hidden either way)', header({}), BOTH, 'buy'],
    ['an order whose counterparty is on no list: unknown (fails closed)', header({}), null, 'unknown'],
    ['an order I SENT to a party on the customer list only: a sale by my own lists (a PO to such a party is a mis-listed party; the fix is the list)', sentTo(CUSTOMER), CUS, 'sell'],
    ['a subscription from a brand on my supplier list', header({ purpose: 'subscription' }), SUP, 'buy'],
    ['a despatch note I received', header({ purpose: 'delivery_note' }), null, 'buy'],
    ['a despatch note I sent', header({ purpose: 'delivery_note', sender_entity_id: SHOP }), null, 'sell'],
    ['income I sent: money in', header({ purpose: 'income', sender_entity_id: SHOP }), null, 'sell'],
    ['"income" on a RECEIVED copy from a party on no list: the sender wrote the purpose — hidden', header({ purpose: 'income' }), null, 'unknown'],
    ['a service chit received from a supplier: a supplier\'s chit, hidden', header({ purpose: 'service' }), SUP, 'buy'],
    ['an inquiry received from a party on no list: hidden', header({ purpose: 'inquiry' }), null, 'unknown'],
    ['a resale chit received from a supplier: hidden', header({ purpose: 'resale' }), SUP, 'buy'],
    ['general with no kind, received: hidden', header({ purpose: 'general' }), null, 'unknown'],
    ['a priced invoice with NO sender (docOf null): hidden', header({ purpose: 'invoice', sender_entity_id: null }), null, 'unknown'],
    ['a service chit I SENT to a customer: a sale', Object.assign(sentTo(CUSTOMER), { purpose: 'service' }), CUS, 'sell'],
    ['a service chit I sent to a party on no list: hidden (an unlisted party may be a supplier not yet listed)', Object.assign(sentTo(STRANGER), { purpose: 'service' }), null, 'unknown'],
    ['a marketing chit received from a brand: hidden — nothing priced is lost, and a trade list from a supplier stays off', header({ purpose: 'marketing' }), null, 'unknown'],
    ['a marketing chit I sent to a customer: a sale (my own offer)', Object.assign(sentTo(CUSTOMER), { purpose: 'marketing' }), CUS, 'sell']
  ];
  cases.forEach(([label, copy, role, want]) => t('costSideOf | ' + label, view.costSideOf(copy, SHOP, role), want));
  t('counterpartyOf | the sender when not me; else the first recipient that is not me; a self chit has none', [view.counterpartyOf(BILL, SHOP), view.counterpartyOf(sentTo(CUSTOMER), SHOP), view.counterpartyOf(RECEIPT, SHOP)], [SUPPLIER, CUSTOMER, null]);
  console.log('   lib/cost-view · hideChitCosts never changes what it was given (the sealed body stays)');
  const fatLine = { line_id: CHIT, particulars: 'x', quantity: 2, unit: 'kg', gst_rate: 5, hsn: '1006', price: 1, total: 2, unit_price: 1, line_total: 2, cgst: 0.05, sgst: 0.05, igst: 0, cess: 0, mrp: 3, rate: 1, amount: 2, taxable: 2, discount: 0, item_data: { lot: 'L1', mrp: 3, unit_cost: 0.5, tax_amount: 0.1 } };
  const answer = { header: Object.assign(structuredClone(BILL), { business_json: { their_bill: { no: 'INV-7', total: 9, tax: 1, taxable: 8 }, invoice: { total: 9 }, order: { from: 'ORD-1' } } }), detail: structuredClone(DETAIL), live_set: [{ live: structuredClone(fatLine), original: { total: 2 }, history: [{ price: 3 }] }], amendments: [{ line: { price: 4 } }], line_delivery: { [CHIT]: { charged: 17, added: [{ delivery_id: CHIT, amount: 10 }, { delivery_id: SUPPLIER, amount: 7 }] } }, delivery_summary: { charged: 17 }, books_wait: { todo: 'accept', short: { theirs_minor: 294000, ours_minor: 291000, short_minor: 3000 } }, some_new_block: { note: 'kept', grand_total: 4242, nested: { price_minor: 1 } } };
  const before = JSON.stringify(answer);
  const hidden = view.hideChitCosts(answer, { side: 'buy', mine: new Set([CHIT]) });
  t('hideChitCosts | the walk is an ALLOWLIST: books_wait keeps todo only, a planted unknown block is dropped whole', [hidden.books_wait, hidden.some_new_block, 'some_new_block' in hidden], [{ todo: 'accept' }, undefined, false]);
  const prose = view.hideChitCosts({ header: Object.assign(structuredClone(BILL), { figure: 4242, n: 4747, v: 4848, unknown_words: 'pay ₹500 now', business_json: { paise: 100, their_bill: { no: 'INV-7', total: 9 } }, summary_json: { minor: 4949, line_item_count: 2, currency_code: 'INR' } }), books_wait: { todo: 'accept', name: 'Mill', why: 'Accept it at ₹1,234.00 (₹12.50 short of their bill)', gap: 1234, short: { offer: 1234, theirs_minor: 123400 }, candidates: [] }, state_log: [{ action: 'step', detail: 'Accepted at ₹1,234.00', created_at: AT }], amendments: [{ amendment_id: CHIT, line: { price: 9, particulars: 'x' }, reason: 'they charged ₹9', reason_code: 'price' }], actions: { accept: { ok: false, why: 'not_received' } }, doc: 'bill_received' }, { side: 'buy', mine: new Set() });
  const text = JSON.stringify(prose);
  t('hideChitCosts | money in VALUES: books_wait.why and gap, numbers under figure · paise · n · v · minor, a ₹ in an unknown header key, a log line and a reason with a figure — all gone', [/₹/.test(text), /4242|1234|12\.50|500|\b100\b|4747|4848|4949/.test(text), prose.books_wait, prose.state_log[0].detail, prose.amendments[0].reason], [false, false, { todo: 'accept' }, undefined, undefined]);
  t('hideChitCosts | ...and the allowlisted keys stay: ids, parties, purpose, the engine\'s actions and doc, the line\'s name, their bill\'s number', [prose.header.chit_id, prose.header.purpose, prose.header.all_recipients.length, prose.header.business_json, prose.header.summary_json, prose.actions, prose.doc, prose.amendments[0].line, prose.state_log[0].action], [CHIT, 'invoice', 2, { their_bill: { no: 'INV-7' } }, { line_item_count: 2, currency_code: 'INR' }, { accept: { ok: false, why: 'not_received' } }, 'bill_received', { particulars: 'x' }, 'step']);
  t('hideChitCosts | the input is untouched, byte for byte', JSON.stringify(answer) === before, true);
  t('hideChitCosts | buy: a line keeps the ALLOWLIST only (name · quantity · unit · gst_rate · hsn · item_data sans money); cgst, sgst, mrp, unit_price, line_total, rate, amount, taxable, discount all go', hidden.live_set[0].live, { line_id: CHIT, particulars: 'x', quantity: 2, unit: 'kg', gst_rate: 5, hsn: '1006', item_data: {} });
  t('hideChitCosts | buy: every other line shape loses its money; the header its money, the invoice and their bill\'s total/tax (their number and the order link stay)', [hidden.live_set[0].original, hidden.live_set[0].history[0], hidden.amendments[0].line, hidden.header.summary_json, hidden.header.business_json], [{}, {}, {}, { line_item_count: 2, currency_code: 'INR', purpose: 'order' }, { their_bill: { no: 'INV-7' }, order: { from: 'ORD-1' } }]);
  t('hideChitCosts | buy: my own add stays (the delivery rows say it is mine), the other goes; charged above my own is refused, the chit sum with it; cost_hidden says money was withheld', [hidden.line_delivery[CHIT].added.map((a) => a.amount), hidden.line_delivery[CHIT].charged, hidden.delivery_summary.charged, hidden.cost_hidden], [[10, undefined], undefined, undefined, true]);
  const own = view.hideChitCosts({ line_delivery: { [CHIT]: { charged: 10, added: [{ delivery_id: CHIT, amount: 10 }] } }, delivery_summary: { charged: 10 } }, { side: 'buy', mine: new Set([CHIT]) });
  t('hideChitCosts | buy: charged that is exactly my own sum stays, and so does the chit\'s — and nothing removed means NO marker', [own.line_delivery[CHIT].charged, own.delivery_summary.charged, own.cost_hidden], [10, 10, undefined]);
  t('mineDeliveries | the rows recorded by this actor, by id', [...view.mineDeliveries([DELIVERY(CHIT, BLIND_ID, 1), DELIVERY(SUPPLIER, GRANTED_ID, 2)], BLIND_ID)], [CHIT]);
  const sell = view.hideChitCosts({ header: structuredClone(SALE), detail: structuredClone(DETAIL) }, { side: 'sell' });
  t('hideChitCosts | sell: the price and the money stay, only the cost-named keys go, and cost_hidden is ABSENT (no money was withheld)', [sell.detail.line_items[0].price, sell.header.summary_json.money.total, costKeys(sell), sell.cost_hidden], [SECRET.price, SECRET.money_total, [], undefined]);
  t('hideChitCosts | unknown side is treated as buy (fails closed): the price goes', view.hideChitCosts({ detail: structuredClone(DETAIL) }, { side: 'unknown' }).detail.line_items[0].price, undefined);
  const trap = JSON.parse('{"constructor":"₹9","toString":"₹8","valueOf":"₹7","hasOwnProperty":"₹6","__proto__":"₹5","todo":"accept"}');
  t('prune | a prototype-named key is never "named" by a spec: dropped, counted; the real key stays; the spec has no prototype and is frozen', [view.prune(trap, view.ANSWER_KEEP.books_wait), JSON.stringify(trap), Object.getPrototypeOf(view.ANSWER_KEEP), Object.isFrozen(view.ROW_KEEP)], [5, '{"todo":"accept"}', null, true]);
  /* sixth review: a bare string where the spec expects an object (a nested spec or LINE) is dropped, never kept as is; an array under one keeps its objects only */
  const loose = view.hideChitCosts({ header: Object.assign(structuredClone(BILL), { business_json: { payment: 'Total Rs 7000', their_bill: 'Rs 7000' } }), detail: { line_items: ['Rs 3000', { particulars: 'Rice', quantity: 2 }] } }, { side: 'buy', mine: new Set() });
  const looseText = JSON.stringify(loose);
  t('prune | a bare string under a nested spec or LINE is dropped: no "7000" or "3000" anywhere; the real line stays', [/7000|3000/.test(looseText), loose.detail.line_items.length, loose.detail.line_items[0].particulars], [false, 1, 'Rice']);
  t('isMoneyKey | money words and suffixes yes; a rate, a name, a count, the marker no', ['price', 'cgst', 'tax_amount', 'amount_minor', 'their_total', 'unit_cost'].map(view.isMoneyKey).concat(['gst_rate', 'tax_name', 'line_item_count', 'cost_hidden', 'quantity'].map(view.isMoneyKey)), [true, true, true, true, true, true, false, false, false, false, false]);
  t('hideRowCosts | a buy row loses money and total_value and says cost_hidden; a sell row with nothing named is as it was; a buy row with NO money says nothing', [view.hideRowCosts({ summary_json: structuredClone(SUMMARY) }, 'buy'), view.hideRowCosts({ summary_json: { total_value: 5 } }, 'sell'), view.hideRowCosts({ summary_json: { purpose: 'order' } }, 'unknown')], [{ summary_json: { line_item_count: 2, currency_code: 'INR', purpose: 'order' }, cost_hidden: true }, { summary_json: { total_value: 5 } }, { summary_json: { purpose: 'order' } }]);
  t('rollupGroup | the sum keeps the sales members only, the count stays, cost_hidden when one was left out', view.rollupGroup({ key: 'k', chits: 2, members: [{ total_value: '5', purpose: 'invoice', sender_entity_id: SUPPLIER, all_recipients: [] }, { total_value: '7.5', purpose: 'order', sender_entity_id: CUSTOMER, all_recipients: [] }] }, SHOP, new Map([[CUSTOMER, { customer: true, supplier: false }]])), { key: 'k', chits: 2, total_value: '7.50', cost_hidden: true });
  const many = Array.from({ length: view.ROLLUP_MEMBER_CAP + 1 }, () => ({ total_value: '1', purpose: 'order', sender_entity_id: CUSTOMER, all_recipients: [] }));
  t('rollupGroup | a group above the member cap answers no sum at all (null, cost_hidden), never a plausible wrong number', view.rollupGroup({ key: 'k', chits: many.length, members: many }, SHOP, new Map([[CUSTOMER, { customer: true, supplier: false }]])), { key: 'k', chits: many.length, total_value: null, cost_hidden: true });
  t('rollupMembersSql | the wire is capped at the member cap + 1', /\[1:201\] AS members/.test(view.rollupMembersSql('ch', true)) && view.rollupMembersSql('ch', false) === '', true);
  const asked = { query: { amount_min: '1', amount_max: '9', sort: 'amount', q: 'tea' } };
  t('moneyParams | a blind reader\'s amount filter and sort are taken off and named; the rest stays; everyone else keeps theirs', [view.moneyParams(asked, true), asked.query, view.moneyParams({ query: { sort: 'amount' } }, false)], [['amount_min', 'amount_max', 'sort'], { q: 'tea' }, []]);
  const arrays = { query: { amount_min: [''], amount_max: { gt: '1' }, sort: ['amount'], dir: 'asc' } };
  t('moneyParams | the ARRAY and OBJECT forms (?sort[]=amount, ?amount_min[]=) go the same way: nothing that is not a plain string reaches the consumer', [view.moneyParams(arrays, true), arrays.query, view.moneyParams({ query: { sort: ['date'] } }, true), view.moneyParams({ query: { sort: 'date' } }, true)], [['amount_min', 'amount_max', 'sort'], { dir: 'asc' }, ['sort'], []]);
}

(async () => {
  console.log('\n-- RAIL-146 · the shop\'s cost stays off a cost-blind reader of the chit --\n');
  require.cache[require.resolve(API + '/middleware/auth')] = { exports: Object.assign((req, res, next) => { req.identity = WHO; next(); }, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id }) };
  const client = { query: async (sql, params) => handle(sql, params) };
  require.cache[require.resolve(API + '/db')] = { exports: { query: client.query, withEntity: async (_id, fn) => fn(client), withTransaction: async (fn) => fn(client), onEntity: async (_i, _d, fn) => fn(client), readBatch: async () => [], trySavepoint: async (db, run, fallback) => { try { return await run(db); } catch (_) { return fallback; } } } };
  console.error = () => undefined;
  const app = express(); app.use(express.json());
  app.use('/api/chits', require(API + '/routes/chits'));
  unitCases(); /* after the stand-ins: lib/cost must see the stand-in db, as the routes do */
  const server = app.listen(0); const port = server.address().port;
  /* one reader at a time: the stand-in auth reads WHO when the request arrives */
  const read = async (p) => [await call(port, p, OWNER), await call(port, p, GRANTED), await call(port, p, BLIND)];
  const same = (label, owner, granted) => t(label + ' | owner and cost-allowed: byte-identical', granted.raw === owner.raw ? true : differing(owner.body, granted.body), true);
  /* GET /:chit_id: byte-identical but for `actions`, which the rail answers by the reader's level */
  const sameRead = (label, owner, granted) => t(label + ' | owner and cost-allowed: identical but for the rail\'s actions (by level)', [sansActions(granted.body) === sansActions(owner.body) ? true : differing(owner.body, granted.body).filter((k) => k !== 'actions'), granted.body.actions !== undefined], [true, true]);

  /* 1 · GET /:chit_id on a supplier's BILL: cost-named keys, price, total, the header money, the invoice, their total — all gone; the rest the owner's */
  SCENE = { header: BILL, deliveries: [DELIVERY(CHIT, BLIND_ID, SECRET.add), DELIVERY(SUPPLIER, GRANTED_ID, SECRET.other_add)] };
  let [owner, granted, blind] = await read('/api/chits/' + CHIT);
  t('bill | owner reads the price, the cost and the money', [owner.status, owner.body.detail.line_items[0].price, owner.body.detail.line_items[0].item_data.unit_cost, owner.body.header.summary_json.money.total], [200, SECRET.price, SECRET.unit_cost, SECRET.money_total]);
  sameRead('bill', owner, granted);
  t('bill | blind: 200, cost_hidden, the lines keep name · quantity · unit · gst_rate', [blind.status, blind.body.cost_hidden, blind.body.detail.line_items.map((l) => [l.particulars, l.quantity, l.unit, l.gst_rate])], [200, true, [['Basmati rice 1kg', 10, 'kg', 5], ['Toor dal 1kg', 5, 'kg', 5]]]);
  t('bill | blind: no cost-named key at any depth', costKeys(blind.body), []);
  t('bill | blind: no price · total on the payload, the live set, the header, the detail', [blind.body.detail.line_items[0].price, blind.body.live_set[0].live.price, blind.body.live_set[0].original.total, blind.body.header.summary_json.money, blind.body.header.summary_json.total_value, blind.body.detail.total_value, blind.body.header.business_json.invoice, blind.body.header.business_json.their_bill], [undefined, undefined, undefined, undefined, undefined, undefined, undefined, { no: 'INV-7' }]);
  t('bill | blind: the payload line is the allowlist (cgst · sgst · mrp · unit_price gone with the price)', blind.body.detail.line_items[0], { line_id: CHIT, particulars: 'Basmati rice 1kg', quantity: 10, unit: 'kg', gst_rate: 5, item_data: {} });
  t('bill | owner: cgst · mrp · unit_price were there to lose', [owner.body.detail.line_items[0].cgst, owner.body.detail.line_items[0].mrp], [2.5, 4343.5]);
  t('bill | blind: his OWN add amount stays, the other actor\'s goes, the sums go', [blind.body.line_delivery[CHIT].added.map((a) => a.amount), blind.body.line_delivery[CHIT].charged, blind.body.delivery_summary.charged], [[SECRET.add, undefined], undefined, undefined]);
  t('bill | blind: no secret figure anywhere in the body (his own add aside)', leaked(blind.raw), [String(SECRET.add)]);
  t('bill | blind: the actions (minus the books\' sentence `say`) and the doc are the owner\'s (the real header was read before the strip)', [blind.body.actions, blind.body.doc], [sansSay(owner.body.actions), owner.body.doc]);
  noLeak('bill', blind.raw, [String(SECRET.add)]);
  t('bill | owner\'s rows untouched by the blind read (the next owner read is byte-identical)', (await call(port, '/api/chits/' + CHIT, OWNER)).raw === owner.raw, true);

  /* 1b · the same bill on the FALLBACK path (the one-shot statement fails, the route reads per table): the actor's own add still stays, by its by_id */
  SCENE = { header: BILL, fallback: true, deliveries: [DELIVERY(CHIT, BLIND_ID, SECRET.add), DELIVERY(SUPPLIER, GRANTED_ID, SECRET.other_add)] };
  [owner, granted, blind] = await read('/api/chits/' + CHIT);
  t('bill, fallback path | owner reads both adds', [owner.status, owner.body.line_delivery[CHIT].added.map((a) => a.amount)], [200, [SECRET.add, SECRET.other_add]]);
  t('bill, fallback path | blind: his OWN add stays, the other goes, no secret but his own', [blind.body.cost_hidden, blind.body.line_delivery[CHIT].added.map((a) => a.amount), leaked(blind.raw)], [true, [SECRET.add, undefined], [String(SECRET.add)]]);
  noLeak('bill, fallback path', blind.raw, [String(SECRET.add)]);

  /* 1f · PROTOTYPE keys (fifth review): a sender names a key constructor · toString · valueOf · hasOwnProperty · __proto__ (sent raw as JSON) — a lookup on a plain spec
     would find an inherited function and keep the value; planted in the header's business_json and summary_json, in books_wait and in a line */
  const protoKeys = (figure) => JSON.parse('{"constructor":"₹' + figure + '","toString":"₹' + figure + '","valueOf":"₹' + figure + '","hasOwnProperty":"₹' + figure + '","__proto__":"₹' + figure + '"}');
  /* planted by ONE JSON.parse: Object.assign would SET the prototype on "__proto__" instead of making an own key, which is exactly how a sender's JSON arrives */
  const withProto = (base, figure) => JSON.parse(JSON.stringify(base).slice(0, -1) + ',' + JSON.stringify(protoKeys(figure)).slice(1));
  SCENE = {
    header: Object.assign(structuredClone(BILL), { business_json: withProto({ their_bill: { no: 'INV-7' } }, SECRET.planted), summary_json: withProto(SUMMARY, SECRET.planted) }),
    detail: Object.assign(structuredClone(DETAIL), { line_items: [withProto(LINES[0], SECRET.planted), LINES[1]] }),
    books_wait: withProto({ todo: 'accept', candidates: [] }, SECRET.planted)
  };
  [owner, granted, blind] = await read('/api/chits/' + CHIT);
  t('prototype keys | owner reads them all (the sender\'s keys, verbatim)', [owner.status, owner.body.header.business_json.constructor, owner.body.books_wait.__proto__, owner.body.detail.line_items[0].valueOf], [200, '₹' + SECRET.planted, '₹' + SECRET.planted, '₹' + SECRET.planted]);
  sameRead('prototype keys', owner, granted);
  t('prototype keys | blind: none of the five keys anywhere; the named keys stay', [/"(constructor|toString|valueOf|hasOwnProperty|__proto__)"/.test(blind.raw), blind.body.books_wait, blind.body.header.business_json, blind.body.header.summary_json.line_item_count], [false, { todo: 'accept' }, { their_bill: { no: 'INV-7' } }, 2]);
  noLeak('prototype keys', blind.raw, []);
  SCENE = { rows: [Object.assign(listRow(BILL), { summary_json: withProto(SUMMARY, SECRET.planted) })] };
  [owner, granted, blind] = await read('/api/chits/inbox');
  t('prototype keys on a list row | owner reads them; blind: none, no ₹', [owner.body.chits[0].summary_json.toString, /"(constructor|toString|valueOf|hasOwnProperty|__proto__)"/.test(blind.raw), blind.body.chits[0].summary_json], ['₹' + SECRET.planted, false, { line_item_count: 2, currency_code: 'INR', purpose: 'order' }]);
  noLeak('prototype keys on a list row', blind.raw, []);

  /* 1e · the books wait on a GAP (their total above the lines): the rail answers accept with the books' sentence in `say` — the owner reads it, a blind reader never */
  SCENE = { header: BILL, books_wait: { todo: 'record', name: 'Mill', why: 'Their total ₹' + SECRET.theirs + ' is ₹' + SECRET.gap + ' more than the lines', gap: SECRET.gap, candidates: [] } };
  [owner, granted, blind] = await read('/api/chits/' + CHIT);
  t('books gap | owner: accept is refused with the books\' sentence, the figure in it', [owner.status, owner.body.actions.accept.why, /₹/.test(owner.body.actions.accept.say), owner.body.actions.accept.todo], [200, 'books_waiting', true, 'record']);
  sameRead('books gap', owner, granted);
  t('books gap | blind: the same verdict without the sentence; the todo code stays', [blind.body.actions.accept, blind.body.actions, blind.body.books_wait], [{ ok: false, why: 'books_waiting', todo: 'record' }, sansSay(owner.body.actions), { todo: 'record' }]);
  noLeak('books gap', blind.raw, []);

  /* 1c · odd purposes received from a supplier, and a priced chit with no sender: not positively a sale, so hidden */
  for (const purpose of ['service', 'inquiry', 'resale', 'general']) {
    SCENE = { header: header({ purpose }) };
    [owner, granted, blind] = await read('/api/chits/' + CHIT);
    t(purpose + ' received from a supplier | blind: hidden; owner priced', [blind.body.cost_hidden, blind.body.detail.line_items[0].price, owner.body.detail.line_items[0].price], [true, undefined, SECRET.price]);
    noLeak(purpose + ' received', blind.raw, []);
  }
  SCENE = { header: header({ purpose: 'invoice', sender_entity_id: null }) };
  [owner, granted, blind] = await read('/api/chits/' + CHIT);
  t('a priced chit with no sender | blind: hidden, no secret figure', [blind.body.cost_hidden, leaked(blind.raw)], [true, []]);
  noLeak('no sender', blind.raw, []);

  /* 1d · money in VALUES through the route: the books' wait on a bill (why is prose with the figure, gap a number), numbers under keys that are not money words, a ₹ string */
  SCENE = { header: Object.assign(structuredClone(BILL), { figure: SECRET.total, n: SECRET.planted, v: 4848, unknown_words: 'pay ₹' + SECRET.money_total + ' now', business_json: { paise: 4949, their_bill: { no: 'INV-7', total: SECRET.their_total } } }), books_wait: { todo: 'accept', name: 'Mill', why: 'Accept it at ₹' + SECRET.invoice_total + ' (₹' + SECRET.add + ' short of their bill)', gap: SECRET.add, short: { offer: SECRET.invoice_total, theirs_minor: 5050 }, candidates: [] } };
  [owner, granted, blind] = await read('/api/chits/' + CHIT);
  t('money in values | owner reads the wait sentence, the gap and the planted numbers', [owner.status, owner.body.books_wait.gap, owner.body.header.figure, /₹/.test(owner.raw)], [200, SECRET.add, SECRET.total, true]);
  sameRead('money in values', owner, granted);
  t('money in values | blind: no ₹ anywhere, no 4747/4848/4949/5050, no secret figure; books_wait is todo alone', [/₹/.test(blind.raw), /4747|4848|4949|5050/.test(blind.raw), leaked(blind.raw), blind.body.books_wait, blind.body.header.figure, blind.body.header.unknown_words, blind.body.header.business_json], [false, false, [], { todo: 'accept' }, undefined, undefined, { their_bill: { no: 'INV-7' } }]);
  t('money in values | blind: the allowlisted keys stay (ids, parties, purpose, doc, actions, line names, quantities)', [blind.body.header.chit_id, blind.body.header.sender_entity_display_name, blind.body.header.all_recipients.length, blind.body.doc, blind.body.actions, blind.body.detail.line_items.map((l) => [l.particulars, l.quantity, l.unit])], [CHIT, 'Mill', 2, owner.body.doc, owner.body.actions, [['Basmati rice 1kg', 10, 'kg'], ['Toor dal 1kg', 5, 'kg']]]);

  /* 2 · the counter's goods receipt (sent to self): a purchase — the receipt figures on the header go too */
  SCENE = { header: RECEIPT };
  [owner, granted, blind] = await read('/api/chits/' + CHIT);
  sameRead('receipt', owner, granted);
  t('receipt | blind: costs · goods · landed_total off the header, no secret figure', [blind.body.cost_hidden, blind.body.header.business_json, leaked(blind.raw)], [true, {}, []]);
  noLeak('receipt', blind.raw, []);

  /* 3 · a customer's order (a SALE): the price stays; only the cost-named keys go (half i) */
  SCENE = { header: SALE };
  [owner, granted, blind] = await read('/api/chits/' + CHIT);
  sameRead('sale', owner, granted);
  t('sale | blind: price, total and the header money stay', [blind.body.detail.line_items[0].price, blind.body.live_set[0].live.price, blind.body.header.summary_json.money.total, blind.body.detail.total_value], [SECRET.price, owner.body.live_set[0].live.price, SECRET.money_total, String(SECRET.total)]);
  t('sale | blind: the cost-named keys still go; cost_hidden is ABSENT because no money was withheld', [costKeys(blind.body), blind.body.cost_hidden], [[], undefined]);
  t('sale | blind: exactly the owner\'s answer minus the cost-named keys', blind.body, stripNamed(owner.body));

  /* 4 · my own order SENT with no declared side: the counterparty decides — a supplier hides, a stranger hides (unknown), a customer keeps */
  for (const [party, want] of [[SUPPLIER, 'hidden'], [STRANGER, 'hidden'], [CUSTOMER, 'kept']]) {
    SCENE = { header: sentTo(party) };
    [owner, granted, blind] = await read('/api/chits/' + CHIT);
    sameRead('sent to ' + want, owner, granted);
    t('sent order, counterparty ' + (party === SUPPLIER ? 'a supplier' : party === STRANGER ? 'on no list' : 'a customer') + ' | blind: price ' + want, blind.body.detail.line_items[0].price === undefined ? 'hidden' : 'kept', want);
    if (want === 'hidden') noLeak('sent order, ' + (party === SUPPLIER ? 'supplier' : 'no list'), blind.raw, []);
  }

  /* 5 · the three lists: the summary money goes on a cost-side row, stays on a sale; the side columns never reach the wire */
  for (const [p, name] of [['/api/chits/inbox', 'inbox'], ['/api/chits/sent?sort=date', 'sent'], ['/api/chits/folder?view=archive', 'folder']]) {
    SCENE = { rows: [listRow(BILL), listRow(SALE)] };
    [owner, granted, blind] = await read(p);
    same(name, owner, granted);
    t(name + ' | owner: both rows carry the money; no _sender / _bj on the wire', [owner.status, owner.body.chits.map((c) => c.summary_json.money.total), Object.keys(owner.body.chits[0]).filter((k) => k.startsWith('_'))], [200, [SECRET.money_total, SECRET.money_total], []]);
    t(name + ' | blind: the bill row loses money · total_value and says cost_hidden; the sale row keeps them', [blind.body.chits[0].summary_json.money, blind.body.chits[0].summary_json.total_value, blind.body.chits[0].cost_hidden, blind.body.chits[1].summary_json.money.total, blind.body.chits[1].cost_hidden], [undefined, undefined, true, SECRET.money_total, undefined]);
    t(name + ' | blind: no secret figure but the sale\'s', leaked(blind.raw).sort(), [String(SECRET.money_total), String(SECRET.total)].sort());
    noLeak(name + ' list', blind.raw, [String(SECRET.money_total), String(SECRET.total)]);
    t(name + ' | nobody asked for an amount filter: no cost_params_ignored', [owner.body.cost_params_ignored, blind.body.cost_params_ignored], [undefined, undefined]);
  }
  /* 5b · the ORACLE: an amount filter or an amount sort over the hidden total would let a blind reader search for it — taken off, named back; the owner's statement keeps them */
  /* the ARRAY form (?sort[]=amount, ?amount_min[]=) never reaches a statement: the routes' own schema (lib/chits-contract, strict query) refuses it 422 for everyone;
     moneyParams drops a non-string anyway (unit case above), so the consumer's map is never indexed by an array even if the schema were loosened */
  for (const [p, name] of [['/api/chits/inbox?sort[]=amount&amount_min[]=100', 'inbox'], ['/api/chits/sent?sort[]=amount&amount_max[]=1', 'sent'], ['/api/chits/folder?view=archive&amount_min[]=1', 'folder']]) {
    LAST_LIST_SQL = '';
    const ownerArr = await call(port, p, OWNER);
    const blindArr = await call(port, p, BLIND);
    t(name + ' array form | refused 422 for owner and blind alike, no list statement ran', [ownerArr.status, blindArr.status, LAST_LIST_SQL], [422, 422, '']);
  }
  for (const [p, name] of [['/api/chits/inbox?sort=amount&amount_min=100&amount_max=9000', 'inbox'], ['/api/chits/sent?sort=amount&dir=asc&amount_min=100', 'sent'], ['/api/chits/folder?view=archive&amount_max=9000', 'folder']]) {
    SCENE = { rows: [listRow(BILL)] };
    const ownerAsked = await call(port, p, OWNER);
    const ownerSql = LAST_LIST_SQL;
    const blindAsked = await call(port, p, BLIND);
    const blindSql = LAST_LIST_SQL;
    t(name + ' oracle | owner: the filter and the amount order are in the statement, nothing ignored', [ownerAsked.status, /total_value'\)::numeric,0\) (>=|<=)/.test(ownerSql), /ORDER BY \(?.*total_value.*numeric/.test(ownerSql) || !/sort(\[\])?=amount/.test(p), ownerAsked.body.cost_params_ignored], [200, true, true, undefined]);
    t(name + ' oracle | blind: no amount filter, no amount order, and the ask named back', [blindAsked.status, /total_value'\)::numeric,0\) (>=|<=)/.test(blindSql), /ORDER BY[^;]*total_value/.test(blindSql), (blindAsked.body.cost_params_ignored || []).slice().sort()], [200, false, false, p.split('?')[1].split('&').map((kv) => kv.split('=')[0].replace('[]', '')).filter((k) => k === 'amount_min' || k === 'amount_max' || k === 'sort').sort()]);
  }

  /* 6 · the rollup: the blind actor's sum leaves out the supplier's bill, the count stays, the group says cost_hidden */
  const member = (h) => ({ total_value: String(h.summary_json.total_value), purpose: h.purpose, sender_entity_id: h.sender_entity_id, all_recipients: h.all_recipients, business_json: h.business_json || {} });
  SCENE = { groups: [{ key: 'pending', chits: 2, total_value: String(SECRET.total * 2), members: [member(BILL), member(SALE)] }] };
  [owner, granted, blind] = await read('/api/chits/rollup?group_by=state');
  t('rollup | owner: the sum as the statement gave it (the stand-in answers the member column to everyone)', [owner.status, owner.body.groups[0].total_value, owner.body.groups[0].cost_hidden], [200, String(SECRET.total * 2), undefined]);
  same('rollup', owner, granted);
  /* REP-50 (sit/run6): a group also carries by_currency, one row per currency (the stand-in answers no currency_code) */
  t('rollup | blind: the sale alone, two chits, cost_hidden', blind.body.groups[0], { key: 'pending', chits: 2, by_currency: [{ currency_code: null, chits: 2, total_value: SECRET.total.toFixed(2) }], cost_hidden: true, total_value: SECRET.total.toFixed(2) }); /* sit/run6: the REP-50 fold writes by_currency, then the strip its marker and the folded sum (the keys in wire order) */
  noLeak('rollup', blind.raw, [String(SECRET.total)]);
  const crowd = Array.from({ length: 201 }, () => member(SALE));
  SCENE = { groups: [{ key: 'pending', chits: 500, total_value: '99999.00', members: crowd }] };
  [owner, granted, blind] = await read('/api/chits/rollup?group_by=state');
  t('rollup | a group too big to sum honestly (members capped on the wire): blind reads no sum, the count; owner reads the statement\'s', [blind.body.groups[0], owner.body.groups[0].total_value], [{ key: 'pending', chits: 500, by_currency: [{ currency_code: null, chits: 500, total_value: null }], cost_hidden: true, total_value: null }, '99999.00']);

  server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error = console.log; console.error(e); process.exit(1); });
