/**
 * tests/p2-ops-doors.test.cjs — P2 lane 2 (12 Nov): four stock / match doors that said less than the truth.
 *
 * OWNS      OPS-85  GET /api/till/match: 300 counter bills newer than a PO do not push the PO out; a cancelled / rejected PO is not awaited.
 *           OPS-87  an order line counted in ANOTHER unit (10 kg ordered, 12 pieces) is flagged counted-in-another-unit and the verdict is not "awaited".
 *           OPS-79  GET /chits/:id/trace and /trace/batches say when they cut the answer (truncated:true + cap_note); a chain that ends exactly at the limit is not flagged.
 *           OPS-6   the send answer names a receipt line with no product of mine (stock_not_posted, code no_product); a stocked line is not named.
 *           (OPS-99 is pinned in tests/ops-5-delivered-stock.test.cjs.)
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes over a stubbed db.
 * FLOW      world (heads · progress · chain · lines) -> real route / step -> the answer
 * CARD      12-suppliers-and-procurement/purchase-order-and-goods-receipt · 13-inventory-stock-and-traceability/batch-traceability
 *
 * Run: node tests/p2-ops-doors.test.cjs
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
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(96) + (ok ? '' : JSON.stringify(got) + '   want ' + JSON.stringify(want)));
};
const E1 = 'e1', S = '33333333-3333-4333-8333-333333333333';
const U = (n) => '30000000-0000-4000-8000-' + String(n).padStart(12, '0');
const mock = (rel, exports) => { require.cache[require.resolve(API + rel)] = { id: rel, filename: rel, loaded: true, exports }; };

/* ── the world: purchase orders and counter bills (heads), the trace chain, the batch rows ── */
const world = { heads: [], detail: {}, progress: new Map(), chain: [], batchRows: 0 };
const head = (id, over) => Object.assign({ chit_id: id, created_at: '2026-11-10T10:00:00Z', purpose: 'order', direction: 'sent', current_status: 'pending', sender_entity_id: E1, all_recipients: [{ entity_id: S }], counterparty_id: S, counterparty_name: 'Mill', summary_json: {}, entity_id: E1, business_json: {} }, over || {});

mock('/middleware/auth', Object.assign((req, res, next) => { req.identity = { identity_id: E1, identity_type: 'entity' }; next(); }, {
  entityOf: () => E1, requireScope: () => (req, res, next) => next(), userOf: (req) => req.identity }));
const nodeRow = (i) => ({ chit_id: U(1000 + i), entity_id: E1, sender_entity_display_name: 'S', all_recipients: '[]', trace: { product: 'Rice', qty: 1, base_qty: 1, base_unit: 'kg', is_origin: i === 0, parents: i === 0 ? [] : [U(1000 + i - 1)] } });
const dbq = async (sql, params) => {
  const s = String(sql).replace(/\s+/g, ' ');
  if (/can_see_costs FROM identities/.test(s)) return { rows: [{ can_see_costs: true }] };
  if (/h[.]purpose = 'receipt'|h[.]direction = 'received' AND h[.]purpose = 'invoice'/.test(s)) return { rows: [] };
  if (/FROM chit_header h LEFT JOIN chit_detail d/.test(s)) return { rows: params[1].filter((id) => world.detail[id]).map((id) => Object.assign({ chit_id: id }, world.detail[id])) };
  if (/FROM chit_header WHERE chit_id = \$1/.test(s)) { const r = world.chain.find((x) => x.chit_id === params[0]); return { rows: r ? [r] : [] }; }
  if (/'parents' \?\| \$1/.test(s)) {
    const rows = world.chain.filter((x) => x.trace.parents.some((p) => params[0].includes(p)));
    return { rows: /LIMIT 1\b/.test(s) ? rows.slice(0, 1) : rows };
  }
  if (/WHERE summary_json->'trace' IS NOT NULL/.test(s)) {
    const m = /LIMIT (\d+)/.exec(s);
    return { rows: Array.from({ length: Math.min(world.batchRows, m ? +m[1] : 1e9) }, (_, i) => Object.assign(nodeRow(i), { created_at: '2026-11-01T10:00:00Z' })) };
  }
  return { rows: [] };
};
mock('/db', { query: dbq, withEntity: async (_id, fn) => fn({ query: dbq }), readBatch: async () => [] });
const get = (port, p) => new Promise((ok, bad) => http.get({ host: '127.0.0.1', port, path: p }, (res) => {
  let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => ok(JSON.parse(raw)));
}).on('error', bad));

(async () => {
  /* the selector, as the real one answers it: own_bills:false and status_not at the "database", THEN the cap (lib/select.js) */
  const asked = [];
  require(API + '/lib/select').rows = async (_e, sel) => {
    asked.push(sel);
    const kept = world.heads.filter((h) => !(sel.own_bills === false && h.business_json && h.business_json.bill_no && h.sender_entity_id === E1)
      && !(Array.isArray(sel.status_not) && sel.status_not.includes(h.current_status)));
    return kept.slice(0, sel.limit);
  };
  require(API + '/lib/policy').get = async () => ({});
  require(API + '/lib/deliverline').progress = async (_e, id) => world.progress.get(id) || new Map();
  const app = express();
  app.use('/api/till', require(API + '/routes/till'));
  app.use('/api/chits', require(API + '/routes/chits-trace'));
  const srv = app.listen(0), port = srv.address().port;
  const match = async () => { const b = await get(port, '/api/till/match'); return Object.fromEntries(b.orders.map((o) => [o.chit_id, o])); };
  const line = (qty, unit) => ({ line_items: [{ line_id: U(900), particulars: 'Rice', quantity: qty, unit: unit || 'kg', price: 100 }], business_json: { side: 'buy' } });

  console.log('\n══ OPS-85 · the match reads past counter bills and leaves out closed orders ══\n');
  const PO = U(1), CANCELLED = U(2);
  const bills = Array.from({ length: 300 }, (_, i) => head(U(5000 + i), { business_json: { bill_no: 'B' + i } })); /* 300 counter bills, all newer than the PO */
  world.heads = [head(CANCELLED, { current_status: 'cancelled' }), ...bills, head(PO, { created_at: '2026-10-01T10:00:00Z' })]; /* newest first, as the selector reads */
  world.detail = { [PO]: line(10), [CANCELLED]: line(5) };
  let m = await match();
  t('with 300 counter bills newer than a PO, the PO still matches', Object.keys(m).includes(PO), true);
  t('a cancelled PO is not listed as awaited', Object.keys(m).includes(CANCELLED), false);
  t('the selector asks own_bills:false and status_not [rejected, cancelled]', [asked[0].own_bills, asked[0].status_not], [false, ['rejected', 'cancelled']]);

  console.log('\n══ OPS-87 · goods counted in another unit are not "nothing received" ══\n');
  world.heads = [head(PO)];
  world.detail = { [PO]: line(10, 'kg') };
  world.progress = new Map([[PO, new Map([[U(900), { delivered: 0, unit_mismatch: true, other_units: [{ unit: 'piece', mine: 12, theirs: 0 }] }]])]]);
  m = await match();
  t('order 10 kg, 12 pieces counted in: the line is flagged counted_in_another_unit', [m[PO].lines[0].counted_in_another_unit, m[PO].lines[0].other_units], [true, [{ unit: 'piece', mine: 12, theirs: 0 }]]);
  t('the verdict is not "awaited", the line state is other_unit', [m[PO].verdict, m[PO].lines[0].state], ['differs', 'other_unit']);
  world.progress = new Map();
  m = await match();
  t('nothing counted anywhere stays awaited, state short as before (no flag added)', [m[PO].verdict, m[PO].lines[0].state, 'counted_in_another_unit' in m[PO].lines[0]], ['awaited', 'short', false]);
  world.progress = new Map([[PO, new Map([[U(900), { delivered: 10 }]])]]);
  m = await match();
  t('a line delivered in the ordered unit is unchanged: agreed', [m[PO].verdict, m[PO].lines[0].state], ['agreed', 'agreed']);

  console.log('\n══ OPS-79 · the recall trace says when it cut its answer ══\n');
  const chainOf = (n) => { world.chain = Array.from({ length: n + 1 }, (_, i) => nodeRow(i)); return world.chain[0].chit_id; };
  let origin = chainOf(100);
  let b = await get(port, '/api/chits/' + origin + '/trace?dir=forward');
  t('chain of 100 forward hops: the answer reached 41 chits and says truncated:true with a reason', [b.reachable_count, b.truncated, /40 hops/.test(b.cap_note || '')], [41, true, true]);
  origin = chainOf(40);
  b = await get(port, '/api/chits/' + origin + '/trace?dir=forward');
  t('a chain that ends exactly at the limit is complete: no truncated key', [b.reachable_count, 'truncated' in b], [41, false]);
  origin = chainOf(10);
  b = await get(port, '/api/chits/' + origin + '/trace?dir=forward');
  t('a short chain is complete: no truncated key', [b.reachable_count, 'truncated' in b], [11, false]);
  chainOf(100);
  b = await get(port, '/api/chits/' + world.chain[100].chit_id + '/trace?dir=backward');
  t('backward over 100 hops stops at 40 and says so', [b.hops, b.truncated], [40, true]);
  b = await get(port, '/api/chits/' + world.chain[10].chit_id + '/trace?dir=backward');
  t('backward to the origin is complete: no truncated key', [b.hops, 'truncated' in b], [10, false]);
  world.batchRows = 250;
  b = await get(port, '/api/chits/trace/batches');
  t('/trace/batches cut at 200 rows says truncated:true with a note', [b.truncated, typeof b.cap_note], [true, 'string']);
  world.batchRows = 150;
  b = await get(port, '/api/chits/trace/batches');
  t('/trace/batches under 200 rows is whole: no truncated key', 'truncated' in b, false);
  srv.close();

  console.log('\n══ OPS-6 · the send answer names a receipt line with no product of mine ══\n');
  const stock = require(API + '/lib/stock-from-chit');
  const lines = [{ line_id: 'L1', particulars: 'Basmati', quantity: 5, item_id: 'ITEM-1' }, { line_id: 'L2', particulars: 'Freight on rice', quantity: 1 }, { line_id: 'L3', particulars: 'Zero', quantity: 0 }];
  t('unstockedLines names the free-text receipt line only, with a code', stock.unstockedLines({ purpose: 'receipt', line_items: lines }).map((x) => [x.line_ref, x.code]), [['L2', 'no_product']]);
  t('a counter bill and a draft name nothing (not this door)', [stock.unstockedLines({ purpose: 'order', business_json: { bill_no: 'B1' }, line_items: lines }).length, stock.unstockedLines({ purpose: 'receipt', is_draft: true, line_items: lines }).length], [0, 0]);
  const chits = require(API + '/routes/chits');
  const said = {};
  const res = { json: (x) => Object.assign(said, x) };
  const answer = (items) => chits.sendAnswer({ sender_id: E1, purpose: 'receipt', is_draft: false, line_items: items, business_json: {}, counts: { to: 1, cc: 0, for: 0 }, receiverDetails: [], chit_id: U(77), summary_json: {} }, {}, res);
  await answer(lines);
  t('the real send answer carries stock_not_posted for the receipt', (said.stock_not_posted || []).map((x) => x.code), ['no_product']);
  for (const k of Object.keys(said)) delete said[k];
  await answer([lines[0]]);
  t('a receipt of my own products carries no stock_not_posted key', said.stock_not_posted === undefined, true);

  console.log('\n══ cost-blind reader: the two OPS fields survive prune(), money still drops ══\n');
  const cv = require(API + '/lib/cost-view');
  const mw = { chit_id: 'c', lines: [{ line_id: 'l', name: 'Rice', ordered: 10, price: 60, other_units: [{ unit: 'piece', mine: 12, theirs: 0, price: 60, amount_minor: 600 }] }], verdict: 'open' };
  const cutM = cv.prune(mw, cv.MATCH_KEEP);
  t('match: other_units keeps unit / mine / theirs for a cost-blind reader', mw.lines[0].other_units, [{ unit: 'piece', mine: 12, theirs: 0 }]);
  t('match: a planted price and amount_minor drop (line price + 2 in other_units = 3 removed)', [cutM, mw.lines[0].price], [3, undefined]);
  const a2 = { chit_id: 'c', stock_not_posted: [{ line_ref: 'L2', particulars: 'Freight', code: 'no_product', why: 'no product of mine', price: 60, amount: 100 }] };
  const cutA = cv.prune(a2, cv.SEND_ANSWER_KEEP);
  t('send answer: stock_not_posted keeps line_ref / particulars / code / why', a2.stock_not_posted, [{ line_ref: 'L2', particulars: 'Freight', code: 'no_product', why: 'no product of mine' }]);
  t('send answer: a planted price and amount in a not-posted line drop (2 removed)', cutA, 2);

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  console.log(pass + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
