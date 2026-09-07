// @stage tested
// @stage-note Counts the database round trips ONE request makes, when asked to. Off unless CB_TRIPS=1.
'use strict';
/**
 * trips.js — HOW MANY TIMES DID THIS ONE REQUEST CROSS THE WIRE?
 *
 * Athi, 2026-09-07: *"do the region move now… and look at each of the API for round trips and enhance."* The region move was the big
 * lever and it is done (San Francisco → Singapore, a database read 1.75 s → 0.49 s). What is left is the number of trips per screen,
 * and the first thing that work needs is a number rather than a hunch.
 *
 * ── HOW IT WORKS ──────────────────────────────────────────────────────────────────────────────────────────────
 * An AsyncLocalStorage store is opened per request; db/index.js increments it on every query and every transaction. The count comes
 * back on the response as `X-DB-Trips` (and `X-DB-Ms`), so a browser's network tab, a curl, or a spec can read it.
 *
 * ── ⚠️ OFF UNLESS ASKED ───────────────────────────────────────────────────────────────────────────────────────
 * `CB_TRIPS=1` in the environment. A counter that runs in production for everyone is a header that leaks how the inside is shaped, and
 * an AsyncLocalStorage per request is not free. This is a measuring tool for a week of work, not a feature.
 *
 * ⚠️ AND IT MEASURES, IT DOES NOT JUDGE. A screen that needs eight trips is not automatically wrong — a chit legitimately reads several
 * tables. The number is here so the WORST offenders are known before anything is rewritten, which is the opposite of guessing.
 */
const { AsyncLocalStorage } = require('async_hooks');

const on = () => String(process.env.CB_TRIPS || '') === '1';
const als = new AsyncLocalStorage();

/** count one trip against whatever request is in flight (called by db/index.js) */
function tick(kind) {
  if (!on()) return;
  const s = als.getStore();
  if (!s) return;
  s.n += 1;
  if (kind) s.kinds[kind] = (s.kinds[kind] || 0) + 1;
}

/** express middleware: open a store per request and report what it cost */
function middleware() {
  return function trips(req, res, next) {
    if (!on()) return next();
    const store = { n: 0, kinds: {}, t0: Date.now() };
    als.run(store, () => {
      res.on('finish', () => { /* nothing: the header is set before the body goes out, below */ });
      const end = res.end;
      res.end = function (...args) {
        try {
          if (!res.headersSent) {
            res.setHeader('X-DB-Trips', String(store.n));
            res.setHeader('X-DB-Ms', String(Date.now() - store.t0));
          }
        } catch (_) {}
        return end.apply(this, args);
      };
      next();
    });
  };
}

module.exports = { tick, middleware, on };
