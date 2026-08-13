'use strict';
/**
 * lib/sla.js — THE SERVICE CLOCK. Pure arithmetic, zero dependencies.
 *
 * Athi, 2026-08-13: *"do you think our model is a better match for ITIL, as both the parties in agreement or
 * disagreement in resolution?"*
 *
 * ── ⭐ THE ANSWER, AND IT IS NARROWER AND STRONGER THAN "BOTH PARTIES AGREE" ─────────────────────────────────────
 * In every service-management tool, resolution is asserted by ONE side. The desk marks it Resolved; the customer
 * either accepts or reopens. The disagreement is not in the data — a reopen looks like a new event, not like two
 * parties differing about the same one. So the record cannot answer "did we actually fix it", only "how many times
 * was it reopened", which is a proxy everyone games.
 *
 * ⭐ BUT THE REAL FIGHT IS NEVER THE RESOLUTION. IT IS THE PAUSE.
 * A breach is arithmetic once you agree on the pauses. Every SLA argument in the world reduces to "was that pause
 * legitimate" — the desk says the clock stopped while waiting on the customer, the customer says nobody asked them
 * anything, and the tool that adjudicates belongs to one of them. Nobody holds both sides of that.
 *
 * So this module makes the PAUSE the disputed object, not the breach, and computes the clock BOTH WAYS:
 *
 *     as_agreed   — every pause honoured. The desk's number.
 *     contested   — pauses the counterparty rejected are removed. The customer's number.
 *
 * Showing one number is taking a side. Showing both, from one co-held record, is the thing no single-tenant tool
 * can do — and it is the same claim CB already makes about documents, applied to time.
 *
 * ── ⚠️ WHAT THIS FILE IS NOT ───────────────────────────────────────────────────────────────────────────────────
 * It does not decide anything. It reports. Nothing here auto-resolves, auto-accepts a pause, or auto-breaches —
 * the same discipline as the matcher, for the same reason: a wrong number that looks confident is worse than a
 * gap, because a gap gets checked.
 *
 * ── ZERO DEPENDENCIES · TIER A ─────────────────────────────────────────────────────────────────────────────────
 * Importable on its own, like money / gs1 / order-input. See ENGINE-CORE.md.
 */

/**
 * ── PRIORITY: impact × urgency ─────────────────────────────────────────────────────────────────────────────────
 * The ITIL matrix, kept because it is the one every service desk already argues in. IMPACT is how much of the
 * business is affected; URGENCY is how fast it degrades. They are genuinely different questions and collapsing
 * them into a single "priority" dropdown is how everything becomes P1.
 */
const IMPACT = ['low', 'medium', 'high'];
const URGENCY = ['low', 'medium', 'high'];
const PRIORITY_MATRIX = {
  'high|high': 'P1', 'high|medium': 'P2', 'high|low': 'P3',
  'medium|high': 'P2', 'medium|medium': 'P3', 'medium|low': 'P4',
  'low|high': 'P3', 'low|medium': 'P4', 'low|low': 'P4',
};
const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];

function priorityOf(impact, urgency) {
  const i = String(impact || '').toLowerCase();
  const u = String(urgency || '').toLowerCase();
  if (!IMPACT.includes(i) || !URGENCY.includes(u)) return null;   // not a guess — a missing priority is a question
  return PRIORITY_MATRIX[i + '|' + u];
}

/**
 * Default targets, in MINUTES. A policy may override any of them.
 *
 * ⚠️ TWO CLOCKS, NOT ONE, and they are the two an SLA actually promises: how fast someone picks it up, and how
 * fast it is done. Tools that track only resolution let a ticket sit untouched for a day and still pass.
 */
const DEFAULT_TARGETS = {
  P1: { respond: 15, resolve: 4 * 60 },
  P2: { respond: 30, resolve: 8 * 60 },
  P3: { respond: 4 * 60, resolve: 24 * 60 },
  P4: { respond: 8 * 60, resolve: 72 * 60 },
};

function targetsFor(priority, policy) {
  const p = PRIORITIES.includes(priority) ? priority : null;
  if (!p) return null;
  const base = DEFAULT_TARGETS[p];
  const over = (policy && policy[p]) || {};
  return { respond: Number(over.respond) > 0 ? Number(over.respond) : base.respond,
           resolve: Number(over.resolve) > 0 ? Number(over.resolve) : base.resolve };
}

const ms = (v) => (v instanceof Date ? v.getTime() : (v == null ? NaN : new Date(v).getTime()));
const MIN = 60000;

/**
 * normalisePauses(pauses, from, to) — clamp, drop the impossible, and MERGE OVERLAPS.
 *
 * ⚠️ OVERLAP MERGING IS NOT TIDINESS, IT IS THE DIFFERENCE BETWEEN A BREACH AND A PASS. Two people can pause the
 * same ticket for overlapping windows — a desk pauses for "waiting on customer" while an engineer pauses for
 * "waiting on parts". Summing the two durations subtracts the overlap TWICE and can hand back more paused time
 * than the ticket has existed, turning a breached ticket into a comfortable pass. Nothing downstream would query
 * a number that only ever looks favourable.
 *
 * ⚠️ AN OPEN PAUSE IS CLAMPED TO `to`, NOT TREATED AS ZERO. A pause nobody closed is the most common state of a
 * ticket that is genuinely stuck, and scoring it as no pause at all would breach the party who is waiting.
 */
function normalisePauses(pauses, from, to) {
  const lo = ms(from), hi = ms(to);
  const spans = (Array.isArray(pauses) ? pauses : [])
    .map((p) => {
      const s = Math.max(lo, ms(p.from));
      const e = Math.min(hi, p.to == null ? hi : ms(p.to));
      if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null;
      return { s, e, rejected: p.accepted === false, reason: p.reason || null, on_counterparty: !!p.on_counterparty };
    })
    .filter(Boolean)
    .sort((a, b) => a.s - b.s);

  const merged = [];
  for (const sp of spans) {
    const last = merged[merged.length - 1];
    if (last && sp.s <= last.e) { last.e = Math.max(last.e, sp.e); last.rejected = last.rejected && sp.rejected; }
    else merged.push({ ...sp });
  }
  return merged;
}

/** Running time between two instants, minus paused spans. `keep` decides which pauses count. */
function runningMs(from, to, pauses, keep) {
  const lo = ms(from), hi = ms(to);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return 0;
  const spans = normalisePauses(pauses, from, to).filter(keep);
  const paused = spans.reduce((n, s) => n + (s.e - s.s), 0);
  return Math.max(0, (hi - lo) - paused);
}

/**
 * ⭐ clock(rec, now) — the whole state of one service request, computed BOTH WAYS.
 *
 * rec: { raised_at, responded_at?, resolved_at?, priority | impact+urgency, pauses:[{from,to?,reason,on_counterparty,accepted}], policy? }
 *
 * ⚠️ RESOLUTION STOPS THE CLOCK EVEN IF A PAUSE IS STILL OPEN. Closing a ticket without closing the pause is
 * ordinary human behaviour; letting the clock keep running past resolution would breach tickets that were
 * delivered on time, and the party at fault would be the one who fixed it.
 */
function clock(rec, now) {
  const r = rec || {};
  const at = now == null ? Date.now() : ms(now);
  const raised = ms(r.raised_at);
  if (!Number.isFinite(raised)) return { error: 'raised_at is required' };

  const priority = r.priority || priorityOf(r.impact, r.urgency);
  const targets = targetsFor(priority, r.policy);
  const stop = Number.isFinite(ms(r.resolved_at)) ? ms(r.resolved_at) : at;
  const respStop = Number.isFinite(ms(r.responded_at)) ? ms(r.responded_at) : stop;

  const view = (keep) => {
    const respondMs = runningMs(raised, respStop, r.pauses, keep);
    const resolveMs = runningMs(raised, stop, r.pauses, keep);
    const out = { respond_ms: respondMs, resolve_ms: resolveMs };
    if (targets) {
      out.respond_target_ms = targets.respond * MIN;
      out.resolve_target_ms = targets.resolve * MIN;
      out.respond_breached = respondMs > out.respond_target_ms;
      out.resolve_breached = resolveMs > out.resolve_target_ms;
      out.resolve_remaining_ms = out.resolve_target_ms - resolveMs;   // negative = over
    }
    return out;
  };

  /* as_agreed honours every pause. contested removes the ones the counterparty REJECTED — not the ones merely
     unanswered, because silence is not a rejection and treating it as one would breach a desk for a customer who
     simply has not replied yet. */
  const as_agreed = view(() => true);
  const contested = view((s) => !s.rejected);
  const disputed = normalisePauses(r.pauses, raised, stop).filter((s) => s.rejected);

  return {
    priority: priority || null,
    /* ⚠️ SAID PLAINLY RATHER THAN DEFAULTED. Without a priority there is no target, and a screen that quietly
       showed "not breached" would be reporting the absence of a rule as compliance. */
    has_target: !!targets,
    running: !Number.isFinite(ms(r.resolved_at)),
    paused_now: normalisePauses(r.pauses, raised, at).some((s) => s.e >= at),
    responded: Number.isFinite(ms(r.responded_at)),
    resolved: Number.isFinite(ms(r.resolved_at)),
    as_agreed,
    contested,
    /* ⭐ The number that matters when the two disagree: how much time is actually being argued about. */
    disputed_pause_ms: disputed.reduce((n, s) => n + (s.e - s.s), 0),
    disputed_pauses: disputed.length,
    /* One party's answer differs from the other's. That is not a display detail — it is the case to settle. */
    contested_changes_outcome: !!targets
      && (as_agreed.resolve_breached !== contested.resolve_breached
       || as_agreed.respond_breached !== contested.respond_breached),
  };
}

/** A sentence a person can read, rather than a duration they have to convert. */
function readable(msVal) {
  const n = Math.abs(Math.round(Number(msVal) || 0));
  const m = Math.round(n / MIN);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24) return h + 'h' + (rm ? ' ' + rm + 'm' : '');
  const d = Math.floor(h / 24), rh = h % 24;
  return d + 'd' + (rh ? ' ' + rh + 'h' : '');
}

/**
 * Closure vocabulary. ITIL separates the two on purpose, and so do we:
 *   resolution — WHAT was done. Feeds problem management: five "workaround applied" is a problem, not five incidents.
 *   closure    — whether the requester accepted it.
 *
 * ⚠️ `not_reproducible` AND `no_fault_found` ARE DIFFERENT and both are kept. The first says we could not make it
 * happen; the second says we looked and the thing is working. Collapsing them loses the only signal that
 * distinguishes an intermittent fault from a misunderstanding.
 */
const RESOLUTION_CODES = ['fixed', 'workaround_applied', 'not_reproducible', 'no_fault_found',
                          'withdrawn_by_requester', 'rejected', 'duplicate'];
const PAUSE_REASONS = ['waiting_on_counterparty', 'waiting_on_third_party', 'waiting_on_parts',
                       'outside_service_hours', 'scheduled', 'other'];

module.exports = {
  IMPACT, URGENCY, PRIORITIES, PRIORITY_MATRIX, DEFAULT_TARGETS,
  RESOLUTION_CODES, PAUSE_REASONS,
  priorityOf, targetsFor, normalisePauses, runningMs, clock, readable,
};
