'use strict';
/**
 * prove-sla.js — the service clock, and the argument it exists to settle.
 *
 * ⚠️ THE LOAD-BEARING TEST IS THE DISPUTED PAUSE. Anyone can add up elapsed time. The assertion that matters is
 * that the SAME record produces two different, both-defensible answers when the parties disagree about a pause —
 * because that is the only thing a single-tenant service desk structurally cannot do.
 *
 * Run: node scripts/prove-sla.js
 */
const sla = require('../lib/sla');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? '\n      ' + d : '')); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), 'got  ' + JSON.stringify(g) + '\n      want ' + JSON.stringify(w));

const T = (h, m) => new Date(Date.UTC(2026, 7, 14, h, m || 0)).toISOString();

console.log('\n── the service clock ────────────────────────────────────────────────────────\n');

console.log('1 · priority is impact × urgency, not a dropdown');
{
  eq('high impact + high urgency = P1', sla.priorityOf('high', 'high'), 'P1');
  eq('high impact + low urgency = P3 — a big thing that can wait', sla.priorityOf('high', 'low'), 'P3');
  eq('low impact + high urgency = P3 — a small thing that cannot', sla.priorityOf('low', 'high'), 'P3');
  /* ⚠️ Collapsing the two into one field is how every ticket becomes a P1. */
  ok('⚠️ a missing half returns null, never a default — an unset priority is a QUESTION',
    sla.priorityOf('high', '') === null && sla.priorityOf('', 'high') === null);
  eq('P1 targets: 15m respond, 4h resolve', sla.targetsFor('P1'), { respond: 15, resolve: 240 });
  eq('a policy may override one clock without losing the other',
    sla.targetsFor('P1', { P1: { respond: 5 } }), { respond: 5, resolve: 240 });
}

console.log('\n2 · two clocks, because an SLA promises two things');
{
  const c = sla.clock({ raised_at: T(9, 0), responded_at: T(9, 10), priority: 'P1' }, T(10, 0));
  eq('response took 10 minutes', c.as_agreed.respond_ms, 10 * 60000);
  ok('…and met the 15-minute target', c.as_agreed.respond_breached === false);
  ok('but resolution is still running at 60 minutes', c.running === true && c.as_agreed.resolve_ms === 60 * 60000);
  ok('…and has not breached the 4-hour target yet', c.as_agreed.resolve_breached === false);
  /* ⚠️ A tool that tracks only resolution lets a ticket sit untouched all day and still pass. */
  const untouched = sla.clock({ raised_at: T(9, 0), priority: 'P1' }, T(9, 30));
  ok('⚠️ 30 minutes with NOBODY responding is already a response breach',
    untouched.as_agreed.respond_breached === true, JSON.stringify(untouched.as_agreed));
}

console.log('\n3 · ⭐ THE DISPUTED PAUSE — the same record, two defensible answers');
{
  /* A P2 (8h resolve). Raised 09:00, resolved 20:00 = 11 hours wall clock. The desk paused for 4 hours saying it
     was waiting on the customer. The customer rejects that pause: nobody asked them anything. */
  const rec = {
    raised_at: T(9, 0), responded_at: T(9, 5), resolved_at: T(20, 0), priority: 'P2',
    pauses: [{ from: T(12, 0), to: T(16, 0), reason: 'waiting_on_counterparty', on_counterparty: true, accepted: false }],
  };
  const c = sla.clock(rec, T(20, 0));
  eq('as agreed, the clock ran 7 hours', sla.readable(c.as_agreed.resolve_ms), '7h');
  ok('…which is INSIDE the 8-hour target — the desk passed', c.as_agreed.resolve_breached === false);
  eq('contested, the clock ran 11 hours', sla.readable(c.contested.resolve_ms), '11h');
  ok('…which BREACHES it — the customer is also right', c.contested.resolve_breached === true);
  ok('⭐ and the record says the two answers DISAGREE — that is the case to settle',
    c.contested_changes_outcome === true);
  eq('the amount of time actually being argued about', sla.readable(c.disputed_pause_ms), '4h');
  eq('…across one disputed pause', c.disputed_pauses, 1);

  /* ⚠️ Silence is not rejection. A pause the counterparty has simply not answered yet must not be stripped out —
     that would breach a desk for a customer who has not read their email. */
  const unanswered = sla.clock({ ...rec, pauses: [{ ...rec.pauses[0], accepted: null }] }, T(20, 0));
  ok('⚠️ an UNANSWERED pause still counts — silence is not a rejection',
    unanswered.contested.resolve_breached === false && unanswered.disputed_pauses === 0,
    JSON.stringify(unanswered.contested));
}

console.log('\n4 · ⚠️ OVERLAPPING PAUSES — where the arithmetic goes wrong quietly');
{
  /* Two people pause the same ticket for overlapping windows: the desk waits on the customer 12:00–16:00 while an
     engineer waits on parts 14:00–18:00. Summing the durations subtracts the 2-hour overlap TWICE. */
  const rec = { raised_at: T(9, 0), resolved_at: T(20, 0), priority: 'P2',
    pauses: [{ from: T(12, 0), to: T(16, 0), reason: 'waiting_on_counterparty' },
             { from: T(14, 0), to: T(18, 0), reason: 'waiting_on_parts' }] };
  const c = sla.clock(rec, T(20, 0));
  /* 11h wall − 6h merged pause (12:00→18:00) = 5h. Naive summing gives 11 − 8 = 3h. */
  eq('⭐ overlapping pauses MERGE — 12:00→18:00 is six hours, not eight', sla.readable(c.as_agreed.resolve_ms), '5h');
  ok('⚠️ the naive sum would have reported 3h and turned a real breach into a comfortable pass',
    c.as_agreed.resolve_ms !== 3 * 3600000);
}

console.log('\n5 · the clamps — every one of these is a real ticket');
{
  /* An open pause is the normal state of a genuinely stuck ticket. Scoring it as zero breaches the waiting party. */
  const open = sla.clock({ raised_at: T(9, 0), priority: 'P3',
    pauses: [{ from: T(10, 0), reason: 'waiting_on_counterparty' }] }, T(14, 0));
  eq('⚠️ an OPEN pause runs to now — 1h ran, 4h paused', sla.readable(open.as_agreed.resolve_ms), '1h');
  ok('…and the ticket reads as paused right now', open.paused_now === true);

  /* Closing the ticket without closing the pause is ordinary. The clock must not keep running past resolution. */
  const past = sla.clock({ raised_at: T(9, 0), resolved_at: T(11, 0), priority: 'P3',
    pauses: [{ from: T(10, 0) }] }, T(23, 0));
  eq('⚠️ RESOLUTION stops the clock even with a pause left open', sla.readable(past.as_agreed.resolve_ms), '1h');
  ok('…and the request is no longer running', past.running === false);

  const before = sla.clock({ raised_at: T(9, 0), resolved_at: T(10, 0), priority: 'P3',
    pauses: [{ from: T(2, 0), to: T(8, 0) }] }, T(10, 0));
  eq('a pause entirely BEFORE the ticket existed is ignored', sla.readable(before.as_agreed.resolve_ms), '1h');

  const noPri = sla.clock({ raised_at: T(9, 0) }, T(10, 0));
  ok('⚠️ no priority → has_target false, and NOTHING is reported as breached — the absence of a rule is not compliance',
    noPri.has_target === false && noPri.as_agreed.resolve_breached === undefined, JSON.stringify(noPri.as_agreed));
  ok('a missing raised_at is refused, not defaulted to now', !!sla.clock({}).error);
}

console.log('\n6 · readable durations');
{
  eq('45 minutes', sla.readable(45 * 60000), '45m');
  eq('an exact hour has no stray minutes', sla.readable(60 * 60000), '1h');
  eq('2h 30m', sla.readable(150 * 60000), '2h 30m');
  eq('over a day', sla.readable(26 * 3600000), '1d 2h');
  eq('overdue time reads as a magnitude, the sign is the caller\'s to say', sla.readable(-90 * 60000), '1h 30m');
}

console.log('\n────────────────────────────────────────────────────────────────────────────');
console.log((fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
