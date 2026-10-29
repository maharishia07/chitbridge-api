/**
 * tests/line-rules.test.cjs — the line-model rules that had no test (RAIL-133 e).
 *
 * The card docs/01-rail-core-the-chit/functions/line-model.md found 12 of 31 rules untested. This pins the ones
 * the JS decides: R4 R5 (a delivery row's own check), R9 R10 R11 R13 R14 (progress, as arithmetic on pre-read
 * rows), R22 R26 (an assignment edit's check and bounds), R31 (a person's "done" is not the events' "done").
 * Not here: R1 (chit_line rows are written by chit_deliver, SQL) and R25 (an unknown state stored as open:
 * RAIL-133 b makes it a 400, so it is not pinned as it stands).
 *
 * ../db is stubbed: every statement is recorded and answers from `answer`, so nothing needs Postgres.
 */
const path = require('path');

const calls = [];
let answer = () => ({ rows: [] });
const client = { query: async (sql, params) => { calls.push({ sql: String(sql), params }); return answer(String(sql), params); } };
const dbPath = require.resolve(path.join(__dirname, '..', 'db'));
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    query: client.query,
    withEntity: async (_id, fn) => fn(client),
    onEntity: async (_id, _db, fn) => fn(client),
    withTransaction: async (fn) => fn(client),
  },
};
const deliverline = require('../lib/deliverline');
const assign = require('../lib/assign');

let pass = 0;
let fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.error('  FAIL ' + name + (extra ? '   ' + extra : '')); }
};
/** the 400 sentence a call refuses with, or '' when it was not refused with a 400 */
const refusedWith = async (fn) => { try { await fn(); return ''; } catch (e) { return e.status === 400 ? e.message : ''; } };

const ME = 'e-me';
/* one event row in the shape progress() reads (PROGRESS_SQL) */
const ev = (line_id, ordered, o) => Object.assign({
  line_id, particulars: line_id, ordered_unit: 'kg', ordered, ordered_price: null, removed: false,
  delivery_id: null, dq: null, du: 'kg', damount: null, dkind: null, dparticulars: null,
  recorded_by_entity_id: ME, delivered_at: '2026-10-28T00:00:00Z',
}, o || {});
let n = 0;
const got = (line_id, ordered, dq, o) => ev(line_id, ordered, Object.assign({ delivery_id: line_id + '-' + (++n), dq }, o || {}));

(async () => {
  console.log('\n── R4 R5 · a delivery row\'s own check (lib/deliverline.js checkRow) ──');
  const rec = (rows) => refusedWith(() => deliverline.record(ME, 'c1', rows, {}));
  t('R4 a row with no line_id is refused', (await rec([{ quantity: 1 }])) === 'Each delivery needs a line_id');
  t('R4 a zero quantity is refused', /^quantity must be a non-zero number/.test(await rec([{ line_id: 'l1', quantity: 0 }])));
  t('R4 a quantity that is not a number is refused', /^quantity must be a non-zero number/.test(await rec([{ line_id: 'l1', quantity: 'ten' }])));
  t('R4 a negative quantity is a correcting entry, not refused', (await rec([{ line_id: 'l1', quantity: -2 }])) === '');
  t('R5 an add with neither quantity nor amount is refused', /^an added event needs a quantity or an amount/.test(await rec([{ line_id: 'l1', kind: 'add', particulars: 'brake oil' }])));
  t('R5 an add must say what it was for', (await rec([{ line_id: 'l1', kind: 'add', amount: 450 }])) === 'an added event must say what it was for');
  t('R5 an add with an amount and a reason passes the check', (await rec([{ line_id: 'l1', kind: 'add', amount: 450, particulars: 'call-out fee' }])) === '');
  t('R5 any other kind is checked as a delivery', /^quantity must be a non-zero number/.test(await rec([{ line_id: 'l1', kind: 'gift', amount: 5, particulars: 'x' }])));
  t('an empty list is refused', (await rec([])) === 'Nothing to record');

  console.log('\n── R9 R10 R11 R13 R14 · progress, from the rows ──');
  const m = await deliverline.progress(ME, 'c1', null, [
    got('mine-only', 10, 4),
    got('agree', 10, 6), got('agree', 10, 6, { recorded_by_entity_id: 'e-them' }),
    got('differ', 10, 6), got('differ', 10, 5, { recorded_by_entity_id: 'e-them' }),
    got('theirs-bigger', 10, 2), got('theirs-bigger', 10, 9, { recorded_by_entity_id: 'e-them' }),
    got('over', 10, 13),
    got('units', 10, 3), got('units', 10, 2, { du: 'crate' }), got('units', 10, 1, { du: '' }),
    got('added', 5, 2), got('added', 5, 1, { dkind: 'add', du: 'litre', damount: '120.5', dparticulars: 'brake oil' }),
    got('added', 5, 0, { dkind: 'add', du: null, damount: '300', dparticulars: 'labour' }),
    got('corrected', 10, 7), got('corrected', 10, -3),
  ]);
  const L = (id) => m.get(id) || {};
  t('R9 delivered is the sum of MY rows', L('mine-only').delivered === 4 && L('corrected').delivered === 4);
  t('R9 theirs is shown beside mine, never merged: their larger figure does not move mine', L('theirs-bigger').delivered === 2 && L('theirs-bigger').theirs === 9);
  t('R10 a blank unit counts as the ordered unit', L('units').delivered === 4);
  t('R10 another unit is carried beside the total, flagged, never converted',
    L('units').unit_mismatch === true && L('units').other_units.length === 1 && L('units').other_units[0].unit === 'crate' && L('units').other_units[0].mine === 2);
  t('R10 a line with a delivery in another unit is not complete on it', L('units').complete === false);
  t('R11 an add never touches delivered', L('added').delivered === 2 && L('added').added.length === 2);
  t('R11 an add\'s money sums into charged', L('added').charged === 420.5);
  t('R13 pending is ordered − delivered', L('mine-only').pending === 6);
  t('R13 pending is never below 0, and over is shown, not refused', L('over').pending === 0 && L('over').over === 3 && L('over').delivered === 13);
  t('R14 both sides spoke, equal totals → both_agree', L('agree').both_agree === true && L('agree').divergent === false);
  t('R14 both sides spoke, different totals → divergent', L('differ').divergent === true && L('differ').both_agree === false);
  t('R14 one side only → unacknowledged, not divergent', L('mine-only').unacknowledged === true && L('mine-only').divergent === false);
  const s = deliverline.summarise(m);
  t('R11 charged sums across lines in the roll-up', s.charged === 420.5);
  t('R14 the roll-up counts divergent and unacknowledged lines', s.divergent === 2 && s.unacknowledged >= 1);

  console.log('\n── R22 R26 · an assignment edit (lib/assign.js) ──');
  const asg = (edits) => refusedWith(() => assign.assign(ME, 'c1', edits, {}));
  t('R22 an empty list is refused', (await asg([])) === 'Nothing to assign');
  t('R22 an edit with no line_id is refused', (await asg([{ assignee_actor_id: null }])) === 'Each assignment needs a line_id');
  t('R22 assignee_actor_id left out is refused (null is not the same thing)', /^Send assignee_actor_id explicitly/.test(await asg([{ line_id: 'l1' }])));
  t('R22 a due_date not shaped YYYY-MM-DD is refused', (await asg([{ line_id: 'l1', assignee_actor_id: null, due_date: '28/10/2026' }])) === 'due_date must be YYYY-MM-DD');
  calls.length = 0;
  answer = () => ({ rows: [{ line_id: 'l1' }] });
  await assign.assign(ME, 'c1', [{
    line_id: 'l1', assignee_actor_id: null, assignee_name: 'N'.repeat(200), task: 'T'.repeat(200), note: 'x'.repeat(500), assignee_type: 'robot',
  }], {});
  const p = (calls.find((c) => /INSERT INTO chit_line_assignment/.test(c.sql)) || {}).params || [];
  t('R22 null assignee_actor_id is written as null (taken off the person)', p[3] === null);
  t('R26 the name is cut to 120', p[4] && p[4].length === 120);
  t('R26 the type is human or ai, else null', p[5] === null);
  t('R26 the task is cut to 80', p[6] && p[6].length === 80);
  t('R26 the note is cut to 300', p[8] && p[8].length === 300);

  console.log('\n── R31 · a person\'s "done" is not the events\' "done" ──');
  answer = () => ({ rows: [
    { assignee_actor_id: 'a1', assignee_name: 'Murugan', chit_id: 'c1', line_id: 'said-done', seq: 1, state: 'done', particulars: 'p', quantity: '5', unit: 'kg', delivered: '0' },
    { assignee_actor_id: 'a1', assignee_name: 'Murugan', chit_id: 'c1', line_id: 'all-in', seq: 1, state: 'open', particulars: 'q', quantity: '5', unit: 'kg', delivered: '5' },
  ] });
  const people = await assign.byPerson(ME, {});
  const lines = people.people.flatMap((x) => x.lines);
  const byId = (id) => lines.find((x) => x.line_id === id) || {};
  t('R31 a line a person marked done with nothing delivered stays done, and still shows what is left', byId('said-done').state === 'done' && byId('said-done').left === 5);
  t('R31 a line fully delivered that nobody marked done stays open', byId('all-in').state === 'open' && byId('all-in').left === 0);

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
