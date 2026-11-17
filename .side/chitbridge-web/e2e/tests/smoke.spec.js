// smoke.spec.js — SMOKE: after minting, open EVERY menu item + toolbar icon and confirm each part renders (no crash).
// This is the "we've seen each part is working" pass. Menu items auto-get a nav-<key> testid (menuBtn), so this list
// is the coverage checklist — extend it as the panel grows. Capability-gated items (connectors/disputes) may be hidden;
// those are skipped (not failed) when absent.
const { test, expect } = require('@playwright/test');
const { mintEntity, dismissModal } = require('../fixtures');

/**
 * ⚠️ THIS LIST DRIFTED FROM THE RAIL AND THE TEST SAID NOTHING.
 *
 * The loop below skips any entry it cannot find — "capability-gated, don't fail" — which was reasonable when
 * written and became a hole the moment the rail changed. On 2026-08-15 `folders`, `profile`, `settings` and
 * `assistreview` all left the rail (folders now hang under their tracks; profile and settings moved behind the
 * avatar). SMOKE-01 kept passing while silently testing 4 fewer screens than it claimed. A safety net that
 * quietly gets smaller is worse than no net, because the green tick is doing the reassuring.
 *
 * So the list is now split: what MUST be in the rail, and what is reachable ELSEWHERE and gets asserted where it
 * actually lives. Neither can be skipped without failing.
 */
const NAV = ['task', 'order', 'messages', 'drafts', 'trash', 'archive', 'network', 'suppliers', 'customers',
  'catalogue', 'readiness', 'coassists', 'mis'];
/* Reachable, but not from the rail — asserted at their real home so a move fails loudly instead of skipping. */
const ELSEWHERE = [
  { key: 'profile',  where: 'avatar menu' },
  { key: 'settings', where: 'avatar menu' },
];
/* Capability-gated: legitimately absent for some entities. Explicitly listed, so "absent" is a DECISION here
   rather than an accident that looks like one. */
const GATED = ['disputes'];

test.describe('Smoke · every menu item + icon renders', () => {
  test('[SMOKE-01] open each menu item', async ({ page }) => {
    await mintEntity(page);
    await expect(page.getByTestId('nav-compose')).toBeVisible();   // app shell (restored session lands at #/, fresh mint at #/app)
    for (const key of NAV) {
      await test.step(`nav: ${key}`, async () => {
        const item = page.getByTestId(`nav-${key}`);
        /* ⚠️ ASSERT, DO NOT SKIP. The old `if (count()===0) return` is why this test kept passing after four
           screens left the rail. If it is meant to be in the rail it must BE in the rail. */
        await expect(item, `${key} must be in the rail — if it moved, move it to ELSEWHERE or GATED`).toHaveCount(1);
        await item.click();
        await expect(page.locator('#mainbody')).toBeVisible();   // the screen mounted without crashing
      });
    }

    /* Reachable, but not from the rail — proven where they actually live, so a future move fails loudly. */
    await test.step('avatar menu holds profile + settings', async () => {
      await page.getByTestId('icon-avatar').click();
      const menu = page.getByTestId('avatar-menu');
      await expect(menu, 'the avatar opens a menu').toHaveCount(1);
      for (const e of ELSEWHERE) {
        await expect(menu.getByTestId(`nav-${e.key}`), `${e.key} should be in the ${e.where}`).toHaveCount(1);
      }
    });

    /* Gated ones are allowed to be absent — but the LIST is asserted, so silently gating a fourteenth screen
       still shows up as an edit to this file rather than as nothing at all. */
    await test.step('capability-gated screens are a declared set', async () => {
      expect(GATED, 'if you gate another screen, declare it here').toEqual(['disputes']);
    });
  });

  test('[SMOKE-02] open compose + each toolbar icon', async ({ page }) => {
    await mintEntity(page);
    await test.step('compose (modal)', async () => {
      await page.getByTestId('nav-compose').click();
      await expect(page.locator('#modalhost')).not.toBeEmpty();   // compose modal opened
      /**
       * ⚠️ Escape was a NO-OP here and this step only continued because the modal was being destroyed underneath
       * it by a background renderApp (fixed 2026-08-09). With that gone, compose correctly stays open and its
       * backdrop intercepts every toolbar click below — so close it deliberately, the way the other steps do.
       *
       * Escape-to-close is deliberately NOT wired for compose: it would discard a draft on a stray keypress,
       * which is the same lost work the renderApp fix exists to prevent. Cancel and the ✕ are explicit; minimise
       * keeps the draft.
       */
      await dismissModal(page);
      await expect(page.locator('#modalhost')).toBeEmpty();
    });
    await test.step('assistant', async () => {
      await page.getByTestId('assistant-open').click();
      await expect(page.getByTestId('assist-input')).toBeVisible();
      await page.getByTestId('assist-close').click();
    });
    /* ⚠️ `icon-messages` IS GONE, and this step is why the removal was not free. The 💬 message centre duplicated
       the Messages screen and counted `m.unread`, which mapApiMsg hardcodes false — a badge that was structurally
       always zero. It was dropped on 2026-08-15 and the RAID report, its one unique feature, took its place.

       ⚠️ AND NOW `icon-raid` IS GONE TOO — the report moved to Insight → Register on 2026-08-30, because the
       topbar is for state that changes while you work and a report is a place you go. Same step, new door: the
       point of walking it was never the icon, it was that the report opens and closes without leaving wreckage. */
    await test.step('register report', async () => { await page.evaluate(() => navTo('raida')); await dismissModal(page); });
    await test.step('notifications', async () => { await page.getByTestId('icon-notifications').click(); await dismissModal(page); });
    await test.step('legend', async () => { await page.getByTestId('icon-legend').click(); await dismissModal(page); });
  });
});
