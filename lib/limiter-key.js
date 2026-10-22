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

const BEARER = /^Bearer\s+(\S+)$/i;

/** the token text the caller presented, from Authorization or X-Api-Key; '' when none */
function presentedToken(req) {
  const raw = String(req.headers.authorization || req.headers['x-api-key'] || '').trim();
  const bearer = BEARER.exec(raw);
  return bearer ? bearer[1] : raw;
}

/** callerKey(req) → the limiter bucket for this caller */
function callerKey(req) {
  const token = presentedToken(req);
  if (token) {
    try {
      const claims = verifyJwt(token).claims;
      if (claims && claims.identity_id) return 'id:' + claims.identity_id + ':' + (claims.jti || '');
    } catch (_notOurToken) {
      /* unverifiable text is not an identity: fall through to the address, which the caller cannot choose */
    }
  }
  return 'ip:' + String(req.ip || (req.socket && req.socket.remoteAddress) || 'unknown');
}

module.exports = { callerKey, presentedToken };
