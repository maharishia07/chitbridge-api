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

/**
 * ── ⚠️⚠️ THE DOMAIN LIST WAS NOT ENOUGH, AND b161 IS THE PROOF ─────────────────────────────────────────────────
 *
 * b157 classified by domain and reported 90 customers. 75 of them were script artefacts — E2E Buyer, Meat Dept,
 * Version Proof 552951400, and seven ISO/ICC STANDARDS minted as businesses — created against domains the list
 * had never heard of: chitbridge.local · chitbridge.system · connector.iot · email.com · node.cb · proof.test ·
 * shopper.cb. I then quoted "90 real customers" all afternoon.
 *
 * ⭐⭐⭐ THE FIX IS NOT SEVEN MORE DOMAINS. A domain list can only ever be a guess about a string somebody chose.
 * Two STRUCTURAL facts were available the whole time and are declarations rather than guesses:
 *
 *     sealed = true              a platform-minted, frozen row (lib/source.js sets it for standards)
 *     owner_scope = 'platform'   owned by the platform, not by a tenant
 *
 * So `atMint()` tests those FIRST. The domain list survives only as the last resort for a self-registration,
 * where neither structural fact is available because the caller is a stranger at the public door.
 */

/** domains only our own test harnesses use. ⚠️ Never add one a real customer could plausibly own. */
const FIXTURE_DOMAINS = [
  '@test.example', '@test.com', '@test-cb.com', '@demo-cb.com', '@example.com',
  /* added by b161, on the evidence of what was actually in the table */
  '@proof.test', '@node.cb', '@shopper.cb', '@connector.iot',
];

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

/**
 * ⭐ THE STRUCTURAL TEST, for any mint that knows more than an email address.
 *
 * Prefer this over atRegistration() everywhere the caller can say what it is making. A row that declares itself
 * platform-owned never needs to be guessed about — which is the whole lesson of b161.
 *
 * @param {object} row  { sealed, owner_scope, email }
 */
function atMint(row) {
  const r = row || {};
  if (r.sealed === true || r.owner_scope === 'platform') return 'internal';
  return atRegistration(r.email);
}

module.exports = { atRegistration, atMint, FIXTURE_DOMAINS };
