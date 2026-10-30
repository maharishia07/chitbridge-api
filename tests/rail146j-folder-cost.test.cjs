/**
 * tests/rail146j-folder-cost.test.cjs — RAIL-146j: the shop's purchase money never reaches a cost-blind actor through the two folder reads the leak hammer found:
 * GET /api/folders/:id/chits (the filed list AND the view-folder list) and GET /api/folders/:id/metrics (the `money` summary).
 *
 * OWNS      the proof, per read, that an actor without can_see_costs gets NO purchase money in ANY form on a cost-side chit (a whole-body scan for the rupee sign and every planted
 *           figure) with cost_hidden:true; that his sale stays priced; that an unlisted party hides (fail closed); that the metrics money stands only when EVERY chit is a sale
 *           (else null + cost_hidden), counts stay; that a money filter or sort is taken off and named back; that the owner and a cost-allowed actor read the same bytes as before.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes and libs over tests/support/work-stub.cjs.
 * FLOW      world (copies · roles · flag) → real route → body → whole-text scan → the sale and the owner untouched
 * CARD      01-rail-core-the-chit/folders
 *
 * Run: node tests/rail146j-folder-cost.test.cjs · MIN unit-per-rule · refusal-path · fail-closed
 */
'use strict';
const http = require('http');
const path = require('path');
const S = require('./support/work-stub.cjs');
const { D, E1, U, copy, seed, as } = S;
const API = path.join(__dirname, '..');
const stubMod = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(100) + (ok ? '' : String(JSON.stringify(got)).slice(0, 300) + '   want ' + JSON.stringify(want).slice(0, 200)));
};
const SUP = '33333333-3333-4333-8333-333333333333', CUS = '55555555-5555-4555-8555-555555555555', STRANGER = '66666666-6666-4666-8666-666666666666';
const FILED = '77777777-7777-4777-8777-777777777777', VIEW = '88888888-8888-4888-8888-888888888888';
const BLIND = { identity_id: 'A7', identity_type: 'actor', entity_id: E1 };
const VIEWER = { identity_id: 'A8', identity_type: 'actor', entity_id: E1, level: 'viewer' };
const OWNER = { identity_id: E1, identity_type: 'entity', entity_id: E1 };
/* the purchase figures no other field could carry (each also as minor units and as two-place text); the sale's own figure is NOT secret */
const FIG = { bill: 7777.77, odd: 4646.5, tax: 1399.99, paid: 2222.22 };
const SALE = 1200.5;
const shapes = (n) => [String(n), n.toFixed(2), String(Math.round(n * 100))];
const SECRET = Object.values(FIG).flatMap(shapes);
const leaked = (raw) => SECRET.filter((s) => new RegExp('(^|[^0-9.])' + s.replace('.', '\\.') + '([^0-9]|$)').test(raw));
const noLeak = (label, body) => { const raw = JSON.stringify(body); t(label + ' | whole-body scan: no rupee sign, no planted figure', [/₹/.test(raw), leaked(raw)], [false, []]); };

/* the filed list: ONE statement, the rows answered with the side columns only when the statement asked for them */
const FILED_ROWS = { rows: [], sql: [] };
const dbMod = require('../db');
const realWithEntity = dbMod.withEntity;
dbMod.withEntity = async (entity, fn) => realWithEntity(entity, (c) => fn({ query: async (sql, p) => {
  const text = String(sql).replace(/\s+/g, ' ');
  if (/FROM chit_status cs JOIN chit_header ch .* cs\.folder_id = \$2/.test(text)) { FILED_ROWS.sql.push(text); return { rows: FILED_ROWS.rows.map((row) => rowAs(row, text)) }; }
  if (/SELECT f\.folder_id, f\.name, to_jsonb\(f\)->>'kind' AS kind FROM folder f/.test(text)) return { rows: [{ folder_id: p[0], name: 'F', kind: p[0] === VIEW ? 'view' : null }] };
  if (/SELECT scope FROM folder/.test(text)) return { rows: [{ scope: null }] };
  return c.query(sql, p);
} }));
function rowAs(row, text) {
  const asks = /AS _bj/.test(text) && /AS all_recipients/.test(text);
  const { _sender, _bj, all_recipients, ...plain } = row;
  return asks ? row : plain;
}
/* the view folder: its members (select rows + a bill lifecycle) and its measured rows, from the world */
const billOf = (c) => ({ step: 'accepted', code: 'B-2100', label: c.label, by: 'u1', by_name: 'U', at: '2026-10-01T00:00:00Z', open: true, paid: false, history: [{ step: 'line', code: 'R-1400', label: c.label, by: 'u1', at: '2026-10-01T00:00:00Z', theirs: false }] });
stubMod('lib/folder-views.js', Object.assign({}, require('../lib/folder-views'), {
  members: async () => ({ chits: D.copies.filter((c) => c.entity_id === E1).map((c) => Object.assign({}, c, { bill: billOf(c) })), counts: { open: 3, closed: 0, total: 3 }, state: 'open' }),
  rowsFor: async () => D.copies.filter((c) => c.entity_id === E1).map((c) => Object.assign({}, c))
}));
stubMod('lib/policy.js', Object.assign({}, require('../lib/policy'), { get: async () => ({ overdue_days: 3 }) }));

const express = require('express');
const app = express();
app.use('/api/folders', require('../routes/folders'));
const srv = http.createServer(app);
const call = (url) => new Promise((resolve, reject) => http.get({ port: srv.address().port, path: url }, (res) => {
  let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
}).on('error', reject));

/** the world: c1 a supplier's bill (cost), c2 a customer's order (sale), c3 something from a party on no list (hidden) */
function world() {
  seed();
  const label = 'Paid ₹' + FIG.paid + ' of ₹' + FIG.bill;
  D.copies = [
    copy(1, { purpose: 'invoice', doc_kind: 'bill_received', sender_entity_id: SUP, counterparty_id: SUP, counterparty_name: 'Mill', auto_subject: 'Mill bill', value: String(FIG.bill), alt_value: String(FIG.tax), summary_json: { total_value: FIG.bill, currency_code: 'INR', line_item_count: 1 }, currency: 'INR', created_at: '2026-10-01T00:00:00.000Z', label }),
    copy(2, { purpose: 'order', sender_entity_id: CUS, counterparty_id: CUS, counterparty_name: 'Ravi', auto_subject: 'Ravi order', value: String(SALE), summary_json: { total_value: SALE, currency_code: 'INR' }, currency: 'INR', created_at: '2026-10-01T00:00:00.000Z', label: 'Order in' }),
    copy(3, { purpose: 'general', sender_entity_id: STRANGER, counterparty_id: STRANGER, counterparty_name: 'Walk-in', auto_subject: 'Unlisted', value: String(FIG.odd), summary_json: { total_value: FIG.odd }, currency: 'INR', created_at: '2026-10-01T00:00:00.000Z', label: 'Walk-in ₹' + FIG.odd })
  ];
  D.roles = { [SUP]: { supplier: true }, [CUS]: { customer: true } };
  D.bj = { [U(1)]: {}, [U(2)]: {}, [U(3)]: {} };
  const bj = (fig) => ({ doc: 'order', invoice: { grand_total: fig, cgst: fig === SALE ? 1.5 : FIG.tax }, line_items: [{ price: fig }], note: fig === SALE ? 'sale note' : '₹' + fig, kind: 'x' });
  FILED_ROWS.sql = [];
  FILED_ROWS.rows = [[1, SUP, FIG.bill], [2, CUS, SALE], [3, STRANGER, FIG.odd]].map(([n, sender, fig]) => ({ chit_id: U(n), sender_entity_display_name: 'S' + n, auto_subject: 'A' + n, manual_subject: null, purpose: n === 2 ? 'order' : 'invoice',
    created_at: '2026-10-01T00:00:00Z', business_json: bj(fig), created_by_actor_id: null, raiser_name: null, direction: 'received', current_status: 'pending', _total: '3',
    _sender: sender, all_recipients: [{ entity_id: E1 }], _bj: {} }));
}
const rowOf = (body, n) => body.chits.find((x) => x.chit_id === U(n));
const blinds = [[BLIND, 'a cost-blind co-assist'], [VIEWER, 'a VIEWER login without can_see_costs']];

(async () => {
  await S.start();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  console.log('\n══ RAIL-146j · the folder chits and the folder metrics hide the purchase money ══\n');

  for (const [id, name] of [[FILED, 'filed folder'], [VIEW, 'view folder']]) {
    const url = '/api/folders/' + id + '/chits';
    world(); as(OWNER); D.statements.length = 0;
    const owner = (await call(url)).body;
    t(name + ' chits: the owner reads all three priced, no marker', [owner.chits.length, 'cost_hidden' in owner, owner.chits.some((r) => 'cost_hidden' in r)], [3, false, false]);
    t(name + ' chits: the owner pays no cost read and no side columns', [D.statements.some((s) => /can_see_costs/.test(s)), FILED_ROWS.sql.some((s) => /AS _bj/.test(s))], [false, false]);
    t(name + ' chits: the owner still sees the figures', leaked(JSON.stringify(owner)).length > 0, true);
    for (const [who, label] of blinds) {
      world(); as(who); D.canSeeCosts = false;
      const blind = (await call(url + '?amount_min=1&sort=amount')).body;
      noLeak(name + ' chits | ' + label, blind);
      t(name + ' chits | ' + label + ': the bill and the unlisted party carry cost_hidden', [rowOf(blind, 1).cost_hidden, rowOf(blind, 3).cost_hidden], [true, true]);
      t(name + ' chits | ' + label + ': the sale keeps its figure and no marker', [JSON.stringify(rowOf(blind, 2)).includes(String(SALE)), 'cost_hidden' in rowOf(blind, 2)], [true, false]);
      t(name + ' chits | ' + label + ': all three rows stay (counts and ids)', blind.chits.map((r) => r.chit_id).sort(), [U(1), U(2), U(3)]);
      t(name + ' chits | ' + label + ': the money filter and sort are named back', blind.cost_params_ignored, ['amount_min', 'sort']);
      t(name + ' chits | ' + label + ': no side column on the wire', JSON.stringify(blind).includes('_sender') || JSON.stringify(blind).includes('"_bj"'), false);
    }
    world(); as(BLIND); D.canSeeCosts = true;
    t(name + ' chits: a co-assist WITH can_see_costs reads the owner bytes', JSON.stringify((await call(url)).body), JSON.stringify(owner));
    world(); as(VIEWER); D.canSeeCosts = true;
    t(name + ' chits: a VIEWER WITH can_see_costs reads the owner bytes (the permission is the flag)', JSON.stringify((await call(url)).body), JSON.stringify(owner));
    world(); as(BLIND); D.canSeeCosts = false; D.roles = new Proxy({}, { get() { throw new Error('the lists are down'); } });
    const down = await call(url);
    noLeak(name + ' chits | the party lists are down (fail closed)', down.body);
    t(name + ' chits | the party lists are down: no row is sold as a sale', down.status === 200 ? down.body.chits.filter((r) => !r.cost_hidden).length : 0, 0);
  }

  /* ── metrics ── */
  for (const [id, name] of [[FILED, 'filed folder'], [VIEW, 'view folder']]) {
    const url = '/api/folders/' + id + '/metrics';
    world(); as(OWNER); D.statements.length = 0;
    const owner = (await call(url)).body;
    t(name + ' metrics: the owner sums all three', [owner.count, owner.money.by_currency.map((c) => c.total), 'cost_hidden' in owner], [3, [FIG.bill + SALE + FIG.odd], false]);
    t(name + ' metrics: the owner pays no cost read', D.statements.some((s) => /can_see_costs/.test(s)), false);
    for (const [who, label] of blinds) {
      world(); as(who); D.canSeeCosts = false;
      const blind = (await call(url + '?sort=amount')).body;
      noLeak(name + ' metrics | ' + label, blind);
      t(name + ' metrics | ' + label + ': money is null, cost_hidden true, the counts stay', [blind.money, blind.cost_hidden, blind.count, blind.open, blind.unread], [null, true, owner.count, owner.open, owner.unread]);
      t(name + ' metrics | ' + label + ': the sort is named back', blind.cost_params_ignored, ['sort']);
    }
    world(); as(BLIND); D.canSeeCosts = false; D.copies = D.copies.filter((c) => c.chit_id === U(2));
    const sales = (await call(url)).body;
    t(name + ' metrics | all sales: the summary stands, no marker', [sales.money.by_currency.map((c) => c.total), 'cost_hidden' in sales], [[SALE], false]);
    world(); as(BLIND); D.canSeeCosts = true;
    t(name + ' metrics: a co-assist WITH can_see_costs reads the owner bytes', JSON.stringify((await call(url)).body), JSON.stringify(owner));
    world(); as(BLIND); D.canSeeCosts = false; D.roles = new Proxy({}, { get() { throw new Error('the lists are down'); } });
    const down = (await call(url)).body;
    noLeak(name + ' metrics | the party lists are down (fail closed)', down);
    t(name + ' metrics | the party lists are down: money hidden', [down.money, down.cost_hidden], [null, true]);
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  S.stop(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
