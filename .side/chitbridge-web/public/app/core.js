/* app/core.js — shared client module for the Task Panel (module 1 of the app split).
 * OWNS  the envelope: unwrap() (the {ok,data,error} answer, its list siblings kept), api() (auth · 401/422/500 branching), fill().
 * FLOW  api(key) → EP[key] → fetch → unwrap → the panel paints; a 401 ends the session (CBFrame.ended)
 * CARD 01-rail-core-the-chit/task-panel-core
 * CALLED BY public/app.html, accounts.html, catalogue.html, crm.html, finance.html, operations.html, settings.html, tasks.html (script tag); e2e tests lift cbOrderLive/cbOrderDecl/catg* from it
 * Loaded by /app.html BEFORE its main inline script (classic script, shared global scope).
 * Exposes: fill(), unwrap() (the {ok,data,error} envelope), api() (auth + 401/422/500 branching).
 * Depends on host globals defined in app.html: EP, CFG, SESSION, demoApi, go.
 * Pattern for a NEW panel: add one EP row + one mapper, then a panel module that calls api(). */

function fill(path, params) {
  return path.replace(/:(\w+)/g, (_, k) => encodeURIComponent((params && params[k]) ?? ''));
}

// Single response envelope. Accepts a real {ok,data,error} envelope, or normalises the legacy
// wrappers ({chits,…}, {entity}, {messages,…}, …) so feature code uses `data` directly.
/**
 * ── ⭐⭐⭐ THE DOOR NOW SAYS WHAT IT REFUSED ────────────────────────────────────────────────────────────────
 *
 * This envelope has silently eaten three fields in one day — `truncated`, `status_counts`, and the
 * `counts`/`open` the incident boards read — and each one looked like a completely different bug:
 * a search that found nothing, a shop that reported 500 products, a filter chip with no number.
 *
 * ⚠️⚠️ THE FAILURE IS ALWAYS SILENT AND ALWAYS FLATTERING. The value reads `undefined`, the screen shows a
 * smaller and tidier answer, and nothing anywhere says a field was dropped. Four warnings in capitals are
 * already written above this line and every one of them was read past — by me, twice, today.
 *
 * ⭐ SO IT REPORTS. `importCases` on the server has done this since it lost its fifth field: a named-list
 * copier that cannot say what it threw away will keep throwing things away. The same fix, on the client.
 * [[feedback-silence-is-the-bug]]
 *
 * ⚠️ IT DOES NOT WARN, AND THAT IS DELIBERATE. Plenty of endpoints return siblings nobody needs; a console
 * warning per call would be noise that trains people to ignore it. It ACCUMULATES, and the tester’s Speed
 * area shows the list — visible to somebody who is looking for a fault, invisible to everybody else.
 */
var CBDROP = {};
function cbDropNote(key, keys) {
  try {
    if (!keys || !keys.length) return;
    var k = key || '?';
    var seen = CBDROP[k] || (CBDROP[k] = []);
    keys.forEach(function (item) {
      if (seen.indexOf(item) < 0) seen.push(item);
    });
  } catch (_) {}
}
/* capped · cap_note (SIBS below) — W2-RAIL R2: a cut list SAYS SO — `capped` (the code) and `cap_note` (the sentence) ride beside the chits array on inbox · sent · folder; pgFooter prints it */
function unwrap(j, _key) {
  if (j == null || typeof j !== 'object' || Array.isArray(j)) return j;
  if ('ok' in j && ('data' in j || 'error' in j)) {
    if (j.ok === false) throw new Error(j.error || 'Request failed');
    return j.data;
  }
  /**
   * ⚠️ `has_catalogue` JOINS THIS LIST BECAUSE THE LINE BELOW WAS EATING THE ANSWER (found 2026-08-14, driving the
   * picker under Playwright after three failed attempts by hand).
   *
   * The catalogue-overlay response is a COMPOUND: {has_catalogue, items[], match, ambiguous, candidates[]}. The
   * array-collapse below sees `items` and returns ONLY that array — so `candidates`, `ambiguous` and `match` were
   * silently discarded before any caller saw them. The picker read `cat.candidates` on what was actually a bare
   * array, got undefined, and fell through to the quantity stepper with no error anywhere.
   *
   * ⚠️ AND IT HAD BEEN BREAKING THE OLDER FEATURE ALL ALONG: the "which item?" sheet reads `cat.items`, which on
   * an array is also undefined — so that list has been rendering "No catalogue yet" since the day it was written,
   * on entities with a full catalogue. One convention, applied to a response it was never designed for, quietly
   * disabled two features and produced not a single error message.
   */
  /**
   * ⚠️ `searched` JOINS THE LIST FOR THE THIRD INSTANCE OF THIS EXACT BUG (2026-08-16, found by Athi within
   * minutes of the deploy: *"find product is not finding the product"*).
   *
   * `/suppliers/availability` returns a COMPOUND — {q, results[], count, searched} — and the collapse below sees
   * `results` and returns ONLY that array. `r.results` was then undefined at every call site, so a working
   * endpoint answered "no supplier lists that" for every product on the shelf.
   *
   * ⭐ THE PATTERN IS NOW UNMISTAKABLE: a compound response whose array key happens to be on the collapse list
   * loses everything else, silently, with no error anywhere. It has now disabled the catalogue overlay, the
   * "which item?" sheet, and this. `supCatalogueFull` bypasses api() entirely for the same reason.
   * ⚠️ IF YOU ADD AN ENDPOINT THAT RETURNS AN ARRAY BESIDE ANY OTHER KEY, IT BELONGS ON THIS LINE.
   */
  if ('token' in j || 'my_disputes' in j || 'header' in j || 'has_catalogue' in j || 'searched' in j) return j; // auth / structured / compound -> whole, untouched
  for (const k of ['chits', 'messages', 'connections', 'requests', 'suppliers', 'items', 'results', 'actors'])
    if (Array.isArray(j[k])) {
      const a = j[k]; /**
       * ── ⚠️⚠️⚠️ `truncated` JOINS THIS LIST, AND IT IS THE FIFTH INSTANCE OF THE BUG DESCRIBED ABOVE ────────
       *
       * Athi, 2026-09-13: *"when I search cycle from the catalogue in the webapp it is not showing — I guess the
       * search works only within the data what has been browsed? I could see Cycle Candle from the counter."*
       * He was exactly right, and the cause is this line.
       *
       * ⚠️⚠️ THE SHOP HAS 10,441 PRODUCTS AND THE SCREEN LOADS 500. That is deliberate and fine — the code for
       * it is already written: `/api/products` returns `truncated`, `prodSearchServer()` exists to search the
       * whole shelf, and the input calls it with `if(UI.prodTruncated)`. Every piece was in place.
       *
       * ⭐ AND THIS LINE THREW THE FLAG AWAY. It carries `total`, `page` and `limit` off a compound response and
       * silently drops everything else — so `page.truncated` was undefined, `UI.prodTruncated` stayed false, the
       * server search never fired, and the box searched the 500 rows it happened to be holding. Nine thousand
       * products could not be found by typing their name, and nothing anywhere said so.
       *
       * ⚠️ THE COMMENT ABOVE ALREADY WARNED ABOUT THIS IN CAPITALS — "IF YOU ADD AN ENDPOINT THAT RETURNS AN
       * ARRAY BESIDE ANY OTHER KEY, IT BELONGS ON THIS LINE" — after it had disabled the catalogue overlay, the
       * "which item?" sheet, supplier availability and the /me bundle. A warning is not a guard.
       */
      /**
       * ⚠️⚠️⚠️ THIS LIST HAS NOW EATEN THREE FIELDS, AND EACH ONE LOOKED LIKE A DIFFERENT BUG.
       *   · "truncated" — so the catalogue search never asked the server and answered "no such product"
       *     about 96 products that exist (2026-09-13, morning).
       *   · "status_counts" — so the availability chips counted the 500 loaded rows and reported "495 / 5"
       *     for a shop of 10,441 (2026-09-13, evening). Athi found both.
       *   · and "counts"/"open", which the incident and requirement boards read for their filter chips.
       *
       * ⚠️ THE FAILURE IS ALWAYS SILENT AND ALWAYS FLATTERING: the value reads undefined, the screen shows a
       * smaller, tidier number, and nothing anywhere says a field was dropped. A named allow-list on a shared
       * envelope needs a REPORT, the way importCases got one — that is in the backlog now.
       */
      /**
       * ⚠️⚠️⚠️ AND THE FOURTH AND FIFTH: "category_counts" and "uncategorised" (2026-09-16).
       *
       * `/api/products` now counts the categories where the rows are — one GROUP BY over every product, in the same
       * batched round trip. The Categories screen read `r.category_counts`, got undefined, and fell back to counting
       * the page: "Biscuits 19" for a shop holding 400. THE SERVER WAS RIGHT AND THE SCREEN WAS WRONG, which is the
       * signature of this line every single time.
       *
       * ⚠️ Exactly as the capitals above predicted, on the same day they were re-read. A warning is not a guard —
       * so `cbDropNote` below records every dropped key by endpoint, and `e2e/api-envelope.cjs` now FAILS when a
       * route answers with a sibling this list does not carry.
       */
      /**
       * ⚠️⚠️⚠️ AND THE SIXTH: "actor_health" and "actor_last_seen" (2026-09-16), found by e2e/api-envelope.cjs the
       * hour it was written. `/connectors/:actorId/connections` answers {actor_health, actor_last_seen, connections}
       * and cap-connector read all three off the result — but the response COLLAPSES to the connections array, so
       * every one of them was undefined. The connector cockpit has been reading "offline" with an empty device list
       * no matter what the Pi was actually doing, which is the single thing that screen exists to tell you.
       */
      /**
       * ⚠️ 2026-09-16 — `migrated` is the SEVENTH instance: the product-enquiry thread read it to say "this is not
       * enabled on this deployment yet", the sibling was dropped, and the banner could never fire. `supplier` and
       * `groups` join it for a different reason — they ARE read, but only because supCatalogueFull() bypasses this
       * function entirely to keep them. Carrying them here is what would let that bypass be retired.
       */
      var SIBS = [
        'total',
        'page',
        'limit',
        'next',
        'truncated',
        'count',
        'offset',
        'status_counts',
        'open',
        'counts' /* next: PERF1 — a keyset list's cursor (chits inbox/sent, books pages) */,
        'category_counts',
        'uncategorised',
        'actor_health',
        'actor_last_seen',
        'migrated',
        'supplier',
        'groups',
        'project',
        'late',
        'may_answer',
        'why',
        'capped',
        'cap_note'
      ]; /* late · may_answer · why — T3-P3-CONSENT: GET /api/crm/privacy-requests answers { requests[], total, page, limit, open, late, may_answer, why } — the register greys Answer on may_answer/why. ⚠️ no square bracket INSIDE the array: e2e/api-envelope.cjs reads the list up to the first one */
      for (const mk of SIBS)
        if (mk in j) {
          try {
            Object.defineProperty(a, mk, { value: j[mk], enumerable: false, configurable: true, writable: true });
          } catch (_) {
            a[mk] = j[mk];
          }
        }
      /* ⚠️ everything NOT on the list, and not the array itself, is gone from here on — so it is written down */
      try {
        cbDropNote(
          _key,
          Object.keys(j).filter(function (x) {
            return x !== k && SIBS.indexOf(x) < 0;
          })
        );
      } catch (_) {}
      return a;
    }
  /**
   * ⚠️⚠️ `included` IS A SIBLING OF `entity`, AND THIS LINE WAS EATING IT — the fourth instance of the exact bug
   * the comments above describe, and the most expensive one, because nothing looked wrong.
   *
   * `/entities/me?include=readiness,channels,vault` returns `{entity, capabilities, governance, included}` and
   * the server gathers all three sub-reads in ONE transaction. `return j.entity` handed back the entity alone,
   * so `included` never reached a caller. `_profSeedIncluded(e)` read `e.included`, found nothing, and returned
   * without seeding — and the sub-loaders each went to the network exactly as if the bundle did not exist.
   *
   * ⭐ So the whole one-read optimisation has been dead since it was written: the server did the work and the
   * client discarded it, with no error and no visible symptom beyond a screen that felt slow. Measured
   * 2026-09-01 — a warm profile open still fetched governance/readiness and channels.
   *
   * ⚠️ ATTACHED TO THE ENTITY RATHER THAN RETURNING THE WHOLE OBJECT. Every caller of `api('me')` reads fields
   * off the flattened entity — `r.display_name`, `r.currency_code` — so returning `j` would change the shape
   * under all of them. Carrying one key across keeps both contracts true.
   */
  if (j.entity) {
    if (j.included && j.entity && typeof j.entity === 'object') {
      try {
        j.entity.included = j.included;
      } catch (_) {}
    }
    return j.entity;
  }
  if (j.settings) return j.settings;
  if (j.chit) return j.chit;
  return j;
}

// --- shared in-flight feedback (every panel goes through api(), so this is uniform) ---
let _inflight = 0; const _lockKeys = new Set();
/**
 * ⭐ SAY IT IN WORDS (Athi, 2026-08-16: *"we have to show explicit inprogress bar while reading the data, what
 * you are showing as part of the browser is not good enough"*).
 *
 * There WAS a bar — a 3px gradient hairline pinned to the top of the window. Three things were wrong with it:
 * it sat at the extreme top of the WINDOW, where browser and dev chrome also live, it was thin enough to read as
 * decoration, and — the one that actually mattered — it carried NO WORDS, so it never actually
 * said that data was being read. A silent hairline is not feedback; it is an animation.
 *
 * Now it is a labelled pill — "Reading data…" plus the count when several reads are in flight — beside a thicker
 * sweep. Driven from the one place every panel already funnels through, so no screen has to remember to show it.
 * ⚠️ A SHORT DELAY BEFORE IT APPEARS. A read that returns in 80ms should not flash a banner; a spinner that
 * blinks on every keystroke-driven fetch is worse than none. It waits ~180ms, so only reads a person can
 * actually perceive get announced.
 */
let _netBusyT = null;
function _netBusy(on) {
  let node = document.getElementById('netbusy');
  if (!node) {
    node = document.createElement('div');
    node.id = 'netbusy';
    node.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;display:none';
    node.innerHTML = '<div id="netbusy-card"><span id="netbusy-ring"></span><span id="netbusy-txt">' + tx('Reading data…') + '</span></div>';
    const s = document.createElement('style');
    s.textContent =
      '@keyframes nbspin{to{transform:rotate(360deg)}}' +
      '@keyframes nbin{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}' +
      '#netbusy-card{display:inline-flex;align-items:center;gap:9px;background:var(--chrome);color:var(--chrome-on);' +
      'font:600 12.5px/1 "Segoe UI",system-ui,sans-serif;padding:11px 16px;border-radius:22px;' +
      'box-shadow:0 6px 22px rgba(15,46,61,.30);animation:nbin .14s ease-out}' +
      '#netbusy-ring{width:14px;height:14px;border:2px solid rgba(255,255,255,.32);border-top-color:#fff;' +
      'border-radius:50%;animation:nbspin .7s linear infinite;flex:none}' +
      '@media (prefers-reduced-motion:reduce){#netbusy-ring,#netbusy-card{animation:none}}';
    (document.head || document.documentElement).appendChild(s);
    (document.body || document.documentElement).appendChild(node);
  }
  if (on) {
    const paint = function () {
      const t = document.getElementById('netbusy-txt');
      if (t) t.textContent = _inflight > 1 ? 'Reading data… (' + _inflight + ')' : 'Reading data…';
      /**
       * ⚠️ CENTRED ON THE PANE BEING READ (Athi: *"it is coming somewhere in the screen, it has to be in the
       * center of the current panel"*). Pinned top-right it sat among the browser and dev chrome — technically
       * visible, nowhere near where the eye already is. Centre it on the working surface instead, preferring the
       * detail pane, then the panel, then the main body, and only falling back to the viewport when a screen has
       * none of those (login, onboarding).
       */
      const host = document.getElementById('detailpane') || document.getElementById('panel') || document.getElementById('mainbody') || null;
      const r = host && host.getBoundingClientRect();
      node.style.display = 'block';
      /**
       * ⚠️⚠️ CENTRING ON A PANE THAT RUNS OFF THE SCREEN PUTS THE MESSAGE OFF THE SCREEN. Athi, 2026-08-22:
       * *"I have reduced the size of the window much smaller… the messages were overlapping / going away from
       * the screen."* Measured: at a 700px window the detail pane's centre computes to **869→971** — the card
       * was painted entirely outside the viewport, so "Reading data…" simply never appeared.
       *
       * ⭐ THE HOST IS STILL THE RIGHT ANCHOR — the message belongs where the eye already is, which is why it
       * follows the detail pane rather than sitting in the chrome. What was missing is that a pane can be only
       * PARTLY on screen. Centre on the part you can actually see, and if almost none of it is visible, fall
       * back to the viewport rather than to a point beyond it.
       *
       * ⚠️ THEN CLAMP, using the card's own width. Centring the visible strip is not enough on its own: a
       * 102px card centred 20px from the edge still hangs half off. Measured after `display:block`, so the
       * number is the card's real width rather than a guess that rots when the text changes.
       */
      var vw = window.innerWidth || 0,
        vh = window.innerHeight || 0;
      var cx = vw / 2,
        cy = vh / 2;
      if (r && r.width > 40 && r.height > 40) {
        var vl = Math.max(0, r.left),
          vr = Math.min(vw, r.right);
        var vt = Math.max(0, r.top),
          vb = Math.min(vh, r.bottom);
        if (vr - vl > 60) cx = (vl + vr) / 2; /* enough of it is on screen to aim at */
        if (vb - vt > 60) cy = (vt + vb) / 2;
      }
      var hw = Math.min((node.offsetWidth || 120) / 2 + 8, vw / 2);
      var hh = Math.min((node.offsetHeight || 40) / 2 + 8, vh / 2);
      node.style.left = Math.round(Math.max(hw, Math.min(vw - hw, cx))) + 'px';
      node.style.top = Math.round(Math.max(hh, Math.min(vh - hh, cy))) + 'px';
      node.style.transform = 'translate(-50%,-50%)';
    };
    if (node.style.display === 'block')
      paint(); // already up — just refresh the count
    else if (!_netBusyT)
      _netBusyT = setTimeout(function () {
        _netBusyT = null;
        if (_inflight > 0) paint();
      }, 180);
  } else {
    if (_netBusyT) {
      clearTimeout(_netBusyT);
      _netBusyT = null;
    }
    node.style.display = 'none';
  }
}
// --- tester message/event log (in-memory ring buffer; surfaced by the in-app Message console) ---
const __cblog = [];
function cblog(level, text) {
  __cblog.push({ t: Date.now(), level: level || 'info', text: String(text) });
  if (__cblog.length > 300) __cblog.shift();
}
if (typeof window !== 'undefined') {
  window.__cblog = __cblog;
  window.cblog = cblog;
}

// OUTBOX-SAFE mutations (offline Phase 4.2): fire-and-forget state changes / idempotent overwrites / deletes whose
// callers ignore the response body. Offline, these are QUEUED (cb-offline.js) and replayed on reconnect — deduped by the
// server Idempotency-Key (b109), so a replay can't double-apply. CREATES + id-returning + content-returning mutations
// (createChit, sendMsg, dispute-raise, AI, auth, uploads) are deliberately NOT here — offline they fail gracefully and
// the Phase-4.1 draft protects the typed input. See SPEC-offline-coverage.md.

/**
 * ⭐ CBPrefs — ONE way to sync a person's own preferences to their identity row (b165 locale · b166 ui).
 *
 * ⚠️ SHARED RATHER THAN COPIED, and the reason is not tidiness. The localisation layer and the appearance
 * controls need exactly the same behaviour — debounce, fire-and-forget, queue when offline, stay silent before
 * the migration runs. Written twice, the second copy drifts the first time one of them gains a retry or a log
 * line, and the copy nobody remembered would be the one carrying somebody's accessibility setting.
 *
 * ⚠️ FIRE AND FORGET, ON PURPOSE. The setting has ALREADY applied locally and the screen has already
 * re-rendered; the person can see it worked. Surfacing a failure here would contradict what is on screen. It is
 * registered in OUTBOX_KEYS, so offline it queues and replays on reconnect — and before the migration the API
 * answers {pending:true}, which is equally nothing to report.
 *
 * ⚠️ DEBOUNCED PER KIND, not globally. Someone trying three themes to see which they like should cost one
 * write; but a theme change must never cancel a pending language change, which one shared timer would do.
 */
/* ⭐ FX-QA1: THE ROW CBPrefs CALLS LIVES BESIDE IT, not in each page's EP. Tasks · Accounts · CRM · Finance · Settings declare an EP of their own
   rows (const EP = {}) and load this file, so avatar.js handed every push to CBPrefs → api('savePrefs') → "no endpoint" — the edition chosen on
   Tasks stayed pending until Employees (a page without core.js) sent it. api() answers this row on every host (epOf); a page never lists it. */
var CB_PREFS_EP = {
  savePrefs: { m: 'PATCH', p: '/api/entities/me/prefs/:kind', ok: '✓' } // b165/b166 · ONE endpoint for both preference sets; params:{kind:"locale"|"ui"}
};
/** the page's row for a name, else core's own (CB_PREFS_EP) — the one lookup api() and apiOnce() share */
function epOf(key) {
  return (typeof EP !== 'undefined' && EP[key]) || CB_PREFS_EP[key] || null;
}
var CBPrefs = (function () {
  var timers = {};
  return {
    /* done (optional, FX-UX2): called with the server's answer — {ok:true} landed · {queued:true} offline · null refused/failed; the avatar's pending mark reads it */
    push: function (kind, obj, done) {
      /* ⚠️ CU3: the server merges (RFC 7386, CU2) — a key not sent is KEPT. CBLocale.push sends prefs(), which leaves out
         cleared keys, so "use my device's zone" / "regional default" never reached the server. snapshot() is the same
         keys with every clear as '' (= remove). Until the locale engine sends snapshot() itself, this door does. */
      if (kind === 'locale' && typeof window !== 'undefined' && window.CBLocale && typeof window.CBLocale.snapshot === 'function') {
        try {
          obj = window.CBLocale.snapshot();
        } catch (_) {}
      }
      if (timers[kind]) {
        try {
          clearTimeout(timers[kind]);
        } catch (_) {}
      }
      timers[kind] = setTimeout(function () {
        try {
          if (typeof api !== 'function' || !(typeof SESSION !== 'undefined' && SESSION && SESSION.token)) return;
          api('savePrefs', { params: { kind: kind }, body: obj || {} }).then(
            function (reply) {
              if (done) done(reply);
            },
            function () {
              if (done) done(null);
            }
          );
        } catch (_) {}
      }, 400);
    }
  };
})();
try {
  if (typeof window !== 'undefined') window.CBPrefs = CBPrefs;
} catch (_) {}

const OUTBOX_KEYS = new Set([
  'advance',
  'status',
  'setPriority',
  'custFlag',
  'star',
  'voidChit',
  'markUnread',
  'archive',
  'unarchive',
  'restore',
  'delChit',
  'purgeChit',
  'assignBulk',
  'actorBreak',
  'actorStatus',
  'actorPinReset',
  'actorDelegate',
  'assign',
  'unassign',
  'actorEdit',
  'resolveDispute',
  /* ⚠⚠ KEYED BY NAME, NOT BY PATH. `profileSave` was retired in favour of `profilePut` (one endpoint, one
     name — e2e/ep-aliases.cjs); had the survivor not been added here, that write would have quietly stopped
     being queued when the counter is offline, with nothing anywhere to say so. */
  'saveProfile',
  'shopStatus',
  'saveSettings',
  'vaultSave',
  'profilePut',
  'savePrefs', // b165 — an idempotent merge-patch (CU2) of one's own preferences; the caller ignores the body
  'connRespond',
  'netApprove',
  'netDecline',
  'netSuspend',
  'netResume',
  'netDisconnect',
  'supDel',
  'supPatch',
  'prodDel',
  'prodEdit',
  'prodBulkCategories', // QA-130 a bulk job step: add or remove a category per product; each product answers done, unchanged or refused, so a repeat changes nothing
  'prodStatusBulk', // a bulk job step: sets a status and answers the ids it missed; a repeat only re-stamps who and when
  'folderRename',
  'folderDelete',
  'folderMove',
  'connectorDelete',
  'connectorConnToggle',
  'readinessGather',
  'readinessVerify',
  'assistResolve',
  'assistPublish',
  'netDesignPut' // b111 — whole-document upsert, idempotent → safe to queue + replay offline
]);

/* ══ A PRODUCT'S CATEGORIES ══════════════════════════════════════════════════════════════════════════════════
 * ⭐⭐ A PRODUCT BELONGS TO MANY CATEGORIES (Athi, 2026-08-16: *"same product must be able to attach under
 * multiple category, and search should show the same"*). Rice is Grains AND Staples; a saree is Silk AND
 * Wedding. One slot was the wrong model and forced a false choice at the moment of authoring.
 *
 * ── ONE READER, BECAUSE THERE ARE TWO SHAPES IN THE DATA ───────────────────────────────────────────────────────
 * ⚠️ Products authored before this carry `category` (one id) + `category_name`. Products authored after carry
 * `categories` (ids) + `category_names`. BOTH EXIST IN LIVE DATA and always will — item_data is free-form jsonb,
 * so there is no migration that can sweep every historical row, and a counterparty's copy is not ours to edit.
 * Everything therefore reads through `catgIdsOf`, and NOTHING reads `d.category` directly. A second place that
 * knows the legacy shape is a second place that will forget it.
 *
 * ⚠️ WRITES ONLY EVER EMIT THE NEW SHAPE, and delete the old keys as they go — so a row upgrades the first time
 * it is saved, without a migration and without a moment where both shapes are true of the same product.
 */
function catgIdsOf(d) {
  d = d || {};
  if (Array.isArray(d.categories)) return d.categories.map(String).filter(Boolean);
  if (d.category) return [String(d.category)]; // legacy single — read, never written again
  return [];
}
/**
 * ⭐ A CATEGORY'S ANCESTORS COUNT TOO. Athi, 2026-09-05: "I applied 5% for the top category — it should reflect the
 * categories underneath … same way offer as well?" — yes. An offer scoped to "Fruits & Vegetables" must fire on a
 * product in "Dried Fruits". The engine matches ids exactly and stays pure, so the LINE carries its categories AND
 * their ancestors (rules.parent, up the tree). One helper for compose, the product preview and the storefront cart.
 */
/* ⚠ module-scoped: the guard is about the one READ in flight, not about any one caller */
var _catgKick = false;
function catgWithAncestors(ids) {
  var out = (ids || []).map(String).filter(Boolean),
    seen = {};
  out.forEach(function (id) {
    seen[id] = true;
  });
  var cats = typeof cbDefsCached === 'function' ? cbDefsCached('category') : null;
  if (cats === null) {
    /**
     * ── ⚠️⚠️⚠️ THIS RAN 1,600 TIMES IN ONE PAINT ─────────────────────────────────────────────────────────
     *
     * Athi, 2026-09-13, reading the Speed table: *"why do you need to fetch category for every attempt, again
     * 3 times?"* — the answer turned out to be far worse than three. Traced live: this function is called
     * ONCE PER PRODUCT PER OFFER from `offersForProduct` → `prodDeals`, so on a 500-item shelf it ran over
     * sixteen hundred times in a single paint, and every one of them:
     *
     *   · called `cbDefsLive` again
     *   · attached ANOTHER `.then` that repaints the basket total and two whole product sections
     *
     * ⚠⚠ SO THE MOMENT THE CATEGORY SHELF LANDED, SIXTEEN HUNDRED REPAINTS WERE QUEUED. The cache absorbed
     * nearly all the fetches — which is exactly why this never looked like a bug — but the repaint storm was
     * real, and it is the kind of cost that shows up as "the catalogue feels slow" and never as an error.
     *
     * ⭐ THE READ IS A ONE-TIME EVENT, SO IT IS KICKED ONCE. A flag, not a cache check: `cbDefsCached` stays
     * null for the whole time the request is in flight, which is precisely the window in which every one of
     * those calls arrives.
     */
    if (!_catgKick && typeof cbDefsLive === 'function') {
      _catgKick = true;
      cbDefsLive('category')
        .then(function () {
          try {
            if (typeof ccRenderTotal === 'function') ccRenderTotal();
          } catch (_) {}
          try {
            if (typeof prodRepaintSection === 'function') {
              prodRepaintSection('offers');
              prodRepaintSection('pricing');
            }
          } catch (_) {}
        })
        /* ⚠ cleared either way: a failed read must not leave the shelf permanently un-askable */
        .catch(function () {})
        .then(function () {
          _catgKick = false;
        });
    }
    return out;
  }
  if (!cats.length) return out;
  /* ⭐ THE WALK IS catalogue-lines.js's cbCatgAncestors (2026-09-28) — one walker for the app and the storefront, told
     how this store reads a category. Where catalogue-lines is not loaded (a bare test of this file) the ids stay as
     they are, which is what cart.js already does outside the app — never a second copy of the walk. */
  if (typeof cbCatgAncestors !== 'function') return out;
  return cbCatgAncestors(
    out,
    cats,
    function (x) {
      return x && x.rules && x.rules.parent;
    },
    function (x) {
      return x && (x.definition_id || x.id);
    }
  );
}
/** The travelling names, positionally aligned with catgIdsOf. Used only where an id cannot be resolved. */
function catgNamesOf(d) {
  d = d || {};
  if (Array.isArray(d.category_names)) return d.category_names.map(String);
  if (d.category_name) return [String(d.category_name)];
  return [];
}
/**
 * Write `ids` onto an item_data object, in place, and return it.
 *
 * ⚠️ BOTH THE IDS AND THE NAMES, for the reason that has not changed: the id is MY reference (rename in the
 * Categories panel and every product of mine follows), the names are a VALUE copy for a counterparty who cannot
 * resolve my definition_ids and never will — [[reference-cb-core-principle]]. The copy is deliberately not kept
 * in step with a later rename.
 */
function catgSetOn(d, ids) {
  d = d || {};
  var live = typeof _CATG !== 'undefined' && _CATG ? _CATG : [];
  /* ⚠️ SNAPSHOT BEFORE DELETING. My first cut deleted the legacy keys and then tried to read them for the
     unresolved-name fallback below — so the fallback silently found nothing and every unresolved id would have
     been relabelled as its own uuid. Read what is there, THEN clear it. */
  var wasIds = catgIdsOf(d),
    wasNames = catgNamesOf(d);
  var clean = [],
    seen = {};
  (ids || []).forEach(function (id) {
    id = String(id || '').trim();
    if (id && !seen[id]) {
      seen[id] = 1;
      clean.push(id);
    }
  });
  delete d.category;
  delete d.category_name; // the legacy pair never survives a save
  if (!clean.length) {
    delete d.categories;
    delete d.category_names;
    return d;
  }
  d.categories = clean;
  d.category_names = clean.map(function (id) {
    var c = live.filter(function (x) {
      return x.id === id;
    })[0];
    /* ⚠️ An id we cannot resolve keeps whatever name it already travelled with, rather than being relabelled as
       its own uuid. Losing the word is worse than holding a slightly stale one. */
    if (c) return c.name;
    var i = wasIds.indexOf(id);
    return i >= 0 && wasNames[i] ? wasNames[i] : id;
  });
  return d;
}

/* ══ THE LIVE CATEGORY SHELF ═════════════════════════════════════════════════════════════════════════════════
 * ⚠️ IT LIVES IN core.js AND NOT IN cap-catalogue.js. Both compose (app.html, always loaded) and the item form
 * (cap-catalogue.js, lazy) need it, and a loader behind a lazy load is a loader half the callers cannot reach.
 * ONE owner, one cache — the alternative is compose fetching its own copy and the two drifting.
 */
/**
 * ⭐ ONE LIVE-DEFINITION LOADER, KEYED BY KIND — extracted 2026-08-17 when order models became the second
 * caller, which is exactly the case the note below anticipated. Categories and order models want the same
 * thing: the live definitions of one kind, cached, with one in-flight request no matter how many forms open.
 * ⚠️ Returns the RAW definitions. Each caller shapes what it needs — a category wants {id,name}, an order model
 * wants its sub-kind and rules — because a shared loader that also imposed a shape would just be two functions
 * with a shared cache and a lie in the middle.
 */
var _DEFS = {}; // kind → raw definitions, as last read
var _defsReq = {}; // kind → in-flight promise
/**
 * ── ⭐⭐⭐ EVERY KIND ASKED FOR IN ONE TICK GOES IN ONE JOURNEY ───────────────────────────────────────────────
 *
 * Athi, 2026-09-13: *"batch the defList calls into one."*
 *
 * ⭐⭐ THE MEASUREMENT SAID WHERE TO CUT. With CB_TRIPS on, opening the Catalogue made SEVEN calls to this one
 * route — category, pricing, tax, ordermodel, offer and two repeats — each costing about **65 ms inside the
 * server** for **273–642 ms of wall time**, and ZERO database round trips. Roughly 2.7 seconds spent almost
 * entirely on the wire for less than half a second of work. ⚠️ Without the split I would have gone looking at
 * the SQL and saved nothing: the query was never the problem, the number of journeys was.
 *
 * ⭐ SO THE KINDS ARE COLLECTED FOR ONE TICK AND SENT TOGETHER. Nothing else changes: the callers still ask
 * for one kind and still get one kind back, the per-kind cache is still the per-kind cache, and a caller that
 * asks later still gets its own request. The batching lives entirely in here.
 *
 * ⚠️ A MICROTASK, NOT A TIMER. `Promise.resolve().then()` fires after the current synchronous run and before
 * the browser paints, so a screen whose render path asks for five kinds in a row gets all five in one call
 * with no delay a person could perceive. A setTimeout would add latency to the very thing being sped up.
 *
 * ⚠️ AND A KIND WITH NOTHING ON THE SHELF MUST BE CACHED AS EMPTY. The response only contains rows for kinds
 * that HAVE definitions, so splitting it by row alone would leave the empty kinds looking unfetched — and
 * every render would ask again forever. Each requested kind is seeded to [] before the split.
 */
var _defsQueue = []; // kinds waiting for the next tick
var _defsFlush = null; // the promise that will carry them

/**
 * ⚠️ THE WINDOW STAYS OPEN UNTIL THE ANSWER LANDS. Clearing `_defsFlush` at the START of the flush meant a
 * caller arriving one tick later — while the request was still in the air — opened a SECOND batch for a kind
 * already being fetched. On a screen that paints in several passes that is how one shelf gets asked for two
 * and three times, which is the shape Athi spotted in the table.
 */
function cbDefsFlush() {
  var kinds = _defsQueue.slice();
  _defsQueue = [];
  if (!kinds.length) {
    _defsFlush = null;
    return Promise.resolve({});
  }
  return (
    api('defList', { query: { kind: kinds.join(','), status: 'live' } })
      .then(function (reply) {
        var by = {};
        kinds.forEach(function (item) {
          by[item] = [];
        });
        ((reply && reply.definitions) || []).forEach(function (item) {
          var k = item && item.kind;
          if (by[k]) by[k].push(item);
        });
        return by;
      })
      /* whether it answered or failed, the window is closed and the next asker opens a new one */
      .then(
        function (by) {
          _defsFlush = null;
          return by;
        },
        function (e) {
          _defsFlush = null;
          throw e;
        }
      )
  );
}

function cbDefsLive(kind, force) {
  if (!force && _DEFS[kind]) return Promise.resolve(_DEFS[kind]);
  if (!force && _defsReq[kind]) return _defsReq[kind];
  if (typeof api !== 'function') return Promise.resolve([]);

  /**
   * ⚠️⚠️ A FORCED REFRESH MUST NEVER JOIN A BATCH. `force` is what cap-definitions.js calls the moment a
   * definition is made live, and its whole job is to return data newer than the change. A flush scheduled a
   * microtask earlier was composed BEFORE that change — joining it would hand back the stale shelf while
   * looking like a refresh, which is worse than not refreshing at all because the caller then repaints and
   * believes it.
   *
   * ⭐ It is also the rare path — once, after an edit — so it costs one journey and saves the whole class of
   * bug that "author a slab, make it live, and the dropdown still says none" belongs to.
   */
  if (force) {
    _defsReq[kind] = api('defList', { query: { kind: kind, status: 'live' } })
      .then(function (reply) {
        _DEFS[kind] = (reply && reply.definitions) || [];
        _defsReq[kind] = null;
        return _DEFS[kind];
      })
      .catch(function () {
        _defsReq[kind] = null;
        return _DEFS[kind] || [];
      });
    return _defsReq[kind];
  }

  if (_defsQueue.indexOf(kind) < 0) _defsQueue.push(kind);
  if (!_defsFlush) _defsFlush = Promise.resolve().then(cbDefsFlush);
  var mine = _defsFlush;

  _defsReq[kind] = mine
    .then(function (by) {
      _DEFS[kind] = (by && by[kind]) || [];
      _defsReq[kind] = null;
      return _DEFS[kind];
    })
    .catch(function () {
      _defsReq[kind] = null;
      return _DEFS[kind] || [];
    });
  return _defsReq[kind];
}
/** Synchronous read of whatever was last loaded — for render paths that cannot await. */
function cbDefsCached(kind) {
  return _DEFS[kind] || null;
}

var _CATG = null; // [{id,name}] — the live shelf, as last read
var _CATG_AT = 0; // when it was last read — see catgChipsHTML
var _catgReq = null; // in-flight promise, so a form opening twice does not fetch twice
/**
 * ── ⭐⭐ CREATING A CATEGORY, BESIDE THE CACHE IT UPDATES ───────────────────────────────────────────────────────
 *
 * Moved here from cap-catalogue.js when the six-step wizard was deleted (Athi, 2026-09-03: "delete the old
 * wizard"). They were the only two things in that file the rest of the app still called.
 *
 * ⭐ AND THIS IS WHERE THEY BELONGED ALL ALONG. Both read and refresh `_CATG` / `cbCatgLive`, which live right
 * here — so sitting in a LAZY module meant the product form had to `ensureCap('catalogue')` before it could
 * offer "new category", and the old comment said exactly why that was dangerous: *"calling it directly works
 * only if you happened to open the wizard earlier in the session — the worst kind of bug, because it works when
 * you test it and not when someone else does."* core.js is eager, so the dance is gone with the wizard.
 */
async function cbCatgCreate(name) {
  name = String(name || '').trim();
  if (name.length < 2) throw new Error('Give the category a name of at least 2 characters.');
  var dup = (_CATG || []).filter(function (item) {
    return item.name.toLowerCase() === name.toLowerCase();
  })[0];
  if (dup) return dup; // ⚠️ Silently reusing the existing one beats minting a second shelf with one name.
  var reply = await api('defAdd', { body: { kind: 'category', sub_kind: null, name: name, note: '', rules: {} } });
  var id = reply && (reply.definition_id || (reply.definition && reply.definition.definition_id));
  if (!id) throw new Error('Created, but the server did not return an id.');
  await api('defSave', { params: { id: id }, body: { status: 'live' } });
  await cbCatgLive(true);
  return { id: id, name: name };
}

function cbCatgAskNew(onDone) {
  if (typeof promptAsk !== 'function') return;
  promptAsk(
    'New category',
    {
      label: 'What is it called?',
      placeholder: 'e.g. Fasteners',
      maxlength: 60,
      okLabel: 'Create',
      hint: 'It goes on the shelf as <b>live</b>, so you can use it straight away. Rename it any time under ' + 'Definitions — your products follow the rename.'
    },
    function (v) {
      cbCatgCreate(v)
        .then(function (reply) {
          toast('“' + reply.name + '” added ✓');
          if (onDone) onDone(reply);
        })
        .catch(function (e) {
          toast((e && e.message) || 'Could not create that.');
        });
    }
  );
}

function cbCatgLive(force) {
  if (!force && _CATG) return Promise.resolve(_CATG);
  if (!force && _catgReq) return _catgReq;
  if (typeof api !== 'function') return Promise.resolve([]);
  _catgReq = cbDefsLive('category', force)
    .then(function (defs) {
      _CATG = (defs || []).map(function (item) {
        return { id: item.definition_id, name: item.name };
      });
      /* ⭐ WHEN it was read, so a caller can tell whether re-reading it could possibly say anything new */
      _CATG_AT = Date.now();
      _catgReq = null;
      return _CATG;
    })
    /**
     * ⚠️ FAILING SOFT IS CORRECT HERE, and it is worth saying why since the opposite rule applies at the mint.
     * A category is a way of FINDING a product; losing it costs a filter, not a fact. An item saved without one
     * is Uncategorised — visible, chip-counted, fixable. Refusing to let someone add an item because a
     * classification shelf could not be read would be the tail wagging the dog.
     */
    .catch(function () {
      _catgReq = null;
      return _CATG || [];
    });
  return _catgReq;
}

/* ══ ORDER MODELS, ADOPTED BY REFERENCE (backlog 17) ═════════════════════════════════════════════════════════
 * A definition wraps one of cart-ui's MODELS with a NAME — "Carton of 6" = `pack, step 6` — so a product adopts
 * the name instead of the rule being retyped on fifty items. The product stores `order = { ref:<definition_id> }`
 * and NEVER the values, so a correction to the definition reaches every product that adopted it.
 *
 * ⚠️⚠️ THAT PROPAGATION IS THE WHOLE RISK, AND IT IS WHY THE MINT FREEZES. Changing "Carton of 6" to 12 moves
 * every adopting product, which is either exactly what you want or a catastrophe. So the rule is two-speed:
 *   browsing / editing → resolve LIVE, so a correction propagates
 *   at the mint        → FREEZE the resolved values onto the chit, so a later change cannot rewrite what was
 *                        agreed (POST /api/definitions/freeze already returns exactly that snapshot)
 */
function cbOrderLive(force) {
  return cbDefsLive('ordermodel', force);
}
/**
 * Resolve a stored `order` into the flat declaration cart-ui reads. Synchronous, because every render path that
 * needs it is synchronous; it reads the cache cbOrderLive() fills.
 *
 * ⚠️⚠️ AN UNRESOLVED REFERENCE MUST NOT QUIETLY BECOME `count`. cart-ui defaults an unknown model to `count`,
 * so returning a bare `{ref}` would silently turn "Carton of 6" into "6 each" — the same number, a different
 * promise, and no error anywhere. Instead the marker is carried out so callers can REFUSE to quantify and say
 * the model could not be read. Losing a category costs a filter; losing an order model would change what was
 * ordered, and those two failures do not deserve the same softness.
 */
function cbOrderDecl(order) {
  var o = order || {};
  if (!o.ref) return o; // inline declaration — unchanged, still supported
  var defs = cbDefsCached('ordermodel');
  if (!defs) {
    cbOrderLive();
    return { ref: o.ref, unresolved: 'loading' };
  }
  var d = null;
  for (var index = 0; index < defs.length; index++)
    if (defs[index].definition_id === o.ref) {
      d = defs[index];
      break;
    }
  /* ⚠️ A RETIRED definition still resolves if the server returned it — "do not offer this any more" is not
     "this never happened". Only a genuinely missing one is unresolved. */
  if (!d) return { ref: o.ref, unresolved: 'missing' };
  var out = { ref: o.ref, model: d.sub, name: d.name };
  var rules = d.rules || {};
  for (var k in rules) if (Object.prototype.hasOwnProperty.call(rules, k) && out[k] === undefined) out[k] = rules[k];
  return out;
}

/**
 * ⭐ THE MAILBOX BELL, CLIENT SIDE (Server-Sent Events). Athi, 2026-09-04: "why can't we notify like a mailbox?"
 * One open stream per signed-in tab (POST /api/events/ticket with the token → GET /api/events/stream?t=ticket; the
 * token never rides the URL). On an arrival the API sends { kind, id, who }: the bell badge and the list on screen
 * refresh AT ONCE, silently, and nothing else repaints. While the stream is up the 20-second timer stretches to
 * two minutes as a fallback; when the stream drops it comes back to 20 s and the client re-tickets with backoff.
 */
var _push = { es: null, up: false, backoff: 5000, timer: null };
function cbPushUp() {
  return !!_push.up;
}
function cbPushStart() {
  if (_push.es || !window.EventSource || !SESSION.token || (typeof CFG !== 'undefined' && CFG.MODE === 'demo')) return;
  api('eventsTicket')
    .then(function (reply) {
      if (!reply || !reply.ticket || !SESSION.token || _push.es) return;
      var base = (typeof CFG !== 'undefined' && CFG.API_BASE) || '';
      var node = new EventSource(base + '/api/events/stream?t=' + encodeURIComponent(reply.ticket));
      _push.es = node;
      /**
       * ── ⭐⭐⭐ WITH THE BELL UP, THE POLL IS A SAFETY NET AND NOT A CLOCK ────────────────────────────────
       *
       * Athi, 2026-09-13, reading the Speed table: *"every attempt, notification takes more time — are we
       * really calling notification for every request, or every browsing of the data item in the catalogue?"*
       *
       * ⭐ MEASURED FIRST, AND HE IS HALF RIGHT. It is NOT per request and not per browse: it is a background
       * clock. But it was still ticking every 120 s WITH THE PUSH STREAM CONNECTED — and the stream already
       * calls loadNotifs() on every arrival (cbPushArrived). So a poll that exists to catch what push missed
       * was running thirty times an hour to catch nothing, at 700–1000 ms a time.
       *
       * ⚠️ AND EACH ONE IS EXPENSIVE FOR A BADGE. /api/notifications is two round trips — a plain query for
       * the dispute handler, then a withEntity transaction — over a DISTINCT ON join of state_log, chit_status
       * and chit_header, returning up to thirty full rows, to keep ONE NUMBER current.
       *
       * ⭐ TEN MINUTES. Long enough that it costs nothing, short enough to catch a stream that has died
       * without saying so — which is the only reason it exists. If the stream errors, onerror below puts it
       * straight back to 20 s, so a real outage is still covered in one tick.
       */
      node.addEventListener('hello', function () {
        _push.up = true;
        _push.backoff = 5000;
        if (typeof _autoRefreshTimer !== 'undefined' && _autoRefreshTimer) {
          clearInterval(_autoRefreshTimer);
          _autoRefreshTimer = setInterval(autoRefresh, 600 * 1000);
        }
      });
      node.addEventListener('cb', function (ev) {
        var d = {};
        try {
          d = JSON.parse(ev.data || '{}');
        } catch (_) {}
        cbPushArrived(d);
      });
      node.onerror = function () {
        try {
          node.close();
        } catch (_) {}
        _push.es = null;
        _push.up = false;
        if (typeof _autoRefreshTimer !== 'undefined' && _autoRefreshTimer) {
          clearInterval(_autoRefreshTimer);
          _autoRefreshTimer = setInterval(autoRefresh, 20 * 1000);
        }
        if (!SESSION.token) return;
        clearTimeout(_push.timer);
        _push.timer = setTimeout(cbPushStart, _push.backoff);
        _push.backoff = Math.min(_push.backoff * 2, 60000);
      };
    })
    .catch(function () {
      clearTimeout(_push.timer);
      _push.timer = setTimeout(cbPushStart, _push.backoff);
      _push.backoff = Math.min(_push.backoff * 2, 60000);
    });
}
/**
 * ── ⭐⭐ WHICH IDENTITY AM I, AS AN ID ────────────────────────────────────────────────────────────────────
 *
 * ⚠️ NAMES ARE FOR READING, IDS ARE FOR DECIDING. "Is this finding mine to retest?" and "did I just do this
 * myself?" are both answered by comparing against the server’s `identity.identity_id`, and a display name
 * cannot answer either — two people called Athi would both be told to go and verify one fix.
 *
 * ⚠️ THREE SOURCES BECAUSE THE PROFILE IS LAZY. `UI._me` is the loaded profile and the right answer when it
 * is there; before it loads, the JWT already carries the same id — `SESSION.actorId` for a co-assist login,
 * and for an entity login `SESSION.entityId`, which setSession derives from `identity_id` itself.
 * ⚠️ ORDER MATTERS: for a CO-ASSIST, entityId is the parent entity and not this person, so actorId comes
 * first. Falling through to entityId there would tell every co-assist that the entity’s findings were theirs.
 */
function cbMeId() {
  try {
    if (typeof UI !== 'undefined' && UI && UI._me && UI._me.identity_id) return String(UI._me.identity_id);
  } catch (_) {}
  try {
    if (typeof SESSION !== 'undefined' && SESSION) {
      if (SESSION.actorId) return String(SESSION.actorId);
      if (SESSION.entityId) return String(SESSION.entityId);
    }
  } catch (_) {}
  return '';
}
function cbPushStop() {
  clearTimeout(_push.timer);
  if (_push.es) {
    try {
      _push.es.close();
    } catch (_) {}
  }
  _push.es = null;
  _push.up = false;
}
/* the screen an arrival touches: the list when a list screen is showing, and (RAIL-119) the chit OPEN on screen, which is read again when the far side's answer for it arrives (status, message, dispute, proposal) — never over a form being typed in */
function cbPushRefreshScreen(arrival) {
  try {
    var listNav = ['task', 'order', 'drafts', 'trash', 'archive', 'intake', 'messages'];
    if (typeof UI !== 'undefined' && listNav.indexOf(UI.nav) >= 0 && !(UI.detail || UI.mdetail) && typeof loadList === 'function') loadList(true);
  } catch (_) {}
  try {
    if (typeof chitOnReturn === 'function') chitOnReturn(arrival);
  } catch (e) {
    console.warn('chitOnReturn: the open chit was not read again', e && e.message); /* F11: log, never swallow; the person is not told (the next open reads it) */
  }
}
/** something arrived: refresh only what it touches — the bell badge, and the list on screen if it is a list screen */
function cbPushArrived(d) {
  /* ⚠ forced: something genuinely arrived, so the badge must move even if one was fetched a second ago */
  try {
    if (typeof loadNotifs === 'function') loadNotifs(true);
  } catch (_) {}
  cbPushRefreshScreen(d);
  /* ⭐ a books answer is not a new chit: it repaints the Books block of the chit it names, and says nothing else (2026-09-07) */
  try {
    if (typeof booksOnBell === 'function' && d && (d.kind === 'books' || d.note === 'books')) {
      booksOnBell(d);
      return;
    }
  } catch (_) {}
  try {
    if (typeof booksOnBell === 'function') booksOnBell(d);
  } catch (_) {}
  /**
   * ── ⭐⭐⭐ THE REFERENCE SHELVES DROP WHEN THE SERVER SAYS THEY MOVED ─────────────────────────────────────
   *
   * Athi, 2026-09-13: *"anything static like profile info and so on, why do we read it again and again? Can’t
   * we keep it in memory, and if there is a change can’t we push to refresh — this way you don’t need to read
   * profile at all?"*
   *
   * ⚠️⚠️ THE PUSH WAS ALREADY BEING SENT AND THIS APP WAS IGNORING IT. `routes/definitions.js` has emitted
   * `{kind:'shop'}` on every create and retire since the TV work — the counter and the shop screen listen and
   * refresh at once. The main app, holding the SAME shelves in `_DEFS`, `_CATG` and `UI._ctOffers`, heard the
   * event and did nothing with it. Half a push system is not a push system; it is a cache with a rumour.
   *
   * ⭐ SO THE ANSWER TO HIS QUESTION IS YES, AND THIS IS THE PIECE THAT MAKES IT SAFE. Caching harder without
   * this is only caching staler — a shelf held longer is a shelf wrong for longer.
   *
   * ⚠️ THE CACHES ARE DROPPED, NOT REFETCHED. Nobody may be looking at the catalogue; refetching five shelves
   * on every price change in another tab is the round trips back by a different door. The next reader asks,
   * and by then it is one batched call.
   */
  try {
    if (d && d.kind === 'shop') {
      if (typeof _DEFS !== 'undefined')
        for (var k in _DEFS) {
          if (Object.prototype.hasOwnProperty.call(_DEFS, k)) delete _DEFS[k];
        }
      if (typeof _CATG !== 'undefined') _CATG = null;
      if (typeof UI !== 'undefined') {
        UI._ctOffers = undefined;
        UI._party = undefined;
        UI._prodOffers = null;
      }
      /* only the screen actually showing them repaints — everything else picks it up when it is next opened */
      if (typeof UI !== 'undefined' && UI.nav === 'catalogue' && typeof paintProdList === 'function') paintProdList();
      return;
    }
  } catch (_) {}
  /**
   * ── ⭐⭐⭐ SOMEBODY FOUND SOMETHING, OR ANSWERED WHAT YOU FOUND ───────────────────────────────────────────
   *
   * Athi, 2026-09-13: *"do we have a mechanism of getting the notification when someone raises an incident or
   * a case?"* and *"a message back stating that this issue has been fixed — that feedback loop is not there."*
   *
   * ⭐ TWO DIRECTIONS ON ONE EVENT. Outbound: a finding was raised, and the other testers should not spend the
   * afternoon finding it again. Inbound: something YOU raised has moved, and `for` names you — that one is
   * spoken out loud even with the lab shut, because it is the only message on this pipe that asks you to act.
   *
   * ⚠️ NEVER YOUR OWN. events.emit reaches every connection of the entity including the tab that just pressed
   * the button; telling somebody what they have this second done is how a notification stops being read.
   *
   * ⚠️ AND THE EVENT CARRIES NO FINDING — see lib/testnews.js. The board REREADS through the ordinary
   * RLS-guarded endpoint, so what a person sees is what the server would answer, not what a message claimed.
   */
  try {
    if (d && d.kind === 'test') {
      var meId = cbMeId();
      if (d.by && meId && String(d.by) === String(meId)) return;
      var lab = typeof CBTEST !== 'undefined' && CBTEST.on;
      /* ⚠️ THE BOARD REREADS, IT DOES NOT PATCH ITSELF FROM THE MESSAGE. The event deliberately carries no
         finding (lib/testnews.js), so what appears is what the server would answer through RLS — never what
         a message claimed. One refresh, and it only touches the lists that are actually loaded. */
      try {
        if (lab && typeof testNewsRefresh === 'function') testNewsRefresh(d.what);
      } catch (_) {}
      /* ⭐ the badge moves even with the lab SHUT — that is the whole point of it being on the chip */
      try {
        if (typeof testWaitingLoad === 'function') testWaitingLoad();
      } catch (_) {}
      var what = d.what === 'requirement' ? tx('requirement') : d.what === 'case' ? tx('case') : tx('incident');
      var ref = d.ref ? ' ' + d.ref : '';
      var byWho = d.who ? ' \u00b7 ' + d.who : '';
      /* ⭐ MINE TO RETEST is a different sentence from somebody else raising something, and it says what to do */
      if (d.for && meId && String(d.for) === String(meId)) {
        if (typeof toast === 'function') toast(tx('Your') + ' ' + what + ref + ' \u2192 ' + (d.state || '') + ' \u2014 ' + tx('retest it') + byWho);
        return;
      }
      if (lab && typeof toast === 'function') {
        toast((d.state === 'raised' ? tx('New') : tx('Updated')) + ' ' + what + ref + byWho);
      }
      return;
    }
  } catch (_) {}
  /**
   * ⚠️ AND ONLY A CHIT SAYS "New chit". Every kind this function did not recognise fell through to this toast,
   * so changing an offer announced a chit that did not exist — a notification that is WRONG is worse than one
   * that is missing, because the reader goes looking.
   */
  try {
    if (typeof toast === 'function' && d && (!d.kind || d.kind === 'chit' || d.kind === 'capture')) {
      var who = d && d.who ? ' · ' + d.who : '';
      toast(d && d.kind === 'capture' ? tx('New message') + who : tx('New chit') + who);
    }
  } catch (_) {}
}
/**
 * ⭐ A REPAINT MUST NOT MOVE THE PAGE. Athi, 2026-09-04: "when I select or unselect, the screen jumps to the top —
 * that is the behaviour I am seeing in many places". A pane painter rebuilds its HTML and the browser hands back a
 * fresh scroll box at 0; the write underneath was fine, the repaint was too broad. scrollKeep() notes every scrolled
 * box (and the window) BEFORE the paint and puts them back AFTER, matched by id, then testid, then tag.class + ordinal.
 *   var k = scrollKeep(); el.innerHTML = html; k();
 * The restore runs at once and again on the next frame, for painters that finish asynchronously.
 */
function scrollKeep(root) {
  var saved = [];
  try {
    (root || document).querySelectorAll('*').forEach(function (el) {
      if (el.scrollTop > 0 || el.scrollLeft > 0) saved.push({ key: _scrollKeyOf(el), top: el.scrollTop, left: el.scrollLeft });
    });
  } catch (_) {}
  var wy = window.scrollY || 0,
    wx = window.scrollX || 0;
  return function () {
    var run = function () {
      saved.forEach(function (item) {
        var el = _scrollFind(item.key);
        if (el) {
          el.scrollTop = item.top;
          el.scrollLeft = item.left;
        }
      });
      if (wy || wx) window.scrollTo(wx, wy);
    };
    run();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  };
}
function _scrollKeyOf(el) {
  if (el.id) return '#' + el.id;
  var t = el.getAttribute && el.getAttribute('data-testid');
  if (t) return '[data-testid="' + t + '"]';
  var cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).join('.') : '';
  var sel = el.tagName.toLowerCase() + (cls ? '.' + cls : '');
  var idx = 0;
  try {
    idx = Array.prototype.indexOf.call(document.querySelectorAll(sel), el);
  } catch (_) {
    sel = el.tagName.toLowerCase();
    idx = Array.prototype.indexOf.call(document.querySelectorAll(sel), el);
  }
  return sel + '@' + idx;
}
function _scrollFind(key) {
  try {
    var at = key.lastIndexOf('@');
    if (key[0] === '#' || key[0] === '[' || at < 0) return document.querySelector(key);
    return document.querySelectorAll(key.slice(0, at))[Number(key.slice(at + 1))] || null;
  } catch (_) {
    return null;
  }
}
/**
 * ── ⭐⭐⭐ THE ERRORS THE PAGE THREW, KEPT ────────────────────────────────────────────────────────────────────
 *
 * ⚠️ A ReferenceError in a paint function is the exact fault that hid the Raised tab for a day: the screen
 * shows something plausible and the only trace is in a console nobody has open. A tester is not going to
 * press F12. So the page keeps its own last twenty, and they ride along on an incident.
 *
 * ⚠️ ALWAYS ON, unlike the call log — twenty short strings cost nothing, and the whole value is having them
 * ALREADY when something goes wrong. A recorder you have to switch on before the bug is a recorder that
 * misses the bug.
 */
/**
 * ── ⚠️⚠️ ONE OWNER FOR THE VISIT COUNTER ────────────────────────────────────────────────────────────────────
 *
 * `guard-static` caught this the same night I wrote it: *"CBNAV is assigned by app.html AND core.js —
 * whichever loads last wins."* Two files writing one global is the shape that has bitten this codebase
 * twice, and the fact that here it is two writes of the same VALUE rather than two definitions of a
 * function does not make it a different shape — it makes it the same shape not biting yet.
 *
 * ⭐ So the rule lives in ONE function and both callers call it. The recorder calls it because it fires
 * before a screen’s own load; the screen stamper calls it because a screen that asks the server for
 * nothing still counts as a visit. Whichever notices first advances it, and the other sees it has happened.
 */
function cbVisitTick(nav) {
  if (nav == null) return window.CBGEN || 0;
  if (window.CBNAV !== nav) {
    window.CBNAV = nav;
    window.CBGEN = (window.CBGEN || 0) + 1;
  }
  return window.CBGEN;
}

(function () {
  if (window.CBERRS) return;
  window.CBERRS = [];
  var keep = function (what, where) {
    try {
      window.CBERRS.unshift({ at: Date.now(), what: String(what || '').slice(0, 400), where: String(where || '').slice(0, 200) });
      window.CBERRS.length = Math.min(window.CBERRS.length, 20);
    } catch (_) {}
  };
  window.addEventListener('error', function (e) {
    keep((e && e.message) || 'error', ((e && e.filename) || '') + ':' + ((e && e.lineno) || ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    keep((r && (r.message || r)) || 'rejected', 'promise');
  });
  /* ⚠ console.error is WRAPPED, never replaced: swallowing what the page logs would be worse than not
     keeping it, and anything that breaks here must leave the original alone */
  try {
    var ce = console.error;
    console.error = function () {
      try {
        keep(Array.prototype.map.call(arguments, String).join(' '), 'console');
      } catch (_) {}
      return ce.apply(console, arguments);
    };
  } catch (_) {}
})();

/**
 * ── ⭐⭐⭐ TWO IDENTICAL READS IN THE AIR AT ONCE ARE ONE READ ────────────────────────────────────────────────
 *
 * Athi, 2026-09-13, after the definitions batching: *"are we good? now the read reduced? optimised?"* — the
 * honest answer was no, and the measurement said why. One cold boot of the Catalogue, with CB_TRIPS on:
 *
 *     prodList  ×3  {limit:500}   1,847 ms   — FIVE HUNDRED PRODUCTS, FETCHED THREE TIMES
 *
 * The same question, the same answer, three journeys. Three different screens each ask for the shelf as they
 * come up, none of them knows about the others, and none of them should have to.
 *
 * ⭐⭐ SO THE DEDUPE BELONGS HERE, NOT IN THE CALLERS. Every fix in the callers is a fix for one pair of them;
 * this one is a fix for every pair that will ever exist, including the ones added next year. `defList` needed
 * a batcher because its callers ask DIFFERENT questions; `prodList` needs only this, because they ask the
 * same one.
 *
 * ⚠️⚠️ IN FLIGHT ONLY — THIS IS NOT A CACHE. The entry is dropped the moment the answer lands, so the next
 * caller asks the server again and gets today’s truth. A response cache here would silently change what
 * every screen in the product means by "read", and staleness bugs of that kind are unfindable.
 *
 * ⚠️⚠️ READS ONLY. Two POSTs are two intentions even when they look alike — collapsing them would lose a
 * write. Mutations keep the double-fire lock below, which REFUSES the second rather than joining it.
 *
 * ⚠️⚠️ AND EVERY JOINER GETS ITS OWN COPY. Today two calls return two separate object graphs, and callers do
 * things like `UI.prods = r.products` and then edit rows in place. Handing them one shared object would be a
 * new class of bug — one screen’s edit appearing in another — that only shows up when two screens happen to
 * load together, which is the hardest kind to reproduce. A clone costs microseconds against a 600 ms trip.
 */
var _apiInflight = {};

/** an independent copy, so a joiner can never share mutable state with the caller it joined */
function _apiCopy(v) {
  if (v === null || typeof v !== 'object') return v;
  try {
    if (typeof structuredClone === 'function') return structuredClone(v);
  } catch (_) {}
  try {
    return JSON.parse(JSON.stringify(v));
  } catch (_) {}
  /* ⚠ uncloneable (a Blob, a stream): hand back the original rather than fail the call, and never dedupe it
     again — said here because a silent share is exactly what this guard exists to prevent */
  return v;
}

function api(key, opts) {
  var o = opts || {};
  var ep = epOf(key);
  if (!ep || ep.m !== 'GET') return apiOnce(key, opts);
  /* NET-42: { fresh: true } never joins a read already in flight — a read that started BEFORE a write would hand back the answer from before it */
  if (o.fresh) return apiOnce(key, opts);

  var dk;
  try {
    dk = key + '|' + JSON.stringify(o.params || null) + '|' + JSON.stringify(o.query || null);
  } catch (_) {
    return apiOnce(key, opts);
  } /* unserialisable options: never guess, just call */

  var live = _apiInflight[dk];
  if (live) return live.then(_apiCopy);

  var reply = apiOnce(key, opts);
  _apiInflight[dk] = reply;
  /* ⚠ cleared on failure too, or one dead request poisons that read for the life of the tab */
  var done = function () {
    if (_apiInflight[dk] === reply) delete _apiInflight[dk];
  };
  reply.then(done, done);
  return reply;
}

/* the Idempotency-Key of a write: the outbox's own, or - for an EP row with idem:true (a proposal write) - a fresh one WITHOUT joining the offline outbox (a money promise is never queued); null for a read */
function cbIdemKey(endpoint, outboxSafe, CB, requestId, attempt, stepKey) {
  if (stepKey) return stepKey; /* QA-131: a caller's own key (one per record step of a bulk job) wins, so a resend of a step is a replay */
  if (outboxSafe && CB) return CB._uuid();
  const fresh = () => (CB && CB._uuid ? CB._uuid() : Date.now() + '-' + requestId);
  if (endpoint.idem === 'attempt' && endpoint.m !== 'GET' && attempt) return _attempts[attempt] || (_attempts[attempt] = fresh());
  if (endpoint.idem && endpoint.m !== 'GET') return fresh();
  return null;
}

/* ⭐ FIN-63 · ONE KEY PER ATTEMPT for a money write (EP row idem:'attempt'), the same rule as shop.html attemptKey (API-3 S36).
   The SAME key goes with every send of the same body (a second tap, a retry after a lost answer or the 90 s deadline), so the
   server records the payment once and answers the retry with the FIRST answer (middleware/idempotency.js). A settled answer
   (status under 500, except 409 IDEMPOTENCY_IN_PROGRESS) ends the attempt, so the next press is a new payment.
   A network failure, a timeout or a 5xx keeps the key: a gateway or deadline 5xx can follow a committed payment, and the
   server never stores a 5xx, so the same key on the retry cannot replay an error (it re-runs, or replays the real answer). */
const _attempts = {};
/** attemptOf(key, params, body) → the attempt id: one door, one target, one body */
function attemptOf(key, params, body) {
  return key + ':' + JSON.stringify(params || {}) + ':' + JSON.stringify(body == null ? null : body);
}
/**
 * ⭐ OPS-89 · postDeliverLines(epKey, chitId, rows) — the ONE deliver-lines write: every row carries client_ref = <ref>:<position>, the key
 * lib/deliverline.js replays a row by (it replays only when a ref is named, so a double tap or a retry used to record twice).
 * The ref is the FIN-63 attempt for this chit + these rows (attemptOf, minted by cbIdemKey, held in _attempts): the SAME ref goes with every
 * send of the same action, a network failure keeps it, an answer (a 2xx or a refusal other than 409) ends it, so the next press is a new delivery.
 * A different chit, line or quantity is a different action. Callers: cap-chit2.js (deliver, take material), cap-tasks.js (tkDeliver).
 * ⚠️ RESIDUAL GAP: _attempts lives in memory only, so a page reload between a lost answer and the retry mints a new ref and can still record
 * twice; attemptOf does not persist (the same limit as the payment attempts). Persisting is a separate change to _attempts for every door.
 */
async function postDeliverLines(epKey, chitId, rows) {
  const attempt = attemptOf('deliver-lines', { id: chitId }, rows);
  const ref = cbIdemKey({ idem: 'attempt', m: 'POST' }, false, typeof window !== 'undefined' ? window.CBOffline : null, Math.random().toString(36).slice(2), attempt);
  const stamped = rows.map((row, position) => Object.assign({}, row, { client_ref: ref + ':' + position }));
  try {
    const reply = await api(epKey, { params: { id: chitId }, body: { rows: stamped } });
    delete _attempts[attempt];
    return reply;
  } catch (failure) {
    /* 409 (in progress) and 5xx (a gateway timeout can follow a committed write) keep the ref; only a 4xx refusal ends the action */
    if (failure && failure.status && failure.status !== 409 && failure.status < 500) delete _attempts[attempt];
    throw failure;
  }
}
/** settleAttempt(endpoint, attempt, res) → res, unchanged; ends an idem:'attempt' attempt on a settled answer, keeps it while the first send runs */
async function settleAttempt(endpoint, attempt, res) {
  if (endpoint.idem !== 'attempt' || !res) return res;
  if (res.status >= 500) return res;
  if (res.status === 409) {
    let code = '';
    try {
      code = ((await res.clone().json()) || {}).code || '';
    } catch (e) {
      cblog('debug', 'attempt: a 409 without a JSON code, so the attempt ends (' + (e && e.message) + ')');
    }
    if (code === 'IDEMPOTENCY_IN_PROGRESS') return res;
  }
  delete _attempts[attempt];
  return res;
}
/** serverErrorWords(endpoint) → the words for a 5xx: a write kept on one key (idem:'attempt') may have landed, so it says check first */
function serverErrorWords(endpoint) {
  if (endpoint.idem === 'attempt') return 'Something went wrong on our side. This may already be saved: check before you try again.';
  return 'Server error — please try again.';
}
/** isKeptKeyWords(text) → true for the words above: a screen-level words filter (accounts-shell actWords) lets them through unchanged */
function isKeptKeyWords(text) {
  return /may already be saved/i.test(String(text || ''));
}
/** deadlineWords(endpoint) → the words for the 90 s abort: the same meaning as a 5xx when the key is kept */
function deadlineWords(endpoint) {
  if (endpoint.idem === 'attempt') return 'No answer in 90 s. This may already be saved: check before you try again.';
  return 'No answer from the server in 90 s — try again.';
}
/* errWords(v) → plain words from whatever an answer carries in a message slot: a string as is; an object (RFC 9457 problem, or {code,message}) by its detail, message, title, error; else ''.
   Never String(object): that is how a screen came to say "[object Object]" (SIT crawl 11 Nov, Work > Intake). */
function errWords(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return String(value);
  return errWords(value.detail) || errWords(value.message) || errWords(value.title) || errWords(value.error) || '';
}
/* answerWords(body) → the words of an error answer's body, through errWords; '' when it has none (the caller then says its own sentence) */
function answerWords(body) {
  var answer = body || {};
  return errWords(answer.message) || errWords(answer.detail) || errWords(answer.error) || errWords(answer.title);
}
/** ACC-176b: the headers of a page acting for a store; none on any other page */
const actingHeaders = () => (typeof CBBooksActing !== 'undefined' ? CBBooksActing.headers() : {}); const actingEp = (ep) => (ep && typeof CBBooksActing !== 'undefined' ? CBBooksActing.guard(ep) : ep); /* the store header never goes outside /api/books*: a call outside it is refused before it is sent */
async function apiOnce(key, { params, query, body, idemKey: stepKey } = {}) {
  const ep = actingEp(epOf(key));
  if (!ep) throw new Error('no endpoint ' + key);
  cblog('debug', ep.m + ' ' + key);
  // Double-fire guard: block a repeat of the SAME in-flight mutation (same endpoint+params). GETs are free.
  const lockKey = ep.m !== 'GET' ? key + ':' + JSON.stringify(params || {}) : null;
  if (lockKey) {
    if (_lockKeys.has(lockKey)) throw new Error('Already working on that — one moment.');
    _lockKeys.add(lockKey);
  }
  _inflight++;
  _netBusy(true);
  const _t0 = typeof performance !== 'undefined' ? performance.now() : Date.now(); /* for the spec call log */
  /**
   * ⭐⭐ THE CORRELATION ID, FROM THIS END. The server already mints one when the header is absent and echoes
   * it as `X-Request-Id` — but nothing on the client sent one or kept it, so a person reporting *"it failed
   * when I pressed Send"* could never be joined to the line that recorded why.
   *
   * ⭐ SENT RATHER THAN READ BACK, deliberately: the id then exists BEFORE the request leaves, so a failure
   * with no response at all — a timeout, a dead connection, a CORS refusal — still has an identity. Reading it
   * off the reply only works for requests that got one, which are the ones you least need to trace.
   *
   * ⚠️ NOT A UUID AND NOT A SECRET. Sixteen hex characters is plenty to join two logs, and it must carry no
   * meaning: an id built from the entity or the user would leak identity into every proxy log on the path.
   */
  const _rid = (function () {
    try {
      if (window.crypto && crypto.getRandomValues) {
        const a = new Uint8Array(8);
        crypto.getRandomValues(a);
        return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (_) {}
    return String(Date.now().toString(16)) + Math.floor(Math.random() * 1e6).toString(16);
  })();
  try {
    const CB = typeof window !== 'undefined' ? window.CBOffline : null;
    const outboxSafe = ep.m !== 'GET' && OUTBOX_KEYS.has(key);
    const attempt = attemptOf(key, params, body), idemKey = cbIdemKey(ep, outboxSafe, CB, _rid, attempt, stepKey);
    let pathQ = fill(ep.p, params);
    let url = CFG.API_BASE + pathQ;
    if (query) {
      const q = new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== ''));
      if ([...q].length) {
        const qs = '?' + q;
        url += qs;
        pathQ += qs;
      }
    }
    // Offline + queue-safe → capture to the outbox instead of a doomed request; replays (idempotently) on reconnect.
    if (outboxSafe && CB && !CB.online()) {
      CB.enqueue({ method: ep.m, path: pathQ, body, id: idemKey });
      cblog('warn', ep.m + ' ' + key + ' → queued offline [' + _rid + ']');
      return { queued: true, offline: true };
    }
    let res;
    try {
      /* ⚠️ A REQUEST THAT NEVER ANSWERS MUST FAIL, NOT FREEZE. Without a deadline a hung PATCH left the busy overlay and the
         tour caption up forever (2026-09-04). 90 s is longer than any honest round trip (Railway sfo ↔ Mumbai ≈ 2 s). */
      const _ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const _to = _ac
        ? setTimeout(function () {
            try {
              _ac.abort();
            } catch (_) {}
          }, 90000)
        : null;
      try {
        res = await fetch(url, {
          signal: _ac ? _ac.signal : undefined,
          method: ep.m,
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            'X-Request-Id': _rid,
            ...(idemKey ? { 'Idempotency-Key': idemKey } : {}),
            ...(SESSION.token ? { Authorization: 'Bearer ' + SESSION.token } : {}), ...actingHeaders() /* ACC-176b: a page acting for a store names it on every request */
          },
          body: body ? JSON.stringify(body) : undefined
        }).then((answer) => settleAttempt(ep, attempt, answer));
      } finally {
        if (_to) clearTimeout(_to);
      }
    } catch (netErr) {
      /* a DEADLINE is not "offline": never queue it, say what happened */
      if (netErr && netErr.name === 'AbortError') {
        cblog('error', ep.m + ' ' + key + ' → no answer in 90 s [' + _rid + ']');
        throw new Error(deadlineWords(ep));
      }
      // network unreachable mid-request: queue if safe, else fail gracefully (the draft has the typed work)
      if (outboxSafe && CB) {
        CB.enqueue({ method: ep.m, path: pathQ, body, id: idemKey });
        cblog('warn', ep.m + ' ' + key + ' → queued, net fail [' + _rid + ']');
        return { queued: true, offline: true };
      }
      cblog('error', ep.m + ' ' + key + ' → network unreachable [' + _rid + ']');
      throw new Error(
        ep.m === 'GET' ? "You're offline — showing last-loaded data where available." : "You're offline — this needs a connection. Your typed work is saved."
      );
    }
    if (!res.ok) {
      /**
       * ⚠️⚠️ THE SPECIFIC REASON WAS BEING THROWN AWAY. Athi, 2026-08-18: *"Trying to update the profile, it
       * says validation failed, not sure what it is. Need to have explanation so people understand and update
       * accordingly."* He was right, and the message he needed already existed.
       *
       * express-validator answers with `{ error:'Validation failed', details:[{field, message}] }`, and the
       * MESSAGES ARE GOOD — *"A User ID cannot contain spaces — try alpha-timers."* This line read `j.message ||
       * j.error` and never looked at `details`, so every one of them collapsed into the two useless words
       * "Validation failed". The product knew exactly what was wrong and refused to say.
       *
       * ⚠️ THE FIELD NAME IS PREFIXED, because "must be at least 8 characters" is unanswerable when a form has
       * six fields. Naming the field is the difference between a message and a hint.
       * ⚠️ AND ALL OF THEM ARE SHOWN, not just the first — fixing one error only to be told about the next is
       * the interaction people describe as "fighting the form".
       */
      let msg = '',
        j = null;
      try {
        j = await res.json();
        if (j && Array.isArray(j.details) && j.details.length) {
          msg = j.details
            .map(function (item) {
              var text = item && item.field ? String(item.field).replace(/_/g, ' ') : '';
              var m = errWords(item && item.message);
              /* "Invalid value" is express-validator's default and says nothing; name the field at least. */
              if (/^invalid value$/i.test(m)) m = 'is not valid';
              return text ? text.charAt(0).toUpperCase() + text.slice(1) + ': ' + m : m;
            })
            .filter(Boolean)
            .join('  ·  ');
        }
        if (!msg) msg = answerWords(j);
      } catch (_) {}
      if (j && j.offline) {
        throw new Error(
          ep.m === 'GET'
            ? "You're offline — showing last-loaded data where available."
            : "You're offline — your work is saved and will sync when you reconnect."
        );
      }
      cblog(res.status >= 500 ? 'error' : 'warn', ep.m + ' ' + key + ' → ' + res.status + (msg ? ' · ' + msg : ''));
      /* ⭐ the status rides on the error (e.status): a page that must tell "this shop has the Ledger off" (404) from "the network
         failed" (no status) — CB Accounts — can, without parsing words. The message itself is unchanged. */
      /* e.data = the answer's own body (M27: a 409 ALREADY_PAID carries .warnings the payment form paints) */
      const _fail = function (m) {
        const er = new Error(m);
        er.status = res.status;
        er.data = j;
        return er;
      };
      if (res.status === 401) {
        SESSION = {};
        try {
          localStorage.removeItem('cb_token');
          localStorage.removeItem('cb_sess');
        } catch (_) {}
        if (typeof go === 'function') go('#/login');
        throw _fail(msg || 'Session expired — please sign in again.');
      }
      if (res.status === 422) {
        throw _fail(msg || 'Please check the form and try again.');
      } // validation
      if (res.status >= 500) {
        throw _fail(msg || serverErrorWords(ep));
      } // generic
      throw _fail(msg || 'API ' + res.status + ' ' + ep.m + ' ' + ep.p);
    }
    /**
     * ⭐⭐ THE SPEC RECORDS WHAT ACTUALLY HAPPENED. Athi, 2026-08-22: *"possibly we can use spec mode to see
     * the actual specification, api calls, and any endpoints, output in json."*
     *
     * ⭐ RECORDED FROM THE REAL CALL, NOT DECLARED. A hand-written list of "endpoints this screen uses" is a
     * second source of truth that drifts the first time a screen gains a request. This is the request that
     * just went out: its name, method, resolved path, status and duration.
     *
     * ⚠️ ONLY WHILE SPEC IS ON. Off, this is one boolean check and nothing is kept — no memory held, and no
     * response body sitting around in a tab that is merely open. The body is also capped, because the point is
     * to see the SHAPE of the answer, not to build a network log.
     */
    const _out = unwrap(res.status === 204 ? null : await res.json(), key);
    try {
      /**
       * ⭐ TEST MODE RECORDS TOO. Athi, 2026-09-13: *"how the API is responding, how many round trips it
       * makes… kind of diagnostic tool, so we can take the required action."* The log this needs already
       * existed for the Spec overlay — the same forty calls, the same shape. It only had to be switched on
       * for the other reader. [[feedback-search-before-you-build]]
       * ⚠️ Still OFF by default: with neither mode on this is one boolean and nothing is kept, so no
       * response body sits around in a tab that is merely open.
       */
      var _rec = (typeof specOn === 'function' && specOn()) || (typeof CBTEST !== 'undefined' && CBTEST && CBTEST.on);
      if (_rec) {
        window.CBCALLS = window.CBCALLS || [];
        /**
         * ⭐⭐ WHICH SCREEN MADE THE CALL, stamped at the moment it is made. Without this the log is a
         * single pile of the last forty calls, and the tester panel reading it credited the Catalogue with
         * eleven routes — most of them the rail, the notifications poll, and the test tool asking about
         * itself. Eighty-three "tests underneath this screen", nearly all of them underneath something else.
         *
         * ⚠️ `navScreenKey()` READS `UI.nav`, WHICH IS SET BEFORE THE LOADING STARTS — unlike the code
         * stamped into the heading, which arrives after the paint. Attributing by the heading would have
         * credited every screen’s own load calls to the screen before it.
         */
        var _scr = null;
        try {
          if (typeof navScreenKey === 'function') _scr = navScreenKey();
        } catch (_) {}
        /**
         * ⭐⭐ AND WHICH VISIT. The name of the screen is not enough: leave the Catalogue, come back, and both
         * visits pile into one log. The tester panel then reports the Catalogue as depending on ten routes,
         * most of them the rail and the notification poll from ten minutes ago.
         *
         * ⚠️ VISIT 1 IS THE APP STARTING, and its calls cannot be separated from whatever screen the tester
         * happened to land on — the boot and the first screen load are genuinely interleaved. The panel says
         * so rather than quietly attributing sign-in to the Catalogue.
         *
         * ⚠ Counted HERE rather than at the router: `UI.nav` is assigned in a dozen places and a hook on one
         * of them would be silently right most of the time, which is the worst kind of wrong.
         */
        cbVisitTick(_scr);
        /**
         * ⭐ WHAT THE SERVER SAID IT COST. `X-DB-Ms` is the time inside the request and `X-DB-Trips` the
         * number of database round trips it made; the difference between that and the total measured here
         * is the network. Both are null unless CB_TRIPS=1 on the API — and the panel says so rather than
         * drawing an empty column and letting it read as "no time spent there".
         */
        /**
         * ── ⭐⭐ THE LAYERS, FROM THE BROWSER ITSELF ─────────────────────────────────────────────────────
         *
         * `performance.getEntriesByName(url)` carries the whole shape of one request. Read here rather than
         * computed: nothing in this codebase could time a TLS handshake, and the browser already did.
         *
         * ⚠️ `requestStart === 0` MEANS NOT PERMITTED, NOT INSTANT. Cross-origin, every field is zeroed
         * unless the server sent `Timing-Allow-Origin`. Recording those zeros as measurements would put a
         * confident "0 ms of encryption" on the screen. So the absence is carried as `blocked` and the panel
         * says why.
         *
         * ⭐ AND THE HANDSHAKE IS PAID ONCE. DNS, TCP and TLS are zero on every call after the first, because
         * the connection is reused — which is the answer to "is encryption making us slow": it is not, after
         * the first call of the session, and the panel says so rather than leaving someone to chase it.
         */
        var _rt = null;
        try {
          var _es = performance.getEntriesByName(url);
          var _e = _es && _es.length ? _es[_es.length - 1] : null;
          if (_e && _e.responseEnd) {
            if (!_e.requestStart) {
              _rt = { blocked: true };
            } else {
              var _tlsAt = _e.secureConnectionStart || 0;
              _rt = {
                dns: Math.max(0, Math.round(_e.domainLookupEnd - _e.domainLookupStart)),
                tcp: Math.max(0, Math.round((_tlsAt > 0 ? _tlsAt : _e.connectEnd) - _e.connectStart)),
                tls: _tlsAt > 0 ? Math.max(0, Math.round(_e.connectEnd - _tlsAt)) : 0,
                wait: Math.max(0, Math.round(_e.responseStart - _e.requestStart)),
                down: Math.max(0, Math.round(_e.responseEnd - _e.responseStart)),
                bytes: _e.transferSize || 0,
                raw: _e.decodedBodySize || 0
              };
            }
          }
        } catch (_) {}
        var _srv = null,
          _trips = null;
        try {
          var _h = res.headers;
          _srv = _h && _h.get('X-DB-Ms') != null ? Number(_h.get('X-DB-Ms')) : null;
          _trips = _h && _h.get('X-DB-Trips') != null ? Number(_h.get('X-DB-Trips')) : null;
        } catch (_) {}
        CBCALLS.unshift({
          key,
          m: ep.m,
          path: pathQ,
          status: res.status,
          rid: _rid,
          scr: _scr,
          srv: isNaN(_srv) ? null : _srv,
          trips: isNaN(_trips) ? null : _trips,
          rt: _rt,
          gen: window.CBGEN,
          ms: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - _t0),
          /**
           * ── ⭐⭐ WHAT WENT OUT, NOT ONLY WHAT CAME BACK ──────────────────────────────────────────────
           *
           * Athi, 2026-09-13: *"are we documenting the parameter which it has gone with? if so, can we
           * make it a hyperlink, the real call statement can be seen… as I am not a techie, I am asking
           * all these questions."*
           *
           * ⚠️ ONLY THE ANSWER WAS KEPT. The query string was in the path, but the BODY of a POST — the
           * thing that actually says what was asked for — was never recorded. So a failed write could be
           * seen to have failed and never be reproduced, which is the half that matters.
           *
           * ⚠️⚠️ AND IT IS REDACTED ON THE WAY IN. This log is attached to incidents and shown on screen,
           * so a password, a PIN, an OTP or a token must never enter it. Redacted HERE rather than at the
           * point of display, because a value that is never stored cannot leak from somewhere I forgot to
           * look. [[project-ai-security-hardening]]
           */
          sent: (function () {
            try {
              if (body === undefined || body === null) return null;
              var SECRET = /(pass|pin|otp|token|secret|auth|key|card|cvv)/i;
              var clean = JSON.parse(JSON.stringify(body), function (k, v) {
                return SECRET.test(k) ? '[redacted]' : v;
              });
              return JSON.stringify(clean).slice(0, 1200);
            } catch (_) {
              return null;
            }
          })(),
          q: (function () {
            try {
              return query ? JSON.parse(JSON.stringify(query)) : null;
            } catch (_) {
              return null;
            }
          })(),
          at: Date.now(),
          body: JSON.stringify(_out === undefined ? null : _out).slice(0, 1200)
        });
        CBCALLS.length = Math.min(CBCALLS.length, 40);
        /* ⚠ AND SAY SO. Recording without repainting is what made the spec panel look dead — the rows were
           there and nothing ever asked the bar to draw them again. Athi found it: "an overlay appears, but
           nothing is changing, I guess it is a dead function." */
        if (typeof specCallsRepaint === 'function') specCallsRepaint();
      }
    } catch (_) {}
    /* a product write drops the memoised own-catalogue VIEW (ownCatalogueView) — the next outlet to open reads fresh */
    try {
      if (ep.m !== 'GET' && /^prod/.test(key) && typeof ownViewInvalidate === 'function') ownViewInvalidate();
    } catch (_) {}
    return _out;
  } finally {
    if (lockKey) _lockKeys.delete(lockKey);
    if (--_inflight <= 0) {
      _inflight = 0;
      _netBusy(false);
    }
  }
}

/* ── the DEFINITIONS routes (cbDefsLive · cbCatgLive above read them) — MOVED here from app.html's EP (T3-CATALOGUE) so app.html and catalogue.html
   register each ONCE (e2e/ep-aliases.cjs); a page merges them with Object.assign(EP, CB_DEFS_EP) as it merges CB_SHOP_EP ── */
var CB_DEFS_EP = {
  defList: { m: 'GET', p: '/api/definitions', ok: 'y' }, // ?all=1 via defListAll
  defListAll: { m: 'GET', p: '/api/definitions?all=1', ok: 'y' }, // the shelf, incl. retired
  defAdd: { m: 'POST', p: '/api/definitions', ok: 'y' },
  defSave: { m: 'PUT', p: '/api/definitions/:id', ok: 'y' }, // rules change => NEW VERSION
  defRetire: { m: 'DELETE', p: '/api/definitions/:id', ok: 'y' } // retires, never deletes
};
