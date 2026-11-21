/**
 * ctp-status-redrive.test.cjs — F11a (1128): a status event that spent its 40 tries is redriven by the owner, and the chit says "not delivered" with the redrive offered.
 * Figures: a failed status row at attempts 40 -> redriven 1, attempts set to 35, status pending; a failed row at attempts 3 (refused for good) -> not touched; the mark says failed + redrivable.
 * Run: node tests/ctp-status-redrive.test.cjs
 */
'use strict';
const path = require('path');
process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = ''; process.env.JWT_SECRET = 'x';
const dbPath = require.resolve(path.join('..', 'db'));
const rows = [{ id: 1, kind: 'status', status: 'failed', attempts: 40, accepted_at: null }, { id: 2, kind: 'status', status: 'failed', attempts: 3, accepted_at: null }, { id: 3, kind: 'message', status: 'failed', attempts: 40, accepted_at: null }];
const fake = { query: async () => ({ rows: [] }), withEntity: async (e, fn) => fn({ query: async (sql, p) => {
  let n = 0;
  if (/UPDATE ctp_event_out/.test(sql)) for (const r of rows) if (r.kind === 'status' && r.status === 'failed' && r.attempts >= p[3] && !r.accepted_at) { r.status = 'pending'; r.attempts = p[2]; n++; }
  return { rowCount: n, rows: [] };
} }) };
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fake };
let pass = 0, fail = 0;
const eq = (n, g, w) => { const ok = JSON.stringify(g) === JSON.stringify(w); ok ? pass++ : fail++; console.log((ok ? '   ok   ' : '   FAIL ') + n + (ok ? '' : ' got ' + JSON.stringify(g) + ' want ' + JSON.stringify(w))); };
(async () => {
  const R = require('../lib/ctpreturn');
  eq('the failed answer carries the redrive offer', R.markOf({ count: 1, since: 'x', failed: true, redrivable: true, why: 'down', words: 'Could not be confirmed to the other side' }).ctp_unconfirmed.redrivable, true);
  eq('redrive: one row put back', await R.redriveFailed('e1', 'c1'), { redriven: 1 });
  eq('the redriven row is pending with 5 tries left (35 of 40)', [rows[0].status, rows[0].attempts], ['pending', 35]);
  eq('a row refused for good (3 tries) and a message row are untouched', [rows[1].status, rows[2].status], ['failed', 'failed']);
  console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
