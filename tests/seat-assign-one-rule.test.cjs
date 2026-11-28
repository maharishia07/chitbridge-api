/**
 * tests/seat-assign-one-rule.test.cjs — DRIFT 9b (Athi 28 Nov): "assign" on a paper the shop SENT is allowed as on one it received, and every door reads ONE rule (lib/seat-abilities).
 * Door A = the work sheet's assign_line (lib/workflow via lib/work-rows) + POST /chits/:id/assign-lines; door B = the worklist (lib/assign byPerson).
 * Guard: the real deciders are driven on sent AND received papers, and the doors carry no paper test of their own.
 * Mutations (recorded in the PR): (1) restore OWN_PAPER_SQL in byPerson; (2) drop the `a.assignee_actor_id IS NOT NULL OR` clause; (3) the route decides on its own again -> each goes red.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
let fails = 0;
const t = (n, f) => { try { f(); console.log('ok   ' + n); } catch (e) { fails++; console.log('FAIL ' + n + '\n     ' + e.message); } };
const sa = require('../lib/seat-abilities');
const workflow = require('../lib/workflow');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const papers = [];
for (const direction of ['sent', 'received']) for (const purpose of ['order', 'task', 'invoice']) for (const is_job of [false, true]) papers.push({ direction, purpose, is_job });
const editor = { level: 'editor' }, viewer = { level: 'viewer' };
const factsOf = (p) => ({ held: true, sender: p.direction === 'sent', received: p.direction === 'received' ? 'pending' : null, purpose: p.purpose });

t('door A: the sheet offers assign_line on a SENT paper as on a received one, the verdict being seat-abilities.assignOn', () => {
  for (const p of papers) {
    assert.strictEqual(workflow.actions(factsOf(p), editor).assign_line.ok, true, 'sheet refuses ' + JSON.stringify(p));
    assert.strictEqual(workflow.actions(factsOf(p), viewer).assign_line.ok, sa.assignOn(true, viewer).ok, 'viewer: sheet and rule differ');
  }
  assert.strictEqual(sa.assignOn(true, editor).ok, true);
  assert.strictEqual(sa.assignOn(false, editor).ok, false, 'no copy held: refused');
});
t('door B: every paper door A offers assign on shows its ASSIGNED line on the worklist', () => {
  for (const p of papers) {
    if (workflow.actions(factsOf(p), editor).assign_line.ok) assert.strictEqual(sa.worklistShows(p, 'actor-1'), true, JSON.stringify(p));
  }
});
t('door B keeps the N-F-03 rule for UNASSIGNED lines: only a paper that came to me', () => {
  assert.strictEqual(sa.worklistShows({ direction: 'sent', purpose: 'order', is_job: false }, null), false);
  assert.strictEqual(sa.worklistShows({ direction: 'received', purpose: 'order', is_job: false }, null), true);
  assert.strictEqual(sa.worklistShows({ direction: 'received', purpose: 'invoice', is_job: false }, null), false);
  assert.strictEqual(sa.worklistShows({ direction: 'sent', purpose: 'task', is_job: true }, null), true);
});
t('the SQL twin names the columns the JS rule reads and keeps the same clauses', () => {
  const sql = sa.cameToMeSql('h').replace(/\s+/g, ' ');
  assert.ok(sql.includes("COALESCE(h.purpose, '') <> 'invoice'"));
  assert.ok(sql.includes("CASE WHEN COALESCE(h.is_job, false) THEN h.direction <> 'received' ELSE COALESCE(h.direction, 'received') = 'received' END"));
});
t('the work list classify and the worklist share ONE came-to-me predicate (onMyCopy)', () => {
  const rows = read('lib/work-rows.js');
  assert.ok(rows.includes('seatAbilities.onMyCopy('));
  assert.ok(!/is_job_chit \? x\.r\.direction/.test(rows), 'classify decides on its own again');
});
t('door B (lib/assign.js) has no paper test of its own and reads seat-abilities', () => {
  const src = read('lib/assign.js');
  assert.ok(src.includes("require('./seat-abilities')"), 'byPerson must import seat-abilities');
  assert.ok(!src.includes('OWN_PAPER_SQL'), 'the old own-paper filter is back');
  assert.ok(!/h\.direction\s*(<>|=)/.test(stripComments(src)), 'a direction test lives in assign.js');
  assert.ok(src.includes('a.assignee_actor_id IS NOT NULL OR'), 'an assigned line of a sent paper must pass the filter');
});
t('door A (the assign-lines route) asks seat-abilities.assignOn and does not decide on its own', () => {
  const all = read('routes/chits.js');
  const at = all.indexOf("router.post('/:chit_id/assign-lines'");
  const route = all.slice(at, at + 1500);
  assert.ok(route.includes('seatAbilities.assignOn('));
  assert.ok(!route.includes("'assign')"), 'the route asks the rail for assign itself again');
});
console.log('\n' + (fails ? fails + ' FAILED' : 'all ok'));
process.exit(fails ? 1 : 0);
