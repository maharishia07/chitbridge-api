// [BOARD] ONE BOARD FOR THE PRODUCT — a brand-new shop sees the same cases as everybody else.
//
// ── ⚠️⚠️ WHAT THIS CATCHES, AND WHY IT IS WORTH A SPEC OF ITS OWN ────────────────────────────────────────────
//
// Athi, 2026-09-13: he signed in as a second shop ("alpha timers") and the report came back EMPTY. The board
// held ChitBridge's OWN test suite — CAT001, RAL002, DTL001, the same screens for every shop, seeded from a
// file in the repo — but it was stored per-entity, so every tenant that pressed "Load cases" got a PRIVATE
// COPY and two people testing the product from two logins had two boards that could never see each other.
// Product data wearing tenant clothing. His call: *"make it platform data, one board for the product."*
//
// ⭐ The switch is lib/testboard.js + TEST_BOARD_ENTITY. This spec is the only thing that can tell the
// difference between "the switch is on" and "the switch is set to an entity that happens to be empty" — both
// of which look like a working deployment from the outside.
//
// ⚠️ IT IS DELIBERATELY TOLERANT OF THE SWITCH BEING OFF. Unset, the board is per-entity and a fresh shop
// SHOULD see nothing; that is the documented fallback, not a failure. The spec asserts the two states are
// each internally consistent and reports which one it found, rather than hard-failing a legitimate config.
//
// Run: npx playwright test tests/one-board.spec.js --reporter=line
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

test('[BOARD-01] a brand-new shop sees the product board, not an empty one', async ({ page }) => {
  test.setTimeout(300000);

  /* ⭐ FRESH is the whole point: an entity minted seconds ago has never pressed "Load cases", so under the
     old per-entity model its board is necessarily empty. Anything it can see, it can only see because the
     board is shared. */
  await mintEntity(page, { fresh: true, name: 'Board ' + Date.now().toString().slice(-6) });
  const token = await page.evaluate(() => SESSION.token);
  const H = { Authorization: 'Bearer ' + token };

  const cases = await (await page.request.get(API + '/api/testing/cases', { headers: H })).json();
  const n = (cases.cases || cases.items || []).length;

  const rep = await (await page.request.get(API + '/api/testing/report', { headers: H })).json();
  const s = (rep.sections || []);
  const two = s.filter((x) => x.id === '2')[0] || {};
  const ten = s.filter((x) => x.id === '10')[0] || {};
  const six = s.filter((x) => x.id === '6')[0] || {};
  const total = ((two.body || {}).totals || {}).total || 0;

  /**
   * ⚠️⚠️ N01 (2026-10-07): THE TOLERANCE BELOW HID THE ONE STATE THIS SPEC EXISTS TO CATCH. If the switch fell
   * off production, the spec took the "documented fallback" branch and went GREEN — exactly "the switch is set
   * to nothing", reported as a pass. Production runs the shared board, so an empty board is now a RED unless
   * the deployment under test says, explicitly, that it is per-entity (CB_BOARD_PER_ENTITY=1).
   */
  if (n === 0 && process.env.CB_BOARD_PER_ENTITY !== '1') {
    expect(n, 'a brand-new shop sees NO cases: TEST_BOARD_ENTITY is unset or points at an empty board. '
      + 'Set CB_BOARD_PER_ENTITY=1 only for a deployment that is meant to be per-entity.').toBeGreaterThan(0);
  }

  if (n === 0) {
    /**
     * ── THE SWITCH IS OFF — the documented fallback, and it must still be HONEST ──────────────────────────
     * ⚠️⚠️ THIS IS THE STATE THAT USED TO PRINT A CLEAN, SIGNABLE REPORT: zeros everywhere, "None." under
     * Incidents, six green MEASURED tags and two ruled signature lines — indistinguishable on paper from a
     * product that was tested and found clean. Whatever else is true, an empty board must SAY it is empty
     * and must not be signable.
     */
    expect(total, 'no cases, so section 2 must total zero').toBe(0);
    expect(ten.no_sign, 'an empty board must NOT offer a signature block').toBeTruthy();
    expect((six.caveats || []).join(' '),
      'section 6 must say the board is empty — its other caveats are all zero here and go silent')
      .toMatch(/NO TEST CASES ON THIS BOARD/i);
    console.log('  TEST_BOARD_ENTITY is not set — per-entity board, and the empty state is honest.');
    return;
  }

  /* ── the switch is on ── */
  /* ⭐ the product board, not a handful: 1,499 is what the board held when it became shared (2026-09-13) */
  expect(n, 'a fresh shop can only see cases because the board is shared').toBeGreaterThanOrEqual(1499);
  expect(total, 'the report must count the same board the case list returned').toBe(n);
  expect(ten.no_sign, 'a board with cases AND results is signable').toBeFalsy();
  console.log('  one board · a shop minted seconds ago sees ' + n + ' cases.');
});
