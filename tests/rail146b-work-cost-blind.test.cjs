/**
 * tests/rail146b-work-cost-blind.test.cjs — RAIL-146b: the shop's purchase money never reaches a cost-blind co-assist through the work reads.
 *
 * OWNS      the proof, per read (GET /api/work/list · /facts?unbilled=1 · /:chit_id), that an actor without can_see_costs gets NO purchase money in ANY form on a cost-side
 *           row: no total_minor, no line price_minor, no ₹ anywhere in the body, no planted figure (also under odd keys, prototype-named keys and bare strings), and the
 *           marker cost_hidden:true; that a SALES row stays priced for him; that an order from a party on no list hides (fail closed); that a failed side read hides;
 *           that the owner and a cost-allowed actor read the same answer as before; that the owner pays no extra statement and the blind reader ONE can_see_costs read.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/work.js, lib/work-rows and lib/cost-view over tests/support/work-stub.cjs.
 * FLOW      world (copies · lines · roles · flag) → real route → body → whole-text scan (₹ and every planted figure) → the sales row and the owner untouched
 * CARD      02-tasks-orders-and-workflow/everyones-work
 *
 * Run: node tests/rail146b-work-cost-blind.test.cjs
 */
'use strict';
const S = require('./support/work-stub.cjs');
const { D, E1, U, copy, seed, as, get } = S;

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(96) + (ok ? '' : JSON.stringify(got).slice(0, 300) + '   want ' + JSON.stringify(want).slice(0, 200)));
};
const SUP = '33333333-3333-4333-8333-333333333333', CUS = '55555555-5555-4555-8555-555555555555', STRANGER = '66666666-6666-4666-8666-666666666666';
const BLIND = { identity_id: 'A7', identity_type: 'actor', entity_id: E1 };
const OWNER = { identity_id: E1, identity_type: 'entity', entity_id: E1 };

/* figures no other field could carry (each also as minor units and as the statement's two-place text) */
const FIG = { value: 4242.5, sentValue: 3131.25, p1: 4141.25, p2: 4040.75, p3: 2929.5, odd: 4646.5, proto: 4545.5, tostr: 4444.5, own: 4343.5, remark: 5151.5, address: 5050.5, note: 4949.5, task: 4848.5, bare: 4747.5, sold: 1200.5 };
const shapes = (n) => [String(n), n.toFixed(2), String(Math.round(n * 100))];
const SECRET_FIG = Object.entries(FIG).filter(([k]) => k !== 'sold').flatMap(([, n]) => shapes(n));
const leaked = (raw) => SECRET_FIG.filter((s) => new RegExp('(^|[^0-9.])' + s.replace('.', '\\.') + '([^0-9]|$)').test(raw));
/** THE WHOLE-TEXT SCAN: no ₹ and no planted purchase figure anywhere in the raw body */
const noLeak = (label, body) => { const raw = JSON.stringify(body); t(label + ' | whole-body scan: no ₹, no planted figure', [/₹/.test(raw), leaked(raw)], [false, []]); };
const moneyKeys = (v) => (v && typeof v === 'object' ? Object.keys(v).flatMap((k) => (/^(total_minor|price_minor)$/.test(k) && v[k] != null ? [k] : moneyKeys(v[k]))) : []);

/** a line as the chit stores it, with figures under the keys the row builder never maps and under objects where a word is expected */
const line = (id, name, qty, price, extra) => Object.assign({ line_id: U(id), particulars: name, quantity: qty, unit: 'kg', price, unit_price: price, line_total: price * qty, comment: 'paid Rs ' + FIG.note }, extra);
/** raw JSON: an OWN key named __proto__ (Object.assign would set the prototype instead) */
const planted = () => JSON.parse(`{"__proto__":{"price":${FIG.proto}},"constructor":"Rs ${FIG.tostr}","toString":${FIG.tostr},"hasOwnProperty":${FIG.own},"valueOf":"Total Rs ${FIG.bare}"}`);
const oddOrderDetails = (name) => JSON.parse(`{"channel":"online","fulfilment":"delivery","name":"${name}","remark":"advance Rs ${FIG.remark}","address":"Rs ${FIG.address} Road","__proto__":{"total":${FIG.proto}},"constructor":"Rs ${FIG.tostr}"}`);

/** the world: c1 an order from a SUPPLIER (cost), c2 an order I SENT to a supplier (cost), c3 an order from a CUSTOMER (sale), c4 an order from a party on no list (hidden) */
function world() {
  seed();
  D.copies = [
    copy(1, { sender_entity_id: SUP, counterparty_id: SUP, counterparty_name: 'Mill', auto_subject: 'Supplier order', value: String(FIG.value), summary_json: Object.assign({ order_details: oddOrderDetails('Mill') }, planted()) }),
    copy(2, { direction: 'sent', sender_entity_id: E1, all_recipients: [{ entity_id: SUP, display_name: 'Mill' }], counterparty_id: SUP, counterparty_name: 'Mill', auto_subject: 'Order to mill', value: String(FIG.sentValue), summary_json: { order_details: 'Total Rs ' + FIG.bare } }),
    copy(3, { sender_entity_id: CUS, counterparty_id: CUS, counterparty_name: 'Ravi', auto_subject: 'Customer order', value: String(FIG.sold), summary_json: { order_details: Object.assign(oddOrderDetails('Ravi'), { remark: 'ring first' }) } }),
    copy(4, { sender_entity_id: STRANGER, counterparty_id: STRANGER, counterparty_name: 'Walk-in', auto_subject: 'Unlisted order', value: String(FIG.odd) })
  ];
  D.roles = { [SUP]: { supplier: true }, [CUS]: { customer: true } };
  D.detail = {
    [U(1)]: { line_items: [line(101, 'Rice', 10, FIG.p1, planted()), line(102, 'Dal', 5, FIG.p2, { unit: { price: FIG.odd }, particulars: { total: FIG.odd } }), 'Rs ' + FIG.bare, { line_id: U(103), particulars: 'Oil', quantity: 1, unit: 'l', price: { total: FIG.proto } }],
      business_json: { order_no: { total: FIG.odd }, party: 'Total Rs ' + FIG.bare, ref: { price: FIG.odd } } },
    [U(2)]: { line_items: [line(201, 'Sugar', 4, FIG.p3)], business_json: { order_no: 'PO-9', party: { name: 'Mill', total: FIG.odd } } },
    [U(3)]: { line_items: [line(301, 'Tea', 2, FIG.sold)], business_json: { order_no: 'SO-3' } },
    [U(4)]: { line_items: [line(401, 'Salt', 1, FIG.odd)], business_json: {} }
  };
  D.bj = { [U(1)]: {}, [U(2)]: {}, [U(3)]: {}, [U(4)]: {} };
  D.progress = [];
  D.marks = [];
  D.assign = [
    { chit_id: U(1), line_id: U(101), seq: 1, assignee_actor_id: 'A9', assignee_name: 'Ravi', assignee_type: 'human', task: 'pack', due_date: '2026-10-11', note: 'owe Rs ' + FIG.note, created_at: '2026-10-09T00:00:00Z', state: 'open' },
    { chit_id: U(1), line_id: U(101), seq: 2, assignee_actor_id: 'A1', assignee_name: 'Asha', assignee_type: 'human', task: 'weigh', due_date: '2026-10-12', note: 'owe Rs ' + FIG.note, created_at: '2026-10-10T00:00:00Z', state: 'open' }
  ];
}
const rowOf = async (view, q) => ((await get('/api/work/list?view=' + view + '&q=' + q)).body.rows || [])[0];

(async () => {
  await S.start();
  console.log('\n══ RAIL-146b · the work reads hide the purchase money from a cost-blind co-assist ══\n');

  /* ── a cost-side row, per route ── */
  for (const [name, id, view, q] of [['c1 an order FROM a supplier', 1, 'orders_in', 'Supplier'], ['c2 an order I SENT to a supplier', 2, 'orders_out', 'mill']]) {
    world(); as(BLIND); D.canSeeCosts = false;
    const list = await get('/api/work/list?view=' + view + '&q=' + q);
    t(name + ' | list answers 200 with one row', [list.status, (list.body.rows || []).length], [200, 1]);
    t(name + ' | list: cost_hidden:true, no total_minor', [list.body.rows[0].cost_hidden, 'total_minor' in list.body.rows[0]], [true, false]);
    noLeak(name + ' | list', list.body);
    const one = await get('/api/work/' + U(id));
    t(name + ' | sheet answers 200, cost_hidden:true, no total_minor, no line price_minor', [one.status, one.body.cost_hidden, moneyKeys(one.body)], [200, true, []]);
    t(name + ' | sheet: the lines are still there, with quantities (the work is not hidden)', one.body.lines.length > 0 && one.body.lines.every((l) => l.line_id && 'qty' in l && 'remaining' in l), true);
    noLeak(name + ' | sheet', one.body);
  }
  world(); as(BLIND); D.canSeeCosts = false;
  const all = (await Promise.all(['orders_in', 'orders_out'].map((v) => get('/api/work/list?view=' + v)))).map((r) => r.body);
  noLeak('both folders at once (the unfiltered list)', all.map((b) => b.rows.filter((row) => row.chit_id !== U(3))));
  const facts = await get('/api/work/facts?unbilled=1');
  t('facts?unbilled=1: a mixed set answers minor:null with cost_hidden:true (never a plausible wrong sum)', [facts.status, facts.body.figures.unbilled.minor, facts.body.figures.unbilled.cost_hidden, facts.body.figures.unbilled.n], [200, null, true, 3]);
  noLeak('facts?unbilled=1', facts.body);

  /* ── a sales row stays priced ── */
  const sale = await rowOf('orders_in', 'Customer');
  t('a SALES row (a customer-only party) stays priced and carries no marker', [sale.total_minor, sale.cost_hidden], [120050, undefined]);
  const saleSheet = (await get('/api/work/' + U(3))).body;
  t('a SALES sheet stays priced: total and every line price', [saleSheet.total_minor, saleSheet.lines.map((l) => l.price_minor), saleSheet.cost_hidden], [120050, [120050], undefined]);
  t('a SALES sheet: the remark and address a customer typed stay (not the shop\'s purchase)', [saleSheet.remark, saleSheet.address], ['ring first', 'Rs ' + FIG.address + ' Road']);
  D.copies = [D.copies[2]];
  const saleFacts = (await get('/api/work/facts?unbilled=1')).body.figures.unbilled;
  t('facts?unbilled=1 over sales only keeps the sum, no marker', saleFacts, { n: 1, minor: 120050, currency: 'INR' });

  /* ── fail closed ── */
  world(); as(BLIND); D.canSeeCosts = false;
  const stranger = await rowOf('orders_in', 'Unlisted');
  t('an order from a party on NO list hides (unknown fails closed)', [stranger.cost_hidden, 'total_minor' in stranger], [true, false]);
  D.roles = { [SUP]: { supplier: true, customer: true }, [CUS]: { customer: true } };
  t('a party on BOTH lists is not a customer-only: hidden', [(await rowOf('orders_in', 'Supplier')).cost_hidden], [true]);
  D.bj[U(3)] = { side: 'buy' };
  t('a sender-declared side buy only hides more: the customer order hides', [(await rowOf('orders_in', 'Customer')).cost_hidden], [true]);
  D.bj[U(3)] = { side: 'sell' };
  D.roles = { [SUP]: { supplier: true } };
  t('a sender-declared side sell never unhides: a customer not on the list stays hidden', [(await rowOf('orders_in', 'Customer')).cost_hidden], [true]);
  D.roles = new Proxy({}, { get() { throw new Error('the lists are down'); } });
  const down = await rowOf('orders_in', 'Customer');
  t('a failed side read hides every row (no 500, no money)', [down.cost_hidden, 'total_minor' in down], [true, false]);
  noLeak('a failed side read', down);

  /* ── the owner and a cost-allowed actor ── */
  world(); as(OWNER); D.statements.length = 0;
  const ownerList = (await get('/api/work/list?view=orders_in')).body, ownerOne = (await get('/api/work/' + U(1))).body, ownerFacts = (await get('/api/work/facts?unbilled=1')).body;
  t('the owner reads the cost-side row priced: total_minor 424250, the line price 414125', [ownerList.rows.find((r) => r.chit_id === U(1)).total_minor, ownerOne.lines[0].price_minor], [424250, 414125]);
  t('the owner\'s rows carry no cost_hidden anywhere', JSON.stringify([ownerList, ownerOne, ownerFacts]).includes('cost_hidden'), false);
  t('the owner pays no side read and no cost-flag read', D.statements.some((s) => /can_see_costs|customer_list|chit_header h WHERE/.test(s)), false);
  as(BLIND); D.canSeeCosts = true; D.statements.length = 0; /* the same world: its created_at stamps are the clock's */
  const allowedList = (await get('/api/work/list?view=orders_in')).body, allowedOne = (await get('/api/work/' + U(1))).body, allowedFacts = (await get('/api/work/facts?unbilled=1')).body;
  t('a cost-allowed actor reads exactly what the owner reads (list, sheet, facts), byte for byte', JSON.stringify([allowedList, allowedOne, allowedFacts]), JSON.stringify([ownerList, ownerOne, ownerFacts]));
  t('a cost-allowed actor pays the cost-flag read and no side read', [D.statements.some((s) => /can_see_costs/.test(s)), D.statements.some((s) => /customer_list|chit_header h WHERE/.test(s))], [true, false]);

  /* ── one can_see_costs read per request; the side read is two statements per page ── */
  world(); as(BLIND); D.canSeeCosts = false; D.statements.length = 0;
  await get('/api/work/list?view=orders_in');
  t('a blind list: ONE can_see_costs read and ONE side read for the whole page (not per row)', [D.statements.filter((s) => /can_see_costs/.test(s)).length, D.statements.filter((s) => /customer_list/.test(s)).length, D.statements.filter((s) => /chit_header h WHERE/.test(s)).length], [1, 1, 1]);
  D.statements.length = 0;
  await get('/api/work/' + U(1));
  t('a blind sheet: ONE can_see_costs read, ONE side read', [D.statements.filter((s) => /can_see_costs/.test(s)).length, D.statements.filter((s) => /customer_list/.test(s)).length], [1, 1]);

  /* ── the spec is the same kind as the others: no prototype, frozen, no pass-through ── */
  const costView = require('../lib/cost-view');
  t('WORK_ROW_KEEP has no prototype and is frozen (a key named constructor finds nothing)', [Object.getPrototypeOf(costView.WORK_ROW_KEEP), Object.isFrozen(costView.WORK_ROW_KEEP)], [null, true]);
  const pruned = costView.hideWorkCosts(JSON.parse('{"chit_id":"x","total_minor":5,"constructor":"Rs 4","__proto__":{"price":1},"toString":7,"lines":["Rs 3",{"line_id":"l","price_minor":9,"unit":{"price":8}}],"assignee":"Rs 5"}'), 'buy');
  t('hideWorkCosts: unnamed and prototype-named keys, bare strings and objects where a word is expected are gone', [Object.keys(pruned).sort(), pruned.lines], [['chit_id', 'cost_hidden', 'lines'], [{ line_id: 'l' }]]);
  t('hideWorkCosts does not change its input', JSON.stringify(costView.hideWorkCosts({ total_minor: 1 }, 'sell')), JSON.stringify({ total_minor: 1 }));

  S.stop();
  console.log('\n  ' + (fail ? '✗' : '✓') + ' ' + pass + ' passed · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((failure) => { console.error(failure); process.exit(1); });
