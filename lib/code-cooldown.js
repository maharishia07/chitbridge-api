'use strict';
/*
 * OWNS      the shopper's code door cool-down: one code per CONTACT per minute (SEC audit 2026-11-16) - POST /api/catalogue/:bridge_id/order/start and /support/start share the one limiter
 * CALLED BY routes/catalogue.js
 * FLOW      request → contact from the body (the route's own resolveContact) → key = door + shop + channel + normalised contact → one pass a minute, else 429 RATE_LIMITED (house answer)
 * CARD      18-identity-sign-in-and-access/rate-limits
 */
/**
 * The per-address catalogue limiter (60 per 15 min) does not stop many addresses sending code after code to ONE phone or inbox (SMS bombing, and the cost of it). This one is keyed by the contact,
 * the house limiter factory (lib/rate-limit, as routes/signin.js askAddressCap), counted before the code is made or sent. A phone is keyed by its last 9 digits (lib/stores phoneMatchKey), so
 * "+91 98400 11111" and "9840011111" are one phone. A contact that does not parse is not counted (the handler refuses it in words). CATALOGUE_CODE_COOLDOWN_SECONDS tunes the minute.
 */
const { MemoryStore } = require('express-rate-limit');
const { rateLimit } = require('./rate-limit');
const store = new MemoryStore(); /* held here so a test lab can clear the minute between scenarios (resetCooldown); the one process-local store, like the other limiters */

/** codeCooldown(resolveContact) → the express middleware; resolveContact(body) → { channel, raw } or { error } (routes/catalogue.js) */
function codeCooldown(resolveContact) {
  return rateLimit({
    name: 'catalogue-code-cooldown',
    windowMs: Math.max(1, Number(process.env.CATALOGUE_CODE_COOLDOWN_SECONDS) || 60) * 1000,
    max: 1,
    store,
    skipFailedRequests: true, /* a refused or failed start (shop closed, send failed) sent no code, so it uses no minute; the count is taken up front, so a burst of parallel asks is still one */
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const typed = resolveContact(req.body || {});
      const who = typed.channel === 'phone' ? require('./stores').phoneMatchKey(typed.raw) || typed.raw : typed.raw;
      return 'code:' + req.path.split('/').slice(-2).join('/') + ':' + String(req.params.bridge_id || '').toLowerCase() + ':' + typed.channel + ':' + who;
    },
    skip: (req) => !!resolveContact(req.body || {}).error,
    message: { error: 'Too many requests', message: 'A code was just sent to that number or email. Use it, or ask again in a minute.' }
  });
}
/** clears every contact's minute - for a test lab that drives the same contact through many scenarios; nothing in the server calls it */
const resetCooldown = () => store.resetAll();
module.exports = { codeCooldown, resetCooldown };
