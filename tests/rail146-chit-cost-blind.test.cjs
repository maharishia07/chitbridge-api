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
const SECRET = { price: 4242.5, unit_cost: 4141.25, landed: 4040.75, total: 8485, money_total: 9999.5, invoice_total: 8888.25, their_total: 7777.75, add: 1212.5, other_add: 1313.5 };
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
/** the top-level keys two bodies differ on (a failure's own words) */
const differing = (left, right) => Array.from(new Set(Object.keys(left || {}).concat(Object.keys(right || {})))).filter((k) => JSON.stringify(left[k]) !== JSON.stringify(right[k]));

/* ── the copies ──────────────────────────────────────────────────────────────────────────────────────────────── */
const LINES = [
  { line_id: CHIT, particulars: 'Basmati rice 1kg', quantity: 10, unit: 'kg', price: SECRET.price, total: SECRET.total, gst_rate: 5, item_data: { unit_cost: SECRET.unit_cost, landed: SECRET.landed, lot: 'L1' } },
  { line_id: SUPPLIER, particulars: 'Toor dal 1kg', quantity: 5, unit: 'kg', price: 12, gst_rate: 5 }
];
const SUMMARY = { line_item_count: 2, total_value: SECRET.total, currency_code: 'INR', money: { gross: SECRET.money_total, net: SECRET.money_total, total: SECRET.money_total }, purpose: 'order' };
const header = (over) => Object.assign({ chit_id: CHIT, entity_id: SHOP, direction: 'received', role: 'Received', purpose: 'order', sender_entity_id: SUPPLIER, sender_entity_display_name: 'Mill', all_recipients: [{ entity_id: SUPPLIER, display_name: 'Mill' }, { entity_id: SHOP, display_name: 'Shop' }], summary_json: SUMMARY, business_json: null, created_by_actor_id: null, created_at: AT, schema_version: 2 }, over);
const DETAIL = { detail_type: 'order', line_item_count: 2, total_value: String(SECRET.total), currency_code: 'INR', line_items: LINES, payload_delivered_at: AT, payload_deleted_at: null };
const LINE_ROW = (l, seq) => ({ line_id: l.line_id, seq, particulars: l.particulars, quantity: String(l.quantity), unit: l.unit, unit_size: null, price: l.price == null ? null : String(l.price), comment: null, asked_as: null, asked_unit: null, raw_phrase: null, removed: false, removed_reason: null, needs_human: false, flags: null });
const DELIVERY = (id, actor, amount) => ({ line_id: CHIT, particulars: 'Basmati rice 1kg', ordered_unit: 'kg', ordered: '10', removed: false, delivery_id: id, dq: '1', du: 'piece', reference: null, note: null, recorded_by_entity_id: SHOP, recorded_by_name: 'Shop', recorded_by_actor_name: actor === BLIND_ID ? 'Blind' : 'Other', recorded_by_actor_id: actor, delivered_at: AT, dkind: 'add', damount: String(amount), dparticulars: 'Gunny bag' });
const bundle = (deliveries) => ({ participants: [{ entity_id: SHOP, current_status: 'pending', read_at: null, display_name: 'Shop', bridge_id: 'SHOP' }], amendments: [], lines: LINES.map(LINE_ROW), assignments: [], deliveries, my_received: 'pending', books_wait: null, order_billed: false });
/** a bill received from the supplier: Bills · Received (docOf), the frozen invoice and their bill on the header */
const BILL = header({ purpose: 'invoice', business_json: { invoice: { total: SECRET.invoice_total, lines: [{ price: SECRET.price }] }, their_bill: { no: 'INV-7', total: SECRET.their_total } } });
/** the counter's goods receipt, sent to self */
const RECEIPT = header({ purpose: 'receipt', direction: 'received', sender_entity_id: SHOP, all_recipients: [{ entity_id: SHOP, display_name: 'Shop', self: true }], business_json: { costs: { transport: 100 }, landed_total: SECRET.landed, goods: SECRET.total } });
/** a customer's order to me: a SALE */
const SALE = header({ sender_entity_id: CUSTOMER, sender_entity_display_name: 'Ravi', all_recipients: [{ entity_id: CUSTOMER, display_name: 'Ravi' }, { entity_id: SHOP, display_name: 'Shop' }] });
/** my own order SENT, no declared side: the counterparty's list decides */
const sentTo = (party) => header({ direction: 'sent', role: 'Sent', sender_entity_id: SHOP, all_recipients: [{ entity_id: SHOP, display_name: 'Shop' }, { entity_id: party, display_name: 'Party' }] });

/* ── the stand-in db ─────────────────────────────────────────────────────────────────────────────────────────── */
let WHO = OWNER, SCENE = {};
const UUID = /[0-9a-f-]{36}/g;
const rolesOf = (ids) => ids.map((id) => ({ id, customer: id === CUSTOMER, supplier: id === SUPPLIER }));
function handle(sql, params) {
  const s = String(sql);
  if (/can_see_costs FROM identities/.test(s)) return { rows: [{ can_see_costs: !!GRANTS[params[0]] }] };
  if (/FROM unnest\(\$2::uuid\[\]\)/.test(s)) return { rows: rolesOf(params[1]) };
  if (/SELECT \* FROM chit_header/.test(s)) return { rows: SCENE.header ? [SCENE.header] : [] };
  if (/FROM chit_detail/.test(s)) return { rows: SCENE.header ? [DETAIL] : [] };
  if (/AS participants,/.test(s)) return { rows: [bundle(SCENE.deliveries || [])] };
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
    ['a payment received', header({ purpose: 'general', business_json: { kind: 'payment_received' } }), null, 'sell'],
    ['a payment made', header({ purpose: 'general', business_json: { kind: 'payment_made' } }), null, 'buy'],
    ['stock to own use', header({ purpose: 'own_use', sender_entity_id: SHOP }), null, 'buy'],
    ['an order from a supplier', header({}), SUP, 'buy'],
    ['an order from a customer', SALE, CUS, 'sell'],
    ['an order with a declared side (side wins)', header({ business_json: { side: 'sell' } }), SUP, 'sell'],
    ['an order whose counterparty is on both lists: unknown', header({}), BOTH, 'unknown'],
    ['an order whose counterparty is on no list: unknown (fails closed)', header({}), null, 'unknown'],
    ['a subscription from a brand on my supplier list', header({ purpose: 'subscription' }), SUP, 'buy'],
    ['a despatch note I received', header({ purpose: 'delivery_note' }), null, 'buy'],
    ['a despatch note I sent', header({ purpose: 'delivery_note', sender_entity_id: SHOP }), null, 'sell'],
    ['a marketing chit: never hidden', header({ purpose: 'marketing' }), null, 'sell']
  ];
  cases.forEach(([label, copy, role, want]) => t('costSideOf | ' + label, view.costSideOf(copy, SHOP, role), want));
  t('counterpartyOf | the sender when not me; else the first recipient that is not me; a self chit has none', [view.counterpartyOf(BILL, SHOP), view.counterpartyOf(sentTo(CUSTOMER), SHOP), view.counterpartyOf(RECEIPT, SHOP)], [SUPPLIER, CUSTOMER, null]);
  console.log('   lib/cost-view · hideChitCosts never changes what it was given (the sealed body stays)');
  const answer = { header: structuredClone(BILL), detail: structuredClone(DETAIL), live_set: [{ live: { price: 1, particulars: 'x' }, original: { total: 2 }, history: [{ price: 3 }] }], amendments: [{ line: { price: 4 } }], line_delivery: { [CHIT]: { charged: 17, added: [{ delivery_id: CHIT, amount: 10 }, { delivery_id: SUPPLIER, amount: 7 }] } }, delivery_summary: { charged: 17 } };
  const before = JSON.stringify(answer);
  const hidden = view.hideChitCosts(answer, { side: 'buy', mine: new Set([CHIT]) });
  t('hideChitCosts | the input is untouched, byte for byte', JSON.stringify(answer) === before, true);
  t('hideChitCosts | buy: every line shape loses its price, the header its money, the invoice goes, their number stays', [hidden.live_set[0].live, hidden.live_set[0].original, hidden.live_set[0].history[0], hidden.amendments[0].line, hidden.header.summary_json.money, hidden.header.business_json], [{ particulars: 'x' }, {}, {}, {}, undefined, { their_bill: { no: 'INV-7' } }]);
  t('hideChitCosts | buy: my own add stays, the other goes; charged above my own is refused, the chit sum with it', [hidden.line_delivery[CHIT].added.map((a) => a.amount), hidden.line_delivery[CHIT].charged, hidden.delivery_summary.charged, hidden.cost_hidden], [[10, undefined], undefined, undefined, true]);
  const own = view.hideChitCosts({ line_delivery: { [CHIT]: { charged: 10, added: [{ delivery_id: CHIT, amount: 10 }] } }, delivery_summary: { charged: 10 } }, { side: 'buy', mine: new Set([CHIT]) });
  t('hideChitCosts | buy: charged that is exactly my own sum stays, and so does the chit\'s', [own.line_delivery[CHIT].charged, own.delivery_summary.charged], [10, 10]);
  const sell = view.hideChitCosts({ header: structuredClone(SALE), detail: structuredClone(DETAIL) }, { side: 'sell' });
  t('hideChitCosts | sell: the price and the money stay, only the cost-named keys go', [sell.detail.line_items[0].price, sell.header.summary_json.money.total, costKeys(sell), sell.cost_hidden], [SECRET.price, SECRET.money_total, [], true]);
  t('hideChitCosts | unknown side is treated as buy (fails closed): the price goes', view.hideChitCosts({ detail: structuredClone(DETAIL) }, { side: 'unknown' }).detail.line_items[0].price, undefined);
  t('hideRowCosts | a buy row loses money and total_value and says cost_hidden; a sell row with nothing named is as it was', [view.hideRowCosts({ summary_json: structuredClone(SUMMARY) }, 'buy'), view.hideRowCosts({ summary_json: { total_value: 5 } }, 'sell')], [{ summary_json: { line_item_count: 2, currency_code: 'INR', purpose: 'order' }, cost_hidden: true }, { summary_json: { total_value: 5 } }]);
  t('rollupGroup | the sum keeps the sales members only, the count stays, cost_hidden when one was left out', view.rollupGroup({ key: 'k', chits: 2, members: [{ total_value: '5', purpose: 'invoice', sender_entity_id: SUPPLIER, all_recipients: [] }, { total_value: '7.5', purpose: 'order', sender_entity_id: CUSTOMER, all_recipients: [] }] }, SHOP, new Map([[CUSTOMER, { customer: true, supplier: false }]])), { key: 'k', chits: 2, total_value: '7.50', cost_hidden: true });
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
  t('bill | blind: his OWN add amount stays, the other actor\'s goes, the sums go', [blind.body.line_delivery[CHIT].added.map((a) => a.amount), blind.body.line_delivery[CHIT].charged, blind.body.delivery_summary.charged], [[SECRET.add, undefined], undefined, undefined]);
  t('bill | blind: no secret figure anywhere in the body (his own add aside)', leaked(blind.raw), [String(SECRET.add)]);
  t('bill | blind: the actions and the doc are the owner\'s (the real header was read before the strip)', [blind.body.actions, blind.body.doc], [owner.body.actions, owner.body.doc]);
  t('bill | owner\'s rows untouched by the blind read (the next owner read is byte-identical)', (await call(port, '/api/chits/' + CHIT, OWNER)).raw === owner.raw, true);

  /* 2 · the counter's goods receipt (sent to self): a purchase — the receipt figures on the header go too */
  SCENE = { header: RECEIPT };
  [owner, granted, blind] = await read('/api/chits/' + CHIT);
  sameRead('receipt', owner, granted);
  t('receipt | blind: costs · goods · landed_total off the header, no secret figure', [blind.body.cost_hidden, blind.body.header.business_json, leaked(blind.raw)], [true, {}, []]);

  /* 3 · a customer's order (a SALE): the price stays; only the cost-named keys go (half i) */
  SCENE = { header: SALE };
  [owner, granted, blind] = await read('/api/chits/' + CHIT);
  sameRead('sale', owner, granted);
  t('sale | blind: price, total and the header money stay', [blind.body.detail.line_items[0].price, blind.body.live_set[0].live.price, blind.body.header.summary_json.money.total, blind.body.detail.total_value], [SECRET.price, owner.body.live_set[0].live.price, SECRET.money_total, String(SECRET.total)]);
  t('sale | blind: the cost-named keys still go, cost_hidden says so', [costKeys(blind.body), blind.body.cost_hidden], [[], true]);
  t('sale | blind: exactly the owner\'s answer minus the cost-named keys', blind.body, Object.assign(stripNamed(owner.body), { cost_hidden: true }));

  /* 4 · my own order SENT with no declared side: the counterparty decides — a supplier hides, a stranger hides (unknown), a customer keeps */
  for (const [party, want] of [[SUPPLIER, 'hidden'], [STRANGER, 'hidden'], [CUSTOMER, 'kept']]) {
    SCENE = { header: sentTo(party) };
    [owner, granted, blind] = await read('/api/chits/' + CHIT);
    sameRead('sent to ' + want, owner, granted);
    t('sent order, counterparty ' + (party === SUPPLIER ? 'a supplier' : party === STRANGER ? 'on no list' : 'a customer') + ' | blind: price ' + want, blind.body.detail.line_items[0].price === undefined ? 'hidden' : 'kept', want);
  }

  /* 5 · the three lists: the summary money goes on a cost-side row, stays on a sale; the side columns never reach the wire */
  for (const [p, name] of [['/api/chits/inbox', 'inbox'], ['/api/chits/sent?sort=date', 'sent'], ['/api/chits/folder?view=archive', 'folder']]) {
    SCENE = { rows: [listRow(BILL), listRow(SALE)] };
    [owner, granted, blind] = await read(p);
    same(name, owner, granted);
    t(name + ' | owner: both rows carry the money; no _sender / _bj on the wire', [owner.status, owner.body.chits.map((c) => c.summary_json.money.total), Object.keys(owner.body.chits[0]).filter((k) => k.startsWith('_'))], [200, [SECRET.money_total, SECRET.money_total], []]);
    t(name + ' | blind: the bill row loses money · total_value and says cost_hidden; the sale row keeps them', [blind.body.chits[0].summary_json.money, blind.body.chits[0].summary_json.total_value, blind.body.chits[0].cost_hidden, blind.body.chits[1].summary_json.money.total, blind.body.chits[1].cost_hidden], [undefined, undefined, true, SECRET.money_total, undefined]);
    t(name + ' | blind: no secret figure but the sale\'s', leaked(blind.raw).sort(), [String(SECRET.money_total), String(SECRET.total)].sort());
  }

  /* 6 · the rollup: the blind actor's sum leaves out the supplier's bill, the count stays, the group says cost_hidden */
  const member = (h) => ({ total_value: String(h.summary_json.total_value), purpose: h.purpose, sender_entity_id: h.sender_entity_id, all_recipients: h.all_recipients, business_json: h.business_json || {} });
  SCENE = { groups: [{ key: 'pending', chits: 2, total_value: String(SECRET.total * 2), members: [member(BILL), member(SALE)] }] };
  [owner, granted, blind] = await read('/api/chits/rollup?group_by=state');
  t('rollup | owner: the sum as the statement gave it (the stand-in answers the member column to everyone)', [owner.status, owner.body.groups[0].total_value, owner.body.groups[0].cost_hidden], [200, String(SECRET.total * 2), undefined]);
  same('rollup', owner, granted);
  t('rollup | blind: the sale alone, two chits, cost_hidden', blind.body.groups[0], { key: 'pending', chits: 2, total_value: SECRET.total.toFixed(2), cost_hidden: true });

  server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error = console.log; console.error(e); process.exit(1); });
