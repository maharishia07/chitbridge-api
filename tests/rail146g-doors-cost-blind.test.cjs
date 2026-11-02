/**
 * tests/rail146g-doors-cost-blind.test.cjs — RAIL-146g: the shop's purchase money never reaches a cost-blind actor through the five doors the leak hammer found beside the chit reads:
 * GET /api/facts/rail/chits · GET /api/notifications · GET /api/folders/groupsum · GET /api/invoice/:id · GET /api/tax/invoice/:id.
 *
 * OWNS      the proof, per door, that an actor without can_see_costs (a co-assist, an editor, a VIEWER login: the permission is the flag, not the level) gets NO purchase money
 *           in ANY form on a cost-side chit (a whole-body scan for ₹ and every planted figure) and the marker cost_hidden:true; that his sale stays priced; that an order from a party
 *           on no list hides (fail closed); that the owner and a cost-allowed actor read the same bytes as before, with no side read and no cost_hidden; ONE strip (lib/cost-view).
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes and libs over tests/support/work-stub.cjs plus a stand-in for the bell's feed and the tax copy.
 * FLOW      world (copies · roles · flag) → real route → body → whole-text scan → the sale and the owner untouched
 * CARD      01-rail-core-the-chit/chits-routes
 *

 * Run: node tests/rail146g-doors-cost-blind.test.cjs · MIN unit-per-rule · refusal-path · fail-closed
 */
'use strict';
const http = require('http');
const S = require('./support/work-stub.cjs');
const { D, E1, U, copy, seed, as } = S;
const path = require('path');
const API = path.join(__dirname, '..');
const stubMod = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(100) + (ok ? '' : String(JSON.stringify(got)).slice(0, 300) + '   want ' + String(JSON.stringify(want)).slice(0, 200)));
};
const SUP = '33333333-3333-4333-8333-333333333333', CUS = '55555555-5555-4555-8555-555555555555', STRANGER = '66666666-6666-4666-8666-666666666666';
const BLIND = { identity_id: 'A7', identity_type: 'actor', entity_id: E1 };
const VIEWER = { identity_id: 'A8', identity_type: 'actor', entity_id: E1, level: 'viewer' };
const OWNER = { identity_id: E1, identity_type: 'entity', entity_id: E1 };
/* the purchase figures no other field could carry (each also as minor units and as two-place text); the sale's own figure is NOT secret */
const FIG = { bill: 7777.77, orderOut: 3131.25, unit: 4141.25, odd: 4646.5, tax: 1399.99 };
const SALE = 1200.5;
const shapes = (n) => [String(n), n.toFixed(2), String(Math.round(n * 100))];
const SECRET = Object.values(FIG).flatMap(shapes);
const leaked = (raw) => SECRET.filter((s) => new RegExp('(^|[^0-9.])' + s.replace('.', '\\.') + '([^0-9]|$)').test(raw));
const noLeak = (label, body) => { const raw = JSON.stringify(body); t(label + ' | whole-body scan: no ₹, no planted figure', [/₹/.test(raw), leaked(raw)], [false, []]); };

/* ── stand-ins beside the work-stub: the bell's feed, the tax copy, the group-sum's lines ── */
const FEED = { rows: [], sql: [] };
const dbMod = require('../db');
const realWithEntity = dbMod.withEntity;
dbMod.withEntity = async (entity, fn) => realWithEntity(entity, (c) => fn({ query: async (sql, p) => {
  const text = String(sql).replace(/\s+/g, ' ');
  if (/FROM state_log sl/.test(text)) { FEED.sql.push(text); return { rows: FEED.rows.map((row) => feedRowAs(row, text)) }; }
  if (/notif_seen_at/.test(text)) return { rows: [{ seen: null }] };
  if (/SELECT chit_id, line_items FROM chit_detail/.test(text)) return { rows: Object.entries(D.detail).filter(([id]) => p[1].includes(id)).map(([id, d]) => ({ chit_id: id, line_items: d.line_items })) };
  if (/FROM catalogue_items WHERE entity_id/.test(text)) return { rows: ['Rice', 'Tea', 'Salt'].map((name, index) => ({ item_id: U(900 + index), item_data: { name, unit: 'kg' }, updated_at: '2026-10-01T00:00:00Z' })) };
  if (/FROM catalogue_item_version/.test(text)) return { rows: [] };
  return c.query(sql, p);
} }));
/** what the feed's SELECT would return: the side columns only when the statement asked for them (the blind form adds _sender, _bj, all_recipients) */
function feedRowAs(row, text) {
  const asks = /AS _bj/.test(text) && /AS all_recipients/.test(text);
  const { _sender, _bj, all_recipients, ...plain } = row;
  return asks ? row : plain;
}
const TAX = { copy: null, entry: null };
stubMod('lib/tax-copy.js', Object.assign({}, require('../lib/tax-copy'), { copyOf: async (id, me) => (TAX.copy && TAX.copy.chit_id === id ? TAX.copy : null), entryFor: async () => TAX.entry, invoiceOf: async () => require('../lib/tax-copy').invoiceFrom(TAX.entry) /* the REAL builder over the planted entry */ }));
stubMod('lib/amend.js', Object.assign({}, require('../lib/amend'), { listFor: async () => new Map(), liveLines: (lines) => lines }));
stubMod('lib/policy.js', Object.assign({}, require('../lib/policy'), { get: async () => ({ overdue_days: 3 }) }));

const express = require('express');
const app = express();
app.use('/api/notifications', require('../routes/notifications'));
app.use('/api/folders', require('../routes/folders'));
app.use('/api/invoice', require('../routes/invoice'));
app.use('/api/tax', require('../routes/tax'));
const srv = http.createServer(app);
const call = (url) => new Promise((resolve, reject) => http.get({ port: srv.address().port, path: url }, (res) => {
  let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
}).on('error', reject));

/** the world: c1 a supplier's bill (cost), c2 a customer's order (sale), c3 something from a party on no list (hidden) */
function world() {
  seed();
  D.copies = [
    copy(1, { purpose: 'invoice', doc_kind: 'bill_received', sender_entity_id: SUP, counterparty_id: SUP, counterparty_name: 'Mill', auto_subject: 'Mill bill', value: String(FIG.bill), currency: 'INR' }),
    copy(2, { purpose: 'order', sender_entity_id: CUS, counterparty_id: CUS, counterparty_name: 'Ravi', auto_subject: 'Ravi order', value: String(SALE), currency: 'INR' }),
    copy(3, { purpose: 'general', sender_entity_id: STRANGER, counterparty_id: STRANGER, counterparty_name: 'Walk-in', auto_subject: 'Unlisted', value: String(FIG.odd), currency: 'INR' })
  ];
  D.roles = { [SUP]: { supplier: true }, [CUS]: { customer: true } };
  D.detail = {
    [U(1)]: { line_items: [{ line_id: U(101), particulars: 'Rice', quantity: 10, unit: 'kg', price: FIG.unit }] },
    [U(2)]: { line_items: [{ line_id: U(201), particulars: 'Tea', quantity: 2, unit: 'kg', price: SALE / 2 }] },
    [U(3)]: { line_items: [{ line_id: U(301), particulars: 'Salt', quantity: 1, unit: 'kg', price: FIG.odd }] }
  };
  D.bj = { [U(1)]: {}, [U(2)]: {}, [U(3)]: {} };
  FEED.rows = [];
  FEED.sql = [];
}
const bellRow = (n, o) => Object.assign({ log_id: n, chit_id: U(n), action: 'delivered', action_by_display_name: 'Someone', new_status: 'accepted', detail: 'paid Rs ' + FIG.tax, created_at: '2026-10-29T00:00:00Z', direction: 'received',
  assigned_to_actor_id: null, auto_subject: 'S' + n, manual_subject: null, currency_code: 'INR', order_channel: null, order_fulfilment: null, assigned_to_me: false, dispute_for_me: false }, o);
const bellWorld = () => {
  world();
  FEED.rows = [
    bellRow(1, { purpose: 'invoice', total_value: String(FIG.bill), _sender: SUP, all_recipients: [{ entity_id: E1 }], _bj: {} }),
    bellRow(2, { purpose: 'order', total_value: String(SALE), _sender: CUS, all_recipients: [{ entity_id: E1 }], _bj: {} }),
    bellRow(3, { purpose: 'general', total_value: String(FIG.odd), _sender: STRANGER, all_recipients: [{ entity_id: E1 }], _bj: {} })
  ];
};
const taxWorld = () => {
  world();
  const invoice = { Version: '1.1', ValDtls: { AssVal: FIG.bill, TotInvVal: FIG.bill + FIG.tax, CgstVal: FIG.tax }, ItemList: [{ SlNo: '1', PrdDesc: 'Rice', Qty: 10, UnitPrice: FIG.unit, TotAmt: FIG.unit * 10 }] };
  const entry = (id) => ({ chit_id: id, direction: 'received', sells: false, status: 'accepted', provisional: true, frozen: false, rated: 1, unrated: 0,
    seller: { LglNm: 'Mill', Gstin: '29ABCDE1234F1Z5', State: '29', Country: 'IN', RegType: 'regular' }, buyer: { LglNm: 'Shop', Gstin: '29ZZZZZ9999Z1Z5', State: '29', Pos: '29', Country: 'IN', RegType: 'regular' }, invoice });
  return { entry, hdr: (id, sender) => ({ chit_id: id, sender_entity_id: sender, all_recipients: [{ entity_id: E1 }], purpose: 'invoice', business_json: {} }) };
};

(async () => {
  await S.start();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const facts = async () => (await S.get('/api/facts/rail/chits')).body;
  const item = (body, n) => body.items.find((x) => x.chit_id === U(n));
  console.log('\n══ RAIL-146g · the rail list, the bell, the group sum and the tax invoice hide the purchase money ══\n');

  /* ── door 1 · GET /api/facts/rail/chits ── */
  world(); as(OWNER);
  const ownerFacts = await facts();
  t('rail/chits: the owner reads the bill priced and the sale priced, no marker', [item(ownerFacts, 1).value, item(ownerFacts, 2).value, JSON.stringify(ownerFacts).includes('cost_hidden')], [FIG.bill, SALE, false]);
  for (const [who, name] of [[BLIND, 'a cost-blind co-assist'], [VIEWER, 'a VIEWER login without can_see_costs']]) {
    world(); as(who); D.canSeeCosts = false;
    const blind = await facts();
    t('rail/chits | ' + name + ': the supplier bill has no value and carries cost_hidden:true', [blind.items.length, item(blind, 1).value, item(blind, 1).cost_hidden], [3, undefined, true]);
    t('rail/chits | ' + name + ': his SALE stays priced and unmarked', [item(blind, 2).value, item(blind, 2).cost_hidden], [SALE, undefined]);
    t('rail/chits | ' + name + ': a chit from a party on NO list hides (fail closed)', [item(blind, 3).value, item(blind, 3).cost_hidden], [undefined, true]);
    t('rail/chits | ' + name + ': the work is not hidden (ids, tabs, who, status all there)', blind.items.every((x) => x.chit_id && x.tab && x.status && x.who), true);
    noLeak('rail/chits | ' + name, blind);
  }
  world(); as(OWNER);
  const ownerAgain = await facts();
  as(BLIND); D.canSeeCosts = true; D.statements.length = 0; /* the same world: its created_at stamps are the clock's */
  t('rail/chits: a cost-allowed actor reads exactly what the owner reads, byte for byte, and pays no side read', [JSON.stringify(await facts()) === JSON.stringify(ownerAgain), D.statements.some((s) => /customer_list/.test(s))], [true, false]);
  world(); as(VIEWER); D.canSeeCosts = true;
  t('rail/chits: a VIEWER WITH can_see_costs reads it priced (the permission is the flag, not the level)', item(await facts(), 1).value, FIG.bill);
  world(); as(BLIND); D.canSeeCosts = false; D.roles = new Proxy({}, { get() { throw new Error('the lists are down'); } });
  const down = await facts();
  t('rail/chits: a failed side read hides every value (no 500, no money)', [down.items.length, down.items.every((x) => x.value === undefined)], [3, true]);
  noLeak('rail/chits | a failed side read', down);

  /* ── door 2 · GET /api/notifications ── */
  const bell = async () => (await call('/api/notifications')).body;
  const bellOf = (body, n) => body.notifications.find((x) => x.log_id === n);
  bellWorld(); as(OWNER); D.statements.length = 0;
  const ownerBell = await bell();
  t('bell: the owner reads the bill total, the detail and no side columns', [bellOf(ownerBell, 1).total_value, bellOf(ownerBell, 1).detail, '_bj' in bellOf(ownerBell, 1), '_sender' in bellOf(ownerBell, 1), 'all_recipients' in bellOf(ownerBell, 1)], [String(FIG.bill), 'paid Rs ' + FIG.tax, false, false, false]);
  t('bell: the owner\'s SELECT adds no side columns and pays no cost read', [FEED.sql.some((s) => /AS _bj/.test(s)), D.statements.some((s) => /can_see_costs/.test(s))], [false, false]);
  for (const [who, name] of [[BLIND, 'a cost-blind co-assist'], [VIEWER, 'a VIEWER login without can_see_costs']]) {
    bellWorld(); as(who); D.canSeeCosts = false;
    const blind = await bell();
    t('bell | ' + name + ': the bill row has no total_value, no detail, cost_hidden:true', [blind.notifications.length, 'total_value' in bellOf(blind, 1), 'detail' in bellOf(blind, 1), bellOf(blind, 1).cost_hidden], [3, false, false, true]);
    t('bell | ' + name + ': his SALE keeps its total and its detail, unmarked', [bellOf(blind, 2).total_value, bellOf(blind, 2).detail, bellOf(blind, 2).cost_hidden], [String(SALE), 'paid Rs ' + FIG.tax, undefined]);
    t('bell | ' + name + ': a party on NO list hides', [bellOf(blind, 3).cost_hidden, 'total_value' in bellOf(blind, 3)], [true, false]);
    t('bell | ' + name + ': the row still says what happened (action, status, chit) and no side column leaks', [bellOf(blind, 1).action, bellOf(blind, 1).new_status, bellOf(blind, 1).chit_id, '_bj' in bellOf(blind, 1) || '_sender' in bellOf(blind, 1) || 'all_recipients' in bellOf(blind, 1)], ['delivered', 'accepted', U(1), false]);
    noLeak('bell | ' + name + ' (the sale\'s detail is the only planted tax figure and it is on a sale)', blind.notifications.filter((x) => x.log_id !== 2));
  }
  bellWorld(); as(BLIND); D.canSeeCosts = true;
  t('bell: a cost-allowed actor reads exactly what the owner reads, byte for byte', JSON.stringify(await bell()), JSON.stringify(ownerBell));

  /* ── door 3 · GET /api/folders/groupsum ── */
  const sum = async (scope) => (await call('/api/folders/groupsum?scope=' + scope)).body;
  world(); as(OWNER);
  const ownerSum = await sum('task');
  const priced = (body) => body.requirement.flatMap((line) => line.value.map((v) => v.total));
  t('groupsum: the owner\'s sum counts the bill and the sale, no marker', [priced(ownerSum).sort((a, b) => a - b), ownerSum.money.total.total, 'cost_hidden' in ownerSum], [[SALE, FIG.odd, FIG.unit * 10].sort((a, b) => a - b), 13624.77, false]);
  for (const [who, name] of [[BLIND, 'a cost-blind co-assist'], [VIEWER, 'a VIEWER login without can_see_costs']]) {
    world(); as(who); D.canSeeCosts = false;
    const blind = await sum('task');
    t('groupsum | ' + name + ': only the sale is priced and summed, cost_hidden:true, the chit count stays', [priced(blind), blind.money.total.total, blind.cost_hidden, blind.chits], [[SALE], SALE, true, 3]);
    t('groupsum | ' + name + ': the quantities still add up (the requirement is not hidden)', blind.requirement.map((line) => line.breakdown.length).reduce((a, b) => a + b, 0), 3);
    noLeak('groupsum | ' + name, blind);
  }
  world(); as(BLIND); D.canSeeCosts = true;
  t('groupsum: a cost-allowed actor reads exactly what the owner reads, byte for byte', JSON.stringify(await sum('task')), JSON.stringify(ownerSum));

  const groupsum = require('../lib/groupsum');
  t('groupsum.gather is the one pass: a chit that is not a sale keeps its lines but loses every price', (() => { const g = groupsum.gather([{ chit_id: 'c' }], new Map([['c', [{ particulars: 'Rice', quantity: 1, unit: 'kg', price: 5 }]]]), () => false, false); return [g.priceOf.get(groupsum.lineKey('c', { particulars: 'Rice', quantity: 1, unit: 'kg' })).price, g.requests[0].lines.length, g.withheld]; })(), [null, 1, true]);

  /* ── doors 4 and 5 · GET /api/invoice/:id and GET /api/tax/invoice/:id ── */
  for (const base of ['/api/invoice/', '/api/tax/invoice/']) {
    const door = base.includes('tax') ? 'tax/invoice' : 'invoice';
    let w = taxWorld(); TAX.copy = w.hdr(U(1), SUP); TAX.entry = w.entry(U(1)); as(OWNER);
    const ownerInv = (await call(base + U(1))).body;
    t(door + ': the owner reads the invoice: ItemList UnitPrice ' + FIG.unit + ' and the heads', [ownerInv.invoice.ItemList[0].UnitPrice, ownerInv.heads.taxable, 'cost_hidden' in ownerInv], [FIG.unit, FIG.bill, false]);
    t(door + ': the owner reads `sells` (a received bill: false) - M3, both doors answer the same fields', ownerInv.sells, false);
    for (const [who, name] of [[BLIND, 'a cost-blind co-assist'], [VIEWER, 'a VIEWER login without can_see_costs']]) {
      w = taxWorld(); TAX.copy = w.hdr(U(1), SUP); TAX.entry = w.entry(U(1)); as(who); D.canSeeCosts = false;
      const blind = (await call(base + U(1))).body;
      t(door + ' | ' + name + ': a received supplier bill has no invoice block and no heads, cost_hidden:true', ['invoice' in blind, 'heads' in blind, blind.cost_hidden], [false, false, true]);
      t(door + ' | ' + name + ': who, which and the state stay (seller, buyer, status, direction)', [blind.chit_id, blind.status, blind.direction, blind.seller.LglNm, blind.buyer.Gstin], [U(1), 'accepted', 'received', 'Mill', '29ZZZZZ9999Z1Z5']);
      t(door + ' | ' + name + ': `sells` stays on a received bill (a party fact, no price) - M3', blind.sells, false);
      noLeak(door + ' | ' + name, blind);
      /* his own sale: the counterparty is on his customer list only */
      TAX.copy = w.hdr(U(2), CUS); TAX.copy.purpose = 'order'; TAX.entry = Object.assign(w.entry(U(2)), { direction: 'sent', sells: true });
      const sale = (await call(base + U(2))).body;
      t(door + ' | ' + name + ': his SALE keeps its invoice and heads, unmarked', [sale.invoice.ItemList[0].UnitPrice, sale.heads.taxable, 'cost_hidden' in sale], [FIG.unit, FIG.bill, false]);
      t(door + ' | ' + name + ': his SALE keeps `sells:true` - M3', sale.sells, true);
      /* a party on no list hides */
      TAX.copy = w.hdr(U(3), STRANGER); TAX.entry = w.entry(U(3));
      const unlisted = (await call(base + U(3))).body;
      t(door + ' | ' + name + ': a party on NO list hides (fail closed)', ['invoice' in unlisted, unlisted.cost_hidden], [false, true]);
    }
    w = taxWorld(); TAX.copy = w.hdr(U(1), SUP); TAX.entry = w.entry(U(1)); as(BLIND); D.canSeeCosts = true;
    t(door + ': a cost-allowed actor reads exactly what the owner reads, byte for byte', JSON.stringify((await call(base + U(1))).body), JSON.stringify(ownerInv));
    t(door + ': a cost-allowed actor reads `sells` as the owner does - M3', (await call(base + U(1))).body.sells, false);
  }

  /* ── M3 · the TWIN: the same copy answers byte for byte the same on both doors ── */
  for (const [who, name, allowed] of [[OWNER, 'the owner', true], [BLIND, 'a cost-blind co-assist', false]]) {
    for (const [id, copyFor, patch] of [[U(1), SUP, {}], [U(2), CUS, { direction: 'sent', sells: true }]]) {
      const w2 = taxWorld(); TAX.copy = w2.hdr(id, copyFor); if (id === U(2)) TAX.copy.purpose = 'order'; TAX.entry = Object.assign(w2.entry(id), patch); as(who); D.canSeeCosts = allowed;
      const [a, b] = [JSON.stringify((await call('/api/invoice/' + id)).body), JSON.stringify((await call('/api/tax/invoice/' + id)).body)];
      t('M3 twin | ' + name + ' | ' + (id === U(1) ? 'a received bill' : 'a sale') + ': /api/invoice/:id and /api/tax/invoice/:id answer byte for byte the same', a === b, true);
    }
  }

  /* ── ONE strip: the doors name their allowlists, the prune and the marker are the chit reads' own ── */
  const costView = require('../lib/cost-view');
  for (const name of ['RAIL_ITEM_KEEP', 'FEED_ROW_KEEP', 'TAX_INVOICE_KEEP']) t(name + ' has no prototype and is frozen (a key named constructor finds nothing)', [Object.getPrototypeOf(costView[name]), Object.isFrozen(costView[name])], [null, true]);
  t('no door names a money key in its allowlist', [costView.RAIL_ITEM_KEEP, costView.FEED_ROW_KEEP, costView.TAX_INVOICE_KEEP].flatMap((spec) => Object.keys(spec).filter((k) => costView.isMoneyKey(k) && k !== 'cost_hidden')), []);

  S.stop(); srv.close();
  console.log('\n  ' + (fail ? '✗' : '✓') + ' ' + pass + ' passed · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((failure) => { console.error(failure); process.exit(1); });
