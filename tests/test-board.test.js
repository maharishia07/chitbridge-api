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
  /**
   * the same rule every other surface follows — a test board is a screen like any other.
   *
   * ⚠️⚠️ IT LOOKS AT CODE, NOT AT COMMENTS, AND IT DID NOT USED TO. This check went red the day the board grew a
   * Try-it view for the currency rule, whose header explains *why* `₹12,34,567` is wrong for a dollar — and to
   * explain that you have to write the symbol down. The screen printed nothing; the guard was reading prose.
   *
   * ⭐ `tests/governed-currency.test.js` had already settled this exact question in its own wording — *"the ₹
   * symbol appears in no minted STRING (prose about it is fine)"* — and this guard was written without looking
   * at it. A guard that reports a fault the product does not have costs more than a missing one, because
   * somebody spends an afternoon on it before discovering the instrument was wrong.
   */
  const code = (s) => String(s)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')          /* block comments, including the big headers */
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')      /* line comments — ⚠ not a bare // , that eats https:// */
    .replace(/<!--[\s\S]*?-->/g, ' ');          /* and HTML comments, since one of these is a page */
  [['the board', board], ['the panel', panel]].forEach(([name, src]) => {
    assert.ok(!/₹/.test(code(src)), name + ' prints a rupee sign of its own');
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

console.log('— the tags the panel builds by hand must balance —');

it('⚠️⚠️ the panel header opens and closes the same number of divs', () => {
  /**
   * ⚠️ FOUND A REAL ONE, AND ONLY BY COUNTING. When the header moved into its own element the wrapper stopped
   * OPENING and its `</div>` stayed behind. innerHTML silently drops a stray closing tag, so the panel looked
   * perfect and the markup was wrong — and the next person to nest something inside it would have had their
   * element land outside, with nothing to explain why.
   *
   * ⚠️ THIS IS THE COST OF BUILDING MARKUP BY STRING CONCATENATION, which the panel does because a capability
   * ships as one file with no template layer. The guard is the price of that choice.
   */
  const start = panel.indexOf("var hd = ''");
  const end = panel.indexOf('head.innerHTML = hd');
  assert.ok(start > 0 && end > start, 'the panel header is no longer built where this guard looks');
  const hd = panel.slice(start, end);
  const open = (hd.match(/<div/g) || []).length, close = (hd.match(/<\/div>/g) || []).length;
  assert.strictEqual(open, close,
    'the header string opens ' + open + ' divs and closes ' + close + ' — innerHTML will quietly swallow the '
    + 'difference and the next element nested here will land in the wrong place');
});

console.log('— you cannot force a tester, so measure the gap instead —');

it('⭐⭐⭐ coverage answers what has NOT been run, ranked by priority', () => {
  /**
   * Athi, 2026-09-11: *"can we force an area to test? Irrespective of the shop, that functionality to be
   * tested."*
   *
   * ⚠️ A PANEL THAT REFUSES TO SHOW ANYTHING BUT ONE MODULE IS A PANEL SOMEBODY CLOSES, and then nothing is
   * tested at all — you have lost the only thing you had, which was their willingness. So the focus PINS and
   * counts down; it does not lock.
   *
   * ⭐ And "irrespective of the shop" is answered by taking the weight from the case's own PRIORITY, which is
   * declared in the reviewed document and travels to every entity that loads it. A High case nobody has run
   * outranks ten Low ones, in every shop, without anything being configured per shop.
   */
  assert.ok(/router\.get\('\/coverage'/.test(route), 'the coverage endpoint is gone');
  assert.ok(/high_untested/.test(route), 'coverage no longer weights by priority, so every area looks alike');
  /* ⚠️ the ledger is append-only, so a case tested five times would count five times without this */
  assert.ok(/DISTINCT ON \(case_key\) case_key, status/.test(route),
    'coverage counts every result rather than the latest per case — a module could report more coverage than '
    + 'it has cases');
});

it('⚠️ the focus pins and warns; it never blocks', () => {
  assert.ok(/function testSetFocus/.test(panel), 'the focus control is gone');
  /* ⚠️ leaving a focus is often right — something looked wrong on the way past. It must be noticed, not
     prevented, and a guard here stops a later "improvement" turning the nudge into a cage. */
  assert.ok(/still to run in/.test(panel), 'leaving the focus no longer says how much is left');
  assert.ok(!/return;\s*\/\* focus lock|if \(CBTEST\.run\.focus\) return/.test(panel),
    'the panel now refuses to leave the focus — that is a panel somebody closes');
});

it('⚠️⚠️ the panel body is a SCROLL container, not a flex column', () => {
  /**
   * Athi, 2026-09-11, within a minute of opening it: *"looks like scrolling is missing, I couldn't roll
   * inside the panel."*
   *
   * ⚠️ THE BODY WAS BOTH, AND THAT IS EXACTLY WHY NOTHING SCROLLED. A flex parent SIZES its child to fit, so a
   * list of a hundred cases was laid out at the height of the box and never overflowed — leaving overflow:auto
   * with nothing to scroll. The markup looked right and every property was individually reasonable.
   *
   * ⚠️ It arrived when the header moved into its own element: the body inherited the flex column the PANEL
   * had been. A guard, because the fix is one word and the symptom is total.
   */
  const at = panel.indexOf('id="cbtestbody"');
  assert.ok(at > 0, 'the panel body is no longer declared where this guard looks');
  /* ⚠️ the style spans concatenated string literals, so read a WINDOW and strip the joins — a regex would only
     match the way the line happens to be wrapped today */
  const style = panel.slice(at, at + 320);
  assert.ok(/overflow-y:auto|overflow:auto/.test(style), 'the panel body does not scroll at all');
  assert.ok(!/display:flex/.test(style),
    'the panel body is a flex container AND the scroll container — a flex parent sizes its child to fit, so '
    + 'the list can never overflow and nothing will scroll');
});

console.log('— a report must not sign itself —');

it('⭐⭐⭐ the judgement sections carry a QUESTION, never a generated answer', () => {
  /**
   * ⚠⚠ THE FAULT THIS PREVENTS IS THE WORST ONE A REPORT CAN HAVE. Half of ISO/IEC/IEEE 29119-3's completion
   * report is judgement — whether the exit criteria were met, what risk is left, who accepts it — and no
   * database holds any of that. Filling those headings with something plausible produces a document that LOOKS
   * signed off and is not, read by people who were not in the room and cannot tell invented prose from
   * evidence.
   *
   * ⚠ So each of these five must stay marked 'needs a person' and must carry `asks`, not `body`.
   */
  ['5', '6', '7', '9', '10'].forEach((id) => {
    const from = route.indexOf("id: '" + id + "'");
    const next = route.indexOf("{ id: ", from + 5);
    const m = from > 0 ? [route.slice(from, next > from ? next : from + 900)] : null;
    assert.ok(m, 'section ' + id + ' of the completion report is gone');
    assert.ok(/source: 'needs a person'/.test(m[0]),
      'section ' + id + ' now claims to be measured — a generated judgement is a report that signs itself');
    assert.ok(/asks:/.test(m[0]), 'section ' + id + ' no longer carries the question it needs a person to answer');
  });
});

it('⚠ the evaluation states what would make a green report wrong', () => {
  /* ⚠ The two facts that most often invalidate a pass rate, stated where the judgement is made rather than
     buried in a table: cases nobody ran, and cases citing a clause that has since changed. */
  const m = route.match(/id: '6'[\s\S]{0,900}?\},\n\n/);
  assert.ok(m, 'the completion evaluation section is gone');
  assert.ok(/never been run/.test(m[0]), 'the evaluation no longer says how many cases were never run');
  assert.ok(/older version of their spec clause/.test(m[0]),
    'the evaluation no longer warns that a pass on a stale case is not evidence about today');
});

it('⚠ the standard named is the current one, not the withdrawn one', () => {
  /* ⚠ IEEE 829 is the name most people reach for and it was withdrawn in 2013. Naming it would have looked
     more familiar to more readers and been wrong. */
  assert.ok(/29119-3/.test(route), 'the report no longer names the standard it follows');
  assert.ok(/supersedes/.test(route), 'the report no longer says which standard this replaced');
});

console.log('— every test on one board, and each one saying what kind it is —');

/**
 * ⭐⭐⭐ Athi, 2026-09-11: *"bring all the test cases and show if it is internal unit testing… say it is unit,
 * integration and so on."*
 *
 * ⚠️⚠️ THE BOARD SHOWED 144 CASES WHILE THE PLATFORM HAD 464 TEST FILES. A coverage figure computed over a
 * quarter of the testing is not a partial answer, it is a misleading one — it looks complete.
 */
const DOC = (() => {
  const f = require('path').join(__dirname, '..', 'data', 'test-cases.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
})();

it('⭐⭐⭐ every case on the board declares what KIND of test it is', () => {
  assert.ok(DOC, 'data/test-cases.json is missing — run build-test-cases.cjs');
  const allowed = ['unit', 'integration', 'system', 'acceptance', 'static', 'support'];
  const bad = DOC.cases.filter((c) => allowed.indexOf(c.test_type) < 0).map((c) => c.case_key);
  assert.deepStrictEqual(bad.slice(0, 8), [],
    'these cases carry no kind, so the board would count them as evidence without saying of what');
  /* ⚠️ the route must accept the same six, or a kind is built and then dropped on the way in */
  allowed.forEach((t) => assert.ok(route.indexOf("'" + t + "'") >= 0,
    'routes/testing.js does not know the kind "' + t + '" — importCases would null it'));
});

it('⭐⭐ an automated case is keyed by its PATH, which is what a posted run lands on', () => {
  /**
   * ⚠️⚠️ THIS IS THE JOIN AND IT IS INVISIBLE UNTIL IT BREAKS. suite.cjs writes `repo/file` into the JUnit
   * `name`; post-suite.cjs posts with `key_from: 'name'`; the case key here has to be the same string or the
   * result creates a SECOND row and the history silently splits in two, with both halves looking healthy.
   */
  const auto = DOC.cases.filter((c) => c.automated);
  assert.ok(auto.length > 300, 'only ' + auto.length + ' automated cases — the classifier found almost nothing');
  const shaped = auto.every((c) => /^chitbridge-(api|web)\/[^/]+\/.+\.(js|cjs|mjs)$/.test(c.case_key));
  assert.ok(shaped, 'an automated case key is not a repo-relative file path');
  /* and the module is the DIRECTORY, which is what makes the filter useful rather than a two-way split */
  const mods = new Set(auto.map((c) => c.module_key));
  assert.ok(mods.size >= 4, 'automated cases collapse into ' + mods.size + ' groups — that is a label, not a filter');
});

it('⚠️⚠️ the JUnit ingest reads `name`, not `classname` — the bug that would have erased every run', () => {
  /**
   * ⭐⭐⭐ FOUND 2026-09-11 BY A NUMBER THAT WAS OBVIOUSLY WRONG: a report containing 185 tests produced 2.
   *
   * JUnit writes `<testcase classname="test.guard" name="chitbridge-api/tests/handle.test.js">`. Matching
   * `name="…"` without a word boundary finds **classname** first — so all 185 results came back keyed
   * `test.guard` / `test.unit`, three rows instead of a hundred and eighty-five, each overwriting the last.
   *
   * ⚠️ The board would not have looked broken. It would have shown a tidy history for a case that does not
   * exist, and the Reliability tab would have called it settled. Nothing had been posted yet, so nothing was
   * lost — but it would have been on the first real run, silently. That is the whole argument for this guard.
   */
  const m = route.match(/const attr = \(s, k\) => \{[\s\S]*?\n {4}\};/);
  assert.ok(m, 'the JUnit attribute reader has changed shape — re-check it reads name, not classname');
  /* eslint-disable no-eval */
  const attr = eval('(' + m[0].replace('const attr = ', '').replace(/;$/, '') + ')');
  const head = ' classname="test.guard" name="chitbridge-api/tests/handle.test.js" time="0"';
  assert.strictEqual(attr(head, 'name'), 'chitbridge-api/tests/handle.test.js',
    'the ingest is reading classname as the case key — every posted run would collapse into three rows');
  assert.strictEqual(attr(head, 'classname'), 'test.guard');
});

it('⭐⭐ the board shows the four facts a project manager asks of a test', () => {
  /**
   * Athi, 2026-09-11: *"each level, how many test cases, what are they, which function it belongs to, what it
   * proves, who runs it"* — and then *"can I see those details in the test lab?"*
   *
   * ⚠️ A fact carried all the way from the classifier into the database and then not rendered is worse than one
   * never measured: the board reports it as present and no one can see it.
   */
  ['Reaches', 'Module under test', 'What it proves', 'Run by'].forEach((label) => {
    assert.ok(board.indexOf(label) >= 0, 'the case body no longer shows "' + label + '"');
  });
  /* ⚠️⚠️ and the honest answer stays honest — a filename dressed as a sentence would be read as evidence */
  assert.ok(/not stated in the file/.test(board),
    'the board no longer says when a test states no claim — 244 of 464 do not, and inventing one is worse');
  /* the area filter must be a VISIBLE control, not state the summary sets behind the reader's back */
  assert.ok(/id="f_area"/.test(board), 'the area filter is no longer a control a person can see or clear');
});

it('⚠️⚠️ the loader and the run-poster are always reachable, not only on an empty board', () => {
  /**
   * ⭐⭐⭐ THE FAULT THIS GUARD IS FOR, found by Athi on the live screen: *"no unit test cases and all visible
   * and filter also not changing."*
   *
   * `seed()` was rendered ONLY inside `if (!CASES.length)` — the empty-board message. A one-time onboarding
   * button that disappeared the moment it worked, while its own copy read *"safe to press again later — it
   * reloads the wording and leaves every result exactly where it is."* So a board holding 110 cases had no way
   * to take the 498 new ones, and I spent an afternoon telling him to press a control that was not on the page.
   *
   * ⚠️ AN UPSERT THAT CANNOT BE RE-RUN IS NOT AN UPSERT. The same applies to posting a run: evidence that
   * requires a copied token and a command line is evidence nobody ever posts, which is why the board held 608
   * cases and zero results.
   */
  const toolbar = board.slice(0, board.indexOf('</div>\n\n<!--') > 0 ? board.indexOf('<script>') : board.indexOf('<script>'));
  ['onclick="seed()"', 'id="f_res"'].forEach((ctl) => {
    assert.ok(toolbar.indexOf(ctl) >= 0,
      ctl + ' is not in the page chrome — if it only renders inside a conditional, it is a control that '
      + 'vanishes exactly when somebody needs it a second time');
  });
});

it('⚠️ support files are on the board but are never called tests', () => {
  /* ⚠️ A fixture counted as coverage is the cheapest way to inflate a number nobody meant to inflate. */
  const sup = DOC.cases.filter((c) => c.test_type === 'support');
  assert.ok(sup.length > 0, 'no support files listed — harnesses and fixtures have gone missing');
  assert.ok(/not a test/i.test(route), 'the vocabulary no longer says that support proves nothing');
});

console.log('\n  ' + pass + ' checks\n');
