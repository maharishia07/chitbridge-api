// CARD 01-rail-core-the-chit/chits-routes
// owns: the sentence a raised dispute answers with (who was told, or why it is a record on the raiser's own copy only).
// called by: routes/chits.js POST /:chit_id/disputes.
// FLOW  parity of the asked party + whether the category widened → said(parity, widened) → one sentence
'use strict';
/**
 * lib/dispute-alert.js — THE SENTENCE UNDER A RAISED DISPUTE (C11 10b, RAIL-79, 2026-11-12).
 *
 * ⚠️ WORDS ONLY. parity_state 'absent' with mode 'one_sided' is the designed record-only dispute (a unilateral record on the raiser's own copy); the sentence names the party that is not on
 *    the chit instead of calling it "no longer reachable". Refusing such a dispute instead is a behaviour choice that belongs to Athi, not to this file.
 */
const LODGED = ' This is lodged as a unilateral record on your own copy.';

/** said(parity, widened) → the alert: parity = { mode, parity_state, target_display_name } of the asked party */
function said(parity, widened) {
  if (parity.mode !== 'one_sided') return widened ? 'This category notifies all parties — raised chit-wide.' : 'Dispute raised with the selected party.';
  if (parity.parity_state === 'absent') return parity.target_display_name + ' is not on this chit.' + LODGED;
  return 'The other side is no longer reachable (' + parity.parity_state + ').' + LODGED;
}

module.exports = { said };
