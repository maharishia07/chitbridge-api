'use strict';
/**
 * lib/assist-parts.js — the assistant's per-screen hints and the catalogue-source write's refusals (who may rewrite a source row, the key's bounds).
 * OWNS      CONTEXT_HINTS · sourceRefusal · keyRefusal (no route, no state)
 * CALLED BY routes/assist.js (POST / and PUT /catalogue-source)
 * FLOW      sourceRefusal(row, owner) -> the words or null · keyRefusal(key) -> the problem spec or null
 * CARD      25-ai-cb-assist-and-support-desks/cb-assist-knowledge-base
 */
const { words } = require('./assist-contract'); // the words of a refusal

// Per-screen focus hints — turn the `context` the client sends (curScreen()) into a one-line steer so the model
// answers for the screen the user is actually on. Keep each TRUE and aligned with the KB.
const CONTEXT_HINTS = {
  coassists:
    "On the Co-assists screen: people (and, planned, systems) that act for the user within the entity's scope — push/pull/bulk assignment, shifts, breaks/leave returning work to the pool. (Per-actor scoping is planned, not yet enforced — a co-assist currently sees all of the entity's chits.)",
  schema:
    'Asking about schemas/blueprints: the configurable fields and rules a deal carries (configuration, not code). The container — record, privacy, audit — stays fixed.',
  compose:
    'On Compose: authoring a chit. Fields are schema-driven; line items come from the catalogue; sending creates a two-copy shared record (sent + received).',
  disputes: 'On Disputes: either side raises a disagreement; it is recorded, both sides see it, and it is resolved on the record.',
  network: "On Network: arranging the user's own branches/members as a tree under a top node; each node keeps its own record.",
  catalogue: 'On Catalogue: the public storefront the user can expose. Private by default; only what they mark public is visible.',
  suppliers: "On Suppliers: the user's supplier relationships, added by user id or email."
};

/** the words of why this caller may not rewrite the source row (or null): owned by another brand; or an unowned platform seed and the caller is not the root (SEC-FIX3 S11) */
function sourceRefusal(row, owner) {
  if (!row) return null;
  if (row.owner_entity_id) return String(row.owner_entity_id) === String(owner) ? null : words.sourceOfAnother();
  return require('./platformroot').isRoot(String(owner)) ? null : words.sourceOfThePlatform();
}

const SOURCE_KEY_MAX = 200;
/** the problem spec when the key is missing (422) or longer than a label should be (400, CAT-246: a 60k-character one was stored with 200), else null */
const keyRefusal = (key) => (!key ? { status: 422, ...words.sourceKeyNeeded() } : key.length > SOURCE_KEY_MAX ? { status: 400, ...words.sourceKeyTooLong(SOURCE_KEY_MAX) } : null);

module.exports = { CONTEXT_HINTS, sourceRefusal, keyRefusal };
