/* ADOPTED from chitbridge-engines v1.66.0 · rollup · sha256 a1d4915f0edf71281d88f72aaf2514086458b11fecdc028b3aebfcdb0caf3014 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · rollup. Edited ONLY in chitbridge-engines/src/rollup.js; every platform adopts a released version of it. */
(function (root) {
'use strict';
/**
 * ── ⭐⭐⭐ rollup.js — A DAY, A WEEK, A MONTH: ONE SET OF FIGURES, COMPUTED ONCE ───────────────────────────────
 *
 * Athi, 2026-09-19: *"we have today's sale / bill, it should go in there, the same format as in the server …
 * at some intervals, that has to be summarised. assuming we are summarising once per day … possibly that day's
 * summary chit. we have to have other folder called summary, so we keep one chit for every day as a summary
 * chit. each week summarise day chit to week chit. summarise, summarise month chit, so we will have 365 chit
 * per year, if we want to check trend on weekly basis we have 52 chit, monthly trend we can look at 12 chit,
 * that is all. after a certain days, we don't need to refer the daily chit data. so, this can be kept in local
 * and also in server. this includes any returns and so on."*
 *
 * ── ⚠️⚠️⚠️ WHY THIS IS AN ENGINE AND NOT A FUNCTION IN THE COUNTER ───────────────────────────────────────────
 *
 * The same arithmetic already existed in THREE places and two of them disagreed:
 *
 *   · till.html CloudHost.state()  — correct since 2026-09-18: a credit note is not a sale, and a refund is
 *                                    money OUT of the drawer
 *   · till.js todayTotals()        — ⚠️ WRONG: `count: rows.length` called a return a sale, and `by` only ever
 *                                    ADDED payments, so the desktop counter's drawer figure was over by exactly
 *                                    the day's refunds. The page was fixed; the program on the shop's PC was not.
 *   · till.html dayCloseSheet()    — correct, and carrying a long note about the four figures that disagreed
 *
 * A fourth copy for the summary would have been the fourth chance to get it wrong, on the figures that become
 * the shop's PERMANENT record once the daily detail is purged. So the rule lives here, once.
 * [[feedback-no-duplicate-functions]] [[project-js-unification]] [[feedback-ui-replaceable-logic-in-engines]]
 *
 * ── ⚠️ NO DATABASE, NO NETWORK, NO DISK ─────────────────────────────────────────────────────────────────────
 *
 * It takes rows and returns figures. That is what lets the same file run on the shop's PC with the line down and
 * on the server, which is Athi's *"this can be kept in local and also in server"* — one rule, not two that drift.
 *
 * ⚠️ THE @stage TAG IS GONE, and its removal is the record: GET /api/till/summary reaches this module as of
 * 2026-09-20 ([TILL-124]), so it is LIVE and the tag would now be a lie on the status report. It said `tested`
 * while the server half of Athi's *"local and also in server"* was unbuilt. tests/engine-boundary.js derives
 * `live` from reachability, so nothing needs to be added in its place.
 */

/** ⚠️ THE ONE PLACE that decides what a return is. `kind` is the counter's own marker (till.html isReturnRow). */
function isReturn(b) { return !!(b && b.kind === 'credit_note'); }
/**
 * ⚠️ THE ONE PLACE that decides what an expense is — same discipline as isReturn(), for the same reason.
 * Athi: "we are not recording against each class... we are not classifying the expense class etc currently,
 * but let it be that way" — no chart-of-accounts, no debit/credit, just what was paid, to whom/for what, and
 * in which tender, so the drawer's own balance is right. `spent` (never `payments` — that field means money
 * TAKEN everywhere else this engine reads) is the row's own money-out array, same shape as a return's
 * `refunds`.
 */
/**
 * ⭐ v1.32.0 (M144b) — A DESPATCH OR RECEIVE NOTE IS NOT A SALE. A chit whose `doc` (on the row, or in its business_json)
 * is 'despatch' or 'receive' moves stock; it is no bill, so the day's bill count never includes it. A credit note stays a return.
 */
function isStockNote(b) {
  const d = b && (b.doc || (b.business_json && b.business_json.doc));
  return d === 'despatch' || d === 'receive';
}
function isExpense(b) { return !!(b && b.kind === 'expense'); }

/* ⭐ money.round — THE one rounder (C:devSPEC-money-one-reader.md). CBMoney in a page; elsewhere the SAME rule.
   ⚠️ NO require('./money') here, on purpose: vendor-till's wrapForBrowser refuses an undeclared require, and the
   shop-PC kit copy of this file runs without money.js beside it. tests/money-round holds this copy equal. */
function roundMoney_(n) {
  if (typeof CBMoney !== 'undefined' && CBMoney.round) return CBMoney.round(n);
  var x = Number(n); if (!isFinite(x)) return x;
  var c = Math.round(Number((Math.abs(x) * 100).toPrecision(15))) / 100;
  return (x < 0 && c !== 0) ? -c : c;
}
const r2 = (n) => roundMoney_(Number(n) || 0);

/**
 * ── ⭐⭐ THE FIGURES, AND WHY THERE ARE SIX OF THEM ─────────────────────────────────────────────────────────
 *
 * A return does not net against a sale in every column, and pretending it does is what produced four screens
 * that disagreed (till.html, 2026-09-18). An expense is the same shape of problem one column further along —
 * money that leaves a tender without ever having been a sale OR a refund of one. Each figure answers a
 * different question:
 *
 *   count         how many SALES were made      ⚠️ a return or an expense is not a sale, so neither is counted here
 *   returns       how many came back
 *   gross         what was sold, before returns
 *   refunds       what was handed back (POSITIVE — it is an amount, and its direction is in its name)
 *   expenseCount  how many expenses were paid — the SAME split as returns/refunds, one word short of a pair
 *   expenses      what was paid OUT of the drawer for something that was not a refund (POSITIVE, same reasoning)
 *   total         what the shop actually kept = gross − refunds − expenses
 *   by            what is in the drawer, per tender ⚠️ a refund OR an expense SUBTRACTS: money handed back or
 *                 paid out has left the drawer, whichever tender it left from
 *
 * ⚠️⚠️ A CREDIT NOTE IS STORED NEGATIVE, deliberately, so `total` nets by itself. An expense is stored
 * negative for the identical reason — every other column has to be told. [[feedback-silence-is-the-bug]]
 */
function totals(rows) {
  const by = {};
  let count = 0, returns = 0, gross = 0, refunds = 0, expenseCount = 0, expenses = 0;
  for (const b of (rows || [])) {
    if (isStockNote(b)) continue;
    if (isReturn(b)) {
      returns++;
      refunds = r2(refunds + Math.abs(Number(b.total) || 0));
      /* ⚠️ money OUT — `refunds` on the row, never `payments`, because every reader of payments assumes taken */
      for (const x of (b.refunds || [])) by[x.how] = r2((by[x.how] || 0) - (Number(x.amount) || 0));
    } else if (isExpense(b)) {
      expenseCount++;
      expenses = r2(expenses + Math.abs(Number(b.total) || 0));
      /* ⚠️ money OUT — `spent`, never `payments`, same reasoning as a return's `refunds` */
      for (const x of (b.spent || [])) by[x.how] = r2((by[x.how] || 0) - (Number(x.amount) || 0));
    } else {
      count++;
      gross = r2(gross + (Number(b.total) || 0));
      for (const p of (b.payments || [])) by[p.how] = r2((by[p.how] || 0) + (Number(p.amount) || 0));
    }
  }
  return { count, returns, gross, refunds, expenseCount, expenses, total: r2(gross - refunds - expenses), by };
}

/**
 * ── ⭐⭐ FOLDING A PERIOD OUT OF SMALLER ONES ─────────────────────────────────────────────────────────────────
 *
 * Athi: *"each week summarise day chit to week chit. summarise, summarise month chit."* So a week is built from
 * seven DAY summaries, not by re-reading seven days of bills — which is the whole point of keeping summaries:
 * *"after a certain days, we don't need to refer the daily chit data."*
 *
 * ⚠️⚠️ THEREFORE IT MUST GIVE THE SAME ANSWER EITHER WAY. fold([summarise(a), summarise(b)]) has to equal
 * summarise(a ++ b), or the month stops agreeing with the days it was built from and nobody can say which is
 * right. tests/rollup.test.js holds those two equal; it is the only reason this is safe to purge behind.
 */
function fold(parts) {
  const by = {};
  let count = 0, returns = 0, gross = 0, refunds = 0, expenseCount = 0, expenses = 0;
  for (const p of (parts || [])) {
    const t = (p && p.totals) || p || {};
    count += Number(t.count) || 0;
    returns += Number(t.returns) || 0;
    gross = r2(gross + (Number(t.gross) || 0));
    refunds = r2(refunds + (Number(t.refunds) || 0));
    /* ⚠️ a summary folded before this existed has no .expenseCount/.expenses field; Number(undefined)||0 reads
       that as 0, not a hole — an old day never grows an expense it never recorded, it just cannot show one */
    expenseCount += Number(t.expenseCount) || 0;
    expenses = r2(expenses + (Number(t.expenses) || 0));
    for (const k of Object.keys(t.by || {})) by[k] = r2((by[k] || 0) + (Number(t.by[k]) || 0));
  }
  return { count, returns, gross, refunds, expenseCount, expenses, total: r2(gross - refunds - expenses), by };
}

/* ── the period keys ───────────────────────────────────────────────────────────────────────────────────────── */

const pad = (n) => (n < 10 ? '0' : '') + n;
/** ⚠️ UTC THROUGHOUT. A shop's day is local, but a key that shifts with the machine's timezone would re-file
 *  yesterday under a different name after a laptop crosses a border. The DAY STRING the counter already writes
 *  (bills-YYYY-MM-DD.jsonl) is the authority; these parse and re-emit it, never re-derive it from a clock. */
function dayKey(d) { return new Date(d).toISOString().slice(0, 10); }
function monthKey(d) { return new Date(d).toISOString().slice(0, 7); }

/**
 * ⚠️ ISO-8601 WEEK (Monday–Sunday, week 1 is the one holding the first Thursday). Athi said *"52 chit"*; an ISO
 * year has 52 OR 53 weeks, and this returns the true number rather than forcing 52 — a summary that quietly
 * dropped a week would be a hole in the record at exactly the year boundary.
 */
function weekKey(d) {
  const t = new Date(new Date(d).toISOString().slice(0, 10) + 'T00:00:00Z');
  /* shift to the Thursday of this week — that Thursday's year is the ISO week-year */
  const dow = (t.getUTCDay() + 6) % 7;                      /* Mon=0 … Sun=6 */
  t.setUTCDate(t.getUTCDate() - dow + 3);
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const fdow = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fdow + 3);
  const week = 1 + Math.round((t - firstThu) / (7 * 24 * 3600 * 1000));
  return t.getUTCFullYear() + '-W' + pad(week);
}

/**
 * ── ⭐⭐⭐ THE YEAR, AND IT IS THE FINANCIAL ONE ──────────────────────────────────────────────────────────────
 *
 * Athi: *"please confirm that MIS I asked for has been completed, in the sense, summing weekly, monthly,
 * yearly?"* — day, week and month were built and proven; the year was not there at all. This is it.
 *
 * ⚠️⚠️ AND IT DEFAULTS TO APRIL, WHICH IS A DECISION AND NOT A DETAIL. India's financial year runs 1 April to
 * 31 March, every return a shop files is against it, and a January-to-December total is a number no Indian
 * shopkeeper has any use for. `fyStart` makes it a shop's own setting; the default names our country first.
 * [[feedback-country-first]]
 *
 * ⭐ THE KEY SAYS WHICH IT IS, so nobody has to remember: '2026-27' is a financial year, '2026' a calendar one.
 * A key that looked the same for both is how two shops' figures end up added together.
 */
function yearKey(d, fyStart) {
  const start = Math.min(12, Math.max(1, Math.floor(Number(fyStart) || 4)));
  const t = new Date(d);
  const y = t.getUTCFullYear(), m = t.getUTCMonth() + 1;
  if (start === 1) return String(y);
  const from = m >= start ? y : y - 1;
  return from + '-' + pad((from + 1) % 100);
}

/**
 * ⭐ v1.66.0 (RPT1) — A QUARTER, AND IT IS THREE MONTHS OF THE SHOP'S OWN YEAR. quarterKey('2026-08-15', 4) → '2026-27-Q2';
 * fyStart 1 → '2026-Q3'. ⚠️ NO DEFAULT YEAR HERE (unlike yearKey, whose April default adopted callers pin): a quarter is new, so
 * nobody depends on a guess, and an Australian Q1 is July–September — guessing April would file it under the wrong quarter.
 */
function fyStartOf_(fyStart, what) {
  const s = Number(fyStart);
  if (!(Number.isInteger(s) && s >= 1 && s <= 12)) {
    throw new Error('rollup: ' + what + ' needs fyStart — the month the shop\'s financial year starts (1-12, from its books setting or country pack); there is no default year.');
  }
  return s;
}
function quarterKey(d, fyStart) {
  const start = fyStartOf_(fyStart, 'a quarter');
  const m = new Date(d).getUTCMonth() + 1;
  return yearKey(d, start) + '-Q' + (Math.floor(((m - start + 12) % 12) / 3) + 1);
}

/** ⚠️ PERIODS ARE THE STORED ONES — the server route and the kit's file count read this list to find summary chits. A quarter is
 *  DERIVED (folded from three month summaries, never written as a chit), so it lives in DERIVED_PERIODS and keyOf() knows both. */
const PERIODS = ['day', 'week', 'month', 'year'];
const DERIVED_PERIODS = ['quarter'];
/**
 * ⚠️ `opts` IS OPTIONAL AND EVERY EXISTING CALLER PASSES NOTHING. Day, week and month never look at it; only
 * the year does, and only for where a shop's year starts.
 */
function keyOf(period, d, opts) {
  if (period === 'day') return dayKey(d);
  if (period === 'week') return weekKey(d);
  if (period === 'month') return monthKey(d);
  if (period === 'year') return yearKey(d, opts && opts.fyStart);
  if (period === 'quarter') return quarterKey(d, opts && opts.fyStart);
  throw new Error('rollup: no such period "' + period + '" — it is one of ' + PERIODS.concat(DERIVED_PERIODS).join(', '));
}

/** which day-keys a week or month is made of, given the days that actually exist */
function daysIn(period, key, days, opts) {
  return (days || []).filter((d) => keyOf(period, d, opts) === key).sort();
}

/**
 * ── ⚠️⚠️ IS THIS PERIOD OVER? ────────────────────────────────────────────────────────────────────────────────
 *
 * A summary of a period still running is a figure that will change after it was published — and once the daily
 * detail behind it is purged, nobody can ever correct it. So only a CLOSED period is ever summarised, and "now"
 * is passed in rather than read from a clock, so a test can prove the boundary.
 */
function isClosed(period, key, now, opts) {
  const today = dayKey(now || Date.now());
  return keyOf(period, today, opts) !== key;
}

/**
 * ── ⭐⭐⭐ THE SUMMARY RECORD ──────────────────────────────────────────────────────────────────────────────────
 *
 * One of these per period, kept locally in `summary/` and sent as a chit. `source` is what it was folded from,
 * which is what makes a month auditable back to its weeks after the bills themselves are gone.
 */
function summary(period, key, totalsIn, opts) {
  const o = opts || {};
  return {
    period, key,
    till: o.till || null,
    totals: totalsIn,
    source: o.source || null,          /* the day/week keys this was folded from — null when read from bills */
    bills_from: o.bills_from || null,  /* first and last bill number, so a run can be checked for gaps */
    bills_to: o.bills_to || null,
    summarised_at: o.at || new Date().toISOString(),
    /* ⚠️ FILLED IN LATER, BY WHOEVER SENDS IT. Never guessed here — a record that claims to have reached
       ChitBridge when it has not is the failure this whole rollup exists to make visible. */
    synced_at: null,
    chit_ref: o.chit_ref || null,
  };
}

/** ⭐ THE CHIT, in exactly the shape tools/tally-connector/till.js already queues (chitOf / chitOfDoc). */
function chitOf(sum) {
  const t = sum.totals || {};
  const who = (sum.till && (sum.till.name || sum.till.id)) || 'Counter';
  const label = sum.period.charAt(0).toUpperCase() + sum.period.slice(1);
  const subject = label + ' summary — ' + sum.key + ' — ' + who;
  return {
    recipients: [{ self: true, name: 'self' }],
    /* ⚠️ 'general', not 'order' — a summary is not a sale, and a purpose that said so would double the books */
    purpose: 'general',
    subject, manual_subject: subject,
    client_ref: refOf(sum),
    business_json: { summary: sum, till: sum.till || null },
    line_items: [],
  };
}

/** ⚠️ STABLE AND UNIQUE: re-sending the same period must be the same reference, or the server grows duplicates. */
function refOf(sum) {
  /* ⚠️ A LETTER PER PERIOD, AND A MISSING ONE IS SILENT: 'SUM/undefined/C1/2026-27' is a perfectly valid
     string, so a year summary would have been sent under a reference nothing could ever match again. */
  const p = { day: 'D', week: 'W', month: 'M', year: 'Y' }[sum.period];
  if (!p) throw new Error('rollup: no reference letter for period "' + sum.period + '"');
  return 'SUM/' + p + '/' + ((sum.till && sum.till.id) || 'C1') + '/' + sum.key;
}

/**
 * ── ⭐⭐⭐ THE PURGE, AND THE FIVE THINGS THAT MUST BE TRUE BEFORE A SALE IS DELETED ([TILL-123]) ─────
 *
 * Athi: *"after a certain days, we don't need to refer the daily chit data"* — and then, asked for the number:
 * *"do the purge with a floor of 90 days."*
 *
 * ⚠️⚠️⚠️ THIS IS THE ONLY CODE IN THE COUNTER THAT DESTROYS A RECORD OF MONEY TAKEN. It is built the way
 * lib/retention.js is built, for the same reason: **dry run first**. planPurge() only ever REPORTS, and says of
 * every day it is NOT purging exactly why — because a purge that silently skips is indistinguishable from a
 * purge that silently deletes the wrong thing. [[feedback-silence-is-the-bug]] [[feedback-adopt-dont-reinvent]]
 *
 * ⭐ A FLOOR IS A FLOOR, NOT A DEADLINE. 90 days is the EARLIEST a day may go, never a promise that it will.
 * Every one of these must also hold, and each closes a way of losing a sale for good:
 *
 *   1. the day is older than the floor
 *   2. its day summary EXISTS                 — or the day's figures would vanish with its bills
 *   3. that summary has SYNCED                — or the shop's only record of it is this disk
 *   4. no bill of that day is still QUEUED    — an unsent sale is one ChitBridge has never seen
 *   5. its week AND month are summarised and synced
 *
 * ⚠️⚠️ (5) IS NOT BELT-AND-BRACES, IT CLOSES A REAL HOLE. rollUp() enumerates the days it knows about by
 * listing `bills-*.jsonl`. Delete a day's bills before its week has been folded and that day simply stops
 * existing as far as the fold is concerned — the week would then be written from the days that happened to
 * survive, be wrong, and be written ONCE. With a 90-day floor the week and month are long closed, so requiring
 * them costs nothing and the hole cannot open.
 */
const FLOOR_DAYS = 90;
/** ⚠️ A RUNAWAY SWEEP IS REFUSED, NOT PERFORMED — the same guardrail lib/retention.js keeps. A counter that
 *  has been offline for two years catches up over several runs instead of deleting everything in one. */
const MAX_PER_RUN = 200;

/**
 * planPurge({ days, summaryOf, queuedDays, floorDays, now, max }) → { due, kept, floor, max }
 *
 *   days        the day keys that have a bills file on disk
 *   summaryOf   (period, key) → the stored summary, or null. Pure: the caller does the reading.
 *   queuedDays  a Set of day keys that still have something waiting to be sent
 *
 * ⚠️ IT DELETES NOTHING. It returns what WOULD go and, for everything else, why not.
 */
function planPurge(opts) {
  const o = opts || {};
  const floorDays = Number(o.floorDays) > 0 ? Math.floor(Number(o.floorDays)) : FLOOR_DAYS;
  const max = Number(o.max) > 0 ? Math.floor(Number(o.max)) : MAX_PER_RUN;
  const summaryOf = o.summaryOf || function () { return null; };
  const queued = o.queuedDays || new Set();
  const cutoff = dayKey(new Date(new Date(dayKey(o.now || Date.now()) + 'T00:00:00Z').getTime() - floorDays * 86400000));

  const due = [], kept = [];
  for (const d of (o.days || []).slice().sort()) {
    /* 1 · the floor. `<` not `<=`: a day exactly on the floor is still inside it. */
    if (!(d < cutoff)) { kept.push({ day: d, why: 'inside the ' + floorDays + '-day floor' }); continue; }
    /* 4 · an unsent sale is one ChitBridge has never seen — checked early, because it is the worst to get wrong */
    if (queued.has(d)) { kept.push({ day: d, why: 'a bill of that day is still waiting to be sent' }); continue; }
    /* 2 + 3 · the day itself */
    const ds = summaryOf('day', d);
    if (!ds) { kept.push({ day: d, why: 'not summarised yet' }); continue; }
    if (!ds.synced_at) { kept.push({ day: d, why: 'its summary has not reached ChitBridge' }); continue; }
    /* 5 · and the periods folded FROM it */
    let blocked = null;
    for (const period of ['week', 'month']) {
      const ps = summaryOf(period, keyOf(period, d));
      if (!ps) { blocked = 'its ' + period + ' is not summarised yet'; break; }
      if (!ps.synced_at) { blocked = 'its ' + period + ' summary has not reached ChitBridge'; break; }
    }
    if (blocked) { kept.push({ day: d, why: blocked }); continue; }
    due.push(d);
  }

  /* ⚠️ the cap is applied LAST and to the OLDEST first, so a catch-up run makes progress in date order */
  const over = due.length > max ? due.slice(max) : [];
  for (const d of over) kept.push({ day: d, why: 'over the ' + max + '-per-run limit — the next run takes it' });
  return { due: due.slice(0, max), kept, floor: floorDays, cutoff, max };
}

/**
 * ── ⭐⭐⭐ ONE SHOP, MANY COUNTERS ([TILL-124]) ────────────────────────────────────
 *
 * Athi: *"this can be kept in local and also in server."* This is the half that has no home on a counter: a
 * till can fold its OWN day, week and month, but it cannot see the till at the other end of the shop. Two
 * counters each send `day-2026-09-16`, and the shop's takings for that day are the two folded together.
 *
 * Takes the summaries as stored (newest first) and returns one row per period key.
 *
 * ⚠️⚠️ ONE ROW PER COUNTER PER PERIOD, NEWEST WINS — AND THIS IS THE DANGEROUS PART. A counter re-sends a
 * period only when its own copy was lost, so the newest is the corrected one; counting both would DOUBLE that
 * day's takings, which is the worst thing this function could do. Input must be newest-first: the first
 * sighting of a (key, counter) pair is kept and every later one is a superseded re-send.
 *
 * ⚠️ A SUMMARY WITH NO COUNTER IS STILL SOMEBODY'S. It is folded under 'C?' rather than dropped — losing a
 * day's takings because a till id was missing would be the same silent hole in a different place.
 */
function acrossCounters(summaries) {
  const seen = new Set(), byKey = new Map();
  for (const sum of (summaries || [])) {
    if (!sum || !sum.key || !sum.totals) continue;
    const till = (sum.till && (sum.till.id || sum.till.name)) || 'C?';
    const dedupe = sum.key + '\u0000' + till;
    if (seen.has(dedupe)) continue;                 /* a superseded re-send of the same period by the same till */
    seen.add(dedupe);
    if (!byKey.has(sum.key)) byKey.set(sum.key, []);
    byKey.get(sum.key).push({
      till: { id: (sum.till && sum.till.id) || null, name: (sum.till && sum.till.name) || null },
      totals: sum.totals, at: sum.summarised_at || null, source: sum.source || null,
    });
  }
  /* ⭐ newest period first, which is how every screen that reads this wants it */
  return Array.from(byKey.keys()).sort().reverse().map((key) => ({
    key,
    totals: fold(byKey.get(key).map((p) => p.totals)),
    counters: byKey.get(key),
    /* ⭐ v1.66.0 — the parts the counters were folded from (union), so coverage() still says "short" on the shop-wide row; null when none said */
    source: sourceUnion_(byKey.get(key)),
  }));
}
function sourceUnion_(parts) {
  const all = new Set();
  for (const p of parts) for (const k of (p.source || [])) all.add(k);
  return all.size ? Array.from(all).sort() : null;
}

/**
 * ── ⭐⭐⭐ A SHORT PERIOD SAYS SO ([TILL-184]) ───────────────────────────────────────
 *
 * Athi, on a financial year folded from fewer than twelve months: *"no we can say upto"*.
 *
 * He is right, and it is the third option I had missed. A shop's FIRST financial year starts whenever it
 * opened, not in April, so it can never have twelve months — and the two obvious answers are both wrong:
 *   · refuse to summarise it   → the Years view is empty for ever, with nothing said
 *   · summarise it silently    → ₹1.2 lakh sits under "2026-27" looking like a full year's trading
 * So it is folded AND labelled. A figure that states its own coverage cannot be misread.
 * [[feedback-write-for-the-shopkeeper]]
 *
 * ⚠️ IT READS `source`, which summary() already records — the keys this was folded from. Nothing new is
 * stored, and a summary written before this existed still answers.
 */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
const FULL = { day: 1, week: 7, month: 28, quarter: 3, year: 12 };
function coverage(sum) {
  const src = (sum && sum.source) || null;
  const period = sum && sum.period;
  if (!src || !src.length) return { partial: false, parts: 0, say: '' };
  const parts = src.length;
  const full = FULL[period] || 0;
  /* ⚠️ A MONTH IS 28..31 DAYS, so "full" cannot be an equality — only a floor, or February is always short */
  const partial = (period === 'year' || period === 'quarter' || period === 'week' || period === 'month') ? parts < full : false;
  if (!partial) return { partial: false, parts: parts, from: src[0], to: src[parts - 1], say: '' };
  const to = src[parts - 1];
  let say = 'up to ' + to;
  if (period === 'year' || period === 'quarter') {
    /* ⭐ '2026-08' reads as August to a person; the key does not. */
    const m = /^(\d{4})-(\d{2})$/.exec(String(to));
    if (m) say = 'up to ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1];
  }
  return { partial: true, parts: parts, from: src[0], to: to, say: say };
}

/**
 * ── ⭐⭐⭐ THE SERIES: 52 WEEKS · 12 MONTHS · QUARTERS · YEARS, EACH BESIDE LAST YEAR (v1.66.0 · RPT1) ─────────
 *
 * Athi, 2026-10-17: *"no one wants to see the text, only pictures, comparison … 52 weeks, 12 months, quarter, say 7
 * years of annual comparison."* ONE comparison calculation, here, so the server, the back office and the shop PC
 * (offline) draw the same trend — a page never computes a second answer. docs/planning/metrics/REQUIREMENT.md §3.
 * FLOW: R2R · reports. Pure: `now`, `fyStart` and `currency` are passed in; there is no clock and no default year.
 */
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;   /* '2026-27' is a year, not a 27th month */

/**
 * fromMonths(monthRows, fyStart, period = 'quarter' | 'year') → one row per quarter (or year), newest first:
 * { period, key, totals (fold of its months), source: [its month keys], parts_short: [months that are short themselves] }.
 * ⚠️ ONE ROW PER MONTH (acrossCounters() output, or one counter's months). A month seen twice is refused, because a
 * re-send folded twice doubles the quarter — the worst thing this could do, and it would look like a good quarter.
 */
function fromMonths(monthRows, fyStart, period) {
  const p = period || 'quarter';
  if (p !== 'quarter' && p !== 'year') throw new Error('rollup.fromMonths folds months into a quarter or a year, not "' + p + '"');
  const opts = { fyStart: fyStartOf_(fyStart, 'rollup.fromMonths') };
  const seen = new Set(), byKey = new Map();
  for (const r of (monthRows || [])) {
    if (!r || !r.totals) continue;
    if (!MONTH_RE.test(String(r.key))) throw new Error('rollup.fromMonths: "' + r.key + '" is not a month key (YYYY-MM)');
    if (seen.has(r.key)) throw new Error('rollup.fromMonths: month ' + r.key + ' appears twice — pass one row per month (acrossCounters() output)');
    seen.add(r.key);
    const k = keyOf(p, r.key + '-01', opts);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  return Array.from(byKey.keys()).sort().reverse().map((key) => monthFold_(p, key, byKey.get(key)));
}
function monthFold_(period, key, rows) {
  rows.sort((a, b) => (a.key < b.key ? -1 : 1));
  return {
    period, key,
    totals: fold(rows.map((r) => r.totals)),
    source: rows.map((r) => r.key),
    /* a month that is itself short (coverage()'s rule) makes its quarter or year short too — said, never hidden */
    parts_short: rows.filter((r) => coverage({ period: 'month', source: r.source }).partial).map((r) => r.key),
  };
}

/**
 * lastYearKey(period, key) → the same period one year earlier, or null when there is none:
 *   day '2026-03-01' → '2025-03-01' (29 February → null) · week '2026-W10' → '2025-W10' (W53 → null: no week 53 last year)
 *   month '2026-08' → '2025-08' · quarter '2026-27-Q2' → '2025-26-Q2' ('2026-Q2' → '2025-Q2') · year '2026-27' → '2025-26'.
 * A key that is not of its period's form throws: that is a caller's bug, not "no last year".
 */
function lastYearKey(period, key) {
  const k = String(key == null ? '' : key);
  const re = { day: /^(\d{4})-(\d{2})-(\d{2})$/, week: /^(\d{4})-W(\d{2})$/, month: MONTH_RE,
               quarter: /^(\d{4})(-\d{2})?-Q([1-4])$/, year: /^(\d{4})(-\d{2})?$/ }[period];
  if (!re) throw new Error('rollup.lastYearKey: no such period "' + period + '"');
  const m = re.exec(k);
  if (!m) throw new Error('rollup.lastYearKey: "' + k + '" is not a ' + period + ' key');
  const y = Number(m[1]) - 1;
  if (period === 'day') return (m[2] === '02' && m[3] === '29') ? null : y + '-' + m[2] + '-' + m[3];
  if (period === 'week') return m[2] === '53' ? null : y + '-W' + m[2];
  if (period === 'month') return y + '-' + m[2];
  const year = m[2] ? y + '-' + pad((y + 1) % 100) : String(y);   /* the key form says split or single, as yearKey writes it */
  return period === 'quarter' ? year + '-Q' + m[3] : year;
}

/* ⚠️ money.decimals' rule, without require('./money') (see roundMoney_): CBMoney on a page, else the same Intl lookup.
   tests/rollup.test.js holds the two equal. The currency is checked as an ISO code before this is reached. */
function decimalsOf_(currency) {
  if (typeof CBMoney !== 'undefined' && CBMoney.decimals) return CBMoney.decimals(currency);
  const d = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  return (Number.isInteger(d) && d >= 0 && d <= 4) ? d : 2;
}
/** a summary's major-unit figure → whole minor units of its currency (₹12.34 → 1234, ¥1234 → 1234), half away from zero */
function toMinor_(major, currency) {
  const x = Number(major);
  if (!Number.isFinite(x)) return null;
  const c = Math.round(Number((Math.abs(x) * Math.pow(10, decimalsOf_(currency))).toPrecision(15)));
  return (x < 0 && c !== 0) ? -c : c;
}

/** how many slots each period may ask for — years clamp at 10 (REQUIREMENT §3 rule 7) */
const SERIES_MAX = { day: 366, week: 53, month: 24, quarter: 12, year: 10 };

/** the options a series cannot guess: each missing one throws in words that name it */
function seriesOpts_(period, n, opts) {
  const o = opts || {};
  if (!SERIES_MAX[period]) throw new Error('rollup.series: no such period "' + period + '" — it is one of ' + Object.keys(SERIES_MAX).join(', '));
  const count = Math.floor(Number(n));
  if (!(count >= 1)) throw new Error('rollup.series: n must be a whole number of periods, 1 or more');
  const fyStart = fyStartOf_(o.fyStart, 'rollup.series');
  const currency = String(o.currency || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('rollup.series needs currency — the shop\'s ISO code (INR, AUD, AED …) — to give whole minor units; there is no default currency.');
  if (o.now == null || isNaN(new Date(o.now).getTime())) throw new Error('rollup.series needs now — the moment to measure from; it reads no clock.');
  return { n: Math.min(count, SERIES_MAX[period]), fyStart, currency, now: o.now };
}

/**
 * The shop-wide rows a series reads: stored day · week · month summaries as they are; a quarter folded from months; a
 * year folded from months, and a STORED year only where no month exists AND its own months all fall in that year under
 * this fyStart — a year written with the old April default on a July shop is left out, not shown under the wrong year.
 */
function seriesRows_(period, summaries, fyStart) {
  const of = (p) => acrossCounters((summaries || []).filter((s) => s && s.period === p));
  if (period === 'day' || period === 'week' || period === 'month') return of(period);
  const folded = fromMonths(of('month'), fyStart, period);
  if (period === 'quarter') return folded;
  const have = new Set(folded.map((r) => r.key));
  const fits = (r) => (r.source || []).every((m) => MONTH_RE.test(m) && yearKey(m + '-01', fyStart) === r.key);
  return folded.concat(of('year').filter((r) => !have.has(r.key) && fits(r)));
}

/** the n slot keys ending at the period that holds `now`, oldest first (left → right on a chart) */
function slotKeys_(period, n, now, fyStart) {
  const keys = [], back = { month: 1, quarter: 3, year: 12 }[period];
  const t = new Date(dayKey(now) + 'T00:00:00Z');
  for (let i = 0; i < n; i++) {
    keys.unshift(keyOf(period, t, { fyStart }));
    if (back) { t.setUTCDate(1); t.setUTCMonth(t.getUTCMonth() - back); } else t.setUTCDate(t.getUTCDate() - (period === 'week' ? 7 : 1));
  }
  return keys;
}

/** how many parts make the period whole: a week 7 days, a month its own days, a quarter 3 months, a year 12 */
function expectedParts_(period, key) {
  if (period === 'month') { const m = MONTH_RE.exec(key); return new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate(); }
  return { day: 1, week: 7, quarter: 3, year: 12 }[period];
}

/** a slot's coverage: short = coverage()'s one rule (or a short month inside it); partial = the period is still running */
function coverageOf_(period, key, row, o) {
  const expected = expectedParts_(period, key);
  const partial = !isClosed(period, key, o.now, { fyStart: o.fyStart });
  if (!row) return { expected, seen: 0, short: false, partial };
  const src = row.source && row.source.length ? row.source : null;
  const short = coverage({ period, source: src }).partial || !!(row.parts_short && row.parts_short.length);
  /* read from the bills themselves (no source): whole by construction */
  return { expected, seen: src ? src.length : expected, short, partial };
}

/** one slot. ⚠️ change_pct is null — NEVER 0 — unless this slot and last year's are both whole, closed and last year sold something */
function slot_(period, key, byKey, o) {
  const row = byKey.get(key) || null;
  const lyKey = lastYearKey(period, key);
  const ly = (lyKey && byKey.get(lyKey)) || null;
  const cov = coverageOf_(period, key, row, o);
  const lyShort = !!ly && coverageOf_(period, lyKey, ly, o).short;
  const gross = row ? toMinor_(row.totals.gross, o.currency) : null;
  const lyGross = ly ? toMinor_(ly.totals.gross, o.currency) : null;
  const comparable = row && ly && !cov.short && !cov.partial && !lyShort && lyGross > 0;
  return {
    key,
    gross_minor: gross,
    total_minor: row ? toMinor_(row.totals.total, o.currency) : null,
    bills: row ? (Number(row.totals.count) || 0) : null,
    coverage: cov,
    last_year: { key: lyKey, gross_minor: lyGross, short: lyShort },
    change_pct: comparable ? r2(((gross - lyGross) * 100) / lyGross) : null,
  };
}

/**
 * series(period, n, summaries, { fyStart, currency, now }) → [{ key, gross_minor, total_minor, bills,
 *   coverage: { expected, seen, short, partial }, last_year: { key, gross_minor, short }, change_pct }], newest LAST.
 *
 *   period     'week' (ISO, Monday) · 'month' · 'quarter' (3 months of the shop's year) · 'year' (the shop's own) · 'day'
 *   summaries  stored summary records (summary() shape, any counters, NEWEST FIRST — acrossCounters' rule); quarters and
 *              years are folded from the month summaries; pass last year's too, or there is nothing to compare with
 *   fyStart    1-12, REQUIRED for every period (yearKey's April default is kept only for its adopted callers)
 *
 * Every figure is an integer in minor units, or null when there is no record (a slot with no summary is null, never 0).
 * The lead figure is sales (gross); change_pct compares gross with the same slot last year, to 2 decimals.
 */
function series(period, n, summaries, opts) {
  const o = seriesOpts_(period, n, opts);
  const byKey = new Map(seriesRows_(period, summaries, o.fyStart).map((r) => [r.key, r]));
  return slotKeys_(period, o.n, o.now, o.fyStart).map((key) => slot_(period, key, byKey, o));
}

const EXPORTS = { coverage, isReturn, isExpense, isStockNote, totals, fold, dayKey, yearKey, weekKey, monthKey, keyOf, daysIn, isClosed, summary, chitOf, refOf, PERIODS, planPurge, FLOOR_DAYS, MAX_PER_RUN, acrossCounters, quarterKey, DERIVED_PERIODS, fromMonths, lastYearKey, series };

/**
 * ⚠️ NO SELF-ASSIGNED GLOBAL HERE, DELIBERATELY ([TILL-125]). scripts/vendor-till.cjs wrapForBrowser() turns
 * `module.exports =` into `var EXPORTS =` and assigns window.CBRollup itself. A module that also referenced
 * `module.exports` on its last line would throw in a browser — which is exactly how jurisdiction.js failed
 * with "EXPORTS is not defined" when it was wrapped instead of copied.
 * ⚠️ The KIT copy is a plain copy, not a wrap, so `require('./rollup')` in till.js is unaffected.
 */

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBRollup. */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBRollup = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
