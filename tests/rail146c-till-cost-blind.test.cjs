/**
 * tests/rail146c-till-cost-blind.test.cjs — RAIL-146c: the shop's purchase money never reaches a cost-blind co-assist through the till's two reads,
 * GET /api/till/tasks (line rate) and GET /api/till/match (rates, ordered / received / invoiced totals, money gap, landed, the door's typed reason).
 *
 * OWNS      the proof, per read, that an actor without can_see_costs gets NO purchase money in ANY form on a cost-side order: no rate, no *_total, no money_gap,
 *           no landed, no ₹ in the body, none of the owner's own figures anywhere in the raw text (the scan is calibrated on the OWNER's answer: every money figure it
 *           holds must be absent from the blind body), and cost_hidden:true; that a SALES order stays priced; that an order from a party on no list hides (fail closed);
 *           that a failed side read hides; that amount filters and sort are taken off and named in cost_params_ignored; that the owner, a cost-allowed actor and the paired
 *           till KEY read the same bytes as before; that a blind request pays ONE can_see_costs read and ONE side read, the owner none; the spec trees are frozen, bare, closed.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/till.js, lib/open-orders and lib/cost-view over a stubbed db.
 * FLOW      world (heads · lines · roles · flag) → real route → body → whole-text scan → the sales order, the owner and the key untouched
 * CARD      02-tasks-orders-and-workflow/open-orders-queue
 *
 * Run: node tests/rail146c-till-cost-blind.test.cjs
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
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(96) + (ok ? '' : String(JSON.stringify(got)).slice(0, 300) + '   want ' + String(JSON.stringify(want)).slice(0, 200)));
};

const E1 = 'e1';
const U = (n) => '30000000-0000-4000-8000-' + String(n).padStart(12, '0');
const SUP = '33333333-3333-4333-8333-333333333333', CUS = '55555555-5555-4555-8555-555555555555', STRANGER = '66666666-6666-4666-8666-666666666666';
const OWNER = { identity_id: E1, identity_type: 'entity' };
const KEY = { identity_id: E1, identity_type: 'entity', api_key: true };
const BLIND = { identity_id: 'a1', identity_type: 'actor', access_level: 'editor', parent_entity_id: E1 };
let WHO = OWNER, CAN = false, ROLES = {}, BJ = {}, LISTS_DOWN = false;
const STATEMENTS = [];

/* figures no other field could carry */
const FIG = { rate1: 4141.25, rate2: 4040.75, rateS: 2929.5, sold: 1200.5, bill: 6161.5, landed: 7171.5, goods: 8181.5, remark: 5151.5, address: 5050.5, reason: 4949.5, proto: 4545.5, odd: 4646.5, bare: 4747.5 };
const shapes = (n) => [String(n), n.toFixed(2), String(Math.round(n * 100))];
const SECRET_FIG = Object.entries(FIG).filter(([k]) => k !== 'sold').flatMap(([, n]) => shapes(n));
const leaked = (raw) => SECRET_FIG.filter((s) => new RegExp('(^|[^0-9.])' + s.replace('.', '\\.') + '([^0-9]|$)').test(raw));
const noLeak = (label, body) => { const raw = JSON.stringify(body); t(label + ' | whole-body scan: no ₹, no planted figure', [/₹/.test(raw), leaked(raw)], [false, []]); };
/** every money figure the OWNER's answer holds (a rate, a *_total, the gap, a landed) as text: the blind body must hold none of them */
const MONEY_KEY = /^(rate|price|landed|goods|extras|money_gap|ordered_total|received_total|invoiced_total|total)$/;
const figuresOf = (v, out = new Set()) => { if (v && typeof v === 'object') Object.keys(v).forEach((k) => (MONEY_KEY.test(k) && typeof v[k] === 'number' && v[k] !== 0 ? shapes(v[k]).forEach((s) => out.add(s)) : figuresOf(v[k], out))); return out; };
const moneyKeys = (v) => (v && typeof v === 'object' ? Object.keys(v).flatMap((k) => (/^(rate|ordered_total|received_total|invoiced_total|money_gap|landed|reason|invoiced_from)$/.test(k) && v[k] != null ? [k] : moneyKeys(v[k]))) : []);
const hasFig = (raw, set) => [...set].filter((s) => new RegExp('(^|[^0-9.])' + s.replace('.', '\\.') + '([^0-9]|$)').test(raw));

/** raw JSON: an OWN key named __proto__ (Object.assign would set the prototype instead) */
const planted = () => JSON.parse(`{"__proto__":{"price":${FIG.proto}},"constructor":"Rs ${FIG.odd}","toString":${FIG.odd},"valueOf":"Total Rs ${FIG.bare}"}`);
const line = (id, name, qty, price, extra) => Object.assign({ line_id: U(id), particulars: name, quantity: qty, unit: 'kg', price, unit_price: price, line_total: price * qty, comment: 'paid Rs ' + FIG.reason }, extra);
const head = (n, o) => Object.assign({ chit_id: U(n), created_at: '2026-10-25T10:00:00Z', purpose: 'order', direction: 'sent', current_status: 'pending', sender_entity_id: E1, all_recipients: [], summary_json: {}, entity_id: E1 }, o);
const online = (name) => JSON.parse(`{"channel":"online","fulfilment":"delivery","name":"${name}","remark":"advance Rs ${FIG.remark}","address":"Rs ${FIG.address} Road","__proto__":{"total":${FIG.proto}}}`);

/** the world. 1: order I SENT to a supplier (cost) · 2: a self-chit PO declared buy (cost) · 3: an order from a CUSTOMER (sale) · 4: from a party on no list (hidden) · 5: I SENT to a customer-only party (a mis-listed sale) */
let HEADS = [], DETAIL = {}, RECEIPTS = [], INVOICES = [], PROGRESS = new Map();
function world() {
  HEADS = [
    head(1, { counterparty_id: SUP, counterparty_name: 'Mill', all_recipients: [{ entity_id: SUP, display_name: 'Mill' }], auto_subject: 'Order to mill' }),
    head(2, { direction: 'received', counterparty_name: 'Dal Co', all_recipients: [{ entity_id: E1 }], auto_subject: 'Own PO' }),
    head(3, { direction: 'received', sender_entity_id: CUS, counterparty_id: CUS, counterparty_name: 'Ravi', all_recipients: [{ entity_id: E1 }], auto_subject: 'Customer order', summary_json: { order_details: Object.assign(online('Ravi'), { remark: 'ring first', address: 'Gate 9' }) } }),
    head(4, { direction: 'received', sender_entity_id: STRANGER, counterparty_id: STRANGER, counterparty_name: 'Walk-in', all_recipients: [{ entity_id: E1 }], auto_subject: 'Unlisted order', summary_json: { order_details: online('Walk-in') } }),
    head(5, { counterparty_id: CUS, counterparty_name: 'Ravi', all_recipients: [{ entity_id: CUS, display_name: 'Ravi' }], auto_subject: 'Order to Ravi' })
  ];
  ROLES = { [SUP]: { supplier: true }, [CUS]: { customer: true } };
  BJ = { [U(1)]: {}, [U(2)]: { side: 'buy' }, [U(3)]: {}, [U(4)]: {}, [U(5)]: {} };
  DETAIL = {
    [U(1)]: { line_items: [line(101, 'Rice', 10, FIG.rate1, planted()), line(102, 'Dal', 5, FIG.rate2, { unit: { price: FIG.odd }, particulars: { total: FIG.odd } }), 'Rs ' + FIG.bare], business_json: { side: 'buy' } },
    [U(2)]: { line_items: [line(201, 'Sugar', 4, FIG.rateS)], business_json: { side: 'buy' } },
    [U(3)]: { line_items: [line(301, 'Tea', 2, FIG.sold)], business_json: {} },
    [U(4)]: { line_items: [line(401, 'Salt', 1, FIG.odd)], business_json: {} },
    [U(5)]: { line_items: [line(501, 'Coffee', 3, FIG.sold)], business_json: {} }
  };
  RECEIPTS = [{ chit_id: U(91), created_at: '2026-10-26T10:00:00Z', business_json: { against: { chit_id: U(1) }, doc_no: 'GRN1', goods: FIG.goods, extras: 100.25, landed_total: FIG.landed, their_bill: { no: 'B-7', total: FIG.bill } },
    line_items: [{ line_id: U(101), reason: 'short, bill said Rs ' + FIG.reason }] }];
  INVOICES = [];
  PROGRESS = new Map([[U(1), new Map([[U(101), { delivered: 8 }]])], [U(5), new Map()]]);
}

const mock = (rel, exports) => { require.cache[require.resolve(API + rel)] = { id: rel, filename: rel, loaded: true, exports }; };
mock('/middleware/auth', Object.assign((req, res, next) => { req.identity = WHO; if (WHO.api_key) req.api_key = { id: 'k' }; next(); }, {
  entityOf: (req) => (req.identity && (req.identity.parent_entity_id || req.identity.identity_id)) || null,
  requireScope: () => (req, res, next) => next(),
  userOf: (req) => req.identity
}));
/** the stubbed database: only the statements these two reads send */
const dbq = async (sql, params) => {
  const text = String(sql).replace(/\s+/g, ' ');
  STATEMENTS.push(text);
  if (/can_see_costs FROM identities/.test(text)) return { rows: [{ can_see_costs: CAN }] };
  if (/EXISTS [(]SELECT 1 FROM customer_list/.test(text)) {
    if (LISTS_DOWN) throw new Error('the lists are down');
    return { rows: params[1].map((id) => ({ id, customer: !!(ROLES[id] || {}).customer, supplier: !!(ROLES[id] || {}).supplier })) };
  }
  if (/SELECT DISTINCT ON [(]h[.]chit_id[)]/.test(text)) return { rows: params[1].filter((id) => BJ[id]).map((id) => ({ chit_id: id, business_json: BJ[id] })) };
  if (/h[.]purpose = 'receipt'/.test(text)) return { rows: RECEIPTS };
  if (/h[.]direction = 'received' AND h[.]purpose = 'invoice'/.test(text)) return { rows: INVOICES };
  if (/FROM chit_header h LEFT JOIN chit_detail d/.test(text)) return { rows: params[1].filter((id) => DETAIL[id]).map((id) => Object.assign({ chit_id: id }, DETAIL[id])) };
  return { rows: [] };
};
mock('/db', { query: dbq, withEntity: async (_id, fn) => fn({ query: dbq }), readBatch: async () => [] });

const get = (port, p) => new Promise((ok, bad) => {
  http.get({ host: '127.0.0.1', port, path: p }, (res) => {
    let raw = '';
    res.on('data', (c) => (raw += c));
    res.on('end', () => ok({ status: res.statusCode, raw, body: raw ? JSON.parse(raw) : null }));
  }).on('error', bad);
});
const as = (who, can) => { WHO = who; CAN = can; LISTS_DOWN = false; STATEMENTS.length = 0; };
const idsOf = (rows) => (rows || []).map((row) => row.chit_id).sort();

(async () => {
  const select = require(API + '/lib/select');
  select.rows = async (_entity, opts) => (opts && opts.purpose === 'invoice' ? [] : HEADS.map((h) => Object.assign({}, h)));
  require(API + '/lib/policy').get = async () => ({});
  const deliverline = require(API + '/lib/deliverline');
  deliverline.progress = async (_entity, chitId) => PROGRESS.get(chitId) || new Map();
  deliverline.progressMany = async () => new Map(PROGRESS);

  const app = express();
  app.use(express.json());
  app.use('/api/till', require(API + '/routes/till'));
  const srv = app.listen(0);
  const port = srv.address().port;
  console.log('\n══ RAIL-146c · the till\'s tasks and match hide the purchase money from a cost-blind co-assist ══\n');

  /* ── the owner's answers: the calibration (their money figures must be absent from every blind body) ── */
  world(); as(OWNER, true);
  const ownerReceive = await get(port, '/api/till/tasks?kind=receive'), ownerDespatch = await get(port, '/api/till/tasks?kind=despatch'), ownerMatch = await get(port, '/api/till/match');
  t('the owner reads tasks priced: the supplier order line has its rate', [ownerReceive.status, ownerReceive.body.tasks.find((x) => x.chit_id === U(1)).lines[0].rate], [200, FIG.rate1]);
  t('the owner reads the match priced and with the door\'s reason', [ownerMatch.status, ownerMatch.body.orders.find((x) => x.chit_id === U(1)).ordered_total, ownerMatch.body.orders.find((x) => x.chit_id === U(1)).receipts[0].landed], [200, 10 * FIG.rate1 + 5 * FIG.rate2, FIG.landed]);
  t('the owner\'s answers carry no cost_hidden and no cost_params_ignored', /cost_hidden|cost_params_ignored/.test(ownerReceive.raw + ownerDespatch.raw + ownerMatch.raw), false);
  const costSideOnly = (rows) => rows.filter((x) => x.chit_id === U(1) || x.chit_id === U(2));
  const OWNER_FIGS = new Set([...figuresOf(costSideOnly(ownerReceive.body.tasks)), ...figuresOf(costSideOnly(ownerMatch.body.orders))]);
  t('the calibration holds the supplier-side figures (rates, totals, gap, landed)', OWNER_FIGS.size > 10, true);

  /* ── tasks, cost side ── */
  as(BLIND, false);
  const recv = await get(port, '/api/till/tasks?kind=receive');
  t('tasks receive: answers 200 with the two purchase tasks, still there with their quantities', [recv.status, idsOf(recv.body.tasks), recv.body.tasks.every((x) => x.lines.every((l) => l.line_id && 'ordered' in l && 'remaining' in l))], [200, [U(1), U(2), U(5)], true]);
  t('tasks receive: every cost-side task says cost_hidden:true and no line carries a rate', recv.body.tasks.filter((x) => x.chit_id !== U(5)).map((x) => [x.cost_hidden, x.lines.some((l) => 'rate' in l)]), [[true, false], [true, false]]);
  noLeak('tasks receive', recv.body.tasks.filter((x) => x.chit_id !== U(5)));
  t('tasks receive: none of the owner\'s own figures is in the blind body (but the mis-listed sale\'s)', hasFig(JSON.stringify(recv.body.tasks.filter((x) => x.chit_id !== U(5))), OWNER_FIGS), []);
  t('tasks: a body-wide scan for the rate key', moneyKeys(recv.body.tasks.filter((x) => x.chit_id !== U(5))), []);
  t('tasks receive: an order I sent to a CUSTOMER-only party is a sale by the shop\'s lists and stays priced', recv.body.tasks.find((x) => x.chit_id === U(5)).lines[0].rate, FIG.sold);
  t('tasks receive: that sales task carries no marker', 'cost_hidden' in recv.body.tasks.find((x) => x.chit_id === U(5)), false);

  /* ── tasks, sales and unknown ── */
  const desp = await get(port, '/api/till/tasks?kind=despatch');
  const sale = desp.body.tasks.find((x) => x.chit_id === U(3)), stranger = desp.body.tasks.find((x) => x.chit_id === U(4));
  t('tasks despatch: a SALES task (customer-only party) stays priced, the address and remark a customer typed stay', [sale.lines[0].rate, sale.cost_hidden, sale.order.address, sale.order.remark], [FIG.sold, undefined, 'Gate 9', 'ring first']);
  t('tasks despatch: an order from a party on NO list hides its rate (unknown fails closed)', [stranger.cost_hidden, stranger.lines.some((l) => 'rate' in l)], [true, false]);
  t('tasks despatch: the unknown order\'s typed address and remark go with the marker', [stranger.order.address, stranger.order.remark, Object.keys(stranger.order).sort()], [undefined, undefined, ['channel', 'fulfilment', 'name', 'requested_delivery']]);
  noLeak('tasks despatch (the unknown order)', stranger);
  ROLES = { [SUP]: { supplier: true, customer: true }, [CUS]: { customer: true } };
  BJ[U(3)] = { side: 'buy' };
  t('tasks: a sender-declared side buy only hides more (the customer order hides)', (await get(port, '/api/till/tasks?kind=despatch')).body.tasks.find((x) => x.chit_id === U(3)).cost_hidden, true);
  BJ[U(3)] = { side: 'sell' };
  ROLES = {};
  t('tasks: a sender-declared side sell never unhides (a customer not on the list stays hidden)', (await get(port, '/api/till/tasks?kind=despatch')).body.tasks.find((x) => x.chit_id === U(3)).cost_hidden, true);
  world(); as(BLIND, false);
  LISTS_DOWN = true;
  const down = await get(port, '/api/till/tasks?kind=despatch');
  t('tasks: a failed side read hides every task (no 500, no rate)', [down.status, down.body.tasks.every((x) => x.cost_hidden === true && x.lines.every((l) => !('rate' in l)))], [200, true]);
  noLeak('tasks, a failed side read', down.body);

  /* ── match ── */
  world(); as(BLIND, false);
  const match = await get(port, '/api/till/match');
  const costSide = match.body.orders.filter((x) => x.chit_id === U(1) || x.chit_id === U(2));
  t('match: answers 200 with the purchase orders (the work is not hidden)', [match.status, idsOf(match.body.orders)], [200, [U(1), U(2), U(5)].sort()]);
  t('match: every cost-side order says cost_hidden:true and has no rate, total, gap, landed, source word or typed reason', costSide.map((x) => [x.cost_hidden, moneyKeys(x)]), [[true, []], [true, []]]);
  t('match: the quantities, the verdict and the receipt number stay', [costSide[0].lines[0].ordered, costSide[0].lines[0].received, typeof costSide[0].verdict, costSide[0].receipts[0].no, costSide[0].receipts[0].their_bill_no], [10, 8, 'string', 'GRN1', 'B-7']);
  noLeak('match', costSide);
  t('match: none of the owner\'s own figures is in the blind body', hasFig(JSON.stringify(costSide), OWNER_FIGS), []);
  const misListed = match.body.orders.find((x) => x.chit_id === U(5));
  t('match: an order to a customer-only party is a sale by the shop\'s lists and stays priced', [misListed.lines[0].rate, misListed.ordered_total, misListed.cost_hidden], [FIG.sold, 3 * FIG.sold, undefined]);
  ROLES = {};
  const lost = (await get(port, '/api/till/match')).body.orders.find((x) => x.chit_id === U(5));
  t('match: the same order from a party on NO list hides (unknown fails closed)', [lost.cost_hidden, moneyKeys(lost)], [true, []]);
  world(); as(BLIND, false);
  LISTS_DOWN = true;
  const matchDown = await get(port, '/api/till/match');
  t('match: a failed side read hides every order', [matchDown.status, matchDown.body.orders.every((x) => x.cost_hidden === true && moneyKeys(x).length === 0)], [200, true]);
  noLeak('match, a failed side read', matchDown.body);

  /* ── filters and sort over money are taken off and named ── */
  world(); as(BLIND, false);
  const ignored = await get(port, '/api/till/match?amount_min=5000&amount_max=9000&sort=amount&sort[]=amount');
  t('match: amount_min / amount_max / sort=amount are named in cost_params_ignored', ignored.body.cost_params_ignored, ['amount_min', 'amount_max', 'sort']);
  const ignoredTasks = await get(port, '/api/till/tasks?kind=receive&amount_min=1&sort[]=amount');
  t('tasks: an array sort and an amount filter are named too', ignoredTasks.body.cost_params_ignored, ['amount_min', 'sort']);
  t('match: a plain sort that is not money is left alone and nothing is named', (await get(port, '/api/till/match?sort=party')).body.cost_params_ignored, undefined);
  as(OWNER, true);
  t('the owner\'s amount filter is not named and not touched (no cost_params_ignored)', 'cost_params_ignored' in (await get(port, '/api/till/match?amount_min=1')).body, false);

  /* ── the owner, a cost-allowed actor and the paired till key: the same bytes ── */
  world(); as(OWNER, true);
  const base = [(await get(port, '/api/till/tasks?kind=receive')).raw, (await get(port, '/api/till/tasks?kind=despatch')).raw, (await get(port, '/api/till/match')).raw];
  STATEMENTS.length = 0;
  await get(port, '/api/till/match');
  t('the owner pays no cost-flag read and no side read', STATEMENTS.some((s) => /can_see_costs|customer_list|DISTINCT ON [(]h[.]chit_id[)]/.test(s)), false);
  as(KEY, false);
  const keyed = [(await get(port, '/api/till/tasks?kind=receive')).raw, (await get(port, '/api/till/tasks?kind=despatch')).raw, (await get(port, '/api/till/match')).raw];
  t('the paired till KEY reads exactly what the owner reads (never blind), byte for byte', keyed, base);
  t('the paired till key pays no cost-flag read', STATEMENTS.some((s) => /can_see_costs/.test(s)), false);
  as(BLIND, true);
  const allowed = [(await get(port, '/api/till/tasks?kind=receive')).raw, (await get(port, '/api/till/tasks?kind=despatch')).raw, (await get(port, '/api/till/match')).raw];
  t('a cost-allowed actor reads exactly what the owner reads, byte for byte', allowed, base);
  t('a cost-allowed actor pays the cost-flag read and no side read', [STATEMENTS.some((s) => /can_see_costs/.test(s)), STATEMENTS.some((s) => /customer_list|DISTINCT ON [(]h[.]chit_id[)]/.test(s))], [true, false]);

  /* ── one can_see_costs read per request; the side read is two statements per page ── */
  for (const url of ['/api/till/match', '/api/till/tasks?kind=receive']) {
    as(BLIND, false);
    await get(port, url);
    t(url + ' | a blind request: ONE can_see_costs read, ONE side read, ONE roles read (not per row)',
      [STATEMENTS.filter((s) => /can_see_costs/.test(s)).length, STATEMENTS.filter((s) => /DISTINCT ON [(]h[.]chit_id[)]/.test(s)).length, STATEMENTS.filter((s) => /customer_list/.test(s)).length], [1, 1, 1]);
  }

  /* ── the spec trees: no prototype, frozen, no pass-through; prototype-named keys, bare strings and objects where a word is expected are gone ── */
  const costView = require(API + '/lib/cost-view');
  t('TASK_KEEP and MATCH_KEEP have no prototype and are frozen', [costView.TASK_KEEP, costView.MATCH_KEEP].map((spec) => [Object.getPrototypeOf(spec), Object.isFrozen(spec)]), [[null, true], [null, true]]);
  const dirtyTask = JSON.parse('{"chit_id":"x","party":"Rs 4","constructor":"Rs 4","__proto__":{"price":1},"toString":7,"order":"Rs 9","lines":["Rs 3",{"line_id":"l","rate":9,"unit":{"price":8},"name":{"total":2},"remaining":3}]}');
  const task = costView.hideTaskCosts(dirtyTask, 'unknown');
  t('hideTaskCosts: unnamed and prototype-named keys, a bare string for an object and an object for a word are gone', [Object.keys(task).sort(), task.lines, task.cost_hidden], [['chit_id', 'cost_hidden', 'lines', 'party'], [{ line_id: 'l', remaining: 3 }], true]);
  const dirtyOrder = JSON.parse('{"chit_id":"x","ordered_total":5,"money_gap":1,"verdict":"differs","invoiced_from":"their invoice","constructor":"Rs 4","__proto__":{"total":1},"lines":["Rs 3",{"line_id":"l","rate":9,"reason":"Rs 7","state":{"price":1},"ordered":2}],"receipts":[{"no":"G","landed":4,"at":{"total":1}},"Rs 8"]}');
  const order = costView.hideMatchCosts(dirtyOrder, 'unknown');
  t('hideMatchCosts: the same, and rate · totals · gap · source word · reason · landed all go', [Object.keys(order).sort(), order.lines, order.receipts, order.cost_hidden], [['chit_id', 'cost_hidden', 'lines', 'receipts', 'verdict'], [{ line_id: 'l', ordered: 2 }], [{ no: 'G' }], true]);
  t('hideMatchCosts on a sales order keeps the money but drops a cost-named key (landed), and does not change its input', [JSON.stringify(costView.hideMatchCosts({ ordered_total: 1, receipts: [{ landed: 5, no: 'G' }] }, 'sell')), JSON.stringify(dirtyOrder).includes('landed')], [JSON.stringify({ ordered_total: 1, receipts: [{ no: 'G' }] }), true]);
  t('a task with nothing withheld carries no marker (an unpriced line, no typed address)', 'cost_hidden' in costView.hideTaskCosts({ chit_id: 'x', lines: [{ line_id: 'l', name: 'Rice', rate: null, remaining: 1 }], order: null }, 'buy'), false);

  srv.close();
  console.log('\n  ' + (fail ? '✗' : '✓') + ' ' + pass + ' passed · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((failure) => { console.error(failure); process.exit(1); });
