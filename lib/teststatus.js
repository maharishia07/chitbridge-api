// @stage tested
// @stage-note ONE rule for what state a finding is in. The board, the screen and the report all read it here.
'use strict';
/**
 * teststatus.js — WHAT STATE IS THIS FINDING IN, ANSWERED ONCE.
 *
 * Athi, 2026-09-13: *"we have to see how do we reuse the content, UI/UX, so we don't need to repeat the work
 * three times. Possibly unification should help."* — then, when the three surfaces had names: *"do the report
 * uniformity first."*
 *
 * ⚠️⚠️ CAPTURE AND THE MANAGER WERE UNIFIED THIS MORNING AND THE REPORT WAS NOT, so the product ended the day
 * speaking two dialects about the same row. On screen a finding is `Retest` or `Agreed`; in the report the same
 * finding was `open` or `closed`. Nobody reading both can tell whether they are looking at one thing or two,
 * and the report is the artefact that LEAVES the building — it is the worst place to be inconsistent.
 *
 * ⚠️⚠️⚠️ AND THE RULE LIVED IN THE BROWSER. `testWorkRow()` in cap-testing.js decided the status, so the server
 * could not use it, so the report invented its own coarser answer. A rule that only one of three readers can
 * reach is a rule that will be re-implemented by the other two — which is exactly what had happened.
 *
 * ⭐ SO IT LIVES HERE, on the server, and travels with the row as `work_status`. The client prefers what the
 * server sends and keeps its own copy only as a fallback for a row fetched before this shipped; that copy is
 * marked for deletion once every list carries the field. [[feedback-no-duplicate-functions]]
 *
 * ── ⭐ THE STATES, AND WHY THESE ────────────────────────────────────────────────────────────────────────────
 *
 * Adopted from the test-run status model TestRail, Xray and Kiwi TCMS share — one list, one status per row.
 * `retest` is a first-class TestRail status and is exactly the state this board had no word for: somebody says
 * it is fixed and the person who reported it has not looked yet.
 *
 * ⚠️ TWO ARE OURS AND SAY SO. A test tool assumes the requirement is settled and only the product can be wrong,
 * so it has no word for "the instruction was wrong" (`change`) or "we agreed to build it and have not"
 * (`agreed`). Folding the first into `failed` counts a design decision as a defect — the number every quality
 * report is judged on. Folding the second into `closed` reports a product that does what it was asked when
 * nobody has written the code, and the row that most needs chasing is the one that has vanished.
 */

const ORDER = ['retest', 'todo', 'failed', 'change', 'agreed', 'blocked', 'passed', 'closed'];

const LABEL = {
  retest:  'Retest',
  todo:    'To do',
  failed:  'Failed',
  change:  'Change asked',
  agreed:  'Agreed',
  blocked: 'Blocked',
  passed:  'Passed',
  closed:  'Closed',
};

/** what happens next, in words — "Failed" tells you the past, this tells you the job */
const TELL = {
  retest:  'yours to look at again',
  todo:    'run it',
  failed:  'waiting for a fix',
  change:  'waiting for a decision',
  agreed:  'waiting to be built',
  blocked: 'it could not be run',
  passed:  'nothing — it works',
  closed:  'done',
};

/**
 * @param x { kind:'incident'|'requirement'|'case', state, retired, last }
 *          `state`   the incident/requirement state as stored
 *          `retired` true when a CASE has been closed on the board
 *          `last`    the latest result status for a case: pass | fail | blocked | skipped
 * ⚠️ The order of these branches is the rule. A case that RAISED an incident is judged by the incident, not by
 * its own last result — otherwise a case marked failed and then fixed reads red for ever.
 */
function workStatus(x) {
  const o = x || {};
  if (o.kind === 'incident') {
    if (o.state === 'closed') return 'closed';
    if (o.state === 'resolved') return 'retest';
    return 'failed';
  }
  if (o.kind === 'requirement') {
    if (o.state === 'rejected' || o.state === 'implemented') return 'closed';
    if (o.state === 'accepted') return 'agreed';
    return 'change';
  }
  if (o.retired) return 'closed';
  if (o.last === 'pass') return 'passed';
  if (o.last === 'blocked') return 'blocked';
  /* ⚠️ FAILED WITH NOTHING RAISED IS STILL FAILED, and it is the row most likely to be forgotten: a red verdict
     nobody turned into an incident is a fault that exists and is on nobody's list. */
  if (o.last === 'fail') return 'failed';
  return 'todo';
}

/** ⚠️ `closed` is the ONLY ending. Everything else is somebody's turn, including `passed` — a case that passed
 *  is live and will be run again; it is not finished with. */
function isOpen(status) { return status !== 'closed'; }

module.exports = { workStatus, isOpen, ORDER, LABEL, TELL };
