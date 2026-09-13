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
      /**
       * ── ⚠️⚠️⚠️ IT WAS WRAPPING `res.end`, AND THE HEADERS NEVER WENT OUT ────────────────────────────────
       *
       * Switched on in production 2026-09-13 at Athi’s word and the headers simply were not there. The
       * variable was set, the deploy had landed, `on()` was true, and every response came back without them.
       *
       * ⚠️⚠️ MIDDLEWARE WRAPS OUTWARD, SO IT UNWRAPS INWARD. This runs FIRST, so it wrapped `res.end` first;
       * `compression` runs after and wrapped the wrapper. On the way out compression’s version runs first,
       * flushes the head, and only then calls ours — by which time `res.headersSent` is true and the guard
       * skipped every single time. ⭐ Being first in the chain means being LAST to act.
       *
       * ⭐ `writeHead` IS THE RIGHT SEAM. It is called at the one moment the headers are serialised, by
       * whoever is actually sending them, however many layers deep — which is exactly what the `on-headers`
       * package exists to do, and why patching `end` is the classic way to get this wrong.
       *
       * ⚠️ AND IT SILENTLY MEASURED NOTHING FOR SIX DAYS. The counter ran, the store filled, the numbers were
       * correct and no one could see them. A measuring tool that reports nothing looks exactly like a system
       * with nothing to report. [[feedback-silence-is-the-bug]]
       */
      const writeHead = res.writeHead;
      res.writeHead = function (...args) {
        try {
          res.setHeader('X-DB-Trips', String(store.n));
          res.setHeader('X-DB-Ms', String(Date.now() - store.t0));
        } catch (_) {}
        return writeHead.apply(this, args);
      };
      next();
    });
  };
}

module.exports = { tick, middleware, on };
