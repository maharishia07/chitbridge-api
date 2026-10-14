// @stage tested
// @stage-note T3-DISPUTES-ASSIST · may I raise / resolve a dispute — the server's answer the screens paint (greyed WITH this sentence).
'use strict';
/**
 * lib/dispute-may.js — RAISE and RESOLVE, answered the way the routes refuse (T3-DISPUTES-ASSIST, 14 Oct).
 *
 * Raise is the rail's own verdict (lib/rail.js can(…, 'dispute'): the access level, then "I hold a copy") — never re-derived here.
 * Resolve is not a rail action yet (engines are serial; queued: rail ACTIONS + `resolve_dispute`). Until it is, its rule is the one
 * PUT /chits/:id/disputes/:dispute_id/resolve already enforces, in the same order: the rail's level/held verdict, then still open
 * (400 "Dispute already resolved"), then raiser-only (403). The route asks THIS function, so the answer and the refusal cannot drift.
 *
 *   raise(railVerdict)                         → { ok } | { ok:false, why, say }
 *   resolve(railVerdict, { open, raisedByMe }) → { ok } | { ok:false, why, say }
 * `why` is a CODE (a screen branches on it, never on the sentence); `say` is what a person reads.
 * ⭐ NEW PATH (rule 4): lib/rail-actions.refuse only accepts the rail's own words; resolve's two words (not_raiser · already_resolved)
 *    are not rail words, so they live here beside the one function that answers them.
 */
const rail = require('./rail');

const WHY = {
  not_raiser:       'Only the business that raised this dispute can resolve it.',
  already_resolved: 'This dispute is already resolved.',
};
const YES = Object.freeze({ ok: true });

/** a rail verdict → the answer with its sentence (the rail's WHY table; an unknown word fails loudly, as rail.say does) */
function said(v) { return v && v.ok === false ? { ok: false, why: v.why, say: rail.say(v.why) } : YES; }

function raise(railVerdict) { return said(railVerdict); }

function resolve(railVerdict, f) {
  const x = f || {};
  if (railVerdict && railVerdict.ok === false) return said(railVerdict);
  if (!x.open) return { ok: false, why: 'already_resolved', say: WHY.already_resolved };
  if (!x.raisedByMe) return { ok: false, why: 'not_raiser', say: WHY.not_raiser };
  return YES;
}

module.exports = { raise, resolve, WHY };
