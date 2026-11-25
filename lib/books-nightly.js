// @stage tested
// @stage-note [BOOKS v2] The nightly check: balances recomputed from the lines, the control accounts against the parties,
// @stage-note every entry balanced, the waiting list retried, a day nobody closed posted. Mismatches NAMED, never auto-fixed.
'use strict';
// OWNS      the ledger's nightly check (named differences, never auto-fixed) and its in-process 6-hour timer.
// CALLED BY server.js (start() at boot; off in a test run — dev-otp isTestRun — or with BOOKS_NIGHTLY=0) · routes/books.js (a check on demand)
// FLOW      start() → every 6 h runAll() → ops.f_books_enabled() ids → check(shop) inside withEntity → books_setting.last_check
// CARD      14-accounting/books-health-to-do-outbox
const CLOCK = require('./shop-clock');
const cbLog = require('./logger');
/**
 * lib/books-nightly.js — THE CHECK THAT RUNS WHILE THE SHOP SLEEPS (SPEC-books-v2 §6; research §6.3, the JD Edwards /
 * ERPNext Ledger Health pattern).
 *
 * ⭐ NAMED, NEVER AUTO-FIXED: a difference is written to books_setting.last_check (GET /api/books/health, the Ledger
 *   screen's to-do) with what differs and by how much. Nothing here rewrites a balance or an entry.
 * ⭐ WHAT IT DOES POST is only what would have posted anyway: the waiting list, retried; a walk-in day whose counter
 *   never sent its day summary (the last three days, idempotent by walkin:<counter>:<day>); the repeating entries due and the accruals to turn back
 *   (lib/books-recurring sweep, step 2c); and ⭐ THE SWEEP (critic M6,
 *   SPEC §6 "every chit of the day posted") — the chits of those closed days whose hook never ran (a deploy between
 *   commit and hook, a client retry answered as a duplicate, a failed read of the switch, a bill in flight at day close),
 *   through the same postChit(): posted, or parked in books_outbox with the reason, and counted in `posted.swept`.
 * ⚠️⚠️ NOTHING FROM BEFORE THE LEDGER BEGAN: neither the days nor the sweep reach behind books_setting.enabled_at — what
 *   a shop sold before it switched the ledger on comes in as opening balances, never as back-dated entries.
 * ⚠️ BOUNDED: the sweep reads at most SWEEP_LIMIT chits per check, oldest first; reaching the limit is a named problem.
 * ⚠️ WHICH SHOPS: ops.f_books_enabled() — ids only (SECURITY DEFINER, b272), the one cross-shop read. Everything else
 *   runs as that shop, inside withEntity.
 */
const books = require('./books');
const engines = require('./books-engines');
const store = require('./books-store');
const hooks = require('./books-hooks');

const SWEEP_LIMIT = 200;
function withEntity(e, fn) {
  return require('../db').withEntity(e, fn);
}
const logger = hooks.loggerOf; /* the one lazy logger (lib/books-hooks) */

/** step 1: the waiting list (the outbox) is retried; a failure is a problem named in the result, never a throw */
async function retryWaiting(out, entity) {
  try {
    out.posted.retried = await hooks.retryOutbox(entity, 100);
  } catch (e) {
    out.problems.push({ what: 'retry', why: String(e && e.message) });
  }
}
/** the counters that billed on one walk-in day are posted; a counter the books queued is a problem named in the result */
async function postCounters(out, entity, setting, counters, day) {
  for (const counter of counters) {
    const result = await hooks.postDay(entity, counter, day, { setting: setting });
    if (result && result.entry_no && !result.duplicate) out.posted.days.push(counter + ' ' + day + ' → ' + result.entry_no);
    if (result && result.queued) out.problems.push({ what: 'walk-in day', counter, day, why: result.why });
  }
}
/** step 2: each walk-in day nobody closed gets its counters read and posted; a failure is a problem named in the result */
async function postWalkInDays(out, entity, setting, days) {
  out.posted.days = [];
  for (const day of days) {
    try {
      const bounds = hooks.dayBounds(day, setting);
      const counters = await withEntity(entity, (h) => store.countersBilling(h, entity, bounds.from, bounds.to));
      await postCounters(out, entity, setting, counters, day);
    } catch (e) {
      out.problems.push({ what: 'walk-in day', day, why: String(e && e.message) });
    }
  }
}
/** what became of one chit the sweep tried to post: nothing to do · queued · waiting · posted */
function chitOutcome(result) {
  if (!result || result.none || result.off || result.covered || result.duplicate || (result.payment && result.payment.duplicate)) return 'nothing';
  if (result.queued) return 'queued';
  return result.waiting ? 'waiting' : 'posted';
}
/** step 2b: every chit of the closed days is posted (after the days, so a bill its day did not name posts late), counted by what happened to it */
async function sweepUnpostedChits(out, entity, setting, window) {
  try {
    const from0 = hooks.dayBounds(window.closed[window.closed.length - 1], setting).from,
      to = hooks.dayBounds(window.closed[0], setting).to;
    const from = window.began && window.began > from0 ? window.began : from0;
    const swept = { found: 0, posted: 0, queued: 0, waiting: 0, nothing: 0 };
    if (from < to) {
      const found = await withEntity(entity, (h) => store.unpostedChits(h, entity, from, to, SWEEP_LIMIT));
      swept.found = found.length;
      for (const c of found) {
        const result = await hooks.postChit(entity, c.chit_id, { setting: setting });
        swept[chitOutcome(result)]++;
      }
      if (found.length >= SWEEP_LIMIT) out.problems.push({ what: 'more unposted chits than one check reads', read: SWEEP_LIMIT });
    }
    out.posted.swept = swept;
  } catch (e) {
    out.problems.push({ what: 'sweep for unposted chits', why: String(e && e.message).slice(0, 200) });
  }
}
/** step 2c: the daily sweep of repeating entries and accruals (lib/books-recurring); a refusal is named in the result */
async function sweepRecurring(out, entity, setting, today) {
  try {
    const swept = await require('./books-recurring').sweep(entity, setting, today);
    out.posted.recurring = {
      proposed: swept.proposed,
      proposed_reversals: swept.proposed_reversals,
      posted: swept.posted.filter((x) => !x.duplicate).length,
      reversed: swept.reversed.filter((x) => !x.duplicate).length
    };
    swept.problems.forEach((item) => out.problems.push(item));
  } catch (e) {
    out.problems.push({ what: 'recurring sweep', why: String(e && e.message).slice(0, 200) });
  }
}

/** the control accounts (debtors = Σ customers' open items; creditors = Σ suppliers' — SAP reconciliation account): the journal's balance beside the party items */
async function controlRows(handle, entity) {
  const chart = await store.accounts(handle, entity);
  const rows = [];
  for (const role of ['debtors', 'creditors']) {
    const account = chart.find((x) => x.role === role);
    if (!account) continue;
    const netBalance = await store.accountNet(handle, entity, account.account_id);
    const control = role === 'debtors' ? netBalance : -netBalance;
    const parties = (await store.itemTotals(handle, entity, account.account_id)).reduce((total, item) => total + item.total_minor, 0);
    rows.push({ role, code: account.code, control_minor: control, parties_minor: parties });
  }
  return rows;
}
/** step 3: the ledger's own arithmetic — every entry balances, the month rows match their lines, the control accounts match the party items, the controls run, the waiting list is counted */
async function checkLedgerArithmetic(out, handle, entity, today) {
  const unbalanced = await store.unbalancedEntries(handle, entity);
  unbalanced.forEach((item) => out.problems.push({ what: 'entry does not balance', entry_no: item.entry_no, dr_minor: item.dr, cr_minor: item.cr }));
  const drift = await store.balanceDrift(handle, entity);
  drift.forEach((item) =>
    out.problems.push({
      what: 'monthly balance differs from its lines',
      account_id: item.account_id,
      party_id: item.party_id,
      fiscal_year: item.fiscal_year,
      period: item.period,
      lines_dr_minor: item.lines_dr,
      lines_cr_minor: item.lines_cr,
      kept_dr_minor: item.kept_dr,
      kept_cr_minor: item.kept_cr
    })
  );
  out.items_vs_control = (await controlRows(handle, entity)).map((item) => Object.assign({ ok: item.control_minor === item.parties_minor }, item));
  out.items_vs_control
    .filter((item) => !item.ok)
    .forEach((item) =>
      out.problems.push({ what: item.role + ' control ≠ the open items', control_minor: item.control_minor, items_minor: item.parties_minor })
    );
  /* CBLedger.controls: control = Σ party balances (both grains of the month rows), no party missing, every day and entry balanced, TB balanced */
  try {
    const node = await books.controls(handle, entity, today);
    out.controls = { ok: node.ok, checked: node.checked };
    (node.mismatches || []).forEach((item) => out.problems.push(Object.assign({ what: item.name }, item)));
  } catch (e) {
    out.problems.push({ what: 'controls could not run', why: String(e && e.message).slice(0, 200) });
  }
  /* every party has its number (a party added since yesterday) */
  try {
    const numbered = await require('../db').trySavepoint(handle, () => require('./party-fields').numberAll(handle, entity), 0);
    if (numbered) out.posted.parties_numbered = numbered;
  } catch (e) {
    cbLog.fellBack('books-nightly check: the helper failed — carried on without it', e);
  }
  const list = await store.waiting(handle, entity, 20);
  out.waiting = list.map(hooks.waitingRow);
  if (list.length) out.problems.push({ what: 'waiting to post', count: list.length });
}
/** check(entity) → the result stored as last_check */
async function check(entity, opt) {
  const options = opt || {};
  const out = { at: CLOCK.now().toISOString(), ok: true, problems: [], posted: {}, engines: engines.status() };
  const setting = await withEntity(entity, (h) => books.settingOf(h, entity));
  if (!setting || !setting.enabled) return { at: out.at, ok: true, off: true };
  /* the SHOP's day (its zone — setting.timezone, else its country; M210), not the server's: at 02:00 IST "yesterday" is a closed day, and UTC still says today */
  const today = options.today || hooks.dayOf(out.at, setting) || out.at.slice(0, 10);
  const began = setting.enabled_at ? new Date(setting.enabled_at).toISOString() : null; /* the ledger's first moment … */
  const beganDay = began ? hooks.dayOf(began, setting) : null; /* … and its first day */

  /* 1 · the waiting list */
  await retryWaiting(out, entity);

  /* 2 · walk-in days nobody closed (yesterday and the two before) */
  const closed = [1, 2, 3].map((item) => books.addDays(today, -item));
  const days = closed.filter((item) => !beganDay || item >= beganDay);
  await postWalkInDays(out, entity, setting, days);

  /* 2b · every chit of those closed days posted */
  await sweepUnpostedChits(out, entity, setting, { closed, began });

  /* 2c · THE DAILY SWEEP (lib/books-recurring), idempotent by client_ref / source_ref: every 6-hourly run is safe */
  await sweepRecurring(out, entity, setting, today);

  /* 3 · the ledger's own arithmetic */
  await withEntity(entity, (handle) => checkLedgerArithmetic(out, handle, entity, today));
  out.ok = out.problems.length === 0;
  await withEntity(entity, (h) => store.saveCheck(h, entity, out));
  if (!out.ok) logger().warn('books.check', { entity_id: entity, problems: out.problems.length });
  return out;
}

/** every shop with books on — ids only, through the ops function */
async function runAll() {
  let ids = [];
  try {
    const { query } = require('../db');
    ids = (await query('SELECT entity_id FROM ops.f_books_enabled()')).rows.map((item) => item.entity_id);
  } catch (e) {
    if (!runAll.said) {
      runAll.said = true;
      logger().info('books.nightly', { skipped: String(e && e.message).slice(0, 160) });
    }
    return { shops: 0 };
  }
  let count = 0;
  for (const id of ids) {
    try {
      const outcome = await check(id);
      if (outcome && outcome.ok === false) count++;
    } catch (e) {
      count++;
      logger().warn('books.nightly-failed', { entity_id: id, error: String(e && e.message) });
    }
  }
  /* ⭐ RI1: the repeat-supply agreements whose run day has come — EVERY shop with one (ops.f_repeat_supply_due, b303), ledger on or off;
     the same sweep the seller's "Run what is due" presses. Skips quietly (named once) before b303. Never fails the books check. */
  let repeat = null;
  try {
    repeat = await require('./repeat-supply').sweepAll();
    if (repeat && repeat.problems) logger().warn('repeat.sweep', repeat);
  } catch (e) {
    logger().warn('repeat.sweep-failed', { error: String(e && e.message).slice(0, 160) });
  }
  return { shops: ids.length, with_problems: count, repeat };
}

let timer = null;
/** in-process, every 6 hours (first run 10 minutes after start); BOOKS_NIGHTLY=0 turns it off */
function start() {
  if (timer || process.env.BOOKS_NIGHTLY === '0' || require('./dev-otp').isTestRun()) return false;
  const kick = () => {
    runAll().catch(cbLog.orElse('books-nightly kick: failed — carried on without it'));
  };
  setTimeout(kick, 10 * 60000).unref();
  timer = setInterval(kick, 6 * 3600000);
  timer.unref();
  return true;
}

module.exports = { check, runAll, start };
