'use strict';
/*
 * OWNS      the ONE bucket key for the per-caller limiters (services, public doors, till mint): a value the caller cannot invent.
 * CALLED BY server.js (publicLimiter, serviceLimiter) · routes/till.js (catalogueMintLimiter)
 * FLOW      request → callerKey(req) → 'id:<identity>:<jti>' when the bearer / X-Api-Key verifies as a ChitBridge token, else 'ip:<address>'
 * CARD      18-identity-sign-in-and-access/rate-limits
 */
/**
 * lib/limiter-key.js — SEC-79. The limiters run BEFORE auth, so they used to key on the raw X-Api-Key / Authorization text:
 * a stranger could send a new made-up header on every call and get a fresh 240/min bucket each time. Now only a token whose
 * SIGNATURE verifies (lib/jwt-verify, no database) earns its own bucket; anything else is counted against its IP.
 * A revoked-but-signed token still keys to itself, which is harmless: the holder cannot mint another signed token.
 */
const { verifyJwt } = require('./jwt-verify');
const log = require('./logger');

const BEARER = /^Bearer\s+(\S+)$/i;

/** the token text the caller presented, from Authorization or X-Api-Key; '' when none */
function presentedToken(req) {
  const presented = String(req.headers.authorization || req.headers['x-api-key'] || '').trim();
  const bearer = BEARER.exec(presented);
  return bearer ? bearer[1] : presented;
}

/** callerKey(req) → the limiter bucket for this caller */
function callerKey(req) {
  const token = presentedToken(req);
  if (token) {
    try {
      const claims = verifyJwt(token).claims;
      if (claims && claims.identity_id) return 'id:' + claims.identity_id + ':' + (claims.jti || '');
    } catch (notOurToken) {
      /* unverifiable text is not an identity: count it against the address, which the caller cannot choose (the caller sees no difference) */
      log.fellBack('limiter key: token not verifiable, keyed by address', notOurToken, 'debug');
    }
  }
  return 'ip:' + String(req.ip || (req.socket && req.socket.remoteAddress) || 'unknown');
}

/**
 * ⭐ T-F-02 · THE GENERAL (api-global) BUCKET. A signed-in person counts against their OWN budget ('who:<identity_id>', every session of the person together, so a
 * second tab or device cannot dodge it and a colleague behind the same shop address never spends it); anything else counts per address ('ip:<address>', the
 * unauthenticated budget). Only a token whose SIGNATURE verifies earns a person bucket (SEC-79: the caller cannot invent one). Read once per request.
 */
const GENERAL = Symbol('generalBucket');
function generalBucket(req) {
  if (req[GENERAL]) return req[GENERAL];
  let bucket = null;
  const token = presentedToken(req);
  if (token) {
    try {
      const claims = verifyJwt(token).claims;
      if (claims && claims.identity_id) bucket = { key: 'who:' + claims.identity_id, signedIn: true };
    } catch (notOurToken) {
      log.fellBack('limiter key: token not verifiable, keyed by address', notOurToken, 'debug');
    }
  }
  req[GENERAL] = bucket || { key: 'ip:' + String(req.ip || (req.socket && req.socket.remoteAddress) || 'unknown'), signedIn: false };
  return req[GENERAL];
}

module.exports = { callerKey, presentedToken, generalBucket };
