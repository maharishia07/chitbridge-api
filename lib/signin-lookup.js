'use strict';
/**
 * CARD 18-identity-sign-in-and-access/signin-lookup
 * lib/signin-lookup.js — the ONE reader of "who could this typed key be?" before any shop is bound (SEC-184 step A, migration b857; step B SEC-185, migration RUN-2026-11-14-b860-identities-rls.sql).
 * owns: ops.signin_candidates(kind, key) · called by: routes/signin.js, routes/entities.js, lib/identity-auth.js, lib/iddoc-verify.js
 * FLOW  typed e-mail / handle / name / mobile / contact / verified document → candidates() → 8 columns (identity_id, identity_type, parent_entity_id, bridge_id, display_name,
 *       user_id, email, status), never a secret → the caller filters with identityAuth.isAccount, then reads the credentials BY ID (db.queryAs: bound to that id).
 * WHY   identities carries row security (b860, FORCE): an unbound session sees no identity row. A SECURITY DEFINER function (owner bypasses RLS) is the one door a sign-in may use
 *       to find a person before it knows the shop.
 * NO FALLBACK (SEC-185). Step A kept a direct read for the time b857 was not run. That read is gone: with row security on it would return nothing, and before it a second way in
 *       to the same eight columns is a second thing to keep right. If the function is missing or not granted the call THROWS (the database's own error, 42883 / 42501), sign-in fails
 *       closed and says so in the log. Run order: b857, the api that carries this file, then b860 (see the header of migrations/RUN-2026-11-14-b860-identities-rls.sql).
 */
const log = require('./logger');

/** the kinds the function answers; one fixed, exact, parameterised read each (see migrations/b857) */
const KINDS = Object.freeze(['email', 'handle', 'name', 'phone', 'contact', 'doc']);
/** the eight columns the function returns: nothing secret */
const COLUMNS = 'identity_id, identity_type, parent_entity_id, bridge_id, display_name, user_id, email, status';
/** a key shorter than this answers nothing (the function does the same) */
const MIN_KEY = 3;

/** the rows of a database answer ([] for an answer with none) */
const rowsOf = (answer) => (answer && answer.rows) || [];
/** does this key answer nothing at once? (under MIN_KEY characters) */
const tooShort = (typed) => typed.trim().length < MIN_KEY;

/**
 * candidates(execute, kind, typed) → rows of the eight columns, at most 10, [] for an unknown key or one under three characters.
 * `execute` is the db query function (module query or a bound handle). Throws for an unknown kind (a programming error, as the function does),
 * and for a database fault: a missing function (42883) or a missing grant (42501) is logged once per call and re-thrown, never answered from the table.
 * ONE database round trip.
 */
async function candidates(execute, kind, key) {
  if (KINDS.indexOf(kind) === -1) throw new Error('signin-lookup: unknown kind ' + kind);
  const typed = key == null ? '' : String(key);
  if (tooShort(typed)) return [];
  try {
    return rowsOf(await execute('SELECT * FROM ops.signin_candidates($1, $2)', [kind, typed]));
  } catch (failure) {
    if (failure && (failure.code === '42883' || failure.code === '42501')) {
      log.error('signin.lookup.function_unavailable', { code: failure.code, why: 'ops.signin_candidates is missing or not granted to this role (run b857): sign-in fails closed, there is no direct read to fall back to' });
    }
    throw failure;
  }
}

module.exports = { candidates, KINDS, COLUMNS, MIN_KEY };
