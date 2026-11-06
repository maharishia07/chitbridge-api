/**
 * pin-count-stub.cjs — the test stand-in for lib/identity-auth.js countWrongPin (PPL-30): the ONE atomic statement that counts a wrong PIN and locks.
 * OWNS      the model of that statement for in-memory stand-ins: find the row by $1, do nothing if it is already locked, else add 1 and lock at $2.
 * CALLED BY tests/change-pin-lock.test.cjs · employee-first-signin · signin-routes · identity-auth tests
 * CARD      17-people-employees-hr-and-payroll/pin-otp-first-sign-in
 */
'use strict';
const COUNT_SQL = /^UPDATE identities SET pin_attempts = pin_attempts \+ 1, pin_locked_at = CASE WHEN pin_attempts \+ 1 >= \$2 THEN NOW\(\) ELSE pin_locked_at END WHERE identity_id = \$1 AND pin_locked_at IS NULL RETURNING pin_attempts, pin_locked_at$/i;

/** answer the statement against a row finder (stamp: what the stand-in writes for NOW(), a Date unless the harness uses its own marker), or return null when `sql` is not that statement */
function answer(sql, params, findRow, stamp = new Date()) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  if (!COUNT_SQL.test(s)) return null;
  const row = findRow(params[0]);
  if (!row || row.pin_locked_at) return { rows: [], rowCount: 0 };
  row.pin_attempts = (row.pin_attempts || 0) + 1;
  if (row.pin_attempts >= params[1]) row.pin_locked_at = stamp;
  return { rows: [{ pin_attempts: row.pin_attempts, pin_locked_at: row.pin_locked_at || null }], rowCount: 1 };
}
module.exports = { answer };
