/**
 * tests/deliver-trace-golden.test.cjs — POST /chits/:id/deliver-lines AND GET /chits/:id/trace DO WHAT THEY DID BEFORE THE SPLIT.
 *
 * Round T2-SPLIT (2026-10-14): both handlers became named steps (deliver-lines: the use · the record · the notification ·
 * the progress · the goods-in accept; trace: the seed · the forward walk · the mass balance · the backward walk), and the
 * trace label `toName` — written out in the walk AND in /trace/batches — became one helper. REFACTOR-ONLY. Every scenario
 * through the real router (db, auth and the line recorder stubbed — tests/support/route-golden.cjs); every SQL statement,
 * parameter, recorded step and response compared with tests/fixtures/deliver-trace-golden.json, frozen BEFORE the split.
 *
 *   node tests/deliver-trace-golden.test.cjs           compare (the gate)
 *   node tests/deliver-trace-golden.test.cjs --write   re-freeze — ONLY for a deliberate behaviour change, said in the PR
 * No DB, no network.
 */
'use strict';
const path = require('path');
const G = require('./support/route-golden.cjs');
const API = G.API;

const SHOP = '11111111-1111-4111-8111-111111111111', SUPP = '22222222-2222-4222-8222-222222222222';
const A = 'aaaaaaaa-0000-4000-8000-000000000001', B = 'aaaaaaaa-0000-4000-8000-000000000002', C = 'aaaaaaaa-0000-4000-8000-000000000003';
const D = 'aaaaaaaa-0000-4000-8000-000000000004', E = 'aaaaaaaa-0000-4000-8000-000000000005', X = 'aaaaaaaa-0000-4000-8000-000000000009';
const known = { [SHOP]: 'SHOP', [SUPP]: 'SUPP', [A]: 'A', [B]: 'B', [C]: 'C', [D]: 'D', [E]: 'E', [X]: 'X' };

const recips = (to) => JSON.stringify([{ role: 'sender', display_name: 'S' }, { role: 'operator', display_name: 'Op' }, { role: 'receiver', display_name: to }]);
const node = (id, t, to) => ({ chit_id: id, entity_id: SHOP, sender_entity_display_name: 'Sender of ' + id.slice(-1), all_recipients: to === null ? '[not json' : recips(to), trace: t });
const GRAPH = {
  [A]: node(A, { product: 'Rice', qty: 100, unit: 'kg', base_qty: 100, base_unit: 'kg', is_origin: true, parents: [], network: { id: 'net-1' } }, 'Mill'),
  [B]: node(B, { product: 'Rice', qty: 60, base_qty: 60, base_unit: 'kg', parents: [A], network: { id: 'net-1' } }, 'Depot'),
  [C]: node(C, { product: 'Rice', qty: 50, base_qty: 50, base_unit: 'kg', parents: [A], network: { id: 'net-2' } }, null),
  [D]: node(D, { product: 'Rice', qty: 60, base_qty: 60, base_unit: 'kg', parents: [B, X], network: { id: 'net-1' } }, 'Shop'),
  [E]: node(E, { product: 'Rice', qty: 10, base_qty: 10, base_unit: 'bag', parents: [C] }, 'Kiosk'),
};

const bnode = (id, from, to, t) => ({ chit_id: id, sender_entity_id: from, sender_entity_display_name: 'From ' + from.slice(-1), all_recipients: JSON.stringify([{ role: 'sender', entity_id: from }, { role: 'receiver', entity_id: to, display_name: 'To ' + to.slice(-1) }]), trace: t });
const P1 = 'bbbbbbbb-0000-4000-8000-000000000001', P2 = 'bbbbbbbb-0000-4000-8000-000000000002', P3 = 'bbbbbbbb-0000-4000-8000-000000000003', P4 = 'bbbbbbbb-0000-4000-8000-000000000004';
const BATCH = [
  bnode(A, P1, P2, { product: 'Rice', qty: 100, base_qty: 100, base_unit: 'kg' }),
  bnode(B, P2, P3, { product: 'Rice', qty: 70, base_qty: 70, base_unit: 'kg' }),
  bnode(C, P2, P4, { product: 'Rice', qty: 40, base_qty: 40, base_unit: 'kg' }),
  bnode(D, P3, 'bbbbbbbb-0000-4000-8000-000000000005', { product: 'Rice', qty: 5, base_qty: 5, base_unit: 'bag' }),
  bnode(B, P2, P3, { product: 'Rice', qty: 70, base_qty: 70, base_unit: 'kg' }),
];
const CYCLE = bnode(E, P2, P1, { product: 'Rice', qty: 1 });   /* P2 sends back to P1: A → B and E → A — a cycle the depth walk must not loop on */
function rows(s, p, ctx) {
  if (/FROM chit_header WHERE chit_id = \$1/.test(s) && /trace/.test(s)) {
    const r = GRAPH[p[0]]; if (!r) return [];
    if (p[1] && !(r.trace.network && r.trace.network.id === p[1])) return [];
    return [r];
  }
  if (/jsonb_array_elements_text/.test(s)) {
    const front = p[0] || [];
    return Object.values(GRAPH).filter((r) => r.trace.parents.some((x) => front.includes(x)) && (!p[1] || (r.trace.network && r.trace.network.id === p[1])));
  }
  if (/JOIN chit_line/.test(s)) { if (ctx.lotThrows) throw new Error('no chit_line'); return ctx.lot ? BATCH : []; }
  if (/lower\(summary_json->'trace'->>'product'\) = lower\(\$1\)/.test(s)) return BATCH.slice(0, 2).concat([CYCLE]);
  if (/WHERE summary_json->'trace' IS NOT NULL/.test(s)) return Object.values(GRAPH).concat([GRAPH[A]]).map((r) => Object.assign({ created_at: '2026-10-01T10:00:00.000Z' }, r));
  if (/state_log_fanout/.test(s) && ctx.noFanout) { const e = new Error('no fn'); e.code = '42883'; throw e; }
  return [];
}

const h = G.harness({ rows, known });
const deliverline = require(path.join(API, 'lib', 'deliverline'));
deliverline.record = async (eid, cid, rowsIn, o) => {
  h.note('deliverline.record', { eid, cid, rows: rowsIn, o });
  if (h.state.ctx.recordThrows) { const e = new Error('Nothing to record'); e.status = 400; throw e; }
  return { delivered: (Array.isArray(rowsIn) ? rowsIn : []).map((r) => ({ line_id: r.line_id, quantity: r.quantity })) };
};
deliverline.progress = async (eid, cid) => { h.note('deliverline.progress', { eid, cid }); if (h.state.ctx.progressThrows) throw new Error('x'); return new Map(h.state.ctx.progress || [['L1', { ordered: 2, delivered: 2, complete: true }]]); };
const taxCopy = require(path.join(API, 'lib', 'tax-copy'));
/* SEC4: the route now asks "do I hold a copy" first, so a scenario holds one by default — an ordinary order copy (not a bill); ctx.copy: null is the stranger */
taxCopy.copyOf = async (cid, eid) => { h.note('taxCopy.copyOf', { cid, eid }); return 'copy' in h.state.ctx ? h.state.ctx.copy : ORDER_COPY; };
const billPrivacy = require(path.join(API, 'lib', 'bill-privacy'));
billPrivacy.writeStep = async (...a) => { h.note('billPrivacy.writeStep', a); return { written: true }; };
require(path.join(API, 'lib', 'bill-use')).set = async (...a) => { h.note('billUse.set', a); return h.state.ctx.useRefused ? { ok: false, message: 'already accepted' } : { ok: true, use: 'resale' }; };

const app = h.app('/api/chits', require(path.join(API, 'routes', 'chits')));
const ME = { identity_id: SHOP, identity_type: 'entity', bridge_id: 'CBSHOP0001', display_name: 'Mayur Traders' };
const ROWS_IN = [{ line_id: 'L1', quantity: 2 }];
const ORDER_COPY = { chit_id: A, entity_id: SHOP, sender_entity_id: SHOP, purpose: 'order', direction: 'sent', current_status: 'delivered', business_json: {} };
const BILL_COPY = { chit_id: A, entity_id: SHOP, sender_entity_id: SUPP, purpose: 'invoice', direction: 'received', current_status: 'pending', business_json: {} };

const SCENARIOS = [
  ['deliver · an order line, the notification fans out', { method: 'POST', url: '/' + A + '/deliver-lines', body: { rows: ROWS_IN } }],
  ['deliver · pre-b158, the single-copy row instead', { method: 'POST', url: '/' + A + '/deliver-lines', body: ROWS_IN, ctx: { noFanout: true } }],
  ['deliver · a bill I received, in full → private step + accept', { method: 'POST', url: '/' + A + '/deliver-lines', body: { rows: ROWS_IN, use: 'resale' }, ctx: { copy: BILL_COPY } }],
  ['deliver · a bill, partly in → no accept', { method: 'POST', url: '/' + A + '/deliver-lines', body: { rows: ROWS_IN }, ctx: { copy: BILL_COPY, progress: [['L1', { ordered: 2, delivered: 1, complete: false }], ['L2', { ordered: 1, delivered: 1, complete: true }]] } }],
  ['deliver · the use refused, the delivery still records', { method: 'POST', url: '/' + A + '/deliver-lines', body: { rows: ROWS_IN, use_lines: [{ line_id: 'L1', use: 'own' }] }, ctx: { useRefused: true } }],
  ['deliver · progress unreadable, the write stands', { method: 'POST', url: '/' + A + '/deliver-lines', body: { rows: ROWS_IN }, ctx: { progressThrows: true } }],
  ['deliver · SEC4 a business holding no copy → 404 not_participant, nothing written', { method: 'POST', url: '/' + A + '/deliver-lines', body: { rows: ROWS_IN, use: 'resale' }, ctx: { copy: null } }],
  ['deliver · the recorder refuses → its status', { method: 'POST', url: '/' + A + '/deliver-lines', body: { rows: [] }, ctx: { recordThrows: true } }],
  ['trace · a bad id → 400', { method: 'GET', url: '/not-a-uuid/trace' }],
  ['trace · not visible → 404', { method: 'GET', url: '/' + X + '/trace' }],
  ['trace · forward from the origin (a red balance, an unknown one)', { method: 'GET', url: '/' + A + '/trace' }],
  ['trace · forward, one network only', { method: 'GET', url: '/' + A + '/trace?network=net-1' }],
  ['trace · backward to the origin (a dead-end parent recorded)', { method: 'GET', url: '/' + D + '/trace?dir=backward' }],
  ['trace · backward from the origin', { method: 'GET', url: '/' + A + '/trace?dir=backward' }],
  ['trace · the batches list (one label helper with the walk)', { method: 'GET', url: '/trace/batches' }],
  ['by-batch · no value → 400', { method: 'GET', url: '/trace/by-batch' }],
  ['by-batch · matched on the lot (depth, a red node, an unknown one)', { method: 'GET', url: '/trace/by-batch?q=24B', ctx: { lot: true } }],
  ['by-batch · no lot anywhere → the product, said (a cycle)', { method: 'GET', url: '/trace/by-batch?q=rice' }],
  ['by-batch · pre-b142 (no chit_line) → the product', { method: 'GET', url: '/trace/by-batch?q=rice', ctx: { lotThrows: true } }],
];

(async () => {
  console.log('\n══ T2-SPLIT · deliver-lines and the trace walk — the same trace before and after the split ══\n');
  const recs = {};
  for (const [name, sc] of SCENARIOS) {
    recs[name] = await h.run(app, { method: sc.method, url: '/api/chits' + sc.url, body: sc.body, identity: ME, ctx: sc.ctx || {} });
  }
  const bad = G.compare(recs, path.join(__dirname, 'fixtures', 'deliver-trace-golden.json'));
  let pass = 0;
  for (const [name] of SCENARIOS) {
    const b = bad.find((x) => x.name === name);
    if (b) console.log('   FAIL ' + name + '\n          ' + G.firstDiff(b.got, b.want));
    else { pass++; console.log('   ok   ' + name + '  (' + recs[name].status + ', ' + recs[name].calls.length + ' calls)'); }
  }
  console.log('\n  ' + pass + ' passed, ' + bad.length + ' failed');
  console.log('  ' + pass + ' checks');
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
