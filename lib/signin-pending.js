// OWNS      the pending sign-in store's caller: put / take / try of ops.signin_pending (b879), the random references and their hashes
// FLOW      route ──▶ put(kind, ref, payload) ──▶ ops.signin_pending_put ... later take(kind, ref) ──▶ ONE delete-returning (single use) ──▶ payload or null
// CALLED BY routes/signin-provider.js · tests/signin-provider.test.cjs
// CARD      18-identity-sign-in-and-access/sign-in
'use strict';
/**
 * lib/signin-pending.js — SEC-112 P0 (P0-DESIGN §2b). Three uses, one table, three narrow doors (migrations/b879).
 *   start      the state, nonce and PKCE verifier of ONE provider round trip, found by the hash of a cookie the browser holds (10 min)
 *   handoff    what the callback learned, found by the one-time code in the URL fragment (60 s)
 *   ticket     the checked claims of a person not yet connected (10 min, five tries)         [P1a]
 *   linkstart  an account-page "add Google" request, and its confirm row (60 s)              [P1a]
 * ⭐ THE REFERENCE IS NEVER STORED, only its SHA-256 (a database dump holds nothing that opens a row). 32 random bytes each.
 * ⭐ SINGLE USE IS ONE STATEMENT: take() is a DELETE … RETURNING inside the database door. A replay finds nothing.
 * ⚠️ b879 MAY NOT BE RUN YET: a missing door (42883) or table (42P01) answers code STORE_MISSING to the caller (the route hides the buttons / refuses in words), never a 500, and logs ONCE per window.
 * ⚠️ NO TENANT DATA and no token ever goes into a payload: the nonce, the verifier, the device id, the next path, and the CHECKED claims.
 */
const { query } = require('../db');
const log = require('./logger');
const { randomRef, hashRef } = require('./signin-provider');

const KINDS = Object.freeze({ start: 600, handoff: 60, ticket: 600, linkstart: 60 });
const WINDOW_MS = 10 * 60 * 1000;
let _said = 0;

/** a store failure that means "b879 is not applied": say so once a window and answer STORE_MISSING; any other failure → null */
function missing(failure) {
  const code = failure && failure.code;
  if (code !== '42P01' && code !== '42883' && code !== '3F000') return null;
  const now = Date.now();
  if (!_said || now - _said >= WINDOW_MS) {
    _said = now;
    log.error('signin_pending', { code, why: 'b879 is not applied: provider sign-in is off until it is' });
  }
  const e = new Error('signin pending store missing');
  e.code = 'STORE_MISSING';
  return e;
}

/** put(kind, ref, payload) → void. The ttl is the kind's own (KINDS). Throws STORE_MISSING when b879 is not run. */
async function putPending(kind, ref, payload) {
  if (!KINDS[kind]) throw new Error('signin-pending: unknown kind ' + kind);
  try {
    await query('SELECT ops.signin_pending_put($1, $2, $3::jsonb, $4)', [kind, hashRef(ref), JSON.stringify(payload || {}), KINDS[kind]]);
  } catch (failure) {
    throw missing(failure) || failure;
  }
}
/** take(kind, ref) → the payload (and the row is gone), or null: unknown, spent, expired or another kind. One database round trip. */
async function take(kind, ref) {
  if (!KINDS[kind]) throw new Error('signin-pending: unknown kind ' + kind);
  if (typeof ref !== 'string' || ref.length < 20 || ref.length > 200) return null;
  try {
    const answer = await query('SELECT ops.signin_pending_take($1, $2) AS payload', [kind, hashRef(ref)]);
    return (answer.rows[0] && answer.rows[0].payload) || null;
  } catch (failure) {
    throw missing(failure) || failure;
  }
}
/** attempt(ref) → the ticket's payload and one try counted, or null once the five are used (the ticket is dead). */
async function attempt(ref) {
  if (typeof ref !== 'string' || ref.length < 20 || ref.length > 200) return null;
  try {
    const answer = await query('SELECT ops.signin_pending_try($1) AS payload', [hashRef(ref)]);
    return (answer.rows[0] && answer.rows[0].payload) || null;
  } catch (failure) {
    throw missing(failure) || failure;
  }
}
/** is the store there? (providers() hides the buttons without it) */
async function available() {
  try {
    await query("SELECT 1 FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'ops'::regnamespace AND p.proname = 'signin_pending_put' LIMIT 1").then((answer) => {
      if (!answer.rows.length) throw Object.assign(new Error('absent'), { code: '42883' });
    });
    return true;
  } catch (failure) {
    if (missing(failure)) return false;
    throw failure;
  }
}

module.exports = { put: putPending, take, attempt, available, randomRef, hashRef, KINDS };
