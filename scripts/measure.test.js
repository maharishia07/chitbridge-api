#!/usr/bin/env node
'use strict';
/**
 * measure.test.js — the shared measurement helpers, tested purely (no network, no DB).
 *
 * These numbers end up on a folder header and on a supplier's scorecard, where they will be believed and acted on.
 * The cases below are chosen to be the ones that MISLEAD rather than the ones that crash:
 *   · an empty set reporting 0% disputed (reads "clean record"; means "never traded")
 *   · a value awaiting agreement counted as a value of zero
 *   · one ancient chit dragging an average until the typical case disappears
 *   · response time and resolution time collapsed into one number
 *
 * RUN:  node scripts/measure.test.js
 */
const assert = require('assert');
const measure = require('../lib/measure');
const money = require('../lib/money');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗ ' + name + '\x1b[0m' + (detail ? '\n      ' + detail : '')); }
};
const eq = (name, a, b) => ok(name + (a === b ? '' : '  (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'), a === b);

const NOW = '2026-08-10T12:00:00Z';
const chit = (o) => Object.assign({
  current_status: 'pending', direction: 'received', created_at: NOW, read_at: null, touched_at: null,
  value: null, currency: 'INR', open_disputes: 0, resolved_disputes: 0,
}, o);

console.log('\n  measure — the numbers a folder and a scorecard both rest on\n');

/* ── the empty set: the most dangerous input, because every rate is tempting to report as 0 ────────────────────── */
const e = measure.measure([], { now: NOW });
eq('empty · count is 0', e.count, 0);
ok('★★★ empty · dispute rate is NULL, not 0 — "0% disputed" reads as a clean record, and it would mean "never traded"',
  e.disputes.rate_pct === null);
ok('empty · every clock is null, not zero', e.clock.median_age_days === null && e.clock.oldest_at === null);

/* ── value awaiting agreement is NOT a value of zero ───────────────────────────────────────────────────────────── */
const await1 = measure.measure([chit({ value: 100 }), chit({ value: null })], { now: NOW });
const inr = await1.money.by_currency.find((c) => c.currency === 'INR');
eq('★★★ a chit awaiting agreement is NOT counted as a valued chit', inr.chits, 1);
eq('…and it is reported as excluded instead', await1.money.excluded.awaiting_agreement, 1);
ok('★★ a REAL zero still counts as valued — the fix must not swallow a genuine free line',
  money.summarise([{ value: 0, currency: 'INR' }]).by_currency[0].chits === 1);

/* ── mixed currencies are never summed ─────────────────────────────────────────────────────────────────────────── */
const mixed = measure.measure([chit({ value: 100, currency: 'INR' }), chit({ value: 50, currency: 'AED' })], { now: NOW });
ok('★★★ mixed currencies produce buckets and NO single total', mixed.money.mixed === true && mixed.money.total === null);

/* ── median, not mean ──────────────────────────────────────────────────────────────────────────────────────────── */
const skew = measure.measure([
  chit({ created_at: '2026-08-09T12:00:00Z' }),
  chit({ created_at: '2026-08-08T12:00:00Z' }),
  chit({ created_at: '2025-08-10T12:00:00Z' }),   // one year old
], { now: NOW });
eq('★★ one ancient chit does not drag the typical age (median 2, mean would be ~123)', skew.clock.median_age_days, 2);
eq('…but the oldest is still reported, because that is the one nobody is working', skew.clock.oldest_age_days, 365);

/* ── response and resolution are different clocks ──────────────────────────────────────────────────────────────── */
const clocks = measure.measure([
  chit({ created_at: '2026-08-01T12:00:00Z', read_at: '2026-08-01T18:00:00Z', touched_at: '2026-08-09T12:00:00Z', current_status: 'completed' }),
], { now: NOW });
eq('★★ first-touch (RESPONSE) is 0.3 days', clocks.clock.median_first_touch_days, 0.3);
eq('★★ time-to-close (RESOLUTION) is 8 days — collapsing these hides "answers fast, finishes never"',
  clocks.clock.median_to_close_days, 8);

/* ── overdue is a POLICY, passed in, not a constant ────────────────────────────────────────────────────────────── */
const old = [chit({ created_at: '2026-08-04T12:00:00Z' })];    // 6 days old, still open
eq('overdue at 7 days · not yet late', measure.measure(old, { now: NOW, overdue_days: 7 }).overdue, 0);
eq('★★ overdue at 3 days · the SAME data is late — the threshold is declared, never baked in',
  measure.measure(old, { now: NOW, overdue_days: 3 }).overdue, 1);

/* ── the scorecard's own additions ─────────────────────────────────────────────────────────────────────────────── */
const card = measure.scorecard([
  chit({ direction: 'sent', current_status: 'completed', created_at: '2026-08-01T12:00:00Z', touched_at: '2026-08-02T12:00:00Z' }),
  chit({ direction: 'sent', current_status: 'rejected', created_at: '2026-08-03T12:00:00Z', touched_at: '2026-08-04T12:00:00Z' }),
  chit({ direction: 'received', current_status: 'pending' }),
], { now: NOW });
eq('scorecard · completion rate is of CLOSED chits, not of all', card.completion.completion_rate_pct, 50);
eq('★★ scorecard · says which way round the relationship reads', card.relationship.shape, 'both ways');
eq('scorecard · you sent 2', card.relationship.you_sent, 2);
ok('scorecard · keeps everything measure() gives (it is a superset, not a fork)',
  card.clock !== undefined && card.money !== undefined && card.by_status !== undefined);
ok('★★★ scorecard · NO single 0-100 grade — one number invites a ranking, and the weighting would be nobody\'s',
  card.grade === undefined && card.score === undefined);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exitCode = fail ? 1 : 0;
