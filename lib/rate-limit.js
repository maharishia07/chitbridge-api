'use strict';
/*
 * OWNS      the ONE way a limiter is built and the ONE answer it gives when a caller is over the limit: 429 problem+json, code RATE_LIMITED, Retry-After.
 * CALLED BY server.js (every limiter) · routes/products.js · routes/ctp.js · routes/csp-report.js
 * FLOW      rateLimit(opts) → express-rate-limit with our handler → over the limit → problem(req, res, {429, RATE_LIMITED, retry_after_seconds}) + Retry-After
 * CARD      28-platform-and-operations/limits-idempotency-rate-limits
 */
/**
 * lib/rate-limit.js — API-16 (BH-5). express-rate-limit's own answer is text/html "Too many requests, please try again later."; the till and the web call
 * res.json() on every answer, so that threw a parse error instead of "wait 59 s". Every limiter now answers through lib/problem.js.
 *
 * ⭐ LEGACY KEYS STAY (S2). A limiter that already had a `message: {error, message}` keeps sending exactly those keys under the problem fields; its
 * `message` sentence is also the problem `detail`, so the words a shop saw do not change. A limiter with no message gets the register's words.
 * Retry-After is set by express-rate-limit before the handler runs (whole seconds); the same number is copied into the body as params.retry_after_seconds.
 */
const expressRateLimit = require('express-rate-limit');
const { problem } = require('./problem');

const factory = expressRateLimit.rateLimit || expressRateLimit;
const DEFAULT_DETAIL = 'Too many requests came in a short time.';

/** limitedHandler(message?) → the (req, res) handler: 429 RATE_LIMITED with the wait in seconds */
function limitedHandler(message) {
  const legacy = message && typeof message === 'object' ? message : null;
  return (req, res) => {
    const wait = Number(res.getHeader('Retry-After'));
    const seconds = Number.isFinite(wait) && wait >= 1 ? Math.ceil(wait) : 60;
    if (!res.getHeader('Retry-After')) res.set('Retry-After', String(seconds));
    const detail = (legacy && legacy.message) || (typeof message === 'string' ? message : DEFAULT_DETAIL);
    return problem(req, res, {
      status: 429,
      code: 'RATE_LIMITED',
      detail,
      hint: 'Wait ' + seconds + ' seconds, then try again.',
      params: { retry_after_seconds: seconds },
      legacy
    });
  };
}

/**
 * rateLimit(opts) — express-rate-limit with the house answer; an opts.handler of its own still wins.
 * COLUMN 16 (resource_cap, OWASP API4): `opts.name` is the limiter's NAME and is kept on the middleware (limiterName, limiterBudget {windowMs, max}) so the register can read, per route,
 * which named budget stands in front of it; the name is not handed to express-rate-limit. A limiter with no name still limits, and reads as unnamed in the register.
 */
const rateLimit = (opts) => {
  const { name, ...rest } = opts || {};
  const middleware = factory(Object.assign({ handler: limitedHandler(rest.message) }, rest));
  if (name) Object.assign(middleware, { limiterName: String(name), limiterBudget: { windowMs: rest.windowMs, max: rest.max } });
  return middleware;
};

module.exports = { rateLimit, limitedHandler };
