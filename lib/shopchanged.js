/**
 * shopchanged.js — ONE SENTENCE, SAID ONCE: something a counter or a screen is holding a copy of has moved.
 *
 * Athi, 2026-09-09: *"when the offers are updated, how to push to TV and every other outlet? The push should happen and it should
 * be visible right away."*
 *
 * The counter and the shop screen each hold a LOCAL copy of the shop — that is what makes them fast and what makes them work with
 * the line down. The cost of a copy is that it goes stale, and until now the only cure was a timer: fifteen minutes on the screen,
 * a press of ↻ on the counter. A shopkeeper who changes a price and then stands in front of a television waiting for it does not
 * think "the cache will catch up"; they think it is broken.
 *
 * ⭐ ADOPTED, NOT INVENTED. lib/events.js already carries server push for the mailbox bell (SSE, one open GET per client, a
 * one-time ticket because EventSource cannot send a header). This adds no mechanism — it adds one more KIND of event down the
 * same pipe, so there is one push system in this product rather than two that will disagree.
 *
 * ⚠️ THE EVENT CARRIES NO DATA, ON PURPOSE — the same rule the bell already follows. It says "the catalogue moved"; the client
 * then READS through the ordinary, RLS-guarded snapshot. An event that carried the new price would be a second source of truth
 * about a price, and the day it disagreed with the snapshot nobody would know which was right.
 *
 * ⚠️ NEVER THROWS, NEVER BLOCKS. A write that succeeded must not fail because a television could not be told about it.
 */
'use strict';

/** tell every counter and screen of this shop that its copy is out of date. `what` is for the log, not for the client. */
function shopChanged(entity_id, what) {
  if (!entity_id) return 0;
  try { return require('./events').emit([String(entity_id)], { kind: 'shop', what: String(what || 'catalogue') }); }
  catch (_) { return 0; }
}
module.exports = { shopChanged };
