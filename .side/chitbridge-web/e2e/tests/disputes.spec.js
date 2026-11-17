// MODULE: Disputes — THE USP. A dispute is TARGETED (only picked parties see it), the room is PRIVATE to them, and
// resolution is PER-PARTY. Two tests:
//   1 (single entity): the mechanics — raise on a chit, resolve it.
//   2 (THREE entities, multi-context): the real USP — A → B,C; A disputes with B ONLY → B sees it, C does NOT → A resolves.
// Run headed to watch it: `npm run test:multiparty` (or `playwright test disputes --headed`).
// LOCATORS: chit-dispute · dispute-category/reason/raise · dispute-resolve-open/note/submit · dispute-room-input/send ·
//           input.dispparty (the party picker) · nav-disputes
const { test, expect } = require('@playwright/test');
const { mintEntity, mintInContext, composeChit, composeSelfChit, settle, dismissModal } = require('../fixtures');

test.describe('Module · Disputes', () => {
  // A dispute is inherently BETWEEN parties — a self-chit has no counterparty, so raising on one produces no resolvable
  // dispute (confirmed live: no dispute panel appears). The real, valid mechanics are the 2-party flow in DISP-02.
  test.skip('[DISP-01] mechanics — (self-chit can\'t be disputed; see DISP-02 for the real 2-party flow)', async ({ page }) => {
    await mintEntity(page);
    const subject = 'E2E dispute ' + Date.now();
    await composeSelfChit(page, subject);
    await test.step('RAISE', async () => {
      await page.getByTestId('nav-task').click();
      await page.getByText(subject).first().click();
      await page.getByTestId('chit-dispute').click();
      await page.getByTestId('dispute-category').selectOption('quality');
      await page.getByTestId('dispute-reason').fill('Quantity short by two units, please replace.');
      await page.getByTestId('dispute-raise').click();
      await settle(page);
    });
    await test.step('RESOLVE — on the same chit detail (not the Disputes menu)', async () => {
      await dismissModal(page);                         // close the raise modal
      // the dispute is open on THIS chit — resolve it right here (dropdown to open it, then resolve the party)
      await page.getByTestId('dispute-resolve-open').first().click();
      await page.getByTestId('dispute-resolve-note').fill('Replacement sent and confirmed.');
      await page.getByTestId('dispute-resolve-submit').click();
      await expect(page.getByText(/resolved/i).first()).toBeVisible();
    });
  });

  // THE USP — but the resolve UI (open-dispute dropdown → "Resolve <party>") is runtime-rendered and my automated
  // diagnostics can't reliably reach it. Skipped until the exact resolve interaction is confirmed from a manual watch
  // (Athi walks it → gives the clicks, like the raise-flow screenshots) — then finalise the "sees/excluded/resolve" steps.
  /**
   * ⚠️ THE CONFIDENTIALITY HALF OF THIS IS NOW PROVEN IN dispute-privacy.spec.js — six assertions across THREE
   * entities: B sees the dispute, C on the same chit sees ZERO (not a redacted one, and not a count), a
   * stranger sees nothing. That spec is API-level, so it needs no manual step and runs on every regression.
   *
   * ⚠️ THIS one stays skipped ON PURPOSE: what it adds beyond that is the RESOLVE flow through the real UI,
   * which still needs a human to confirm. Leaving it skipped is honest; leaving the CLAIM unproven was not.
   */
  test.skip('[DISP-02] USP — A disputes with B only; B sees it, C does NOT; A resolves (needs manual resolve-UI confirm)', async ({ browser }) => {
    test.slow();   // 3 entities minted in 3 contexts → needs 3× the default timeout
    const A = await mintInContext(browser);   // sender / raiser
    const B = await mintInContext(browser);   // disputed party
    const C = await mintInContext(browser);   // other party — must be EXCLUDED
    const stamp = Date.now();
    const subject = 'USP order ' + stamp;
    const reason = 'Quality issue ' + stamp + ' — please review and replace.';

    await test.step('A composes ONE chit to both B and C', async () => {
      // Compose is a four-step wizard (Items → To → Details → Review); composeChit owns the walk so this spec can
      // stay about the DISPUTE. Two To recipients on ONE chit is the whole setup for the per-party scoping below.
      await composeChit(A.page, { subject, recipients: [B.name, C.name] });
    });

    await test.step('A raises a dispute TARGETED at B only', async () => {
      await dismissModal(A.page);                       // close the compose modal left open after send
      await A.page.getByTestId('nav-order').click();
      await A.page.getByText(subject).first().click();
      await A.page.getByTestId('chit-dispute').click();
      // tick ONLY B in the party picker (C left unticked → excluded)
      await A.page.locator('label').filter({ hasText: B.name }).locator('input.dispparty').check();
      await A.page.getByTestId('dispute-category').selectOption('quality');
      await A.page.getByTestId('dispute-reason').fill(reason);
      await A.page.getByTestId('dispute-raise').click();
      await settle(A.page);
    });

    await test.step('B SEES the dispute — C does NOT (targeting + privacy)', async () => {
      await B.page.reload();
      await B.page.getByTestId('nav-disputes').click();
      await expect(B.page.getByText(reason)).toBeVisible();          // B is on the dispute

      await C.page.reload();
      await C.page.getByTestId('nav-disputes').click();
      await expect(C.page.getByText(reason)).toHaveCount(0);         // C is excluded — never sees it
    });

    await test.step('A resolves WITH B (per-party)', async () => {
      await A.page.getByTestId('nav-disputes').click();
      await expect(A.page.getByText(reason)).toBeVisible();
      await A.page.getByTestId('dispute-resolve-open').first().click();
      await A.page.getByTestId('dispute-resolve-note').fill('Resolved with B — replacement shipped.');
      await A.page.getByTestId('dispute-resolve-submit').click();
      await expect(A.page.getByText(/resolved/i)).toBeVisible();
    });

    await A.context.close();
    await B.context.close();
    await C.context.close();
  });
});
