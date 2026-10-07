/**
 * lib/jwt-verify.js — THE ONE jwt.verify (E10, 2026-10-08). Every place that reads a bearer token goes through here:
 * middleware/auth.js, customer-auth.js, idempotency.js, routes/assist.js, routes/catalogue.js. Never a second.
 *
 * Signing is always JWT_SECRET (lib/identity-auth.js signToken, routes/keys.js, lib/autoraise.js). Verifying tries JWT_SECRET,
 * then JWT_SECRET_PREV — so the secret can be rotated without signing anybody out (docs/RUNBOOK-rotate.md).
 *
 * ⚠️⚠️ WITH JWT_SECRET_PREV UNSET THIS IS EXACTLY `jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] })` — same call, same
 * errors thrown. The second secret is tried ONLY on a bad signature: an expired token (signature already good) stays expired,
 * and a token that fails both secrets throws the FIRST error, as it always did.
 */
'use strict';
const jwt = require('jsonwebtoken');

/** verifyJwt(token) → { claims, rotated } · rotated = true when the PREVIOUS secret verified it · throws like jwt.verify */
function verifyJwt(token) {
  const opts = { algorithms: ['HS256'] };
  const prev = process.env.JWT_SECRET_PREV;
  try {
    return { claims: jwt.verify(token, process.env.JWT_SECRET, opts), rotated: false };
  } catch (err) {
    if (!prev || !err || err.name !== 'JsonWebTokenError' || err.message !== 'invalid signature') throw err;
    try { return { claims: jwt.verify(token, prev, opts), rotated: true }; }
    catch (e2) { throw (e2 && e2.name !== 'JsonWebTokenError') ? e2 : err; }   // PREV said expired / not-yet: that is the truth; PREV said bad signature too: the FIRST error, as always
  }
}

/** true while a rotation window is open (JWT_SECRET_PREV set) */
const rotating = () => !!process.env.JWT_SECRET_PREV;

module.exports = { verifyJwt, rotating };
