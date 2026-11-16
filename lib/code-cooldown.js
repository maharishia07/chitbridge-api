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
const { rateLimit } = require('./rate-limit');

/** codeCooldown(resolveContact) → the express middleware; resolveContact(body) → { channel, raw } or { error } (routes/catalogue.js) */
function codeCooldown(resolveContact) {
  return rateLimit({
    windowMs: Math.max(1, Number(process.env.CATALOGUE_CODE_COOLDOWN_SECONDS) || 60) * 1000,
    max: 1,
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
module.exports = { codeCooldown };
