'use strict';
/**
 * tests/lib/call-log.cjs — THE ONE LOG of the requests a harness run sent (QA 12 Nov: the SIT lifecycle and gorilla junits name the endpoints they called,
 * so the coverage map's junit reader (toolset/coverage/test-ledger.cjs junitRows) can credit them).
 * OWNS: record(method, path, status) · the current-case marker · distinct(list). It records only what was SENT: METHOD, the concrete path (query dropped), the status.
 * It does NOT map a path to a register key: the writers (toolset/lifecycle-run.cjs, toolset/gorilla-junit.cjs) do that with the hunt kit's one matcher (toolset/sit-hunt/lib/junit.cjs keyOf).
 * CALLED BY: tests/lib/truth-harness.cjs j() and kase(), scripts/seed-local.cjs j(), tests/lib/gorilla.cjs hammer(), toolset/lifecycle-run.cjs.
 * CARD qa/offline-guards
 */
const calls = [];
const state = { current: null };
/** one request the run sent; `c` = the case id running at that moment (null between cases) */
function record(method, path, status) { calls.push({ m: String(method || 'GET').toUpperCase(), p: String(path).split('?')[0], s: status, c: state.current }); }
/** the same request once (METHOD + path), the last status seen; a throw between calls cannot hide the ones already made */
function distinct(list) {
  const seen = new Map();
  for (const x of list) seen.set(x.m + ' ' + x.p, { m: x.m, p: x.p, s: x.s });
  return [...seen.values()];
}
module.exports = { calls, state, record, distinct, since: (n) => distinct(calls.slice(n)) };
