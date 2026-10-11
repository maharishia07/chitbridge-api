/**
 * work-rows.test.cjs — TASKS & ORDERS, READ (TO1/A1): GET /api/work/list · /api/work/:id · /api/work/facts through the REAL router,
 * lib/work-rows, lib/select and the adopted engines, over a stubbed database. Offline: no Postgres, no network.
 *
 *   1  the list: folders (a self-PO is Orders OUT — the declared side, never `direction`), a note-to-self counted once, a bill left out,
 *      counts per folder, filters (status · assigned · q), paging
 *   2  the row: stage word, billed / despatched marks, delivery progress → lines_open_n, task assignee, line assignees, total in MINOR units
 *   3  the sheet (one): lines with delivered / remaining, current assignee + history, settings, per-line verdicts
 *   4  actions: EVERY action answered, a refused one with its sentence; a viewer is refused everything, in rail's words
 *   5  truncated: more copies than one read takes → `truncated: true`, no counts, no total (never a wrong one)
 *   6  degrade: line tables not migrated → null fields, not a 500
 *   7  trips: the list is select (4) + ONE batch (1); facts is select only; one is select + the batch — never a query per row
 *   8  RLS: another shop sees nothing and gets 404 for this shop's chit; every statement names the entity; customer role and API keys refused
 *   9  static: reads only (no INSERT/UPDATE/DELETE), no copied rail table, the one marks statement is open-orders'
 */
'use strict';
const path = require('path'), fs = require('fs');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

const S = require('./support/work-stub.cjs');
const { D, E2, U, copy, seed, reset, as, get } = S;
const srv = { listen: (p, h, cb) => S.start().then(cb), address: () => ({}), close: () => S.stop() };
(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  console.log('\n══ work-rows — Tasks & Orders, read ══\n');

  /* ── 1 · the list ── */
  seed(); as({});
  let r = await get('/api/work/list?view=orders_in');
  ok('GET /list → 200', r.status === 200, JSON.stringify(r.body).slice(0, 200));
  ok('counts per folder: orders in 1 · orders out 3 (a self-PO, an order I sent, a PO to myself) · tasks 1 · done 2',
    JSON.stringify(r.body.counts) === JSON.stringify({ orders_in: 1, orders_out: 3, tasks: 1, done: 2 }), JSON.stringify(r.body.counts));
  ok('Orders in lists the one open sale; a bill, a sent non-order and the other shop\'s chit are nowhere', r.body.rows.length === 1 && r.body.rows[0].chit_id === U(1) && r.body.total === 1);
  const out = (await get('/api/work/list?view=orders_out')).body;
  ok('⭐ a self-PO (received, declared buy) is Orders OUT — the side is declared, never read off direction', out.rows.some((x) => x.chit_id === U(2) && x.side === 'buy'));
  ok('a self-chit holds two copies and counts once', out.rows.filter((x) => x.chit_id === U(7)).length === 1 && out.total === 3);
  const tasks = (await get('/api/work/list?view=tasks')).body;
  ok('Tasks: what came to me that is not an order', tasks.rows.length === 1 && tasks.rows[0].chit_id === U(4) && tasks.rows[0].kind === 'task');
  const done = (await get('/api/work/list?view=done')).body;
  ok('Done: closed and rejected, with how they closed', done.rows.map((x) => x.word).sort().join() === 'Closed,Rejected', done.rows.map((x) => x.word).join());
  ok('an unknown view falls back to Orders in; the limit is capped', (await get('/api/work/list?view=bogus&limit=9999')).body.limit === 100);
  ok('filter status=accepted', (await get('/api/work/list?view=orders_out&status=accepted')).body.rows.every((x) => x.status === 'accepted'));
  ok('filter assigned=me / none / <id>', (await get('/api/work/list?view=tasks&assigned=me')).body.total === 1
    && (await get('/api/work/list?view=tasks&assigned=none')).body.total === 0 && (await get('/api/work/list?view=tasks&assigned=A1')).body.total === 1);
  ok('filter q matches the customer\'s name from the order itself (Meena)', (await get('/api/work/list?view=orders_in&q=meena')).body.total === 1 && (await get('/api/work/list?view=orders_in&q=zzz')).body.total === 0);
  const p2 = (await get('/api/work/list?view=orders_out&limit=2&page=2')).body;
  ok('paging: page 2 of 3 rows at 2 a page holds the last one; total says 3', p2.rows.length === 1 && p2.total === 3 && p2.page === 2);

  /* ── 2 · the row ── */
  const o1 = (await get('/api/work/list?view=orders_in')).body.rows[0];
  ok('row: kind · tab · stage · word', o1.kind === 'order_in' && o1.tab === 'orders_in' && o1.stage === 'new' && o1.word === 'New');
  ok('row: the storefront\'s own words — channel · fulfilment · asked-for date · remark', o1.channel === 'online' && o1.fulfilment === 'pickup' && o1.requested_for === '2026-10-12' && o1.remark === 'Ring first' && o1.party === 'Meena');
  ok('row: total in MINOR units (1200.50 INR → 120050)', o1.total_minor === 120050 && o1.currency === 'INR');
  ok('row: lines 2, one still open (5 of 5 sent, 1 of 3 sent)', o1.lines_n === 2 && o1.lines_open_n === 1);
  ok('row: the task-level assignee, and how many lines are held (one of two has a latest holder)', o1.assignee && o1.assignee.id === 'A1' && o1.assignee.name === 'Asha' && o1.lines_assigned_n === 1);
  ok('row: ref from the order', o1.ref === 'SO-1');
  ok('row: billed comes from the till\'s own mark (open-orders MARKS) — c2 is billed, c1 is not', o1.billed === false && out.rows.find((x) => x.chit_id === U(2)).billed === true);

  /* ── 3 · the sheet ── */
  r = await get('/api/work/' + U(1));
  ok('GET /:id → 200 with the row and its lines', r.status === 200 && r.body.chit_id === U(1) && r.body.lines.length === 2);
  const L1 = r.body.lines[0], L2 = r.body.lines[1];
  ok('line: ordered · delivered · remaining by the delivery events; price in minor units', L1.qty === 5 && L1.delivered === 5 && L1.remaining === 0 && L2.delivered === 1 && L2.remaining === 2 && L1.price_minor === 10000 && L2.price_minor === 25000);
  ok('line: the CURRENT holder (latest seq wins) with the history behind it', L1.assignment.assignee_name === 'Asha' && L1.assignment.history.length === 1 && L1.assignment.history[0].assignee_name === 'Ravi');
  ok('line: settings from the assignment (due · task · note · state); an unassigned line says open', L1.settings.due === '2026-10-12' && L1.settings.task === 'pack' && L1.settings.note === 'fragile' && L1.settings.state === 'open' && L2.assignment === null && L2.settings.state === 'open');
  ok('line: three verdicts (assign · deliver · amend)', Object.keys(L1.actions).sort().join() === 'amend,assign_line,deliver_line');
  ok('/:id of something that is not a chit, or not a task or order → 404', (await get('/api/work/not-a-uuid')).status === 404 && (await get('/api/work/' + U(6))).status === 404 && (await get('/api/work/' + U(8))).status === 404);

  /* ── 4 · actions ── */
  const A = o1.actions;
  ok('actions: every action is answered — shown, never hidden', ['accept', 'reject', 'complete', 'cancel', 'reopen', 'assign_task', 'assign_line', 'deliver_line', 'amend'].every((k) => A[k]));
  ok('actions: accept is ok on a new order; reopen is refused wrong_step WITH its sentence', A.accept.ok === true && A.reopen.ok === false && A.reopen.why === 'wrong_step' && /cannot move/.test(A.reopen.say));
  ok('actions: reject and an early complete ask for a reason (lines still open)', A.reject.needs[0] === 'reason' && A.complete.needs[0] === 'reason');
  as({ level: 'viewer' });
  const V = (await get('/api/work/list?view=orders_in')).body.rows[0].actions;
  ok('actions: a viewer is refused every action in rail\'s sentence', Object.keys(V).every((k) => V[k].ok === false && V[k].why === 'read_only' && /view-only/.test(V[k].say)));
  as({ level: 'commenter' });
  ok('actions: a commenter is comment_only', (await get('/api/work/list?view=orders_in')).body.rows[0].actions.accept.why === 'comment_only');
  as({});
  const sentRow = (await get('/api/work/list?view=orders_out')).body.rows.find((x) => x.chit_id === U(3));
  ok('actions: on an order I only SENT, accept is not_received (my sent copy has no steps)', sentRow.actions.accept.why === 'not_received');
  const closed = (await get('/api/work/list?view=done')).body.rows.find((x) => x.status === 'completed');
  ok('actions: a closed order may be reopened', closed.actions.reopen.ok === true && closed.actions.complete.why === 'already_done');

  /* ── 5 · facts ── */
  r = await get('/api/work/facts');
  ok('GET /facts → counts, lines for the Home box, figures', r.status === 200 && r.body.truncated === false && r.body.counts.orders_in === 1 && r.body.figures.orders_new === 1
    && r.body.figures.tasks_mine === 1 && r.body.lines.map((l) => l.text).join('|') === '1 new order|1 task for you', JSON.stringify(r.body));

  /* ── 6 · truncated ── */
  D.bigRows = Array.from({ length: 5000 }, (_, i) => copy(1000 + i, { chit_id: U(1000 + i) }));
  const big = (await get('/api/work/list?view=orders_in')).body;
  ok('⭐ more copies than one read takes → truncated, NO counts, NO total (never a wrong one); the newest page still answers', big.truncated === true && big.counts === null && big.total === null && big.rows.length === 50);
  const bf = (await get('/api/work/facts')).body;
  ok('facts when truncated: no counts, no lines, no figures — left out, never 0', bf.truncated === true && bf.counts === null && bf.lines.length === 0 && Object.keys(bf.figures).length === 0);
  D.bigRows = null;

  /* ── 7 · degrade ── */
  D.tables = false; require('../lib/schema')._reset();
  r = await get('/api/work/list?view=orders_in');
  ok('line tables not migrated → 200; lines_n / lines_open_n null, not 0 and not a 500', r.status === 200 && r.body.rows[0].lines_n === null && r.body.rows[0].lines_open_n === null && r.body.rows[0].lines_assigned_n === null);
  D.tables = true; require('../lib/schema')._reset();

  /* ── 8 · trips ── */
  seed(); reset(); await get('/api/work/list?view=orders_out&limit=100');
  const listTrips = D.trips, listBatches = D.batches;
  ok('trips: the list = select (4) + ONE batch (1) = 5, whatever the number of rows (3 rows here)', listTrips === 5 && listBatches === 1, 'trips ' + listTrips);
  D.bigRows = null; reset(); await get('/api/work/facts');
  ok('trips: facts = select only (4), no batch', D.trips === 4 && D.batches === 0, 'trips ' + D.trips);
  reset(); await get('/api/work/' + U(1));
  ok('trips: the sheet = select (4) + ONE batch (1) for header · lines · marks · progress · line assignees', D.trips === 5 && D.batches === 1, 'trips ' + D.trips);
  reset(); await get('/api/work/list?view=orders_out&limit=1');
  const batch1 = D.statements.filter((s) => /ANY\(\$2::uuid\[\]\)/.test(s)).length;
  seed(); reset(); await get('/api/work/list?view=orders_out&limit=100');
  const batchN = D.statements.filter((s) => /ANY\(\$2::uuid\[\]\)/.test(s)).length;
  ok('trips: the number of statements does not grow with the rows (1 row = N rows)', batch1 === batchN && batchN === 3, batch1 + ' vs ' + batchN);

  /* ── 9 · RLS and refusals ── */
  as({ identity_id: 'B1', entity_id: E2 });
  const theirs = (await get('/api/work/list?view=orders_in')).body;
  ok('RLS: another shop sees none of this shop\'s chits (its own only)', theirs.rows.every((x) => x.chit_id === U(10)) && theirs.counts.tasks === 0);
  ok('RLS: another shop asking for this shop\'s chit id gets 404 — nothing, not "forbidden"', (await get('/api/work/' + U(1))).status === 404);
  as({});
  reset(); await get('/api/work/list?view=orders_out'); await get('/api/work/' + U(1));
  ok('RLS: every statement names the entity (cs.entity_id = $1 / h.entity_id = $1 / entity_id = $1)', D.statements.filter((s) => /FROM chit_(status|header|line|line_assignment)\b/.test(s)).every((s) => /entity_id = \$1/.test(s)));
  as({}, true);
  ok('an API key is refused on all three routes (a key is not a person)', (await get('/api/work/list')).status === 403 && (await get('/api/work/facts')).status === 403 && (await get('/api/work/' + U(1))).status === 403);
  as({ identity_type: 'customer' });
  ok('the customer role is refused on all three routes', (await get('/api/work/list')).status === 403 && (await get('/api/work/facts')).status === 403 && (await get('/api/work/' + U(1))).status === 403);
  as({});

  /* ── 10 · static ── */
  const src = fs.readFileSync(path.join(API, 'lib', 'work-rows.js'), 'utf8') + fs.readFileSync(path.join(API, 'routes', 'work.js'), 'utf8');
  ok('reads only: no INSERT / UPDATE / DELETE in the work lib or routes', !/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i.test(src) && !/router\.(post|put|patch|delete)\(/.test(src));
  ok('no copied status table: nothing here lists the rail transitions', !/in_progress['"],\s*['"]partial/.test(src));
  ok('the marks statement is open-orders\' own (one definition of billed / despatched)', /openOrders\.MARKS_SQL/.test(src) && !/business_json->'against'/.test(src));
  ok('the routes are mounted in server.js', /app\.use\('\/api\/work', require\('\.\/routes\/work'\)\)/.test(fs.readFileSync(path.join(API, 'server.js'), 'utf8')));

  srv.close();
  console.log('\n  ' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + pass + ' passed · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
