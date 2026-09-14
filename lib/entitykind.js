'use strict';
/**
 * lib/entitykind.js — WHAT AN IDENTITY IS, AND THE ONE PLACE A GUESS SURVIVES.
 *
 * Athi, 2026-09-14: *"we have to understand what are original, what are network entities, test entities and
 * for any other purpose?"*
 *
 * `identities.entity_kind` (b157) is DECLARED at every mint: local suppliers say 'supplier', network branches
 * say 'network', actors and connectors say 'actor', walk-in shoppers say 'shopper', platform-owned rows say
 * 'internal'. Each is a fact the minting code knows for certain, so each simply states it.
 *
 * ── ⚠️⚠️ REGISTRATION IS THE EXCEPTION, BECAUSE A TEST FIXTURE ARRIVES THROUGH THE PUBLIC DOOR ────────────────
 *
 * The e2e harness registers through the ordinary API, exactly as a shop does. It has no private channel to say
 * "I am a fixture", and it must not be given one:
 *
 * ⚠️⚠️ `entity_kind` MUST NEVER BE ACCEPTED FROM THE REQUEST BODY. A client that can name its own kind can
 * register as 'internal' and sit in the operator's own class, or as 'test' and be swept by a cleanup that
 * believes it is deleting fixtures. It is decided here, server-side, from something the caller cannot forge
 * into a privileged value.
 *
 * ⭐ SO ONE INFERENCE SURVIVES — THE EMAIL DOMAIN — AND ONLY AT THE MINT. That is a real improvement over what
 * it replaces, and the difference is the whole point of b157:
 *
 *     BEFORE  every reader re-guessed, forever, from a domain list. Four copies of the guess, all fragile, and
 *             one of them decided what `cleanup-test-entities.sql` would DELETE.
 *     AFTER   the guess runs ONCE, at the mint, and becomes a stored fact. Readers read a column. The delete
 *             predicate becomes `entity_kind = 'test'` — something recorded, not something re-derived.
 *
 * ⚠️ AND THE DOMAIN LIST HERE IS DELIBERATELY NARROWER THAN THE CLEANUP SCRIPT'S. It omits `@x.com` (now a real
 * company's domain) and `@t.com` — neither has ever matched a row, and a domain that could belong to a real
 * business must not be able to mark that business as disposable. This list may only contain domains our own
 * fixtures use and that no customer could plausibly own.
 */

/** domains only our own test harnesses use. ⚠️ Never add one a real customer could own. */
const FIXTURE_DOMAINS = ['@test.example', '@test.com', '@test-cb.com', '@demo-cb.com', '@example.com'];

/**
 * The kind to stamp on a self-registering identity.
 *
 * ⚠️ Defaults to 'customer', and the direction matters: a fixture wrongly called a customer is visible and
 * fixable, while a customer wrongly called a fixture disappears from the platform's books and is swept by the
 * next cleanup. Wrong in the recoverable direction, always.
 */
function atRegistration(email) {
  const e = String(email == null ? '' : email).trim().toLowerCase();
  return FIXTURE_DOMAINS.some((d) => e.endsWith(d)) ? 'test' : 'customer';
}

module.exports = { atRegistration, FIXTURE_DOMAINS };
