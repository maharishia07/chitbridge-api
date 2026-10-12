/**
 * repeat-supply.test.cjs — REPEAT SUPPLY AS AN AGREEMENT BOTH PARTIES HOLD (round RI1, b300 DRAFT), through real Express, with a stand-in
 * auth, db and table (no database), a stand-in for the one send path (lib/autoraise.sendAs) and for the one status writer.
 *
 * Proves: the schedule math is lib/books-recurring's nextAfter, widened — the 31st meets February and comes back, every 2 weeks is 14 days,
 * a missed month runs once with its own date · the step table (may/why) for both sides · before b300 every route answers 503 in words ·
 * "Repeat this…" sends ONE agreement chit (purpose subscription, the invoice's lines, business_json.repeat) and nothing runs until the
 * customer agrees · the customer's Accept goes through the status writer · Counter puts the proposal on the agreement and the seller's
 * Agree makes it the terms (the next run carries the countered quantity with its frozen figures dropped for the send path to price) ·
 * a run is ONE normal invoice chit with client_ref rep:<id>:<date>; the same day again mints nothing (duplicate) · a skip moves the day
 * on with its reason and counts no run; the customer must say why · pause stops the sweep, resume lets it go · until N runs ENDS it ·
 * the nightly sweepAll finds the shop · a viewer is refused in the rail's words · a stranger learns nothing (404).
 * Run: node tests/repeat-supply.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');
const { memory } = require('./support/repeat-supply-memory.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222', OTHER = '33333333-3333-4333-8333-333333333333';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Mayur Bhavan' };
const SALES = { identity_id: '44444444-4444-4444-8444-444444444444', parent_entity_id: SHOP, identity_type: 'actor', access_level: 'editor', display_name: 'Priya' };
const VIEWER = { identity_id: '55555555-5555-4555-8555-555555555555', parent_entity_id: SHOP, identity_type: 'actor', access_level: 'viewer', display_name: 'Audit' };
const CUSTOMER = { identity_id: CUST, identity_type: 'entity', display_name: 'Ravi Stores' };
const STRANGER = { identity_id: OTHER, identity_type: 'entity', display_name: 'Nobody' };
let WHO = OWNER;
const authStub = Object.assign((req, res, next) => { req.identity = WHO; next(); }, {
  entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id,
  requireScope: () => (req, res, next) => next(),
});
const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});

(async () => {
  console.log('\n══ /api/repeat — repeat supply as an agreement both parties hold ══\n');
  const X = H.load({ auth: authStub });
  const CLOCK = require(path.join(H.API, 'lib', 'shop-clock'));
  const R = require(path.join(H.API, 'lib', 'repeat-supply'));
  const RC = require(path.join(H.API, 'lib', 'books-recurring'));
  const mem = memory(); R.use(mem.store); R.useSender(mem.sendAs);
  const moves = []; R.useMover(async (entity, chit_id, status, by, note) => { moves.push({ entity, chit_id, status }); return { code: 200, moved: true, body: { chit_id, status } }; });
  const app = express(); app.use(express.json()); app.use('/api/repeat', require(path.join(H.API, 'routes', 'repeat-supply')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/repeat' + p, b);
  CLOCK.set('2026-10-05T06:00:00Z');                                  /* 11:30 IST, 5 Oct — the shop's day is 2026-10-05 */

  /* 1 · PURE — the one date rule, widened */
  eq('monthly from the 31st: Jan 31 → Feb 28 → Mar 31 (the anchor comes back)', [RC.nextAfter('2026-01-31', 'monthly', 31), RC.nextAfter('2026-02-28', 'monthly', 31)], ['2026-02-28', '2026-03-31']);
  eq('every 2 weeks is 14 days; every 3 days is 3; every 2 months keeps the anchor', [RC.nextAfter('2026-03-01', 'weekly', null, 2), RC.nextAfter('2026-12-30', 'daily', null, 3), RC.nextAfter('2026-01-31', 'monthly', 31, 2)], ['2026-03-15', '2027-01-02', '2026-03-31']);
  eq('a leap February: 2028-01-31 → 2028-02-29', RC.nextAfter('2028-01-31', 'monthly', 31), '2028-02-29');
  const base = { state: 'agreed', unit: 'monthly', anchor_day: 31, every: 1, runs_done: 0, end_on: null, runs_max: null };
  eq('dueDates: a missed Aug 31 and Sep 30 both run, each with its OWN date, before Oct 31 waits', R.dueDates(Object.assign({}, base, { next_on: '2026-08-31' }), '2026-10-05'), ['2026-08-31', '2026-09-30']);
  eq('dueDates: until 2 runs stops at 2; until a date stops at the date; paused runs nothing',
    [R.dueDates(Object.assign({}, base, { next_on: '2026-07-31', runs_max: 2 }), '2026-10-05'), R.dueDates(Object.assign({}, base, { next_on: '2026-08-31', end_on: '2026-09-01' }), '2026-10-05'), R.dueDates(Object.assign({}, base, { next_on: '2026-08-31', state: 'paused' }), '2026-10-05')],
    [['2026-07-31', '2026-08-31'], ['2026-08-31'], []]);
  eq('advanced: the 3rd of 3 runs ENDS the agreement; a skip counts no run', [R.advanced(Object.assign({}, base, { next_on: '2026-09-30', runs_done: 2, runs_max: 3 }), '2026-09-30', true).state, R.advanced(Object.assign({}, base, { next_on: '2026-09-30', runs_done: 2, runs_max: 3 }), '2026-09-30', false).runs_done], ['ended', 2]);
  eq('schedule(): a bad unit, a past start, an end before the start and a count of 0 are asked in words',
    [['unit', { unit: 'hourly', start_on: '2026-10-06' }], ['past', { unit: 'weekly', start_on: '2026-10-04' }], ['end', { unit: 'weekly', start_on: '2026-10-06', until: { on: '2026-10-01' } }], ['runs', { unit: 'weekly', start_on: '2026-10-06', until: { runs: 0 } }]]
      .map(([k, b]) => { try { R.schedule(b, '2026-10-05'); return k + ':ok'; } catch (e) { return k + ':' + (e.code === 'BOOKS_BAD_REQUEST' ? 'asked' : 'thrown'); } }),
    ['unit:asked', 'past:asked', 'end:asked', 'runs:asked']);
  eq('may(): the customer accepts a proposed one, not an agreed one; the seller pauses an agreed one, not a proposed one; nobody moves an ended one; the other side\'s verb is refused',
    [R.may({ state: 'proposed' }, 'customer', 'accept').ok, R.may({ state: 'agreed' }, 'customer', 'accept').why, R.may({ state: 'agreed' }, 'seller', 'pause').ok, R.may({ state: 'proposed' }, 'seller', 'pause').why,
      R.may({ state: 'ended' }, 'seller', 'end').why, R.may({ state: 'agreed' }, 'customer', 'pause').why, R.may({ state: 'agreed', next_on: '2026-10-09' }, 'seller', 'run', '2026-10-05').why],
    [true, 'wrong_state', true, 'wrong_state', 'ended', 'not_seller', 'not_due']);
  ok('every refusal word has a sentence (a host paints it, never invents it)', Object.keys(R.WHY).every((k) => typeof R.WHY[k] === 'string' && R.WHY[k].length > 8));
  eq('runLines: a countered quantity drops the frozen line figures (the send path prices it); an untouched line keeps them; 0 removes the line',
    R.runLines([{ line_id: 'a', quantity: 2, price: 100, total: 200 }, { line_id: 'b', quantity: 1, price: 50, total: 50 }, { line_id: 'c', quantity: 1, price: 10, total: 10 }], { lines: [{ line_id: 'a', quantity: 3 }, { line_id: 'c', quantity: 0 }] }),
    [{ line_id: 'a', quantity: 3, price: 100 }, { line_id: 'b', quantity: 1, price: 50, total: 50 }]);

  /* 2 · before b300 */
  const g0 = await q('GET', '/');
  ok('BEFORE b300: GET /api/repeat → 200 { agreements: [], migrated:false } with the sentence', g0.status === 200 && g0.body.migrated === false && /next update/.test(g0.body.message), JSON.stringify(g0.body));
  const p0 = await q('POST', '/', { chit_id: 'x', unit: 'weekly', start_on: '2026-10-06' });
  ok('…POST → 503 REPEAT_NOT_MIGRATED, nothing sent', p0.status === 503 && p0.body.code === 'REPEAT_NOT_MIGRATED' && mem.sent.length === 0, JSON.stringify(p0.body));
  eq('…the nightly sweepAll skips quietly', (await R.sweepAll()).skipped, true);
  mem.migrated = true;

  /* 3 · "Repeat this…" on a sent invoice */
  const INV = 'bbbbbbbb-0000-4000-8000-000000000001';
  mem.hold(INV, SHOP, CUST, { purpose: 'invoice', line_items: [{ line_id: 'L1', seq: 10, particulars: 'Milk 1L', quantity: 20, price: 50, total: 1000 }], summary_json: { currency_code: 'INR', money: { total: 1180 } } });
  WHO = VIEWER;
  const v1 = await q('POST', '/', { chit_id: INV, unit: 'weekly', every: 1, start_on: '2026-10-06' });
  ok('a VIEWER may not make one: 403 in the rail\'s words (read_only)', v1.status === 403 && v1.body.why === 'read_only', JSON.stringify(v1.body));
  WHO = SALES;
  const bad = await q('POST', '/', { chit_id: INV, unit: 'weekly', start_on: '2026-10-01' });
  ok('a start in the past is asked about (400), nothing sent', bad.status === 400 && /past/.test(bad.body.message) && mem.sent.length === 0, JSON.stringify(bad.body));
  const c1 = await q('POST', '/', { chit_id: INV, unit: 'weekly', every: 1, start_on: '2026-10-06', until: { runs: 3 }, mode: 'draft' });
  ok('the SALES person makes it: ONE agreement chit sent (purpose subscription, the bill\'s lines, business_json.repeat), state proposed, no run yet',
    c1.status === 200 && c1.body.agreement.state === 'proposed' && mem.sent.length === 1 && mem.sent[0].body.purpose === 'subscription' && mem.sent[0].body.line_items.length === 1
      && mem.sent[0].body.business_json.repeat.agreement_id === c1.body.agreement.agreement_id && mem.sent[0].body.recipients[0].entity_id === CUST && c1.body.agreement.runs_done === 0, JSON.stringify(c1.body).slice(0, 300));
  const A = c1.body.agreement.agreement_id, AC = c1.body.agreement.chit_id;
  ok('…the list shows it with the customer\'s name, the chit\'s money, the next date and its actions (end ✓ · pause ✗ with the sentence)',
    (await q('GET', '/')).body.agreements.some((a) => a.agreement_id === A && a.customer.name === 'Ravi Stores' && a.money && a.money.total === 1180 && a.next_on === '2026-10-06' && a.actions.end.ok && !a.actions.pause.ok && a.actions.pause.say));
  ok('…both copies carry the history line', mem.notes.filter((n) => n.chit_id === AC && n.action === 'repeat_proposed').map((n) => n.entity).sort().join() === [CUST, SHOP].sort().join());
  eq('nothing runs before the customer agrees (the sweep)', (await R.sweep(SHOP, '2026-10-07')).ran, []);

  /* 4 · the customer: a stranger learns nothing; Counter; the seller Agrees; Accept */
  WHO = STRANGER;
  ok('a stranger naming the agreement id → 404', (await q('GET', '/' + A + '?chit=' + AC)).status === 404);
  WHO = CUSTOMER;
  const g1 = await q('GET', '/' + A + '?chit=' + AC);
  ok('the customer reads it through the chit they hold: side customer, accept ✓ counter ✓ decline ✓ skip ✗', g1.status === 200 && g1.body.agreement.side === 'customer' && g1.body.agreement.actions.accept.ok && g1.body.agreement.actions.counter.ok && !g1.body.agreement.actions.skip.ok, JSON.stringify(g1.body).slice(0, 300));
  const co = await q('POST', '/' + A + '/counter', { chit_id: AC, lines: [{ line_id: 'L1', quantity: 15 }], note: 'Fifteen is enough on weekdays' });
  ok('COUNTER: state countered, the proposal on the agreement, the note in both histories', co.status === 200 && co.body.agreement.state === 'countered' && co.body.agreement.counter.lines[0].quantity === 15 && mem.notes.some((n) => n.action === 'repeat_counter' && /Fifteen/.test(n.detail) && n.entity === SHOP), JSON.stringify(co.body).slice(0, 300));
  const ac0 = await q('POST', '/' + A + '/accept', { chit_id: AC });
  ok('…accept is refused while a counter is open (422 REPEAT_WRONG_STATE, the sentence)', ac0.status === 422 && ac0.body.code === 'REPEAT_WRONG_STATE' && /step/.test(ac0.body.message), JSON.stringify(ac0.body));
  WHO = OWNER;
  const ag = await q('POST', '/' + A + '/agree', {});
  ok('the seller AGREES: the countered quantity is the terms, state agreed, the counter cleared', ag.status === 200 && ag.body.agreement.state === 'agreed' && ag.body.agreement.terms.lines[0].quantity === 15 && ag.body.agreement.counter === null, JSON.stringify(ag.body).slice(0, 300));

  /* 5 · the runs: one normal chit per day, idempotent */
  CLOCK.set('2026-10-20T06:00:00Z');                                  /* two weekly runs missed: 6 Oct and 13 Oct; 20 Oct is due today */
  const s1 = await R.sweep(SHOP);
  eq('the sweep runs every missed day, oldest first, each with its own date: 6 Oct · 13 Oct · 20 Oct', s1.ran.map((x) => x.date), ['2026-10-06', '2026-10-13', '2026-10-20']);
  const runs = mem.sent.filter((s) => s.body.purpose === 'invoice');
  ok('each run is ONE invoice chit through the send path: draft (mode draft), the countered quantity with its frozen total dropped, client_ref rep:<id>:<date> = the Idempotency-Key',
    runs.length === 3 && runs.every((s) => s.body.is_draft === true && s.body.line_items[0].quantity === 15 && !('total' in s.body.line_items[0]) && s.body.client_ref === 'rep:' + A + ':' + s.body.business_json.repeat_run && s.opts.idempotency_key === s.body.client_ref), JSON.stringify(runs[0] && runs[0].body).slice(0, 300));
  const row = mem.rows.find((r) => r.agreement_id === A);
  ok('…until 3 runs: the agreement ENDED after the third, runs recorded by day, last run 20 Oct', row.state === 'ended' && row.runs_done === 3 && Object.keys(row.runs).length === 3 && row.last_run_on === '2026-10-20', JSON.stringify(row).slice(0, 300));
  /* the sweep died after the send and before the row moved: put the row back, run again — the send answers the FIRST chit */
  Object.assign(row, { state: 'agreed', next_on: '2026-10-20', runs_done: 2, runs: Object.assign({}, row.runs, { '2026-10-20': undefined }) }); delete row.runs['2026-10-20'];
  const s2 = await R.sweep(SHOP);
  ok('A RE-RUN NEVER MINTS TWICE: the day put back answers duplicate, still 3 invoice chits, the row moves on', s2.ran.length === 1 && s2.ran[0].duplicate === true && mem.sent.filter((s) => s.body.purpose === 'invoice').length === 3 && row.state === 'ended', JSON.stringify(s2));
  eq('…and the next sweep has nothing to do', (await R.sweep(SHOP)).ran, []);

  /* 6 · a second agreement: Accept through the status writer · skip · pause · resume · run now · decline refused after · end */
  CLOCK.set('2026-10-05T06:00:00Z');
  const c2 = await q('POST', '/', { chit_id: INV, unit: 'monthly', start_on: '2026-10-31', mode: 'send' });
  const B = c2.body.agreement.agreement_id, BC = c2.body.agreement.chit_id;
  WHO = CUSTOMER;
  const sk0 = await q('POST', '/' + B + '/skip', { chit_id: BC, reason: 'x' });
  ok('the customer cannot skip before agreeing (422 wrong_state)', sk0.status === 422 && sk0.body.code === 'REPEAT_WRONG_STATE');
  const ac = await q('POST', '/' + B + '/accept', { chit_id: BC });
  ok('ACCEPT: the received copy moves to accepted through the ONE status writer; state agreed', ac.status === 200 && ac.body.agreement.state === 'agreed' && moves.some((m) => m.entity === CUST && m.chit_id === BC && m.status === 'accepted'), JSON.stringify(ac.body).slice(0, 200));
  const sk1 = await q('POST', '/' + B + '/skip', { chit_id: BC });
  ok('the customer\'s skip needs a reason (422 REPEAT_REASON_NEEDED)', sk1.status === 422 && sk1.body.code === 'REPEAT_REASON_NEEDED', JSON.stringify(sk1.body));
  const sk2 = await q('POST', '/' + B + '/skip', { chit_id: BC, reason: 'Shop shut for Diwali' });
  ok('SKIP: 31 Oct passes with the reason (both histories), the day moves to 30 Nov (the 31st in a short month), no run counted',
    sk2.status === 200 && sk2.body.agreement.next_on === '2026-11-30' && sk2.body.agreement.runs_done === 0 && sk2.body.agreement.skips[0].reason === 'Shop shut for Diwali' && mem.notes.some((n) => n.action === 'repeat_skip' && /Diwali/.test(n.detail) && n.entity === SHOP), JSON.stringify(sk2.body).slice(0, 300));
  WHO = OWNER;
  CLOCK.set('2026-12-02T06:00:00Z');
  const pz = await q('POST', '/' + B + '/pause', { reason: 'Stock out' });
  ok('PAUSE (seller): state paused; the sweep runs nothing though 30 Nov is past', pz.status === 200 && pz.body.agreement.state === 'paused' && (await R.sweep(SHOP)).ran.length === 0);
  const rn0 = await q('POST', '/' + B + '/run', {});
  ok('…Run now is refused while paused (422)', rn0.status === 422 && rn0.body.code === 'REPEAT_WRONG_STATE');
  const rs = await q('POST', '/' + B + '/resume', {});
  const rn = await q('POST', '/' + B + '/run', {});
  ok('RESUME then RUN NOW: the missed 30 Nov runs with its own date, SENT (mode send, not a draft), the next day is 31 Dec',
    rs.body.agreement.state === 'agreed' && rn.status === 200 && rn.body.ran.length === 1 && rn.body.ran[0].date === '2026-11-30' && rn.body.agreement.next_on === '2026-12-31'
      && mem.sent.filter((s) => s.body.client_ref === 'rep:' + B + ':2026-11-30' && s.body.is_draft === false).length === 1, JSON.stringify(rn.body).slice(0, 300));
  eq('the nightly sweepAll names the shop and runs nothing twice', await R.sweepAll(), { shops: 1, ran: 0, problems: 0 });
  mem.refuseSend = 'Over the credit limit';
  CLOCK.set('2027-01-02T06:00:00Z');
  const s3 = await R.sweep(SHOP);
  ok('a run the send path REFUSES is a named problem (the reason), the row stays put, nothing recorded', s3.ran.length === 0 && s3.problems.length === 1 && /credit limit/.test(s3.problems[0].why) && mem.rows.find((r) => r.agreement_id === B).next_on === '2026-12-31', JSON.stringify(s3));
  mem.refuseSend = null;
  const en = await q('POST', '/' + B + '/end', { reason: 'Customer moved' });
  ok('END (seller): state ended with the reason; every verb now answers ended', en.status === 200 && en.body.agreement.state === 'ended' && en.body.agreement.state_note === 'Customer moved' && Object.values(en.body.agreement.actions).every((v) => v.why === 'ended'));
  WHO = CUSTOMER;
  const dc = await q('POST', '/' + B + '/decline', { chit_id: BC });
  ok('…the customer\'s decline after that is refused in words (422 ended)', dc.status === 422 && dc.body.code === 'REPEAT_ENDED', JSON.stringify(dc.body));

  /* 7 · decline by the customer, and the seller refusing a counter */
  WHO = OWNER;
  const c3 = await q('POST', '/', { chit_id: INV, unit: 'daily', every: 2, start_on: '2027-01-03' });
  const C3 = c3.body.agreement.agreement_id, C3C = c3.body.agreement.chit_id;
  WHO = CUSTOMER;
  const d3 = await q('POST', '/' + C3 + '/decline', { chit_id: C3C, reason: 'Too often' });
  ok('DECLINE: the copy moves to rejected through the status writer, state declined with the reason', d3.status === 200 && d3.body.agreement.state === 'declined' && moves.some((m) => m.chit_id === C3C && m.status === 'rejected') && d3.body.agreement.state_note === 'Too often');
  WHO = OWNER;
  const c4 = await q('POST', '/', { chit_id: INV, unit: 'weekly', start_on: '2027-01-04' });
  const C4 = c4.body.agreement.agreement_id, C4C = c4.body.agreement.chit_id;
  WHO = CUSTOMER;
  await q('POST', '/' + C4 + '/counter', { chit_id: C4C, every: 2, unit: 'weekly', start_on: '2027-01-11', note: 'Fortnightly please' });
  WHO = OWNER;
  const rf = await q('POST', '/' + C4 + '/refuse', { reason: 'Weekly or nothing' });
  ok('the seller REFUSES a counter: state declined with the reason, the counter cleared', rf.status === 200 && rf.body.agreement.state === 'declined' && rf.body.agreement.counter === null && rf.body.agreement.state_note === 'Weekly or nothing');
  ok('a schedule counter the seller AGREES to becomes the schedule (every 2 weeks from 11 Jan)', await (async () => {
    WHO = OWNER; const c5 = await q('POST', '/', { chit_id: INV, unit: 'weekly', start_on: '2027-01-04' }); const id = c5.body.agreement.agreement_id, cc = c5.body.agreement.chit_id;
    WHO = CUSTOMER; await q('POST', '/' + id + '/counter', { chit_id: cc, every: 2, unit: 'weekly', start_on: '2027-01-11', note: 'Fortnightly' });
    WHO = OWNER; const a = await q('POST', '/' + id + '/agree', {});
    return a.body.agreement.state === 'agreed' && a.body.agreement.every === 2 && a.body.agreement.next_on === '2027-01-11';
  })());

  srv.close(); CLOCK.reset(); R.use(null); R.useSender(null); R.useMover(null);
  console.log('\n   ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
