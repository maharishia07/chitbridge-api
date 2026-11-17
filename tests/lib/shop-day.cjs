'use strict';
/**
 * tests/lib/shop-day.cjs — THE ONE "today" a realstack / walk test uses as a shop's business day (tzsweep, 18 Nov 2026).
 *
 * A shop posts under ITS OWN calendar day (books-hooks.dayOf, the product's one rule for the zone). A test that reads the books "as at"
 * `new Date().toISOString().slice(0, 10)` (the UTC day) reads an empty day from 18:30 to 24:00 UTC when the shop is Asia/Kolkata (its day is already
 * tomorrow's): R1-03 went red that way on 17 Nov. So a test asks THIS file; it never slices a UTC ISO string.
 *
 * owns: shopToday · shopDayAt. Widen, never copy: the zone rule itself stays books-hooks.dayOf; this file only supplies the moment (+ N days).
 * called by: tests/lib/truth-harness.cjs (re-exports both) and every realstack that needs a day. Guard: tests/realstack-shop-day.test.cjs.
 * CARD 29-qa-test-tooling-ux-locale-and-design-system
 */
const DEFAULT_ZONE = 'Asia/Kolkata'; /* the test shops are IN (freshShop); pass 'Australia/Sydney' etc. for another */
/** the shop's calendar day (YYYY-MM-DD) now, in the shop's zone */
const shopToday = (zone) => shopDayAt(0, zone);
/** the shop's calendar day `days` from now (negative = past); whole days of 24 h, read in the shop's zone */
const shopDayAt = (days, zone) => require('../../lib/books-hooks').dayOf(Date.now() + (Number(days) || 0) * 86400000, zone || DEFAULT_ZONE);
module.exports = { shopToday, shopDayAt, DEFAULT_ZONE };
