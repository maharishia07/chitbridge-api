// @stage tested
// @stage-note Lifted unchanged from lib/chit-move.js (it was 503 lines, limit 500): a bill's own history step, written once, held for the owner when it cannot be.
// lib/chit-bill-step.js — a bill's own history step, written once, retried once, then held for the owner (never silent)
// OWNER cb-rail
// RISK plain
// CARD 01-rail-core-the-chit/chit-move
// OWNS  writeBillStep(entity_id, chit_id, step, by, deps) → 'written' | 'retried' | 'held' | 'lost' · raiseBillStepIncident (the Sev-3 desk row) · raiseOf.
// CALLED BY  lib/chit-move.js (moveStatus; re-exported there so tests/bill-step-held.test.cjs and callers keep their door).
// FLOW  moveStatus → writeBillStep → lib/bill-privacy.writeStep (one retry) → else lib/raiseticket (a Sev-3 incident, audience here) — the status change itself is never undone
'use strict';
const cbLog = require('./logger');
const billPrivacy = require('./bill-privacy');

/** the way to raise the incident: the caller's own (a test's), else as the system to the shop's own raiser */
const raiseOf = (entity_id, deps) => (deps && deps.raise) || (async (ticket) => require('./raiseticket').raise(await require('./money-check').raiserOf(entity_id), { id: null, name: 'system' }, ticket));
/** a history line that could not be written twice is held for the owner as a Sev-3 incident → 'held' when raised (or already raised), else 'lost' */
async function raiseBillStepIncident(entity_id, chit_id, step, second, deps) {
  try {
    const raise = raiseOf(entity_id, deps);
    const out = await raise({
      kind: 'incident', audience: 'here', ref: chit_id, severity: 'Sev-3', client_ref: 'billstep:' + chit_id + ':' + step.step,
      subject: 'A bill moved to ' + step.step + ' but its history line was not saved',
      detail: 'The status of bill ' + String(chit_id).slice(0, 8) + ' changed to ' + step.step + ' and stands. Its line in the bill history could not be written (' + String((second && second.message) || second).slice(0, 120) + ').'
    });
    return out && (out.raised || out.duplicate) ? 'held' : 'lost';
  } catch (third) {
    cbLog.error('chits.status.bill-step-held-failed', { chit_id, step: step.step, err: String((third && third.message) || third) });
    return 'lost';
  }
}
/**
 * F3 (1128) · a bill's own step is written ONCE, and a failure is never silent: ONE retry, then a held row on the OWNER's own desk (a ticket, audience 'here', one per chit + step) saying the status stands
 * and its history line is missing — never only a log line. The status change itself is never undone by it. → 'written' | 'retried' | 'held' | 'lost' (even the held row failed: logged as an error)
 * `deps` is for the test ({ writeStep, raise }).
 */
async function writeBillStep(entity_id, chit_id, step, by, deps) {
  const write = (deps && deps.writeStep) || billPrivacy.writeStep;
  try {
    await write(entity_id, chit_id, step, by);
    return 'written';
  } catch (first) {
    try {
      await write(entity_id, chit_id, step, by);
      cbLog.fellBack('chits status: the bill step was written on the second try', first);
      return 'retried';
    } catch (second) {
      cbLog.fellBack('chits status: the bill step was not written, held for the owner — the status change stands without it', second);
      return raiseBillStepIncident(entity_id, chit_id, step, second, deps);
    }
  }
}

module.exports = { writeBillStep, raiseBillStepIncident };
