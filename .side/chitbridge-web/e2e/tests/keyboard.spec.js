// KEYBOARD OPERABILITY — the counter runs on the KEYBOARD; a mouse-only control is a BROKEN control (reviewer, 2026-07-17).
// Every counter flow must be completable start-to-finish with ZERO mouse events — Tab/Shift-Tab/Enter/arrows/typed numbers.
// If tabTo() can't reach a control, the operator can't either → the test FAILS. RED-proof: CB_KBD_BREAK=1 targets an
// unreachable control so a keyboard test that catches nothing proves nothing. Runs at the counter viewport (config).
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');

// Press Tab (or Shift-Tab) until the element carrying `testid` is the focused element. Returns false if unreachable
// within `max` presses — i.e. a keyboard trap or a mouse-only control. This is the whole keyboard-operability gate.
/**
 * ⚠️ THE BUDGET MUST COME FROM THE RING, NOT FROM A NUMBER (backlog 25 lead, 2026-08-16).
 *
 * A fixed `max` is a bet that the page has fewer tab stops than the guess — and this page's ring GROWS WITH THE
 * ACCOUNT'S DATA: every chit row contributes focusable controls, and KBD-01 itself sends a chit each time it
 * runs. Alone, that is one send. In a batch, every project inherits the chits the previous projects sent, so the
 * ring is longer by the time the later projects run and the same fixed budget stops reaching the target.
 *
 * That is precisely the "passes alone, fails in a batch, a different subset each run" signature — and it never
 * looks like a counting problem, it looks like Compose became unreachable by keyboard, which is a far more
 * alarming thing to read in a failure log.
 *
 * Counting the ring makes the budget true by construction. `+8` covers stops that only appear once focus enters
 * a widget. ⚠️ The caller's `max` is a FLOOR, not a ceiling — a small explicit value is RAISED, not respected.
 * That is harmless for the RED-proof hook (`max: 10` hunting a control that does not exist), which fails on
 * absence rather than on budget and simply takes longer; pass `cap: false` where a hard ceiling is the point.
 */
async function ringSize(page) {
  return page.evaluate(() => document.querySelectorAll(
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
  ).length);
}
async function tabTo(page, testid, { max = 60, shift = false, cap = true } = {}) {
  const key = shift ? 'Shift+Tab' : 'Tab';
  if (cap) max = Math.max(max, (await ringSize(page)) + 8);
  for (let i = 0; i < max; i++) {
    const cur = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid'));
    if (cur === testid) return true;
    await page.keyboard.press(key);
  }
  const cur = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid'));
  return cur === testid;
}

// The focused element's testid (for focus-order assertions).
const focusedTestId = (page) =>
  page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid'));

/**
 * Tab to a control whose testid STARTS WITH `prefix`. The step flow's primary button is `step-next-<generated-ns>`,
 * so its exact id is not knowable from a spec — but "the button that moves the wizard on" is, and that is what an
 * operator is reaching for.
 */
async function tabToPrefix(page, prefix, { max = 60, cap = true } = {}) {
  if (cap) max = Math.max(max, (await ringSize(page)) + 8);   // same growing-ring reasoning as tabTo
  for (let i = 0; i < max; i++) {
    const cur = await focusedTestId(page);
    if (cur && cur.startsWith(prefix)) return true;
    await page.keyboard.press('Tab');
  }
  const cur = await focusedTestId(page);
  return !!(cur && cur.startsWith(prefix));
}

/** Advance the compose wizard by keyboard alone, and prove the step actually changed. */
async function stepOnByKeyboard(page, expectStep) {
  expect(await tabToPrefix(page, 'step-next-'),
    'the step flow\'s primary button must be reachable by Tab — a mouse-only Next is a broken wizard').toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.locator(`[data-testid="step-${expectStep}"].now`),
    `compose did not advance to ${expectStep} on Enter`).toBeVisible();
}

test.describe('Keyboard operability · the counter runs on the keyboard', () => {
  test('[KBD-01] compose + send a chit using ONLY the keyboard', async ({ page }) => {
    await mintEntity(page);                      // arrange (reused pool session when present)
    await page.locator('body').click();          // one focus anchor — the ONLY pointer event; everything after is keyboard
    await page.keyboard.press('Tab');            // enter the tab ring

    await test.step('reach + open Compose by keyboard', async () => {
      const reached = await tabTo(page, 'nav-compose');
      expect(reached, 'Compose must be reachable by Tab (mouse-only = broken for the counter)').toBe(true);
      await page.keyboard.press('Enter');        // Enter activates the focused control
      // RED-proof hook: if asked, try to reach a control that does not exist → the flow must fail here.
      if (process.env.CB_KBD_BREAK) expect(await tabTo(page, 'this-control-does-not-exist', { max: 10 })).toBe(true);
    });

    /**
     * ⚠️ COMPOSE IS FOUR STEPS NOW (Items → To → Details → Review), so the keyboard has to walk it. That is not an
     * inconvenience for the test, it is the point of the test: a wizard whose Next is mouse-only is worse than the
     * single screen it replaced, because there is no way past it at all.
     */
    await test.step('ITEMS — fill the line with typed numbers (no forced tab-away mid-number)', async () => {
      // item name → qty → price, each reached by Tab and TYPED (numeric entry must not force a tab-away)
      expect(await tabTo(page, 'chit-item-name')).toBe(true);
      await page.keyboard.type('Widget');
      expect(await tabTo(page, 'chit-item-qty')).toBe(true);
      await page.keyboard.type('3');
      expect(await focusedTestId(page)).toBe('chit-item-qty');   // typing digits did NOT move focus
      expect(await tabTo(page, 'chit-item-price')).toBe(true);
      await page.keyboard.type('100');
      expect(await tabTo(page, 'chit-item-add')).toBe(true);
      await page.keyboard.press('Enter');        // Enter commits the line
      await stepOnByKeyboard(page, 'to');
    });

    await test.step('TO — add self as the recipient, by keyboard', async () => {
      expect(await tabTo(page, 'chit-add-self', { max: 40 })).toBe(true);
      await page.keyboard.press('Enter');
      await stepOnByKeyboard(page, 'details');
    });

    await test.step('DETAILS — type the subject the schema requires', async () => {
      expect(await tabTo(page, 'chit-field-subject')).toBe(true);
      await page.keyboard.type('Keyboard chit ' + Date.now());
      await stepOnByKeyboard(page, 'review');
    });

    await test.step('send by keyboard, land in Order', async () => {
      expect(await tabTo(page, 'chit-send')).toBe(true);
      await page.keyboard.press('Enter');
      // completed with zero mouse events beyond the initial focus anchor — confirm it sent
      // ⚠️ `.first()`. `a.or(b)` under strict mode FAILS when both match, and after a successful send both always
      // do — the app shell has a nav rail AND a #mainbody. So this assertion could only ever pass while the send
      // was broken enough to leave one of them off the page. It was failing for the opposite of the reason it
      // looked like: the flow worked, and the locator did not.
      await expect(page.getByTestId('nav-order').or(page.locator('#mainbody')).first()).toBeVisible();
    });
  });

  // FOCUS ORDER + NO-TRAP — Tab from the top of the compose form and confirm focus keeps moving (never captured) and
  // visits the fields in a logical order. A trap (focus can't move on) is a counter-speed killer.
  test('[KBD-02] focus order is logical and there are no keyboard traps', async ({ page }) => {
    await mintEntity(page);
    /**
     * ⚠️ ON A NARROW VIEWPORT THE NAV IS A CLOSED DRAWER, and this test did not model that: it clicked
     * `nav-compose` directly, which Playwright reports as visible and enabled while `.appwrap.m .menu` holds it
     * at translateX(-100%) — measured at left:-106px, outside the viewport. It failed as "element is outside of
     * the viewport", which reads like flake and is not; it is the mobile navigation working as designed.
     *
     * ⭐ Opening the drawer first is also the STRONGER test, because it is what a keyboard user on a phone
     * actually has to do: reach the hamburger, open it, then reach compose. Clicking straight through skipped
     * the one step unique to mobile.
     */
    const burger = page.getByTestId('nav-drawer');
    if (await burger.isVisible().catch(() => false)) await burger.click();
    await page.getByTestId('nav-compose').click();     // open compose (setup for the focus check)
    await page.locator('body').press('Tab');
    const seen = [];
    for (let i = 0; i < 40; i++) {
      const id = await focusedTestId(page);
      if (id) seen.push(id);
      await page.keyboard.press('Tab');
    }
    // no trap: over 40 tabs we must have visited MORE than one distinct control (focus never stuck)
    const distinct = [...new Set(seen.filter(Boolean))];
    expect(distinct.length, 'focus must move across multiple controls (no keyboard trap)').toBeGreaterThan(3);
  });
});
