// @stage tested
// OWNS      F13 (platform-10): the ONE rule for what the shop that MINTED an identity may still change on it (created_by, not the tree): SQL text + the refusal words.
// CALLED BY lib/network-build-run.js (arranging a store), routes/network-design.js (reissueClaim)
// FLOW      WHERE created_by = me AND CREATOR_MAY_EDIT_SQL → zero rows → creatorRefusal(name) in words
// CARD      18-identity-sign-in-and-access/row-level-security-and-shop-scoped-data
'use strict';
/**
 * ⭐ RULE (Athi's design: a minted identity is the PERSON'S once claimed; the minting shop never deletes it, it only ends its link): the creator may change a row it minted
 *   (1) while it is UNCLAIMED (last_active_at IS NULL: a first good sign-in stamps it, lib/identity-auth.js verifyCredential), or
 *   (2) when the row is a store the creator PROVISIONED as part of its network (entity_kind = 'network': "the operator decided", lib/visibility-cap.js).
 * It is NEVER allowed to delete. The database says the same in migrations/RUN-2026-11-22-b909-identities-creator-narrow.sql (policies on identities); this is the app's half, so a
 * refusal is a sentence and not a silent zero rows. Standards: OWASP API1 (object-level authorisation) and API5 (function-level); NIST SP 800-162 (the claim is an attribute of the object).
 */
const CREATOR_MAY_EDIT_SQL = `(last_active_at IS NULL OR entity_kind = 'network')`;

/** the refusal in words (RFC 9457 detail text; the route wraps it with lib/problem.js) */
const creatorRefusal = (name) =>
  `"${name}" was not changed. Either you did not create it, or its owner has already taken it over, and a shop cannot change a person it created once they have claimed it. Ask its owner to change it, or ask for access.`;

module.exports = { CREATOR_MAY_EDIT_SQL, creatorRefusal };
