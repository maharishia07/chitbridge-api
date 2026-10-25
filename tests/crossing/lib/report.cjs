'use strict';
/**
 * tests/crossing/lib/report.cjs — turns a scenario's recorder into a status, prints the pass/fail table, builds the JSON result.
 * OWNS      statusOf (PASS / FAIL / KNOWN / SKIP) · the table text · the JSON document · the exit code
 * CALLED BY tests/crossing/run.cjs · tests/ctp-crossing-pack.test.cjs
 * KNOWN = every hard check passed and a documented open finding (W-number) still fails: it does NOT fail the run; when it starts passing the table says "now passes: remove the KNOWN".
 */

function statusOf(rec, error) {
  if (error) return 'FAIL';
  if (!rec.checks.length) return 'FAIL'; // a scenario that checked nothing proved nothing
  if (rec.checks.some((c) => !c.ok)) return 'FAIL';
  if (rec.knownItems.some((k) => !k.ok)) return 'KNOWN';
  return 'PASS';
}

/** one finished scenario as the JSON row */
function rowOf(plan, rec, error, ms) {
  return {
    id: plan.id, title: plan.title, pair: plan.pair, installations: plan.installations, prereq: plan.state === 'prereq',
    status: statusOf(rec, error), ms,
    error: error ? String(error.message || error) : null,
    checks: rec.checks, known: rec.knownItems, notes: rec.notes
  };
}

const skipRow = (plan, reason) => ({ id: plan.id, title: plan.title, pair: plan.pair, installations: plan.installations, prereq: false, status: 'SKIP', ms: 0, error: null, reason, checks: [], known: [], notes: [] });

function table(rows) {
  const lines = ['id    status  checks  ms      title'];
  for (const r of rows) {
    const passed = r.checks.filter((c) => c.ok).length;
    lines.push(r.id.padEnd(5) + ' ' + r.status.padEnd(7) + ' ' + (passed + '/' + r.checks.length).padEnd(7) + ' ' + String(r.ms).padEnd(7) + ' ' + r.title + (r.prereq ? '  (prerequisite)' : '') + (r.reason ? '  [' + r.reason + ']' : ''));
    for (const c of r.checks.filter((x) => !x.ok)) lines.push('        FAIL  ' + c.what + (c.detail ? '  -> ' + String(c.detail).slice(0, 220) : ''));
    if (r.error) lines.push('        ERROR ' + r.error.slice(0, 300));
    for (const k of r.known) lines.push('        ' + (k.ok ? 'KNOWN now passes: remove the KNOWN for ' : 'KNOWN open ') + k.finding + ' - ' + k.what);
  }
  return lines.join('\n');
}

function summary(rows) {
  const count = (s) => rows.filter((r) => r.status === s).length;
  return { pass: count('PASS'), fail: count('FAIL'), known: count('KNOWN'), skip: count('SKIP'), total: rows.length };
}

const exitCode = (rows) => (rows.some((r) => r.status === 'FAIL') ? 1 : 0);

module.exports = { statusOf, rowOf, skipRow, table, summary, exitCode };
