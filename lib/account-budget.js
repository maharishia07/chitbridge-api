/**
 * lib/account-budget.js — ONE failure budget per ACCOUNT across every credential (NIST SP 800-63B §5.2.2: limit consecutive failed attempts per account, at most 100).
 * OWNS  the count of consecutive wrong secrets (a wrong code or a wrong PIN) typed for one identity, however many codes were issued; the refusal once it is spent.
 * WHY   the per-code budget (5 per live code, lib/otp.js) and the per-PIN timed lock (lib/identity-auth.js) each stop one secret; a guesser who alternates codes, asks again after expiry, or
 *       moves between the code and the PIN door had no ceiling over the whole account. Rule, product-wide: ONE ATTEMPT COUNTER, NEVER RESET BY AN ASK — only a right secret or the owner's reset clears it.
 * COLUMNS identities.auth_fail_count, identities.auth_fail_at (migrations/b900_identity_failure_budget.sql, NOT RUN · Athi runs it). Before the file runs there is no account count (the per-code
 *       and per-PIN limits still hold, as before); once it runs the budget is enforced with no further deploy. A read that fails while the column exists REFUSES (fail closed).
 * DECAY a count older than WINDOW_MS counts as 0, so a stranger's typing cannot shut an owner out for longer than one window.
 * CALLED BY lib/identity-auth.js verifyCredential, setPin; lib/employee-code.js issue (the owner's act clears it)
 * OWNER  cb-security
 * FLOW   spent(wrong secret typed?) ──▶ miss (count one, atomic) ──▶ clear (right secret / owner reset); every read bound to the identity (boundRead, one trip)
 * RISK   a read that fails on a database that has the column answers spent (fail closed); a stranger can lock an owner out for one WINDOW_MS at most
 * CARD   18-identity-sign-in-and-access/account-failure-budget
 */
'use strict';
const { boundRead } = require('./bound-read');
const log = require('./logger');

const MAX_ACCOUNT_FAILS = 30;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const ready = () => require('./schema').hasColumn('identities', 'auth_fail_count');

/** spent(query, id) -> true when the account has used its budget inside the window; true too when the read fails on a database that has the column (fail closed) */
async function spent(query, identityId) {
  if (!(await ready())) return false;
  try {
    const result = await boundRead(query, identityId,
      `SELECT auth_fail_count, auth_fail_at FROM identities WHERE identity_id = $1`, [identityId]);
    const row = result && result.rows && result.rows[0];
    if (!row) return false;
    if (Number(row.auth_fail_count || 0) < MAX_ACCOUNT_FAILS) return false;
    const at = row.auth_fail_at ? new Date(row.auth_fail_at).getTime() : NaN;
    return Number.isNaN(at) ? !!row.auth_fail_at : Date.now() < at + WINDOW_MS; /* a time that cannot be read, on a spent count, stays spent */
  } catch (failure) {
    log.fellBack('account-budget spent: the read failed — answered spent (fail closed)', failure);
    return true;
  }
}

/** miss(query, id) — ONE atomic statement counts a wrong secret (a stale count restarts at 1); an ask never touches it */
async function miss(query, identityId) {
  if (!(await ready())) return;
  await boundRead(query, identityId,
    `UPDATE identities SET auth_fail_count = CASE WHEN auth_fail_at IS NULL OR auth_fail_at < NOW() - INTERVAL '24 hours' THEN 1 ELSE COALESCE(auth_fail_count, 0) + 1 END,
            auth_fail_at = NOW() WHERE identity_id = $1`, [identityId]);
}

/** clear(query, id) — a right secret, or the owner's reset of the person's access */
async function clear(query, identityId) {
  if (!(await ready())) return;
  await boundRead(query, identityId, `UPDATE identities SET auth_fail_count = 0, auth_fail_at = NULL WHERE identity_id = $1 AND auth_fail_count <> 0`, [identityId]);
}

module.exports = { MAX_ACCOUNT_FAILS, WINDOW_MS, spent, miss, clear };
