/**
 * lib/signin-ask-cap.js — the per-ACCOUNT send cap on the sign-in code request (moved out of routes/signin.js, whose size row may not grow; the limiter is unchanged).
 * OWNER     cb-security
 * RISK      access
 * OWNS      accountCap({ rateLimit, intFromEnv, typedByAsk }) → the express limiter: SIGNIN_ASK_PER_ACCOUNT_MAX (default 5) per SIGNIN_ASK_PER_ACCOUNT_WINDOW_MIN (default 15) minutes
 * CALLED BY routes/signin.js POST /ask (askAccountCap, exported on the router for the tests)
 * FLOW      typed account ──▶ one budget per account, counted before anything is looked up ──▶ over the cap: 429 RATE_LIMITED, the same for a held account and a free one
 * CARD      security/sign-in-and-sessions
 * ⚠️ Never a switch: it only slows a flood. Same answer for a known and an unknown account (enumeration: tests/signin-enumeration.test.cjs).
 */
'use strict';
/**
 * SEC (gorilla 2026-11-20): a per-ACCOUNT send cap on the sign-in code request. 30 requests for one account in a row all answered 200 (a mailbox or phone could be flooded from many addresses).
 * One budget per typed account, counted before anything is looked up (a held account and a free one cap alike); SIGNIN_ASK_PER_ACCOUNT_MAX (default 5) per SIGNIN_ASK_PER_ACCOUNT_WINDOW_MIN (default 15) minutes. The SIT box raises it by env.
 */
function accountCap({ rateLimit, intFromEnv, typedByAsk }) {
  return rateLimit({
    name: 'signin-ask-per-account', windowMs: intFromEnv('SIGNIN_ASK_PER_ACCOUNT_WINDOW_MIN', 15) * 60 * 1000,
    max: intFromEnv('SIGNIN_ASK_PER_ACCOUNT_MAX', 5),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => 'acct:' + typedByAsk({ body: req.body || {} }).toLowerCase().slice(0, 200),
    skip: (req) => !typedByAsk({ body: req.body || {} }),
    message: { error: 'Too many codes', message: 'Codes were asked for that account several times already. Use the last one we sent, or try again in a few minutes.' }
  });
}
module.exports = { accountCap };
