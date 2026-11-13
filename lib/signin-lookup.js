'use strict';
/**
 * CARD 18-identity-sign-in-and-access/signin-lookup
 * lib/signin-lookup.js — the ONE reader of "who could this typed key be?" before any shop is bound (SEC-184 step A, migration b857).
 * owns: ops.signin_candidates(kind, key) and its fallback · called by: routes/signin.js, routes/entities.js, lib/identity-auth.js, lib/iddoc-verify.js
 * FLOW  typed e-mail / handle / name / mobile / contact / verified document → candidates() → 8 columns (identity_id, identity_type, parent_entity_id, bridge_id, display_name,
 *       user_id, email, status), never a secret → the caller filters with identityAuth.isAccount, then reads the credentials BY ID.
 * WHY   identities will carry row security (step B); a SECURITY DEFINER function is the one door a sign-in may use to find a person before it knows the shop.
 * FALLBACK  the function is missing (b857 not run yet), or this role may not run it → today's direct read of the same eight columns, with ONE logged warning
 *       (the 42703 style of routes/till.js recheck: never silent). The missing state is re-tried after RETRY_MS so running b857 needs no restart.
 */
const log = require('./logger');

/** the kinds the function answers; one fixed, exact, parameterised read each (see migrations/b857) */
const KINDS = Object.freeze(['email', 'handle', 'name', 'phone', 'contact', 'doc']);
/** the eight columns the function returns and the fallback reads: nothing secret */
const COLUMNS = 'identity_id, identity_type, parent_entity_id, bridge_id, display_name, user_id, email, status';
/** the ONE PostgreSQL code that means "the function is not there": undefined function. A permission error (42501) is a real grant fault: logged loudly on every call, never read as missing */
const MISSING_CODES = Object.freeze(['42883']);
/** after a miss, go straight to the direct read for this long before asking the function again */
const RETRY_MS = 60 * 1000;
/** a key shorter than this answers nothing (the function does the same), so the two paths agree */
const MIN_KEY = 3;

/** the typed key as it is sent: as is, except a document key (SCHEME:hash[,hash]) which is split into the scheme and the list of hashes */
const asIs = (typed) => [typed];
const asDocument = (typed) => [typed.slice(0, typed.indexOf(':')), typed.slice(typed.indexOf(':') + 1).split(',').slice(0, 10)];
/** the same eight columns, read straight from the tables: the answer the function gives, used only while it is missing */
const DIRECT = Object.freeze({
  email: { sql: `SELECT ${COLUMNS} FROM identities WHERE email = LOWER($1) ORDER BY identity_id LIMIT 10`, params: asIs },
  handle: { sql: `SELECT ${COLUMNS} FROM identities WHERE LOWER(user_id) = LOWER($1) ORDER BY identity_id LIMIT 10`, params: asIs },
  name: {
    sql: `SELECT ${COLUMNS} FROM identities WHERE LOWER(display_name) = LOWER($1) AND identity_type = 'entity' AND status = 'active' ORDER BY identity_id LIMIT 10`,
    params: asIs
  },
  phone: {
    sql: `SELECT ${COLUMNS} FROM identities WHERE identity_type = 'customer' AND (phone = $1 OR phone = '+' || $1) ORDER BY identity_id LIMIT 10`,
    params: asIs
  },
  contact: { sql: `SELECT ${COLUMNS} FROM identities WHERE identity_type = 'customer' AND otp_contact = $1 ORDER BY identity_id LIMIT 10`, params: asIs },
  doc: {
    sql: `SELECT ${COLUMNS} FROM identities WHERE identity_id IN (SELECT identity_id FROM identity_documents
            WHERE scheme IN ('PHONE', 'EMAIL') AND scheme = $1 AND value_hash = ANY ($2::text[]) AND status = 'verified' AND verified_at IS NOT NULL) ORDER BY identity_id LIMIT 10`,
    params: asDocument
  }
});

let missingUntil = 0; // > Date.now() while the function is known to be missing
let warned = false;

/** is this error "the function is not there / not allowed for this role"? */
const isMissing = (failure) => !!failure && MISSING_CODES.indexOf(failure.code) !== -1;
/** the rows of a database answer ([] for an answer with none) */
const rowsOf = (answer) => (answer && answer.rows) || [];
/** does this key answer nothing at once? (under MIN_KEY characters) */
const tooShort = (typed) => typed.trim().length < MIN_KEY;

/** the direct read (today's answer): the caller's own `execute`, one statement */
async function direct(execute, kind, typed) {
  const statement = DIRECT[kind];
  return rowsOf(await execute(statement.sql, statement.params(typed)));
}

/** the function is missing for this role: remember it, say so ONCE (never silent), and let the caller fall back */
function noteMissing(failure) {
  missingUntil = Date.now() + RETRY_MS;
  if (warned) return;
  warned = true;
  log.warn('signin.lookup.function_missing', { code: failure.code, why: 'ops.signin_candidates is not available to this role (b857 not run?): signing in reads identities directly until it is' });
}

/**
 * candidates(execute, kind, typed) → rows of the eight columns, at most 10, [] for an unknown key or one under three characters.
 * `execute` is the db query function (module query or a bound handle). Throws for an unknown kind (a programming error, as the function does).
 * ONE database round trip on either path: the missing state is remembered, so a missing function costs no extra trip per call.
 */
async function candidates(execute, kind, key) {
  if (KINDS.indexOf(kind) === -1) throw new Error('signin-lookup: unknown kind ' + kind);
  const typed = key == null ? '' : String(key);
  if (tooShort(typed)) return [];
  if (Date.now() < missingUntil) return direct(execute, kind, typed);
  try {
    return rowsOf(await execute('SELECT * FROM ops.signin_candidates($1, $2)', [kind, typed]));
  } catch (failure) {
    if (failure && failure.code === '42501') log.error('signin.lookup.permission_denied', { code: failure.code, why: 'cb_app may not run ops.signin_candidates: the b857 GRANT is wrong; the lookup is NOT falling back, sign-in fails until it is fixed' });
    if (!isMissing(failure)) throw failure;
    noteMissing(failure);
    return direct(execute, kind, typed);
  }
}

/** test hook: forget the remembered state so a test can start clean */
function reset() {
  missingUntil = 0;
  warned = false;
}

module.exports = { candidates, KINDS, COLUMNS, MIN_KEY, RETRY_MS, DIRECT, isMissing, reset };
