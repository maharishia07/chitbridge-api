// @stage tested
// @stage-note Tells the other testers, down the bell that already exists. Never carries the finding itself.
'use strict';
/**
 * testnews.js — SOMEBODY FOUND SOMETHING, AND THE PEOPLE TESTING BESIDE THEM SHOULD KNOW.
 *
 * Athi, 2026-09-13: *"do we have a mechanism of getting the notification when someone raises an incident or a
 * case?"* — we did not. Nothing in routes/testing.js emitted anything, so two people testing the same product
 * found the same fault twice and neither knew until somebody opened the lab.
 *
 * ⭐ ADOPTED, NOT INVENTED. lib/events.js already carries server push (SSE, one open GET per client) and
 * lib/shopchanged.js already added a second KIND of event to it rather than a second pipe. This is the third,
 * and for the same reason: one push system in this product, not three that will disagree.
 *
 * ── ⚠️⚠️ THE EVENT CARRIES NO FINDING, ON PURPOSE ─────────────────────────────────────────────────────────────
 *
 * It says "an incident was raised on CAT001, by Athi". It does NOT carry the observation, the severity or the
 * screenshot. The client then READS through the ordinary, RLS-guarded endpoint. An event carrying the text
 * would be a second source of truth about a finding, and the day it disagreed with the board nobody could say
 * which was right — the same rule shopchanged.js already follows for a price.
 *
 * ── ⚠️ AND IT NAMES WHO DID IT, SO THEY CAN BE SKIPPED ────────────────────────────────────────────────────────
 *
 * events.emit goes to every connection of the entity, including the tab that just pressed the button. Telling
 * somebody what they have this second done is noise, and noise is how a notification stops being read. The
 * client compares `by` against itself.
 *
 * ⚠️ NEVER THROWS, NEVER BLOCKS. An incident that recorded must not fail because a colleague's browser could
 * not be told about it.
 *
 * ── ⭐⭐⭐ AND IT CARRIES THE RETURN LEG, WHICH IS THE HALF EVERY BOARD FORGETS ─────────────────────────────────
 *
 * Athi, 2026-09-13: *"a message back stating that this issue has been fixed — that feedback loop is not there.
 * Say I test it, I create an incident, you fix it and then update the message back that it has been fixed, so I
 * can retest and confirm that this has been resolved and close it."*
 *
 * ⭐ THE TWO STATES FOR THAT ALREADY EXISTED, unused as a pair: `resolved` is the FIXER saying "I believe this is
 * done", `closed` is the RAISER saying "I have looked, and it is". Nothing told the raiser their turn had come,
 * so `resolved` read as the end of the story and nothing was ever verified. `state` and `for` are what close it.
 *
 * ⚠️ `for` NAMES THE ONE PERSON WAITING. Everyone on the entity hears the event; only the raiser's session says
 * "yours to retest". A message telling five people to verify one fix gets verified by none of them.
 */

/**
 * @param entity_id  whose board this is
 * @param what       'incident' | 'requirement' | 'case' — WHAT KIND of thing moved, never its state
 * @param ref        the human handle — INC-260913-0S94, REQ-…, or the case key
 * @param extra      { state, forId, screen, by, byName }
 *                     state  — 'raised' (default) | 'resolved' | 'closed' | 'accepted' | 'rejected' | …
 *                     forId  — the person whose turn it now is (the original raiser), if anyone's
 *                     by     — the actor's id, so their own tab can skip the news
 *                     byName — their name, which is what a person actually reads
 */
function testRaised(entity_id, what, ref, extra) {
  if (!entity_id || !what) return 0;
  const x = extra || {};
  try {
    return require('./events').emit([String(entity_id)], {
      kind: 'test',
      what: String(what),
      /* ⚠️ the KIND and the STATE are two fields, not one. Folding them ('incident' or 'resolved') would leave
         the client unable to say WHAT was resolved, and it is the sentence a person has to read. */
      state: x.state ? String(x.state) : 'raised',
      ref: ref ? String(ref) : null,
      screen: x.screen ? String(x.screen) : null,
      /* ⚠ the id is for SKIPPING, the name is for SHOWING — a notification that says a uuid found something is
         worse than none, and a name alone cannot be compared against the reader */
      by: x.by ? String(x.by) : null,
      who: x.byName ? String(x.byName) : null,
      /* ⚠️ may be null, and often is: a case written by hand is owed to nobody in particular */
      for: x.forId ? String(x.forId) : null,
    });
  } catch (_) { return 0; }
}

module.exports = { testRaised };
