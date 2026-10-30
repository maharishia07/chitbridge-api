'use strict';
// lib/measure.js — TURN A SET OF CHITS INTO NUMBERS. One measurer, every caller.
// OWNS  the one measurement of a set of chits — open · overdue · ageing · per-currency sums — that Home, the folder pane and Reports read.
// FLOW  rows (lib/select) → measure(rows, opts) → scorecard(rows) → the route answers; nothing is summed anywhere else
// CARD 01-rail-core-the-chit/measure
//
// The second half of the pair (see lib/select.js): a folder metric, a counterparty scorecard and an ageing/SLA view
// are the same operation over different selectors. Written once so a folder and a supplier can never disagree about
// what "open" or "overdue" means — which they would within a month if each screen counted for itself.
//
// ── ⚠️ MIXED CURRENCIES ARE NEVER SUMMED ────────────────────────────────────────────────────────────────────────
// One total across INR and AED is a number that means nothing and gets believed because it looks like money.
// lib/money.js already settled this (summarise, mode 1 · split): per-currency buckets plus a count of rows carrying
// a currency but no value yet. Adopted, not re-derived.
const money = require('./money');

const DAY = 86400000;
const days = (from, to) => (!from || !to ? null : Math.round(((new Date(to) - new Date(from)) / DAY) * 10) / 10);

/** Median, not mean. One chit left open for a year drags an average into uselessness; the median keeps describing
 *  the typical case, which is what "how are we doing" actually asks. */
function median(nums) {
  const a = nums.filter((item) => Number.isFinite(item)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return Math.round((a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) * 10) / 10;
}

/* W2-RAIL R2: the status words are the ONE table (lib/rail-actions, read off the rail engine's transitions) — never spelled here */
const { OPEN_STATES: OPEN, CLOSED_STATES: CLOSED } = require('./rail-actions');

/**
 * moneyPart(list, opts) — the money slot of a measure, by who reads it (RAIL-146k). The owner (no opts.sides) gets the per-currency summary as it always was.
 * A cost-blind reader (opts.sides: Map chit_id to 'buy' | 'sell' | 'unknown', from lib/cost-view) gets it ONLY when every member is the shop's own sale, else
 * money:null and cost_hidden:true — so no shown figure holds a purchase, and no sum or difference of shown figures can recover one. A row the Map does not
 * name is not a sale. opts.money === false (Home, which prints counts only) leaves the slot out.
 */
function moneyPart(list, opts) {
  if (opts.money === false) return {};
  const summed = () => money.summarise(list.map((x) => ({ value: x.value === null || x.value === undefined ? null : Number(x.value), currency: x.currency })));
  if (!opts.sides || list.every((x) => opts.sides.get(String(x.chit_id)) === 'sell')) return { money: summed() };
  return { money: null, cost_hidden: true };
}

/**
 * measure(rows, opts) — the one shape both a folder and a counterparty are described in.
 *
 * opts.sides / opts.money — see moneyPart (a cost-blind reader's money; Home's counts-only read).
 * opts.overdue_days — how old an OPEN chit must be to count as overdue. Default 7.
 *   ⚠️ It is a PARAMETER, not a constant, because "overdue" is a policy and policies here are declared and
 *   cascadable (b130 policy flags), never hard-coded into a report. A number baked into a metric is a rule nobody
 *   can see or change.
 */
function measure(rows, opts = {}) {
  const list = rows || [];
  const now = opts.now ? new Date(opts.now) : new Date();
  const overdueDays = Number.isFinite(+opts.overdue_days) ? +opts.overdue_days : 7;

  const by = (k) =>
    list.reduce((total, x) => {
      const v = x[k] || 'unknown';
      total[v] = (total[v] || 0) + 1;
      return total;
    }, {});
  const open = list.filter((x) => OPEN.includes(x.current_status));
  const closed = list.filter((x) => CLOSED.includes(x.current_status));

  /**
   * ⚠️ THE CLOCK IS THE POINT, NOT THE COUNT. ServiceNow's SLA model is start/pause/stop, and the reason it exists
   * is that a count tells you how big the pile is while a clock tells you whether anyone is working it. `oldest`
   * and `median_age` are the honest subset we can compute today from data we already hold.
   *
   * ⚠️ AND `first_touch` IS NOT `age`. Time-to-first-read is a RESPONSE measure; time-to-close is a RESOLUTION
   * measure. ServiceNow keeps them apart deliberately — collapsing them hides "we answer fast and finish never",
   * which is the single most common way a team looks fine and is not.
   */
  const ages = list.map((x) => days(x.created_at, now));
  const firstTouch = list.filter((x) => x.read_at).map((x) => days(x.created_at, x.read_at));
  const toClose = closed.map((x) => days(x.created_at, x.touched_at));
  const oldest = list.reduce((total, x) => (!total || new Date(x.created_at) < new Date(total) ? x.created_at : total), null);
  const overdue = open.filter((x) => (days(x.created_at, now) || 0) >= overdueDays);

  const disputed = list.filter((x) => (+x.open_disputes || 0) > 0);
  const everDisputed = list.filter((x) => (+x.open_disputes || 0) + (+x.resolved_disputes || 0) > 0);
  const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null); // null, never 0 — see below

  return {
    count: list.length,
    by_status: by('current_status'),
    by_direction: by('direction'),
    open: open.length,
    closed: closed.length,
    /* ⚠️ null, NOT 0, when there is nothing to measure. "0% disputed" reads as a clean record; it is actually "we
       have never traded". A metric that cannot tell those apart will be used to make a decision that deserves
       both. Every rate here is null on an empty set. */
    unread: list.filter((x) => !x.read_at).length,
    overdue: overdue.length,
    overdue_days: overdueDays,
    clock: {
      oldest_at: oldest,
      oldest_age_days: oldest ? days(oldest, now) : null,
      median_age_days: median(ages),
      median_first_touch_days: median(firstTouch), // RESPONSE
      median_to_close_days: median(toClose), // RESOLUTION
      never_read: list.filter((x) => !x.read_at).length
    },
    disputes: {
      open: disputed.length,
      ever: everDisputed.length,
      rate_pct: pct(everDisputed.length, list.length)
    },
    ...moneyPart(list, opts)
  };
}

/**
 * scorecard(rows, opts) — measure(), plus the two things that only make sense about a COUNTERPARTY.
 *
 * ⚠️ IT IS DERIVED ENTIRELY FROM CO-HELD RECORDS, which is the whole reason it is worth having. Every ERP scorecard
 * is built from one side's data and can therefore be argued with. Both parties hold matching copies of every chit
 * counted here, so the supplier can check the arithmetic against their own records and reach the same answer.
 * That is a scorecard nobody can dispute — and CB gets it without asking anyone for data.
 *
 * ⚠️ IT SCORES BEHAVIOUR, NOT WORTH. Deliberately no single 0–100 "supplier grade": one number invites a ranking,
 * a ranking invites a decision, and the decision would rest on a weighting nobody agreed. Report the components.
 */
function scorecard(rows, opts = {}) {
  const m = measure(rows, opts);
  const list = rows || [];
  const closed = list.filter((x) => CLOSED.includes(x.current_status));
  const completed = list.filter((x) => x.current_status === 'completed');
  const rejected = list.filter((x) => x.current_status === 'rejected' || x.current_status === 'cancelled');
  const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

  const sent = list.filter((x) => x.direction === 'sent');
  const received = list.filter((x) => x.direction === 'received');
  const firstAt = list.reduce((total, x) => (!total || new Date(x.created_at) < new Date(total) ? x.created_at : total), null);
  const lastAt = list.reduce((total, x) => (!total || new Date(x.created_at) > new Date(total) ? x.created_at : total), null);

  return Object.assign(m, {
    relationship: {
      first_at: firstAt,
      last_at: lastAt,
      /* Direction split says what the relationship IS. Mostly-sent = they are your supplier; mostly-received =
         you are theirs. A scorecard that did not say which way round it read would be describing two different
         relationships with one set of numbers. */
      you_sent: sent.length,
      you_received: received.length,
      shape: sent.length && received.length ? 'both ways' : sent.length ? 'you buy from them' : received.length ? 'they buy from you' : 'none'
    },
    completion: {
      closed: closed.length,
      completed: completed.length,
      rejected_or_cancelled: rejected.length,
      completion_rate_pct: pct(completed.length, closed.length)
    }
  });
}

module.exports = { measure, scorecard, median, OPEN, CLOSED };
