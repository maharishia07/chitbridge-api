'use strict';
/**
 * lib/testing-results.js — the test board's result rules: the two axes (run kinds, layers) and statuses, the case fields the door recognises, a result's refusals, a result as the INSERT takes it.
 * OWNS      RUN_KINDS · LAYERS · STATUSES · CASE_FIELDS · unknownFields · badResult · resultRowOf (no route, no state)
 * CALLED BY routes/testing.js (the results and the CMDB-load doors)
 * FLOW      badResult(entry) -> the words or null · resultRowOf(item, by, tester) -> the row the INSERT takes · unknownFields(rows) -> the names the door dropped
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/test-board
 */


/* The two axes, in one place. The server is the authority so a screen cannot offer a value the CHECK refuses. */
const RUN_KINDS = ['manual', 'unit', 't0', 't1', 't2', 't3', 'regression'];
const LAYERS = ['engine', 'transport', 'web', 'capability', 'db', 'connector'];
const STATUSES = ['pass', 'fail', 'blocked', 'skipped'];

/**
 * ── ⭐⭐⭐ THE DOOR NOW SAYS WHAT IT DROPPED ──────────────────────────────────────────────────────────────────
 *
 * ⚠️⚠️ FIVE TIMES. `seq`, then `changed_at`/`needs`/`held`, then `menu`/`generated`, then `screen_code`/
 * `control_code`, and now `observed`/`evidence_id`. Every time: the field was emitted at one end, named in a
 * commit message, and silently discarded here. Twice it produced confident WRONG output — a board sorted
 * alphabetically, seven reds judged as defects using fields that never arrived.
 *
 * ⭐ ADDING A SIXTH NAME TO THE LIST IS NOT THE FIX. The fault is a copier that discards without a word, and
 * it will do it to the next field too. So the door now counts what it did not recognise and hands the list
 * back with the response. A caller can then check, and the answer to "did my field arrive?" stops being
 * "read the source and hope".
 *
 * ⚠️ IT REPORTS, IT DOES NOT ACCEPT. Copying unknown keys through would put whatever a client sends into the
 * rules blob, which is how a whitelist becomes decoration.
 */
const CASE_FIELDS = new Set([
  'case_key',
  'module_key',
  'module_name',
  'intro',
  'title',
  'claim',
  'priority',
  'pre',
  'data',
  'steps',
  'note',
  'layer',
  'test_type',
  'group',
  'automated',
  'areas',
  'subjects',
  'run_by',
  'seq',
  'step',
  'cites',
  'changed_at',
  'needs',
  'held',
  'menu',
  'generated',
  'observed',
  'evidence_id',
  'screen_code',
  'control_code',
  'written_by',
  'written_by_id',
  'written_at',
  'closed_note',
  'closed_by',
  'closed_at',
  'screen_purpose',
  'generic'
]);

function unknownFields(rows) {
  const seen = new Set();
  (rows || []).forEach((item) =>
    Object.keys(item || {}).forEach((entry) => {
      if (!CASE_FIELDS.has(entry)) seen.add(entry);
    })
  );
  return [...seen].slice(0, 20);
}

function badResult(entry) {
  if (!entry || !String(entry.case_key || '').trim()) return 'a result must name the case it is about';
  if (STATUSES.indexOf(entry.status) < 0) return `"${entry.status}" is not a status — ${STATUSES.join(', ')}`;
  if (RUN_KINDS.indexOf(entry.run_kind) < 0) return `"${entry.run_kind}" is not a kind of run — ${RUN_KINDS.join(', ')}`;
  if (entry.layer && LAYERS.indexOf(entry.layer) < 0) return `"${entry.layer}" is not a layer — ${LAYERS.join(', ')}`;
  /**
   * ⭐⭐ BLOCKED MUST SAY WHY — ISO/IEC/IEEE 29119-3 asks for the reason a case could not be run, and it is
   * right to. A blocked case with no reason is indistinguishable from a case nobody got to, and the two lead
   * to opposite actions: one needs the blocker fixed, the other needs a tester.
   *
   * ⚠ ONLY BLOCKED. A pass needs no words, and a failure already has the observation the panel demanded
   * before it would file one. Nothing automated posts blocked today — checked, not assumed — so this cannot
   * quietly redden a suite.
   */
  if (entry.status === 'blocked' && !String(entry.note || '').trim()) {
    return 'a blocked case must say what blocked it — otherwise it reads the same as one nobody reached';
  }
  return null;
}

/** one result as the INSERT takes it: the case it names (its definition and current version, null when the board does not hold it), the module it belongs to, and the tester stamped from the token */
function resultRowOf(item, by, tester) {
  const key = String(item.case_key).trim();
  const existing = by[key] || null;
  return {
    key: key,
    definition_id: existing ? existing.definition_id : null,
    case_version: existing ? existing.current_version : null,
    module_key: item.module_key || (existing && existing.sub_kind) || key.split('-')[0] || null,
    status: item.status,
    run_kind: item.run_kind,
    layer: item.layer || null,
    tester_name: tester.name /* SEC-FIX3 S10: stamped from the token, never the body */,
    note: item.note || null,
    evidence: item.evidence || null
  };
}

module.exports = { RUN_KINDS, LAYERS, STATUSES, unknownFields, badResult, resultRowOf };
