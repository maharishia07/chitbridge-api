'use strict';
/**
 * OWNS      the SAFE writer of live round-trip counts (SPD-39): which lines of round-trips.live.json and round-trips.budget.json a measurement may touch.
 * CALLED BY tools/live-trips.cjs (the harness) · tests/live-trips-writer.test.cjs (the proof it never lowers).
 * FLOW      measured rows ──▶ applyMeasured(budget, live, rows, day) ──▶ { budget, live, changed } ──▶ serialise() (the files' own format)
 * CARD      28-platform-and-operations/performance-and-round-trips
 *
 * Rules (the file headers say them, this code keeps them): a line is never lowered and never raised here (a live count above a fired ceiling is reported by problems() and the harness exits non-zero; raising is a hand edit with a reason); a placeholder (fired:false) becomes fired:true ONLY by a real 2xx;
 * a 4xx is never a measurement; a line the harness did not measure is returned untouched (same object), so the file stays byte-identical there.
 * tests/round-trips-all.test.cjs --write is lossy (SPD-41) and is NOT used.
 */

const LIVE_ABOUT = 'Live counts of the routes the harness reached (tools/live-trips.cjs, SPD-39): measured[route] = { trips, status, basis, at }; routes[route] carries the same trips for tests/round-trips-all.test.cjs.';

/** the basis sentence for the day (YYYY-MM-DD) a basis sentence names */
const basisOf = (runDay) => 'live from sit-in ' + runDay;

/** a measurement counts only when it is a real answer of the route's own work: a number of trips and a 2xx */
const isMeasurement = (row) => !!row && typeof row.trips === 'number' && Number.isFinite(row.trips) && row.trips >= 0 && row.status >= 200 && row.status < 300;

/** the budget line after a real measurement: a placeholder becomes a fired line with its basis (a fired line is never touched here: see applyMeasured) */
function lineAfter(line, row, runDay) {
  const kept = line || {};
  const next = { file: kept.file, trips: row.trips, wire: null, fired: true, status: row.status, basis: basisOf(runDay) };
  if (kept.registered_only) next.registered_only = true;
  if (kept.extra) next.extra = true;
  if (kept.awaiting_client) next.awaiting_client = kept.awaiting_client;
  return next;
}

/** apply measured rows to copies of the two files; returns what changed (route keys) and never touches another line */
function applyMeasured(budget, live, rows, runDay) {
  const nextBudget = { ...budget, routes: { ...budget.routes } };
  const nextLive = { ...live, routes: { ...(live.routes || {}) } };
  if (rows.length) nextLive.measured = { ...(live.measured || {}) };
  const changed = [];
  const refused = [];
  const exceeded = []; /* a live count above a FIRED ceiling: a raise is a human edit with a reason, so it is reported and nothing is written for the route */
  rows.forEach((row) => {
    if (!isMeasurement(row)) return refused.push(row.route);
    if (!nextBudget.routes[row.route]) return refused.push(row.route); /* a route with no budget line is the I19 test's to report, not ours to invent */
    const ceiling = nextBudget.routes[row.route];
    if (ceiling.fired === true && row.trips > ceiling.trips) return exceeded.push({ route: row.route, ceiling: ceiling.trips, live: row.trips });
    const old = typeof nextLive.routes[row.route] === 'number' ? nextLive.routes[row.route] : null;
    const trips = old === null ? row.trips : Math.max(old, row.trips); /* never lower */
    nextLive.routes[row.route] = trips;
    nextLive.measured[row.route] = { trips, status: row.status, basis: basisOf(runDay), at: runDay };
    if (ceiling.fired !== true) nextBudget.routes[row.route] = lineAfter(ceiling, { ...row, trips }, runDay);
    changed.push(row.route);
  });
  if (changed.length) nextLive._about = LIVE_ABOUT;
  return { budget: nextBudget, live: nextLive, changed, refused, exceeded };
}

/** sentences naming every way `after` is worse than `before`: a lowered or dropped trips line, a fired line turned unfired, a line lost; empty = safe */
function problems(before, after) {
  const found = [];
  (after.exceeded || []).forEach((x) => found.push('live above ceiling: ' + x.route + ' ' + x.ceiling + ' to ' + x.live + ' (a raise is a hand edit with a reason)'));
  Object.keys(before.budget.routes).forEach((key) => {
    const earlier = before.budget.routes[key];
    const now = after.budget.routes[key];
    if (!now) return found.push('budget line dropped: ' + key);
    if (earlier.fired === true && now.fired !== true) found.push('fired line turned unfired: ' + key);
    if (now.trips < earlier.trips && earlier.fired === true) found.push('budget line lowered: ' + key + ' ' + earlier.trips + ' to ' + now.trips);
    if (earlier.fired === false && now.fired === true && !(now.status >= 200 && now.status < 300)) found.push('placeholder fired without a 2xx: ' + key);
  });
  Object.keys(before.live.routes || {}).forEach((key) => {
    const earlier = before.live.routes[key];
    const now = (after.live.routes || {})[key];
    if (now === undefined) found.push('live line dropped: ' + key);
    else if (now < earlier) found.push('live line lowered: ' + key + ' ' + earlier + ' to ' + now);
  });
  return found;
}

/** the files' own formats: the budget has two-space indent, the live file one-space indent, both end in a newline */
const serialiseBudget = (budget) => JSON.stringify(budget, null, 2) + '\n';
const serialiseLive = (live) => JSON.stringify(live, null, 1) + '\n';

module.exports = { applyMeasured, problems, isMeasurement, serialiseBudget, serialiseLive, basisOf };
