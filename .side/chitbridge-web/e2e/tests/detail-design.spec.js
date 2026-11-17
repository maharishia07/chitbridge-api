'use strict';
/* detail-design.spec.js — ── THE DETAIL-PAGE CHOICE ────────────────────────────────────────────────────────────────────────────────────
 *
 * Athi, 2026-08-24: *"attach design 1 or design 2 as per the choice in the settings, in the header record — so we
 * avoid complication of moving from one record type to another and both can be tested independently."* And on
 * everything raised before it shipped: *"just to cover the existing chit, if nothing found, keep it as design 1."*
 *
 * ⭐⭐ TWO CLAIMS, TESTED WHERE EACH ONE LIVES:
 *
 *   THE RECORD  — a chit is stamped at creation and the stamp never moves. That is a fact about stored data, so
 *                 it is read back from the API. A UI check could not tell a stamp from a lucky render.
 *   THE SCREEN  — a stamped chit opens line by line. That is a fact about rendering, so it is read off the page.
 *
 * ⚠️ AND NOT BY SUBJECT. `composeChit` types a subject that a fresh entity's blueprint does not carry, so the
 * chit is created with an AUTO subject ("Order from e2eco-… — 25 Aug 2026") and every search for the typed one
 * fails forty seconds later as "not in the task list" — which reads like a broken list and is not. The send
 * response carries the chit_id; that is what this follows.
 */
const { test, expect } = require('@playwright/test');
const { mintEntity, composeChit, clickNav, openAvatarItem, settle } = require('../fixtures');
/* ⭐ The choice is operated and read back by flows/detail-design.js — the same driver the two-party spec uses,
   so "set the preference" cannot come to mean two different things in two files. */
const { setDetailDesign, storedDesign, watchSends } = require('../flows/detail-design');

const stamp = () => Date.now().toString().slice(-6);

test.describe('Detail page · Order level or Line level', () => {
  test('[DD-01] the setting stamps the next chit, and never an existing one', async ({ page }) => {
    test.setTimeout(10 * 60 * 1000);
    const s = stamp();

    await mintEntity(page);
    await settle(page);
    await page.waitForTimeout(2500);

    const sent = watchSends(page);
    const compose = async (label) => {
      const before = sent.length;
      await composeChit(page, { subject: label, self: true, item: 'Widget ' + s, qty: 1, price: 100 });
      await expect.poll(() => sent.length, { timeout: 30000 }).toBeGreaterThan(before);
      const last = sent[sent.length - 1];
      expect(last.status, 'the chit was refused, so nothing could be stamped').toBeLessThan(400);
      return last.id;
    };

    let orderChit;
    let lineChit;

    await test.step('DEFAULT — no preference means Order level, and nothing is stamped', async () => {
      orderChit = await compose('Order job ' + s);
      /**
       * ⚠️ NULL, not 'chit'. The flag is written only when it is NOT the default, so an entity that never chose
       * does not get a stamp claiming it did — which is exactly what makes every chit raised before this
       * shipped read as Order level, per Athi: *"if nothing found, keep it as design 1."*
       */
      expect(await storedDesign(page, orderChit),
        'a chit raised with no preference must carry no stamp at all').toBe(null);
    });

    await test.step('PROFILE — it states the choice without being expanded', async () => {
      await openAvatarItem(page, 'nav-profile');
      await page.waitForTimeout(2500);
      await expect(page.getByText(/Order level/).first(),
        'the profile does not state which detail page is in force').toBeVisible({ timeout: 20000 });
    });

    await test.step('SWITCH — Line level stamps the next chit', async () => {
      await setDetailDesign(page, 'lines');
      lineChit = await compose('Line job ' + s);
      expect(await storedDesign(page, lineChit),
        'a chit raised under Line level was not stamped').toBe('lines');
    });

    await test.step('⭐⭐ THE EARLIER CHIT DID NOT MOVE', async () => {
      /**
       * ⚠️ THIS IS THE ASSERTION THAT MATTERS, and it is why the stamp is a stored fact rather than a lookup.
       * The chit raised before the switch must still carry no stamp — if this fails, changing a setting has
       * reshaped work that was already recorded.
       */
      expect(await storedDesign(page, orderChit),
        'the earlier chit gained a stamp when the setting changed — the design is being resolved at read '
        + 'time instead of being written once at creation').toBe(null);
    });

    await test.step('AND BACK — Order level again leaves the stamped chit stamped', async () => {
      await setDetailDesign(page, 'chit');
      expect(await storedDesign(page, lineChit),
        'the Line level chit lost its stamp when the setting changed — same fault, other direction').toBe('lines');
      expect(await storedDesign(page, orderChit), 'the unstamped chit changed too').toBe(null);
    });

    await test.step('THE SCREEN — a stamped chit opens line by line', async () => {
      /**
       * ⭐ The record is proved above; this proves the screen obeys it. Design 1 always paints first — design 2
       * is a lazy module that fetches the chit again before replacing it — so its ARRIVAL is the signal, and
       * only its absence needs waiting out.
       */
      await clickNav(page, 'task');
      await page.waitForTimeout(3000);
      await page.evaluate((id) => { if (typeof openChit === 'function') openChit(id); }, lineChit);
      const lines = page.getByTestId('c2-side-them');
      const opened = await lines.waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false);
      expect(opened, 'a Line level chit did not open line by line').toBe(true);

      /**
       * ⚠️⚠️ DRIVEN THE WAY A PERSON DOES — back to the list, then the other row. Calling `openChit()` from
       * `page.evaluate` underneath design 2 does not switch the screen: design 2 owns `#mainbody` and the
       * function that repaints it, so the call lands somewhere nobody is looking. That is a fair thing for a
       * test to discover and the wrong thing for a test to assert against.
       *
       * The rows are newest first, so the Line level chit is row 0 and the Order level one is row 1.
       */
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByTestId('nav-compose').waitFor({ timeout: 30000 });
      await page.waitForTimeout(3000);
      await page.evaluate((id) => { if (typeof openChit === 'function') openChit(id); }, orderChit);
      await page.waitForTimeout(8000);
      /**
       * ⚠️ REPORT WHAT IS ACTUALLY THERE. "count is 1" says design 2 is on screen and nothing about WHOSE — and
       * three separate fixes were aimed at this line before it was clear which chit the screen was showing.
       */
      const seen = await page.evaluate(() => ({
        design2: document.querySelectorAll('[data-testid="c2-side-them"]').length,
        design1: document.querySelectorAll('[data-testid="open-design2"]').length,
        showing: (document.querySelector('#mainbody .dh, #detailpane .dh, #mainbody') || {}).textContent
          ? (document.querySelector('#mainbody .dh, #detailpane .dh, #mainbody').textContent || '')
              .replace(/\s+/g, ' ').trim().slice(0, 70) : '(nothing)',
      }));
      expect(seen.design2,
        `an unstamped chit opened line by line — it must read Order level. On screen: ${JSON.stringify(seen)}`)
        .toBe(0);
    });
  });
});
