/* HOMESPEED (1130): the practice read plans its per-client statements ONCE per message (db.queryAsEach { planOnce }) and sends them as parallel slices (books-practice eachInSlices).
 * OFFLINE. HAND-COMPUTED  3 ids, a statement with $1::uuid and $2::date:
 *   unplanned message = 6 texts (binding, statement) x 3, first rows at result 1, then 3, 5
 *   planned message   = DEALLOCATE ALL, PREPARE ... AS <text with $1 $2 left in>, then (binding, EXECUTE ...) x 3, DEALLOCATE: 9 texts, first rows at result 3, then 5, 7
 *   one id = the unplanned shape (nothing to plan once); the values are the SAME literals the inlined statement carries
 *   slices: 130 ids, ways 6, MIN_SLICE 20 -> 6 slices of 22 (the last 20), 30 ids -> ONE message, 39 ids ways 6 -> 1 slice of 39 (under two slices of 20) */
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://x:x@127.0.0.1:1/x';
const assert = require('assert');
const db = require('../db');
let fail = 0, pass = 0;
const check = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ': ' + e.message); } };
const TEXT = 'SELECT $1::uuid AS entity_id, $2::date AS day';
const IDS = ['3165cee7-927c-433f-8bff-eb2374a48430', '0229571f-5f1a-4cd4-9260-324bc30d9474', 'ead18cbe-ff79-490d-88bd-d41c406c01a8'];
const paramsOf = (id) => [id, '2026-11-26'];
check('unplanned message: binding + inlined statement per id, rows at 1, 3, 5', () => {
  const m = db.eachMessage(IDS, TEXT, paramsOf, false);
  assert.strictEqual(m.parts.length, 6); assert.strictEqual(m.first, 1);
  assert(/^SELECT set_config\('app.current_entity', '3165cee7/.test(m.parts[0]));
  assert(m.parts[1].includes("'3165cee7-927c-433f-8bff-eb2374a48430'::uuid") && !/\$\d/.test(m.parts[1]));
});
check('planned message: DEALLOCATE ALL, PREPARE once, binding + EXECUTE per id, DEALLOCATE; rows at 3, 5, 7', () => {
  const m = db.eachMessage(IDS, TEXT, paramsOf, true);
  assert.strictEqual(m.parts.length, 9); assert.strictEqual(m.first, 3);
  assert.strictEqual(m.parts[0], 'DEALLOCATE ALL');
  assert.strictEqual(m.parts[1], 'PREPARE _cb_plan_once AS ' + TEXT);
  assert(/^SELECT set_config\('app.current_entity', '0229571f/.test(m.parts[4]));
  assert.strictEqual(m.parts[3], "EXECUTE _cb_plan_once('3165cee7-927c-433f-8bff-eb2374a48430', '2026-11-26')");
  assert.strictEqual(m.parts[8], 'DEALLOCATE _cb_plan_once');
  assert.strictEqual(m.parts.filter((p) => /^PREPARE /.test(p)).length, 1, 'planned ONCE, not once per client');
});
check('the planned message binds the same entity in the same order as the unplanned one', () => {
  const bound = (m) => m.parts.filter((p) => /^SELECT set_config/.test(p)).map((p) => /'app.current_entity', '([^']*)'/.exec(p)[1]);
  assert.deepStrictEqual(bound(db.eachMessage(IDS, TEXT, paramsOf, true)), bound(db.eachMessage(IDS, TEXT, paramsOf, false)));
  assert.deepStrictEqual(bound(db.eachMessage(IDS, TEXT, paramsOf, true)), IDS);
});
check('a null id binds nothing (blank), planned or not', () => {
  const m = db.eachMessage([null], TEXT, paramsOf, true);
  assert(/'app.current_entity', ''/.test(m.parts[2]));
});
check('a ; in the statement text is refused planned and unplanned alike (the one-statement rule of the inliner)', () => {
  assert.throws(() => db.eachMessage(IDS, 'SELECT 1; SELECT 2', () => [], false), /one statement/);
  assert.throws(() => db.eachMessage(IDS, 'SELECT 1; SELECT 2', () => [], true), /one statement/);
});
/* the slicing: books-practice sends the same statement as parallel messages and joins the rows in ids order */
const P = require('../lib/books-practice');
(async () => {
  const sent = [];
  const realAsEach = db.query.asEach;
  db.query.asEach = async (ids, text, paramsOf, options) => { sent.push({ n: ids.length, planOnce: !!(options && options.planOnce) }); return { rows: ids.map((id) => ({ entity_id: id })), rowCount: ids.length }; };
  try {
    const mk = (n) => Array.from({ length: n }, (_, i) => 'id' + String(i).padStart(3, '0'));
    const ids = mk(130);
    const out = await P.eachInSlices(ids, TEXT, paramsOf, 6);
    check('130 ids / 6 ways = 6 messages of 22 (the last 20), rows in ids order', () => { assert.deepStrictEqual(sent.map((s) => s.n), [22, 22, 22, 22, 22, 20]); assert.deepStrictEqual(out.rows.map((r) => r.entity_id), ids); assert.strictEqual(out.rowCount, 130); assert(sent.every((s) => s.planOnce)); });
    sent.length = 0; await P.eachInSlices(mk(30), TEXT, paramsOf, 6);
    check('30 ids stay ONE message (under two slices of 20)', () => assert.deepStrictEqual(sent.map((s) => s.n), [30]));
    sent.length = 0; await P.eachInSlices(mk(76), TEXT, paramsOf, 2);
    check('76 ids / 2 ways = 2 messages of 38', () => assert.deepStrictEqual(sent.map((s) => s.n), [38, 38]));
  } finally { db.query.asEach = realAsEach; }
  console.log(fail ? fail + ' failed' : pass + ' passed, 0 failed');
  process.exit(fail ? 1 : 0);
})();
