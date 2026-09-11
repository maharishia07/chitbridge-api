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

console.log('— and RLS refuses a row that cannot prove whose it is —');

it('⭐⭐⭐ every definition_version insert passes entity_id', () => {
  /**
   * ⚠️⚠️ THE FAULT THIS GUARD IS FOR, found by Athi within minutes of the first load:
   *   *"couldn't load the test cases, it says row level security violates the definition."*
   *
   * `definition_version` carries its OWN entity_id and its policy checks it. The parent `definition` row wrote
   * fine, because that insert passed one. This one did not, so entity_id went in NULL and WITH CHECK refused the
   * row — and the message reads as a policy problem when it is a missing COLUMN. The policy was doing exactly
   * its job: refusing a row that cannot demonstrate whose it is.
   *
   * ⚠️ AND THE REAL LESSON IS THE ONE BEHIND IT: routes/definitions.js has always passed entity_id here. I wrote
   * a second insert against a table that already had a working one, instead of reading the working one first.
   */
  const inserts = route.split('INSERT INTO definition_version').slice(1);
  assert.ok(inserts.length, 'no definition_version insert found — has the shape changed?');
  inserts.forEach((tail, i) => {
    const cols = tail.slice(0, tail.indexOf(')'));
    assert.ok(/\bentity_id\b/.test(cols),
      'definition_version insert #' + (i + 1) + ' omits entity_id — RLS will refuse the row, and the error will',
      'name the policy rather than the missing column');
  });
});

it('⚠️ the spec clause is a definition too, not a table of its own', () => {
  /* ⭐ the same argument the test case itself won: a clause is a declared rule that gets edited, and a case
     written against it must say WHICH wording — which is what definition_version already does. */
  assert.ok(/kind = 'spec'/.test(route), 'spec clauses are no longer definitions');
  assert.ok(!/CREATE TABLE[^;]*spec_clause/i.test(sql), 'a spec_clause table appeared');
});

it('⭐⭐⭐ a case cites its clause AT A VERSION, and stale is derived from that', () => {
  /**
   * ⭐ THE VERSION IS THE WHOLE MECHANISM of Athi's loop: *"if it is not the intended behaviour, then capture,
   * update the spec and build and test again."* Edit the clause, it gains a version, and every case citing the
   * old one IS the set that has to be looked at again. No hash, no sweep, no flag to remember to set.
   */
  assert.ok(/cites: c\.cites/.test(route), 'a case no longer carries its citation');
  assert.ok(/cites'->>'version'\)::int < s\.current_version/.test(route),
    'stale is no longer derived by comparing the cited version with the clause current version');
  /* ⚠️ IT REPORTS, IT DOES NOT ACT — no result may be deleted on the strength of a version number */
  assert.ok(!/DELETE FROM test_result|UPDATE definition SET status = 'retired'/.test(route),
    'the stale path destroys evidence — it must only report');
});

console.log('— who tested it —');

it('⭐⭐⭐ the IDENTITY comes from the token and cannot be sent in the body', () => {
  /**
   * Athi, 2026-09-11: *"do we know who is testing? The entity name we can pick it up? Anything else as a tester
   * name, do we need it?"* — both, and they answer different questions.
   *
   * `tested_by` is the identity_id off the JWT: unforgeable, and the actual evidence of which login wrote the
   * row. `tester_name` is a courtesy label for who was at the keyboard, which only differs — and only matters —
   * when one login is shared, which is exactly the case he was describing.
   *
   * ⚠️ THE GUARD IS THAT THE FIRST NEVER COMES FROM THE SECOND. A caller who could post `tested_by` could
   * attribute a result to somebody else, and a test board whose authorship can be typed in is not a record.
  */
  assert.ok(/function testerOf\(req\)[\s\S]{0,240}req\.identity/.test(route),
    'testerOf no longer reads the identity off the request');
  assert.ok(!/tested_by[^,)]*req\.body|r\.tested_by|body\.tested_by/.test(route),
    'tested_by can be supplied by the caller — authorship would be forgeable');
  /* the name may come from the row; the id may not */
  assert.ok(/r\.tester_name \|\| who\.name/.test(route),
    'the tester label no longer falls back to the login name when nobody typed one');
});

it('⚠️ the panel and the board both keep the tester name on the DEVICE, not on the entity', () => {
  /* ⚠️ It is a property of who is sitting at this machine, not of the business. Storing it on the entity would
     make one person's name appear against another person's testing on a different device. */
  assert.ok(/cb_tester/.test(panel), 'the test panel no longer remembers who is testing');
  assert.ok(/cb_tester/.test(board), 'the board no longer remembers who is testing');
});

console.log('— the panel has to be movable, or it covers the thing being tested —');

it('⭐⭐ the panel asks makeMovable for minimise AND a body to fit', () => {
  /**
   * Athi: *"if we provide option like wider, taller, and movable, minimisable, then that would be great."*
   * Every one of those already existed in makeMovable; the panel simply was not asking for them.
   *
   * ⚠️ `fit` is the one that is easy to leave out and looks broken without: dragging the corner taller grows the
   * FRAME and not the list, so you get a band of empty card under the cases — a resize that appears to do
   * nothing, which reads as a bug rather than a missing option.
   */
  assert.ok(/minimise: true/.test(panel), 'the panel cannot be minimised');
  assert.ok(/fit: '#cbtestbody'/.test(panel), 'a taller panel would grow the frame and not the list');
  /* ⚠️ minimise collapses every child except the one classed `mhd` — with a single child it would collapse to
     an empty box, which is a close button with extra steps. */
  assert.ok(/id=\\"cbtesthead\\" class=\\"mhd\\"/.test(panel) || /cbtesthead[^\n]*mhd/.test(panel),
    'the panel header is not marked mhd, so minimising would hide it and leave nothing to restore from');
});

it('⚠️ a size preset writes makeMovable\'s OWN saved shape, not a second one', () => {
  /* ⚠️ Two stores for one panel disagree the first time somebody picks a preset and then drags the corner, and
     the panel jumps to the stale one on next open. */
  assert.ok(/localStorage\.setItem\('cb_testpanel'/.test(panel),
    'the size presets no longer persist through the same key makeMovable restores from');
  assert.ok(/TEST_SIZES/.test(panel), 'the size presets are gone');
});

console.log('\n  ' + pass + ' checks\n');
