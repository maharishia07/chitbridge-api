'use strict';
/**
 * ── THE TEST BOARD IS PLATFORM DATA, NOT TENANT DATA ──────────────────────────────────────────────────────
 *
 * Athi, 2026-09-13, after signing in as a second shop and finding the report empty:
 *   "i guess it is irrespective of the user id, i used alpha timers and the report came empty?"
 *   "make it platform data, one board for the product."
 *
 * WHAT THE BOARD CONTAINS IS THE PRODUCT'S OWN TEST SUITE. CAT001 Catalogue, RAL002 Task, DTL001 - the same
 * screens for every shop on the rail, seeded from TEST-CASES-V2.js, a file in the repo. Stored per-entity,
 * every tenant that pressed "Load cases" got a PRIVATE COPY of ChitBridge's own suite, and two people testing
 * the product from two logins had two boards that could never see each other. Product data in tenant clothing.
 *
 * SO ONE ENTITY OWNS THE BOARD AND EVERY TESTING ROUTE READS AND WRITES THAT ONE.
 *
 * THIS IS A DELIBERATE, NARROW EXCEPTION to the core principle - never share OWNED data, replicate per-copy.
 * It is justified because the board is ABOUT the product rather than about any shop's trade. It is written
 * down here, in one file, so the exception can be found, argued with and switched off, rather than spread
 * across twenty routes as an assumption.
 *
 * AND IT HAS A CONSEQUENCE THAT MUST NOT BE DISCOVERED LATER. Findings carry FREE TEXT and SCREENSHOTS: a
 * tester writes "the biscuit shows 9.00 but the bill says 10.62" and attaches a capture of the screen. On a
 * shared board that is visible to every signed-in user of the platform. The board is a good place for facts
 * about the PRODUCT and a bad place for anything about a shop's own trade.
 *
 * OFF BY DEFAULT, ON BY ENV. Unset, every route behaves exactly as it did - the caller's own entity. Set
 * TEST_BOARD_ENTITY and the board becomes one. A change of this size wants a switch you can throw back
 * without a deploy, and it makes the data migration safe to run in either order.
 */

/* A uuid or nothing. A malformed id would not fail loudly - it would scope every query to an entity that does
   not exist and report an empty board, which is exactly the symptom this change exists to remove.
   ⭐ The read-and-validate is shared with lib/platformroot.js, which resolves its entity the same way. */
const VALID = require('./namedentity').fromEnv('TEST_BOARD_ENTITY', 'testboard', 'board stays per-entity');

/**
 * ── ⭐⭐⭐ AND THE BOARD IS SHARED BY KIND, NOT WHOLESALE ─────────────────────────────────────────────────────
 *
 * Athi, 2026-09-14: *"the requirement / incident should not be seen by others, other than the platform owner,
 * which is us?"* — and he was right to ask, because every route below pointed at the board and the answer was
 * therefore "no, everyone sees them".
 *
 * `definition.kind` holds four things in one table, and they do NOT have one audience:
 *
 *   ✅ testcase   THE PRODUCT'S OWN SUITE. CAT001 Catalogue, RAL002 Task — the same screens for every shop on
 *                 the rail, seeded from a file in the repo. Contains nothing about anybody's trade. SHARED.
 *
 *   ❌ spec       ⚠️⚠️ THIS IS THE REQUIREMENT KIND. `POST /requirements` writes kind='spec' and `GET
 *                 /requirements` reads it back; the word "requirement" appears only as a DISPLAY label out of
 *                 teststatus.workStatus(). Anyone splitting these by kind who trusts the route name instead of
 *                 the INSERT will leave every requirement on the shared board. It is what nearly happened here.
 *
 *   ❌ incident   what somebody found wrong, in their words, with a screenshot. About a SHOP'S BUSINESS.
 *
 *   ❌ evidence   the screenshot itself (cb_attachment). Its own route says it best: *"a test screenshot
 *                 belongs to the tester who took it and to nobody else."*
 *
 * ⚠️ THE WHOLE OF `spec`, `incident` AND `evidence` IS FREE TEXT AND IMAGES. On a shared board that is visible
 * to every signed-in user of the platform — prices, party names, a photograph of somebody's till. The header
 * above warned about exactly this on the day the board was built, and every route ignored it.
 */
const SHARED_KINDS = new Set(['testcase']);

/** the entity that owns the shared board, or null while the board is still per-tenant */
function shared() { return VALID; }

/**
 * THE ONE CALL EVERY TESTING ROUTE MAKES. Pass the caller's own entity; get back whichever entity this route
 * should actually read and write.
 * It takes the FALLBACK rather than the request, so it can never be handed a for_entity from a body - the
 * entity still comes from the token and never from input.
 */
function entityFor(callerEntity) { return VALID || callerEntity; }

/**
 * ⭐ THE OTHER HALF OF THE RULE, AS A NAMED FUNCTION RATHER THAN A BARE `auth.entityOf(req)`.
 *
 * A finding — an incident, a requirement, a screenshot — stays with whoever raised it, board or no board.
 *
 * ⚠️ IT IS DELIBERATELY NOT WRITTEN AS `auth.entityOf(req)` AT THE CALL SITE. A bare caller-entity sitting
 * among twenty `testboard.entityFor(...)` lines reads as an oversight, and the next person to tidy this file
 * will "make it consistent" and reopen the hole. A named call that says what it is cannot be tidied away by
 * accident, and it greps. [[feedback-stay-in-the-construct]]
 */
function entityForFinding(callerEntity) { return callerEntity; }

/**
 * The same decision, data-driven, for the one query that reads several kinds at once (the report's §"what was
 * found"). Pass the kind; get the entity that kind lives in.
 */
function entityForKind(kind, callerEntity) {
  return SHARED_KINDS.has(String(kind)) ? entityFor(callerEntity) : entityForFinding(callerEntity);
}

/** the kinds that live on the shared board — exported so a test can assert the split rather than assume it */
function sharedKinds() { return Array.from(SHARED_KINDS); }

module.exports = { shared, entityFor, entityForFinding, entityForKind, sharedKinds };
