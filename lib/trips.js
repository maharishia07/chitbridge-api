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
/**
 * ── ⭐⭐⭐ AND A TESTER MAY SWITCH IT ON FOR THEMSELVES, FOR TEN MINUTES ──────────────────────────────────────
 *
 * Athi, 2026-09-13: *"in the test mode screen itself, can we bring an icon for CB_TRIPS mode on/off and set
 * the limit as say 10 mins, 15 mins — after that it will be off? So we can enable for any user id and we
 * don't need to worry about which id I should use to test, because we create different ids for different
 * purposes and each one may have to be tested."*
 *
 * ⭐ EXACTLY RIGHT, AND AN ENV LIST CANNOT DO IT. Every new test id would mean editing a variable and
 * redeploying the API — for a diagnostic wanted for ten minutes. Worse, a list is only ever added to: nobody
 * goes back to remove an id, so it quietly becomes permanently-on for a growing set of people.
 *
 * ⚠️⚠️ FOR THEMSELVES, NEVER FOR SOMEBODY ELSE. The route passes the CALLER’S OWN entity and nothing else,
 * so this cannot be used to start reading another shop’s timings. That is the whole safety property, and it
 * is enforced at the only place that knows who is asking.
 *
 * ⚠️ AND IT EXPIRES BY ITSELF. A switch that turns off only when somebody remembers is a switch that stays
 * on — exactly what happened this morning with CB_TRIPS=1. Capped at an hour, ten minutes by default, which
 * is longer than any single measurement takes.
 *
 * ⚠️ PROCESS-LOCAL, so a restart clears every trace. That is the right way for it to fail: off.
 */
const _live = new Map();          // entity_id -> epoch ms at which it stops

function traceOn(entity_id, minutes) {
  if (!entity_id) return { on: false };
  const m = Math.max(1, Math.min(60, Math.round(Number(minutes) || 10)));
  const until = Date.now() + m * 60000;
  _live.set(String(entity_id), until);
  return { on: true, minutes: m, until: until, seconds: m * 60 };
}
function traceOff(entity_id) { _live.delete(String(entity_id)); return { on: false }; }
function traceState(entity_id) {
  const u = _live.get(String(entity_id));
  if (u && u > Date.now()) return { on: true, until: u, seconds: Math.round((u - Date.now()) / 1000) };
  if (u) _live.delete(String(entity_id));
  return { on: false };
}
/* ⚠ sweeps as it looks: an expired entry must not keep the counter running for the life of the process */
function _anyLive() {
  let any = false;
  for (const [k, u] of _live) { if (u > Date.now()) any = true; else _live.delete(k); }
  return any;
}

const _raw = () => String(process.env.CB_TRIPS || '').trim();
/**
 * ⚠️⚠️ INSTRUMENTING IS ALL-OR-NOTHING; ANSWERING IS NOT. The middleware runs before auth, so it cannot know
 * whose request this is when it decides whether to open a store. The moment ANY tester switches tracing on,
 * the counter runs for every request in the process — and only that tester receives a header. Said plainly,
 * because it is the cost of the convenience: ten minutes of it is a trade worth making, a permanent env list
 * is not.
 */
const on = () => (_raw() !== '' && _raw() !== '0') || _anyLive();
const _all = () => _raw() === '1';

/* ⚠ the parsed set is memoised AGAINST THE STRING IT CAME FROM, not just "once". Keyed on nothing, a list
   changed at runtime would keep answering with the old one — and a diagnostic that ignores the switch you
   just moved is the most confusing kind. */
let _idsFrom = null, _ids = null;
function allowed(entity_id) {
  if (!on()) return false;
  /* the tester who asked for it, before any env list is consulted */
  if (traceState(entity_id).on) return true;
  if (_raw() === '' || _raw() === '0') return false;
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

module.exports = { tick, middleware, on, allowed, traceOn, traceOff, traceState };
