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

const RAW = String(process.env.TEST_BOARD_ENTITY || '').trim();

/* A uuid or nothing. A malformed id would not fail loudly - it would scope every query to an entity that does
   not exist and report an empty board, which is exactly the symptom this change exists to remove. */
const VALID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(RAW) ? RAW : null;

if (RAW && !VALID) {
  console.warn('[testboard] TEST_BOARD_ENTITY is set but is not a uuid - ignoring it, board stays per-entity');
}

/** the entity that owns the shared board, or null while the board is still per-tenant */
function shared() { return VALID; }

/**
 * THE ONE CALL EVERY TESTING ROUTE MAKES. Pass the caller's own entity; get back whichever entity this route
 * should actually read and write.
 * It takes the FALLBACK rather than the request, so it can never be handed a for_entity from a body - the
 * entity still comes from the token and never from input.
 */
function entityFor(callerEntity) { return VALID || callerEntity; }

module.exports = { shared, entityFor };
