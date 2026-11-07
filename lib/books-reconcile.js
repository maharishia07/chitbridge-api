// @stage tested
// @stage-note [ACC-266] The 30-second reconciler: a saved bill with no ledger entry is found and posted through the one door (postChit) within about two
// @stage-note minutes, whatever swallowed the after-commit hook; and /health counts what is still missing, with the SAME predicate.
'use strict';
// OWNS      the frequent finder of a posting-purpose chit that has no entry (the derived outbox), its pool guard and cap, and the figures GET /health reads
//           (books_unposted · books_unposted_oldest_s · books_reconcile_age_s · the three swallow counters)
// CALLED BY server.js (start() at boot; off in a test run or with BOOKS_RECONCILE=0) · routes/health.js (health()) · lib/books-hooks.js (swallowed())
// FLOW      start() → every ~30 s tick() → ops.f_books_enabled() ids, round-robin → per shop, ONE transaction holding pg_try_advisory_xact_lock →
//           books-store unpostedCount + unpostedInWindow (rolling 24 h, grace 120 s, open-day walk-ins left out in SQL) → H.postChit per chit
// CARD      14-accounting/books-health-to-do-outbox
const CLOCK = require('./shop-clock');
/**
 * lib/books-reconcile.js — "A BILL IS NEVER LEFT WITHOUT A WORD ABOUT ITS LEDGER" (plan/critic ACC-266, option (c): the derived outbox).
 *
 * THE BILL ROW IS THE DURABLE INTENT. The hook after the commit is not awaited and its three failure paths were one log line each (books.hook-failed,
 * books.switch-unread, and a park that needs a second connection from the same exhausted pool: books.outbox-failed). Whatever fired, the committed
 * bill has no entry and no waiting row, and the 6-hourly nightly looks only at the three CLOSED days. This pass looks at the last 24 hours, every
 * ~30 seconds, and posts what is missing through THE SAME door the hook uses — postChit — so it can never post differently.
 *
 * ⭐ EXACTLY ONCE rests on the database: journal_entry_src_uq (entity, source_ref). A race with the inline post ends in one entry and `duplicate: true`
 *   (lib/books.js postEntry answers the 23505 in its own words). The per-shop advisory lock only stops two instances doing the same work twice.
 * ⭐ GRACE 120 s: a chit younger than that may still be on its way through the inline post (isOn ≤ 10 s + reads ≤ 10 s each + the counter row).
 * ⭐ ROLLING 24 h, not "today": the bill saved at 23:59 is still this pass's at 00:01. The nightly keeps the closed days.
 * ⭐ C1 — WHAT IS NOT LOST: an open-day walk-in at day/shift grain waits for its day close (postWalkinChit → { waiting }) with no row and no entry. The
 *   predicate leaves it out in SQL (books-store UNPOSTED_FROM), so a cap of 50 is never spent on it and /health never says "200 missing" all day.
 *   An answer that is `none` / `waiting` is also remembered for the day (`answered`), so a chit is read once, not every pass.
 * ⭐ LOAD (C4): ONE loop for all shops, shops in round-robin from where the last pass stopped, a GLOBAL cap of 50 posts per pass, and the pool guard
 *   BEFORE EVERY CHIT: the pool already has someone waiting, or 7 of its connections are in use → stop the pass, count it (skipped_busy). The
 *   pass is the first thing to give way, never the bill.
 * ⚠️ NEVER FAILS A CHIT, NEVER REWRITES A BALANCE: it posts what the hook would have posted, or parks it named (postChit's own parking).
 * ⚠️ NOTHING IS FIXED HERE THAT postChit REFUSES: a bill whose month is locked parks, named — that is the right answer.
 */
const GRACE_MS = 120000;
const WINDOW_MS = 24 * 3600000;
const POSTS_PER_PASS = 50;
const BUSY_CONNECTIONS = 7;
const INTERVAL_MS = 30000;
const ANSWERED_MAX = 5000;

const state = {
  passes: 0,
  last_pass_at: null /* ms of the last COMPLETED pass; null = never */,
  by_shop: new Map() /* shop → { count, oldest_ms } as the last pass left it */,
  skipped_busy: 0,
  skipped_locked: 0,
  posted: 0,
  swallow: { hook_failed: 0, switch_unread: 0, outbox_lost: 0 }
};
/* shop:chit_id → ms: a chit classify answered `none` / `waiting` for THAT shop's copy — read once, not every pass.
   The key carries the shop: chit_header is (chit_id, entity_id, direction), so the sender's and the buyer's copies share a chit_id and one shop's answer must never hide the other's copy. */
const answered = new Map();
const answerKey = (shop, chitId) => String(shop) + ':' + String(chitId);
/** the chit ids ONE shop already has an answer for — never another shop's */
function skipIdsFor(shop) {
  const prefix = String(shop) + ':';
  return Array.from(answered.keys()).filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
}
let cursor = 0;
let running = false;
let timer = null;

/** the seams a test replaces; the defaults are the real ones (read at call time) */
const seam = {
  now: () => CLOCK.now().getTime(),
  shops: async () => (await require('../db').query('SELECT entity_id FROM ops.f_books_enabled()')).rows.map((item) => item.entity_id),
  withEntity: (shop, fn) => require('../db').withEntity(shop, fn),
  settingOf: (handle, shop) => require('./books').settingOf(handle, shop),
  store: () => require('./books-store'),
  postChit: (shop, chitId, opt) => require('./books-hooks').postChit(shop, chitId, opt),
  busy: () => {
    const pool = require('../db').pool;
    return !!pool && (pool.waitingCount > 0 || pool.totalCount - pool.idleCount >= BUSY_CONNECTIONS);
  },
  log: () => require('./logger')
};

/** a swallowed posting failure, counted (GET /health) — called from the three places in books-hooks that used to be only a log line */
function swallowed(which) {
  if (Object.prototype.hasOwnProperty.call(state.swallow, which)) state.swallow[which]++;
}

/** what postChit answered → how the pass counts it, and whether the answer holds for the rest of the day */
function outcomeOf(res) {
  if (!res || res.none || res.off || res.covered) return { kind: 'nothing', remember: true };
  if (res.waiting) return { kind: 'waiting', remember: true };
  if (res.duplicate || (res.payment && res.payment.duplicate)) return { kind: 'nothing', remember: false };
  if (res.queued) return { kind: 'queued', remember: false };
  return { kind: 'posted', remember: false };
}

function forgetOld(nowMs) {
  for (const [id, at] of answered) if (nowMs - at > WINDOW_MS) answered.delete(id);
  if (answered.size > ANSWERED_MAX) answered.clear(); /* a runaway map is worse than a re-read */
}

/** [now - 24 h, now - grace), and never from before the ledger began (books-nightly: opening balances, not back-dated entries) */
function windowOf(setting, nowMs) {
  const began = setting.enabled_at ? new Date(setting.enabled_at).getTime() : 0;
  return { from: new Date(Math.max(nowMs - WINDOW_MS, began)).toISOString(), to: new Date(nowMs - GRACE_MS).toISOString() };
}

/** the found chits of one shop, each through the one door; the pool guard BEFORE EVERY CHIT. → how many were posted or tried */
async function postFound(handle, shop, setting, span, nowMs, out) {
  const found = await seam.store().unpostedInWindow(handle, shop, span.from, span.to, span.budget, span.filter);
  let used = 0;
  for (const chit of found) {
    if (seam.busy()) {
      out.skipped_busy++;
      break;
    }
    const outcome = outcomeOf(await seam.postChit(shop, chit.chit_id, { setting }));
    used++;
    out[outcome.kind]++;
    if (outcome.remember) answered.set(answerKey(shop, chit.chit_id), nowMs);
  }
  return used;
}

/** one shop: inside ONE transaction holding the advisory lock — count, list, post. `budget` = posts still allowed this pass (global). */
async function sweepShop(shop, budget, nowMs, out) {
  const store = seam.store();
  return seam.withEntity(shop, async (handle) => {
    const lock = await handle.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS got', ['books-reconcile:' + shop]);
    if (!lock.rows[0] || !lock.rows[0].got) {
      out.skipped_locked++;
      return 0;
    }
    const setting = await seam.settingOf(handle, shop);
    if (!setting || !setting.enabled) {
      state.by_shop.delete(String(shop));
      return 0;
    }
    const { from, to } = windowOf(setting, nowMs);
    if (from >= to) {
      state.by_shop.delete(String(shop));
      return 0;
    }
    const filter = { skipWalkin: setting.walkin_grain !== 'bill', skipIds: skipIdsFor(shop) };
    const before = await store.unpostedCount(handle, shop, from, to, filter);
    const used = before.count > 0 && budget > 0 ? await postFound(handle, shop, setting, { from, to, filter, budget }, nowMs, out) : 0;
    /* the figure /health carries is what is STILL missing after this shop's posts, by the same predicate */
    const after = used ? await store.unpostedCount(handle, shop, from, to, { skipWalkin: filter.skipWalkin, skipIds: skipIdsFor(shop) }) : before;
    state.by_shop.set(String(shop), { count: after.count, oldest_ms: after.oldest ? new Date(after.oldest).getTime() : null });
    return used;
  });
}

/** the shops in round-robin order, from where the last pass stopped; walked until the global budget is spent or the pool is busy. → how many shops were visited */
async function walkShops(ids, nowMs, out) {
  const order = ids.length ? ids.slice(cursor % ids.length).concat(ids.slice(0, cursor % ids.length)) : [];
  let budget = POSTS_PER_PASS;
  let visited = 0;
  for (const shop of order) {
    if (budget <= 0) {
      out.capped = true;
      break;
    }
    if (seam.busy()) {
      out.skipped_busy++;
      break;
    }
    visited++;
    try {
      budget -= await sweepShop(shop, budget, nowMs, out);
    } catch (e) {
      seam.log().warn('books.reconcile-shop-failed', { entity_id: shop, error: String(e && e.message).slice(0, 200) });
    }
  }
  return visited;
}

/** one pass over every books-on shop. Never throws; a pass the pool guard cut short does not move books_reconcile_age_s. */
async function tick() {
  if (running) return { skipped: 'running' };
  running = true;
  const out = { shops: 0, posted: 0, queued: 0, waiting: 0, nothing: 0, skipped_busy: 0, skipped_locked: 0, capped: false, ok: false };
  try {
    const nowMs = seam.now();
    forgetOld(nowMs);
    const ids = await seam.shops();
    out.shops = ids.length;
    const live = ids.map(String);
    for (const known of Array.from(state.by_shop.keys())) if (live.indexOf(known) < 0) state.by_shop.delete(known);
    const visited = await walkShops(ids, nowMs, out);
    cursor = ids.length ? (cursor + Math.max(visited, 1)) % ids.length : 0;
    state.skipped_busy += out.skipped_busy;
    state.skipped_locked += out.skipped_locked;
    state.posted += out.posted;
    if (!out.skipped_busy) {
      state.passes++;
      state.last_pass_at = seam.now();
      out.ok = true;
    }
    if (out.posted || out.queued) seam.log().info('books.reconciled', { posted: out.posted, queued: out.queued, shops: out.shops });
  } catch (e) {
    seam.log().warn('books.reconcile-failed', { error: String(e && e.message).slice(0, 200) });
  } finally {
    running = false;
  }
  return out;
}

/** the figures GET /health carries — one cheap in-process read, no query per probe (a process probe, like money_mismatch) */
function health() {
  const nowMs = seam.now();
  let count = 0;
  let oldest = null;
  for (const v of state.by_shop.values()) {
    count += v.count;
    if (v.count > 0 && v.oldest_ms !== null && (oldest === null || v.oldest_ms < oldest)) oldest = v.oldest_ms;
  }
  return {
    books_unposted: count,
    books_unposted_oldest_s: oldest === null ? 0 : Math.max(0, Math.round((nowMs - oldest) / 1000)),
    books_reconcile_age_s: state.last_pass_at === null ? null : Math.max(0, Math.round((nowMs - state.last_pass_at) / 1000)),
    books_hook_failed: state.swallow.hook_failed,
    books_switch_unread: state.swallow.switch_unread,
    books_outbox_lost: state.swallow.outbox_lost
  };
}

/** in-process, every ~30 s with jitter (first pass ~15 s after boot); BOOKS_RECONCILE=0 turns it off; opt.force is for a test */
function start(opt) {
  const options = opt || {};
  if (timer || (!options.force && (process.env.BOOKS_RECONCILE === '0' || require('./dev-otp').isTestRun()))) return false;
  const every = options.interval || INTERVAL_MS;
  const next = (ms) => {
    timer = setTimeout(
      () => {
        tick().then(() => next(every + Math.round(Math.random() * every * 0.2)));
      },
      ms
    );
    timer.unref();
  };
  next(options.first === undefined ? 15000 + Math.round(Math.random() * 5000) : options.first);
  return true;
}
function stop() {
  if (timer) clearTimeout(timer);
  timer = null;
}
/** tests only: back to boot */
function reset() {
  stop();
  state.passes = 0;
  state.last_pass_at = null;
  state.by_shop.clear();
  state.skipped_busy = state.skipped_locked = state.posted = 0;
  state.swallow = { hook_failed: 0, switch_unread: 0, outbox_lost: 0 };
  answered.clear();
  cursor = 0;
  running = false;
}

module.exports = { tick, start, stop, health, swallowed, reset, _D: seam, _state: state, GRACE_MS, WINDOW_MS, POSTS_PER_PASS };
