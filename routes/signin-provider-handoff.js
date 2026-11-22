// OWNS      POST /api/signin/provider/handoff (SEC-112 P1a, route 4): the one-time code the callback left in the web address → a session, through the ONE session writer
// FLOW      page (#h=code, X-Device-Id) ──▶ POST { code } ──▶ lib/signin-provider-door.decide ──▶ per-account cap ──▶ identity-auth.issueToken (the writer POST /verify uses) ──▶ the SAME body as POST /verify; audit `in` method google
// CALLED BY routes/signin-provider.js (router.post)
// CARD      18-identity-sign-in-and-access/sign-in
'use strict';
/**
 * ⭐ THE SESSION NEVER SITS IN A URL. The callback's redirect carries only a 60-second, single-use CODE in the fragment (#h=); this POST swaps it for the session in a response BODY, exactly the way POST /verify hands one over.
 *    Nothing here writes a token to a log, a header or an address.
 * ⭐ ONE SESSION WRITER: identity-auth.issueToken(query, identity, deviceOfSignin(req)). A device that was removed (DEVICE_REVOKED), no device (NO_DEVICE) and a failed listing (SESSION_NOT_LISTED) answer as POST /verify does.
 * ⭐ ASK-CAP SIBLING: the per-account budget uses the sign-in ask cap's numbers (SIGNIN_ASK_PER_ACCOUNT_MAX per SIGNIN_ASK_PER_ACCOUNT_WINDOW_MIN); the per-address budget is the sign-in budget this route is listed in (server.js authLimiter).
 */
const { problem } = require('../lib/problem');
const log = require('../lib/logger');
const identityAuth = require('../lib/identity-auth');
const sessions = require('../lib/person-session');
const events = require('../lib/signin-events');
const door = require('../lib/signin-provider-door');
const { rateLimit } = require('../lib/rate-limit');
const { query } = require('../db');

const intFromEnv = (name, fallback) => {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
/** one budget per account, counted before a session is written; run by hand because the account is known only after the code is read */
const accountBudget = rateLimit({
  name: 'signin-provider-per-account',
  windowMs: intFromEnv('SIGNIN_ASK_PER_ACCOUNT_WINDOW_MIN', 15) * 60 * 1000,
  max: intFromEnv('SIGNIN_ASK_PER_ACCOUNT_MAX', 5),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => 'acct:' + String(req.signinAccount || ''),
  message: { error: 'Too many attempts', message: 'That account was signed in to several times already. Try again in a few minutes, or use your code.' }
});
/** true when the budget is spent and the 429 is already sent */
const overBudget = (req, res) => new Promise((resolve) => Promise.resolve(accountBudget(req, res, () => resolve(false))).then(() => (res.headersSent ? resolve(true) : null)));

const shopOf = (identity) => identity.parent_entity_id || identity.identity_id;
/** one signin_events row; never a claim value: the subject goes in only as the keyed hash (b880) */
function note(req, identity, action, code, jti, claims, providerKey) {
  let subject_hash = null;
  try {
    subject_hash = claims && claims.subject ? require('../lib/vaultcrypto').keyedSubjectHash(providerKey, claims.issuer, claims.tenant, claims.subject) : null;
  } catch (failure) {
    log.warn('signin_provider', { why: 'subject hash not made: ' + String((failure && failure.code) || 'ERR') });
  }
  events.record(Object.assign(events.fromRequest(req), { entity_id: shopOf(identity), identity_id: identity.identity_id, action, method: providerKey, code: code || null, jti: jti || null, subject_hash }));
}
const refused = (req, res, decided) => {
  log.info('signin_provider', { event: 'handoff_refused', refusal: decided.refusal });
  return problem(req, res, { status: decided.status, code: decided.refusal, detail: decided.detail });
};
/** the session writer's own refusals, worded as POST /verify words them */
function sessionRefused(failure, req, res) {
  const code = failure && failure.code;
  const status = { DEVICE_REVOKED: 403, NO_DEVICE: 400, SESSION_NOT_LISTED: 503 }[code];
  if (!status) return false;
  problem(req, res, { status, code, detail: code === 'DEVICE_REVOKED' ? 'The shop removed this device. Ask the owner.' : failure.message });
  return true;
}
const jtiOf = (token) => {
  try {
    return (require('jsonwebtoken').decode(token) || {}).jti || null;
  } catch (failure) {
    return null;
  }
};

// @does A one-time code from the provider hand-off and this device's id -> we check it, find the one account connected to that provider identity and start its session -> the same answer as the code sign-in, or a refusal in words.
async function handoff(req, res) {
  res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
  /* M2: ONE device read, the session writer's own (header first, then body); the check and the session use the same value, and a header and a body that disagree are refused */
  const dev = sessions.deviceOfSignin(req);
  const device = door.deviceIdOf(dev && dev.device_id);
  if (!device) return problem(req, res, { status: 400, code: 'NO_DEVICE', detail: 'This device must say who it is before it can sign in.' });
  const header = door.deviceIdOf(req.headers['x-device-id']);
  if (header && header !== device) return problem(req, res, { status: 400, code: 'DEVICE_MISMATCH', detail: 'This device said two different things. Start again from the sign-in page.' });
  let decided;
  try {
    decided = await door.decide(String((req.body && req.body.code) || ''), device);
  } catch (failure) {
    log.error('signin_provider', { why: 'handoff failed: ' + String((failure && failure.code) || 'ERR') });
    return refused(req, res, { refusal: 'SIGNIN_UNAVAILABLE', status: door.STATUS.SIGNIN_UNAVAILABLE, detail: door.WORDS.SIGNIN_UNAVAILABLE }); // M3: a fault of ours is a 503 in true words, never "not switched on"
  }
  if (decided.refusal) {
    const one = decided.payload && decided.payload.links && decided.payload.links.length === 1 ? decided.payload.links[0] : null;
    if (one) note(req, { identity_id: one.identity_id, parent_entity_id: one.entity_id }, 'fail', decided.refusal, null, decided.payload.claims, decided.payload.provider);
    return refused(req, res, decided);
  }
  const { identity } = decided;
  req.signinAccount = identity.identity_id;
  if (await overBudget(req, res)) return; // 429 RATE_LIMITED is already sent
  try {
    const token = await identityAuth.issueToken(query, identity, dev);
    note(req, identity, 'in', null, jtiOf(token), decided.claims, decided.provider);
    return res.json({
      message: 'Verified successfully',
      token,
      ...(identity.identity_type === 'actor' && !identity.pin_hash ? { requires_pin_setup: true } : {}),
      entity: { identity_id: identity.identity_id, bridge_id: identity.bridge_id, display_name: identity.display_name, email: identity.email },
      identity: identityAuth.personShape(identity),
      constitution: null
    });
  } catch (failure) {
    if (sessionRefused(failure, req, res)) return note(req, identity, 'fail', failure.code, null, decided.claims, decided.provider);
    log.error('signin_provider', { why: 'session not opened: ' + String((failure && failure.code) || 'ERR') });
    return problem(req, res, { status: 500, code: 'INTERNAL', detail: 'Sign-in failed. Try again, or use your code.' });
  }
}

module.exports = { handoff, accountBudget };
