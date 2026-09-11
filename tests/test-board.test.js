/**
 * ── tests/test-board.test.js · THE BOARD'S OWN GUARDS ─────────────────────────────────────────────────────────
 *
 * ⚠️⚠️ THE BOARD IS WHERE EVERY OTHER RESULT IS RECORDED, so a fault here is not one broken screen — it is a
 * testing session that produces nothing and is discovered only when somebody asks what was covered.
 *
 * ⭐ THE FAULT THIS FILE EXISTS FOR: the statuses, run kinds and layers are written down THREE times — as CHECK
 * constraints in b219, as arrays in routes/testing.js, and as <option>s on two screens. Nothing joins them. Add
 * 't4' to the dropdown and the tap fails with a 500 that says "violates check constraint", at the counter, to
 * somebody who is testing something else entirely and will reasonably report it as that.
 *
 * Run: node tests/test-board.test.js   · no network, no DB.
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');

const API = path.join(__dirname, '..');
const WEB = path.join(API, '..', 'chitbridge-web', 'public');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };

const sql = fs.readFileSync(path.join(API, 'migrations', 'b219_test_ledger.sql'), 'utf8');
const route = fs.readFileSync(path.join(API, 'routes', 'testing.js'), 'utf8');
const board = fs.readFileSync(path.join(WEB, 'testing.html'), 'utf8');
const panel = fs.readFileSync(path.join(WEB, 'app', 'cap-testing.js'), 'utf8');

/** the values a CHECK constraint actually permits: CHECK (col IN ('a','b')) */
function checkValues(name) {
  const m = sql.match(new RegExp(name + "[\\s\\S]{0,200}?IN\\s*\\(([^)]*)\\)"));
  if (!m) throw new Error('no CHECK constraint named ' + name + ' in b219');
  return (m[1].match(/'([^']+)'/g) || []).map((s) => s.replace(/'/g, '')).sort();
}
/** a const array in the route: const NAME = ['a','b']; */
function jsArray(src, name) {
  const m = src.match(new RegExp('const\\s+' + name + '\\s*=\\s*\\[([^\\]]*)\\]'));
  if (!m) throw new Error('no ' + name + ' array');
  return (m[1].match(/'([^']+)'/g) || []).map((s) => s.replace(/'/g, '')).sort();
}

console.log('— the three places the vocabulary is written down must agree —');

it('⭐⭐⭐ the statuses the route accepts are exactly the ones the column permits', () => {
  assert.deepStrictEqual(jsArray(route, 'STATUSES'), checkValues('test_result_status_chk'),
    'the route would accept a status the database refuses — a 500 at the moment somebody taps it');
});

it('⭐⭐⭐ the run kinds agree', () => {
  assert.deepStrictEqual(jsArray(route, 'RUN_KINDS'), checkValues('test_result_kind_chk'),
    'a run kind on the screen that the column refuses');
});

it('⭐⭐⭐ the layers agree', () => {
  assert.deepStrictEqual(jsArray(route, 'LAYERS'), checkValues('test_result_layer_chk'),
    'a layer on the screen that the column refuses');
});

it('⚠️ every run kind the two screens offer is one the route accepts', () => {
  /**
   * ⚠️ THE SCREENS ARE THE THIRD COPY and the easiest one to edit without thinking — a dropdown looks like
   * presentation. It is not: an <option> the server rejects is a button that fails.
   */
  const kinds = jsArray(route, 'RUN_KINDS');
  const fromBoard = (board.match(/<option value="(\w+)">(?:Manual|T\d|Unit|Regression)/g) || [])
    .map((s) => (s.match(/value="(\w+)"/) || [])[1]);
  fromBoard.forEach((k) => assert.ok(kinds.indexOf(k) >= 0, 'the board offers run kind "' + k + '", which the route refuses'));

  /* the panel builds its options from a literal list rather than the server — assert that list too */
  const m = panel.match(/\[([^\]]*)\]\.map\(function \(k\)/);
  assert.ok(m, 'the panel no longer builds its run-kind options from a list this guard can read');
  (m[1].match(/'([^']+)'/g) || []).map((s) => s.replace(/'/g, ''))
    .forEach((k) => assert.ok(kinds.indexOf(k) >= 0, 'the test panel offers run kind "' + k + '", which the route refuses'));
});

console.log('— append-only, or the board is an opinion —');

it('⭐⭐⭐ b219 REVOKEs update and delete, and the route never writes either', () => {
  assert.ok(/REVOKE\s+UPDATE,\s*DELETE\s+ON\s+test_result\s+FROM\s+cb_app/i.test(sql),
    'the append-only grant is gone — a result could be edited, and a status you can edit is not a result');
  assert.ok(!/UPDATE\s+test_result|DELETE\s+FROM\s+test_result/i.test(route),
    'routes/testing.js writes an UPDATE or DELETE against test_result');
});

it('⚠️ a re-run of the same suite cannot double-write', () => {
  /* ⚠️ COALESCE on the nullable column: NULL is never equal to NULL, so without it the unique index does not
     constrain the rows that need it most — results with no layer, which is most automated ones. */
  assert.ok(/uq_test_result_once[\s\S]{0,200}COALESCE\(layer/.test(sql),
    'the once-per-run index no longer covers a NULL layer, so a replayed suite writes every row twice');
  assert.ok(/ON CONFLICT DO NOTHING/.test(route), 'the insert no longer treats a replay as a quiet no-op');
});

console.log('— the case is a definition, not a new table —');

it('⭐⭐ nothing invented a test_case table', () => {
  /**
   * ⭐ Athi's rule, and the reason this whole thing is small: a test case is a `definition` of kind 'testcase',
   * so authoring, versioning, naming and RLS all already work. A guard because the temptation to "just add a
   * table" returns every time somebody wants one more column.
   */
  assert.ok(!/CREATE TABLE[^;]*test_case\b/i.test(sql), 'b219 creates a test_case table — the case is a definition');
  assert.ok(/kind = 'testcase'/.test(route), "the route no longer reads cases from definitions of kind 'testcase'");
});

it('⭐⭐ a result records WHICH VERSION of the case was tested', () => {
  /* ⚠️ Without this a case edited after a run claims that today's wording passed on a day it did not exist. */
  assert.ok(/case_version/.test(sql) && /case_version/.test(route),
    'the result no longer carries the case version — an edit would rewrite history');
});

console.log('— one write path —');

it('⭐⭐⭐ the manual tap and the JUnit import go through the SAME recorder', () => {
  /**
   * ⚠️ Two write paths would become two shapes of row, and the board would quietly be showing two kinds of
   * record that only look alike. Athi's standing rule: a second call site means extract the helper NOW.
   */
  assert.ok(/async function recordResults\(/.test(route), 'the shared recorder is gone');
  const calls = (route.match(/recordResults\(/g) || []).length;
  assert.ok(calls >= 3, 'recordResults has fewer than two callers — one of them grew its own INSERT');
  assert.ok(!/INSERT INTO test_result[\s\S]*INSERT INTO test_result/.test(route),
    'there are two INSERTs into test_result — the automated path has grown its own');
});

it('⚠️ a JUnit test with no case key is reported, never dropped', () => {
  /* ⚠️ A board that silently ignores half a report claims coverage it does not have — which is worse than no
     board at all, because it is believed. */
  assert.ok(/unmatched/.test(route), 'the JUnit ingest no longer reports the tests it could not place');
});

console.log('— and the board must still be readable —');

it('⚠️ the board and the panel both read the LATEST word, not the first row', () => {
  assert.ok(/DISTINCT ON \(case_key/.test(route), 'the board query no longer picks the latest result per case');
  /* both screens rank the same way — the worst result wins, so a green unit test cannot hide a red counter */
  ['fail: 4', 'blocked: 3'].forEach((r) => {
    assert.ok(board.indexOf(r) >= 0, 'the board no longer ranks results (' + r + ')');
    assert.ok(panel.indexOf(r) >= 0, 'the test panel no longer ranks results (' + r + ')');
  });
});

it('⚠️ neither screen prints a currency symbol or a hard-coded date format', () => {
  /* the same rule every other surface follows — a test board is a screen like any other */
  [['the board', board], ['the panel', panel]].forEach(([name, src]) => {
    assert.ok(!/₹/.test(src), name + ' prints a rupee sign of its own');
  });
});

console.log('\n  ' + pass + ' checks\n');
