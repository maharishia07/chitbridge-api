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
const B = require('./books');
const E = require('./books-engines');
const S = require('./books-store');
const H = require('./books-hooks');

const SWEEP_LIMIT = 200;
function withEntity(e, fn) {
  return require('../db').withEntity(e, fn);
}
let log = null;
function L() {
  if (!log) {
    try {
      log = require('./logger');
    } catch (_) {
      log = { info() {}, warn() {} };
    }
  }
  return log;
}

/** check(entity) → the result stored as last_check */
async function check(entity, opt) {
  const o = opt || {};
  const out = { at: CLOCK.now().toISOString(), ok: true, problems: [], posted: {}, engines: E.status() };
  const s = await withEntity(entity, (h) => B.settingOf(h, entity));
  if (!s || !s.enabled) return { at: out.at, ok: true, off: true };
  /* the SHOP's day (its zone — setting.timezone, else its country; M210), not the server's: at 02:00 IST "yesterday" is a closed day, and UTC still says today */
  const today = o.today || H.dayOf(out.at, s) || out.at.slice(0, 10);
  const began = s.enabled_at ? new Date(s.enabled_at).toISOString() : null; /* the ledger's first moment … */
  const beganDay = began ? H.dayOf(began, s) : null; /* … and its first day */

  /* 1 · the waiting list */
  try {
    out.posted.retried = await H.retryOutbox(entity, 100);
  } catch (e) {
    out.problems.push({ what: 'retry', why: String(e && e.message) });
  }

  /* 2 · walk-in days nobody closed (yesterday and the two before) */
  const closed = [1, 2, 3].map((item) => B.addDays(today, -item));
  const days = closed.filter((item) => !beganDay || item >= beganDay);
  out.posted.days = [];
  for (const d of days) {
    try {
      const b = H.dayBounds(d, s);
      const counters = await withEntity(entity, (h) => S.countersBilling(h, entity, b.from, b.to));
      for (const c of counters) {
        const r = await H.postDay(entity, c, d, { setting: s });
        if (r && r.entry_no && !r.duplicate) out.posted.days.push(c + ' ' + d + ' → ' + r.entry_no);
        if (r && r.queued) out.problems.push({ what: 'walk-in day', counter: c, day: d, why: r.why });
      }
    } catch (e) {
      out.problems.push({ what: 'walk-in day', day: d, why: String(e && e.message) });
    }
  }

  /* 2b · every chit of those closed days posted — after the days, so a bill its day did not name posts late */
  try {
    const from0 = H.dayBounds(closed[closed.length - 1], s).from,
      to = H.dayBounds(closed[0], s).to;
    const from = began && began > from0 ? began : from0;
    const sw = { found: 0, posted: 0, queued: 0, waiting: 0, nothing: 0 };
    if (from < to) {
      const found = await withEntity(entity, (h) => S.unpostedChits(h, entity, from, to, SWEEP_LIMIT));
      sw.found = found.length;
      for (const c of found) {
        const r = await H.postChit(entity, c.chit_id, { setting: s });
        if (!r || r.none || r.off || r.covered || r.duplicate || (r.payment && r.payment.duplicate)) sw.nothing++;
        else if (r.queued) sw.queued++;
        else if (r.waiting) sw.waiting++;
        else sw.posted++;
      }
      if (found.length >= SWEEP_LIMIT) out.problems.push({ what: 'more unposted chits than one check reads', read: SWEEP_LIMIT });
    }
    out.posted.swept = sw;
  } catch (e) {
    out.problems.push({ what: 'sweep for unposted chits', why: String(e && e.message).slice(0, 200) });
  }

  /* 2c · THE DAILY SWEEP (lib/books-recurring): repeating entries that fell due are proposed on the To-do — or posted, when the template says auto —
         and the accruals whose day has come are reversed. Idempotent by client_ref / source_ref, so every 6-hourly run is safe; a refusal is NAMED below. */
  try {
    const sw = await require('./books-recurring').sweep(entity, s, today);
    out.posted.recurring = {
      proposed: sw.proposed,
      proposed_reversals: sw.proposed_reversals,
      posted: sw.posted.filter((x) => !x.duplicate).length,
      reversed: sw.reversed.filter((x) => !x.duplicate).length
    };
    sw.problems.forEach((item) => out.problems.push(item));
  } catch (e) {
    out.problems.push({ what: 'recurring sweep', why: String(e && e.message).slice(0, 200) });
  }

  /* 3 · the ledger's own arithmetic */
  await withEntity(entity, async (h) => {
    const unbalanced = await S.unbalancedEntries(h, entity);
    unbalanced.forEach((item) => out.problems.push({ what: 'entry does not balance', entry_no: item.entry_no, dr_minor: item.dr, cr_minor: item.cr }));
    const drift = await S.balanceDrift(h, entity);
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
    /* the control accounts: debtors = Σ customers' open items; creditors = Σ suppliers' (SAP reconciliation account) */
    const chart = await S.accounts(h, entity);
    const rows = [];
    for (const role of ['debtors', 'creditors']) {
      const a = chart.find((x) => x.role === role);
      if (!a) continue;
      const net = await S.accountNet(h, entity, a.account_id);
      const control = role === 'debtors' ? net : -net;
      const parties = (await S.itemTotals(h, entity, a.account_id)).reduce((total, item) => total + item.total_minor, 0);
      rows.push({ role, code: a.code, control_minor: control, parties_minor: parties });
    }
    /* the journal's control accounts against the PARTY ITEMS (the bill-wise record) — two independent records of one thing */
    out.items_vs_control = rows.map((item) => Object.assign({ ok: item.control_minor === item.parties_minor }, item));
    out.items_vs_control
      .filter((item) => !item.ok)
      .forEach((item) =>
        out.problems.push({ what: item.role + ' control ≠ the open items', control_minor: item.control_minor, items_minor: item.parties_minor })
      );
    /* CBLedger.controls: control = Σ party balances (both grains of the month rows), no party missing, every day and entry balanced, TB balanced */
    try {
      const node = await B.controls(h, entity, today);
      out.controls = { ok: node.ok, checked: node.checked };
      (node.mismatches || []).forEach((item) => out.problems.push(Object.assign({ what: item.name }, item)));
    } catch (e) {
      out.problems.push({ what: 'controls could not run', why: String(e && e.message).slice(0, 200) });
    }
    /* every party has its number (a party added since yesterday) */
    try {
      const n = await require('../db').trySavepoint(h, () => require('./party-fields').numberAll(h, entity), 0);
      if (n) out.posted.parties_numbered = n;
    } catch (e) {
      cbLog.fellBack('books-nightly check: the helper failed — carried on without it', e);
    }
    const list = await S.waiting(h, entity, 20);
    out.waiting = list.map(H.waitingRow);
    if (list.length) out.problems.push({ what: 'waiting to post', count: list.length });
  });
  out.ok = out.problems.length === 0;
  await withEntity(entity, (h) => S.saveCheck(h, entity, out));
  if (!out.ok) L().warn('books.check', { entity_id: entity, problems: out.problems.length });
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
      L().info('books.nightly', { skipped: String(e && e.message).slice(0, 160) });
    }
    return { shops: 0 };
  }
  let count = 0;
  for (const id of ids) {
    try {
      const r = await check(id);
      if (r && r.ok === false) count++;
    } catch (e) {
      count++;
      L().warn('books.nightly-failed', { entity_id: id, error: String(e && e.message) });
    }
  }
  /* ⭐ RI1: the repeat-supply agreements whose run day has come — EVERY shop with one (ops.f_repeat_supply_due, b303), ledger on or off;
     the same sweep the seller's "Run what is due" presses. Skips quietly (named once) before b303. Never fails the books check. */
  let repeat = null;
  try {
    repeat = await require('./repeat-supply').sweepAll();
    if (repeat && repeat.problems) L().warn('repeat.sweep', repeat);
  } catch (e) {
    L().warn('repeat.sweep-failed', { error: String(e && e.message).slice(0, 160) });
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
