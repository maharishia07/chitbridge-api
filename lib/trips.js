// @stage tested
// @stage-note Counts the database round trips ONE request makes, when asked to. OFF unless CB_TRIPS is set:
// @stage-note   unset|0 = nothing · 1 = every caller (dev only) · <id>,<id> = measure all, answer only those entities.
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

/**
 * ── ⭐⭐⭐ OFF, EVERYONE, OR A NAMED FEW ──────────────────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-13, having asked for it to be switched on an hour earlier: *"it is the development tool for
 * us to measure, so we need an env variable to switch on and off — definitely for prod this feature has to be
 * removed, or kept silent, or activated only for a few ids, id specific."*
 *
 * ⭐ HE IS RIGHT AND A BOOLEAN WAS THE WRONG SHAPE. A diagnostic you can only have for everybody or nobody
 * gets left on — which is precisely what happened this morning, and why the note to turn it off had to go
 * into memory rather than into the code.
 *
 *   CB_TRIPS unset or 0      nothing. No store, no counting, no header. THE PRODUCTION DEFAULT.
 *   CB_TRIPS=1               everyone. For a dev or staging box, never for live.
 *   CB_TRIPS=<id>,<id>       measure, but answer ONLY those entities. Live diagnosis of one shop.
 *
 * ⚠️⚠️ THE COST AND THE ANSWER ARE TWO DIFFERENT GATES, and it matters which is which. The entity is not
 * known when this middleware runs — auth has not happened yet — so with an id list the store IS opened for
 * every request and only the HEADER is withheld. The AsyncLocalStorage cost is therefore paid by everyone
 * whenever the variable is set to anything. ⭐ Which is the honest reason the production default is UNSET,
 * rather than "set it to a list and forget it".
 *
 * ⚠️ AND WITHHELD MEANS ABSENT, NOT ZERO. A header reading 0 would tell a reader "no database work happened",
 * which is a different and false statement. The panel already says "the server is not reporting its own
 * time" when the header is missing, and that is the true one.
 */
const _raw = () => String(process.env.CB_TRIPS || '').trim();
const on = () => _raw() !== '' && _raw() !== '0';
const _all = () => _raw() === '1';

/* ⚠ the parsed set is memoised AGAINST THE STRING IT CAME FROM, not just "once". Keyed on nothing, a list
   changed at runtime would keep answering with the old one — and a diagnostic that ignores the switch you
   just moved is the most confusing kind. */
let _idsFrom = null, _ids = null;
function allowed(entity_id) {
  if (!on()) return false;
  if (_all()) return true;
  const raw = _raw();
  if (_idsFrom !== raw) {
    _ids = new Set(raw.split(',').map((x) => x.trim()).filter(Boolean));
    _idsFrom = raw;
  }
  return !!entity_id && _ids.has(String(entity_id));
}
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
          /* ⚠ decided HERE and not at the top: auth has run by now, so the caller finally has a name */
          const who = (req.identity && (req.identity.entity_id || req.identity.identity_id)) || null;
          if (allowed(who)) {
            res.setHeader('X-DB-Trips', String(store.n));
            res.setHeader('X-DB-Ms', String(Date.now() - store.t0));
          }
        } catch (_) {}
        return writeHead.apply(this, args);
      };
      next();
    });
  };
}

module.exports = { tick, middleware, on, allowed };
