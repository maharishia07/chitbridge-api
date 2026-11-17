/* app/test-verdict.js — what would make this red green. ONE judgement, two surfaces.
 * OWNS the verdict judgement, the shared counts, the cite line and the not-evidence mark · CALLED BY app/cap-testing.js (the Test panel) and testing.html
 * FLOW  case + last result → testCounts / testCiteLine / testIsEvidence → the panel row
 * CARD 29-qa-test-tooling-ux-locale-and-design-system/test-board
 *
 * ── ⭐⭐ WHY THIS IS ITS OWN FILE ────────────────────────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-12, on the lab: *"this is nothing but the cases tab in the report — those information should be
 * here as well."*
 *
 * He is right, and carrying it across meant writing the verdict a second time: once in testing.html for the
 * REPORT, once in cap-testing.js for the LAB. ⚠️ That is the shape that produced every bug of the last two
 * days — three copies of a heading reader, three of a tab dispatch, two of a canonicaliser. Each time the copy
 * that got fixed was not the copy being read.
 *
 * ⭐ So the judgement lives here and both surfaces call it. A classic script with no imports and no framework,
 * because app.html loads capabilities into one shared scope and testing.html is a single standalone page —
 * the only thing both can agree on is a plain <script>.
 *
 * ── THE FOUR ANSWERS ───────────────────────────────────────────────────────────────────────────────────────
 *
 *   ⟳ re-run       the file changed AFTER this result. The red describes code that no longer exists.
 *   ⚙ environment  it needs a database, the API or a browser that the run did not have.
 *   ⏸ decision     the file declares a held decision — red because nobody has chosen yet.
 *   ✗ defect       red, unchanged since the result, needing nothing it lacked. ⭐ THE REAL ONE.
 *
 * ⚠️ DEFECT IS NEVER THE DEFAULT. It is the strongest thing this can say, and the first version let it be what
 * fell out when the others were ruled out — so seven reds were called defects using fields that were simply
 * MISSING, two of them already fixed. A case with no `changed_at` cannot rule out "re-run", so it returns
 * `unknown` and says why. Absence of evidence is not evidence.
 */
'use strict';

var TEST_TODO = {
  'never run': { icon: '○', tone: 'dim', say: 'nobody has run it' },
  'ok': { icon: '✓', tone: 'ok', say: 'nothing to do' },
  're-run': { icon: '⟳', tone: 'warn', say: 're-run — the file changed after this result' },
  'environment': { icon: '⚙', tone: 'warn', say: 'needs something the run did not have' },
  'decision': { icon: '⏸', tone: 'warn', say: 'a decision nobody has made yet' },
  'defect': { icon: '✗', tone: 'bad', say: 'a defect — unchanged since this result, and it needs nothing it did not have' },
  'unknown': { icon: '?', tone: 'dim', say: 'cannot tell yet — this board has not been rebuilt since the file facts were added' }
};

/**
 * @param c    the case, as the board holds it (changed_at, needs, held)
 * @param last the latest result for it, or null
 * @returns {{kind:string, why:string}}
 */
function testVerdict(c, last) {
  if (!c) return { kind: 'unknown', why: TEST_TODO.unknown.say };
  if (!last) return { kind: 'never run', why: TEST_TODO['never run'].say };
  if (last.status === 'pass') return { kind: 'ok', why: TEST_TODO.ok.say };

  /**
   * ⚠️ THIS COMPARISON COMES FIRST, and the order is the whole point: a file changed AFTER its last result
   * means the result describes code that is gone. Ruling that out before anything else is what stops a stale
   * red being called a defect.
   */
  if (c.changed_at && last.at && new Date(c.changed_at) > new Date(last.at)) {
    return { kind: 're-run', why: TEST_TODO['re-run'].say };
  }
  if (c.needs && c.needs.length) return { kind: 'environment', why: 'needs ' + c.needs.join(' and ') };
  if (c.held) return { kind: 'decision', why: 'a decision: ' + c.held };
  /* ⚠️ no facts ⇒ no claim. See the header. */
  if (!c.changed_at) return { kind: 'unknown', why: TEST_TODO.unknown.say };
  return { kind: 'defect', why: TEST_TODO.defect.say };
}

/** the short label for a row — '' when there is nothing to do, so a green row stays quiet */
function testVerdictLabel(c, last) {
  var v = testVerdict(c, last);
  if (v.kind === 'ok') return '';
  return (TEST_TODO[v.kind] || TEST_TODO.defect).icon + ' ' + v.kind;
}

/**
 * ── ⭐⭐⭐ ONE COUNT, TWO SURFACES ────────────────────────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-12: *"in the report cases passed shows the value, here it is all none — it has to be the
 * same."* And then: *"always there are differences? I have already mentioned it has to be the same."*
 *
 * ⚠️⚠️ HE IS RIGHT, AND THE DISAGREEMENT WAS NEVER A DISPLAY BUG. The Report and the lab each walked the same
 * two lists and counted them with their own code. Two implementations of one arithmetic will agree only for
 * as long as nobody touches either — and the moment the lab's results failed to load, its counter reported
 * "621 not run" with total confidence rather than reporting that it had no results at all.
 *
 * ⭐ So the counting lives here, beside the verdict, and both surfaces call it. A difference between the two
 * is now impossible to introduce by editing one of them, which is the only kind of guarantee worth having.
 *
 * ⚠️ AND IT SAYS WHEN IT HAS NOTHING. `noResults` is true when not one case has a result, which is a
 * different fact from "nothing has passed" — and telling them apart is exactly what would have surfaced this
 * bug on the day it was written instead of weeks later.
 */
function testCounts(cases, last) {
  const n = { total: 0, pass: 0, fail: 0, blocked: 0, skipped: 0, todo: 0 };
  (cases || []).forEach(function (item) {
    n.total++;
    const l = last && last[item.case_key];
    if (!l) {
      n.todo++;
      return;
    }
    if (n[l.status] === undefined) n[l.status] = 0;
    n[l.status]++;
  });
  n.noResults = n.total > 0 && n.todo === n.total;
  return n;
}

/* ── QUAL-1 (K-BOARD, 19 Oct 2026): what a case is held to, and whether its file can fail a run ───────────────
 * QA-24 + CAT-50: the traceability line. Order: the clause the case cites (`cites`), then the requirement a test
 * header names with `@covers` (`covers`), else the words "Not cited". A requirement is NEVER inferred from a file
 * name: the only thing a path proves is that a file exists.
 * QA-72: a file that cannot fail a run (a seed, a demo, a narrated proof, the engine manifest, the walkthrough
 * fixture) is shown as "not evidence", so a green tick from it is never read as proof.
 * Both are plain functions, called by the Test panel (cap-testing.js) and tested in tests/board-trace.test.cjs. */
const TEST_NOT_EVIDENCE =
  /(^|[/\\])(seed[^/\\]*|[^/\\]*[-_.]seed[^/\\]*|[^/\\]*demo[^/\\]*|[^/\\]*narrat[^/\\]*|[^/\\]*proof-?walk[^/\\]*|engine-manifest\.js|walkthrough\.js)$/i;
function testIsEvidence(caseKey) {
  return !TEST_NOT_EVIDENCE.test(String(caseKey || ''));
}
function testCiteLine(boardCase) {
  const clause = boardCase && boardCase.cites;
  if (clause && (clause.clause || clause.standard)) {
    const bits = [clause.standard, clause.clause ? '§' + clause.clause : null, clause.chapter, clause.level ? 'level ' + clause.level : null];
    return { cited: true, source: 'clause', text: bits.filter(Boolean).join(' · ') };
  }
  const covers = boardCase && (boardCase.covers || (boardCase.rules && boardCase.rules.covers));
  if (covers && String(covers).trim()) return { cited: true, source: 'covers', text: String(covers).trim() };
  return { cited: false, source: 'none', text: 'Not cited' };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { testIsEvidence, testCiteLine, testCounts };
