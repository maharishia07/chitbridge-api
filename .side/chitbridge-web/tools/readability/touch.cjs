/* tools/readability/touch.cjs — the TOUCH RULE: a change that touches a file leaves it better, and at 0 readability failures (MNT-30, Athi 25 Oct).
 *
 * OWNS      the verdict per touched file (zero · better · same · worse), the mode (warn or fail) and the one-line summary the §6 checklist prints.
 *           It measures nothing: the score before (base) and after (head) come from ratchet.score, the one number per file.
 * CALLED BY tools/readability/guard.cjs (judgeFile adds the finding, judgeChange the summary, markdown the line), e2e/readability-guard.cjs (the fixtures).
 * FLOW      score before · score after · mode ──▶ verdict ──▶ finding (warn today, fail from FAIL_FROM or with --strict) ──▶ summary line
 * CARD      qa/readability-guard
 *
 * WARN MODE (report only) until the switch: the ratchet already blocks WORSE; today 205 of 637 api routes and a minority of files meet the rule, so a hard
 * rule would turn most open PRs red. The switch to FAIL is the date below (the stated condition: the touched-file pass rate, printed in every §6 body,
 * is read on that day; the date moves only by a decision written in PM/ATHI-DECISIONS.md). `--strict` fails now, for a branch that wants it.
 */
'use strict';

/** from this day a touched file that is not at 0 fails the guard (no flag needed) */
const FAIL_FROM = '2026-12-01';

/** warn or fail: an explicit option wins, else the date decides */
function modeFor(today, option) {
  if (option === 'warn' || option === 'fail') return option;
  return today >= FAIL_FROM ? 'fail' : 'warn';
}

/** zero (the rule is met) · better (lower than the base, not 0) · same · worse (the ratchet rule already fails it); a new file has no base: it must be 0 */
function verdictOf(before, after) {
  if (after.score === 0) return 'zero';
  if (!before) return 'same';
  if (after.score < before.score) return 'better';
  return after.score === before.score ? 'same' : 'worse';
}

/** the finding of one touched file; null when the rule is met or the ratchet rule already speaks (worse) */
function ruleTouch(file, before, after, mode) {
  const verdict = verdictOf(before, after);
  if (verdict === 'zero' || verdict === 'worse') return null;
  const history = before ? 'was ' + before.score + ', now ' + after.score : 'new file, now ' + after.score;
  const shortfall = verdict === 'better' ? 'better but not at 0' : before ? 'not better' : 'a new file must be at 0';
  return { level: mode === 'fail' ? 'fail' : 'warn', rule: 'touch', text: `${file}: touch rule — ${shortfall} (${history}); a touched file leaves at 0 readability failures${mode === 'warn' ? ' (warn mode until ' + FAIL_FROM + ')' : ''}`, verdict };
}

/** the verdict count over the judged files: [{ touchVerdict }] */
function summary(files, mode) {
  const count = (verdict) => files.filter((file) => file.touchVerdict === verdict).length;
  return { mode, files: files.length, zero: count('zero'), better: count('better'), same: count('same'), worse: count('worse') };
}

/** the §6 checklist line (a report: always ticked, the guard line below it carries pass or fail) */
function line(sum) {
  const rest = sum.files - sum.zero;
  return `- [x] Touch rule (${sum.mode === 'fail' ? 'FAIL mode' : 'report, warn mode until ' + FAIL_FROM}): touched files at 0 failures ${sum.zero}/${sum.files} · better but not 0 ${sum.better} · not better ${sum.same + sum.worse}${rest ? ' — each file a PR touches should end at 0' : ''}`;
}

module.exports = { FAIL_FROM, modeFor, verdictOf, ruleTouch, summary, line };
