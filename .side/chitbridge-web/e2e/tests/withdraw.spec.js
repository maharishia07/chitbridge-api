/**
 * CARD  03-disputes-service-and-register/cancel-request-confirm
 * withdraw.spec.js — THE WHOLE LOOP: A withdraws, B is told, and B's copy does not move.
 *
 * Athi, 2026-09-02: *"wire the button and rename it to Withdraw"* · *"it has to be flagged against the order
 * right away, so we need a flag to show cancel requested"* · *"set it up on test entities and run the full loop"*.
 *
 * ── ⚠️⚠️ WHY A TWO-PARTY SPEC AND NOT THREE UNIT CHECKS ────────────────────────────────────────────────────────
 * Every piece of this was verified alone and every piece passed: the button's folder gate in the browser, the
 * banner's four render states against fixtures, the column arriving in the payload. What NONE of them could see
 * is the join — that the thing A presses stamps the row B reads. This session has already produced two features
 * that were green in parts and dead in the middle (a storefront gate on the wrong predicate, cancel columns added
 * to one of three list queries), so the join is the assertion worth having.
 *
 * ── ⭐ THE INVARIANT THIS EXISTS TO PROTECT ────────────────────────────────────────────────────────────────────
 * A withdrawal must NEVER move B's status. The route is emphatic — a supplier who cut the stock at 6am has to be
 * able to refuse — and that is precisely the kind of rule a later "tidy-up" breaks, because propagating the
 * status looks tidier and passes every test that only checks A's side. So B's status is read BEFORE and AFTER
 * and compared. That single assertion is the reason this file will still be worth running in a year.
 *
 * ⚠️ IT SENDS A REAL CHIT between two freshly minted test entities, which is why it is not in the default run. Athi approved
 * exactly this on 2026-09-02 ("just t1, t2 level, possibly you can use the existing test entity"). It never
 * touches a customer entity and never leaves an obligation on one.
 *
 * Run: npx playwright test tests/withdraw.spec.js --project=authed
 */
'use strict';
const { test, expect } = require('@playwright/test');
const { mintInContext, composeChit, settle } = require('../fixtures');

test.describe('Withdraw · the cancel-request loop', () => {
  test('[WD-01] A withdraws; B is flagged and B\'s own status does not move', async ({ browser }) => {
    test.slow();   // two signed-in contexts, a real send, and a status write

    /**
     * ⚠️ MINTED, NOT POOLED — and the first run proved why. Athi suggested the existing test entities, so this
     * started on poolContext(0)/(1) and failed at the very first click: nav-compose never appeared, because
     * the saved pool sessions are not signed in on this machine. poolContext swallows that (its waitFor has a
     * .catch) and hands back a page sitting on the login screen, so the failure surfaces four lines later as a
     * timeout on an unrelated locator.
     *
     * mintInContext is what MP-01 uses and it works. The cost is two registrations per run; the benefit is that
     * the spec depends on nothing that a previous run has to have left behind.
     */
    const A = await mintInContext(browser);   // sender — withdraws
    const B = await mintInContext(browser);   // recipient — must be told, and must stay in control
    const subject = 'Withdraw loop ' + Date.now();
    const reason  = 'customer cancelled overnight';

    await test.step('A sends B an order', async () => {
      await composeChit(A.page, { subject, recipients: [B.name], item: 'Pallet wrap', qty: 4, price: 890 });
      await settle(A.page);
    });

    /* ⭐ READ B'S STATUS BEFORE ANYTHING IS WITHDRAWN. Comparing against a remembered value is the only way to
       prove it did not move; asserting "it is pending" afterwards would pass even if the code had set it. */
    let statusBefore = null;
    await test.step('B has the chit, and we note the status B is holding it at', async () => {
      await B.page.reload();
      await B.page.getByTestId('nav-task').click();
      await expect(B.page.getByText(subject).first()).toBeVisible({ timeout: 20000 });
      statusBefore = await B.page.evaluate((s) => {
        const row = (UI.rows || []).find((r) => (r.code || '') === s);
        return row ? row._status || row.state : null;
      }, subject);
      expect(statusBefore, 'B should be holding the chit at some status').toBeTruthy();
    });

    await test.step('A withdraws it from Order, giving a reason', async () => {
      await A.page.reload();
      await A.page.getByTestId('nav-order').click();
      await A.page.getByText(subject).first().click();

      /* ⚠️ THE BUTTON MUST BE HERE AND NOWHERE ELSE — the defect Athi found was it being offered in Task, where
         the API answers 403 by construction. */
      const wd = A.page.getByTestId('chit-void');
      await expect(wd, 'Withdraw is missing from the sent side').toBeVisible({ timeout: 15000 });
      await expect(wd).toContainText(/Withdraw/);

      await wd.click();
      await A.page.getByTestId('prompt-input').fill(reason);
      const done = A.page.waitForResponse(
        (r) => /\/void$/.test(r.url()) && r.request().method() === 'PUT', { timeout: 30000 }).catch(() => null);
      await A.page.getByTestId('prompt-ok').click();
      const res = await done;
      expect(res && res.status(), 'the withdraw call did not succeed').toBe(200);
      await settle(A.page);
    });

    await test.step('B is told — the flag, who asked, and why', async () => {
      await B.page.reload();
      await B.page.getByTestId('nav-task').click();
      await B.page.getByText(subject).first().click();

      const flag = B.page.getByTestId('chit-cancel-req');
      await expect(flag, 'B was never flagged — the cancel request only reached the Messages tab')
        .toBeVisible({ timeout: 20000 });
      await expect(flag).toContainText(/asked you to cancel/);
      /* ⚠️ THE REASON IS THE POINT, not decoration: it is what tells a supplier whether to stop the line or
         finish the batch. */
      await expect(flag).toContainText(reason);
    });

    await test.step("⭐ AND B'S OWN STATUS HAS NOT MOVED — the invariant", async () => {
      const statusAfter = await B.page.evaluate((s) => {
        const row = (UI.rows || []).find((r) => (r.code || '') === s);
        return row ? row._status || row.state : null;
      }, subject);
      expect(statusAfter,
        'B\'s status changed when A withdrew — a withdrawal must ASK, never decide for the counterparty')
        .toBe(statusBefore);
    });

    await test.step('and the external message is there too, as the record of the request', async () => {
      await B.page.getByTestId('msg-tab').click();
      await expect(B.page.getByText(/cancel requested/i).first()).toBeVisible({ timeout: 15000 });
    });

    await test.step('B answers — cancels their own copy from the banner', async () => {
      /* ⭐ THE ANSWER IS WHERE THE QUESTION IS. Not the status picker three steps away — the button on the
         banner that just told them. */
      const agree = B.page.getByTestId('cancel-agree');
      await expect(agree, 'the banner offers no way to answer it').toBeVisible({ timeout: 10000 });
      await agree.click();
      const done = B.page.waitForResponse(
        (r) => /\/status$/.test(r.url()) && r.request().method() === 'PUT', { timeout: 30000 }).catch(() => null);
      await B.page.getByTestId('confirm-ok').click();
      const res = await done;
      expect(res && res.status(), 'the cancellation did not reach the server').toBe(200);
      await settle(B.page);
    });

    await test.step("⭐⭐ AND A IS TOLD — the return leg (b197)", async () => {
      /**
       * ⚠️ THIS IS THE HALF THAT WAS INERT FOR A WHOLE DAY. The column existed, the API stamped it, and it
       * reached nobody because the SELECT never named it. Nothing failed; the sender simply went on seeing a
       * request with no reply. So this asserts what A can SEE, not what the server wrote.
       */
      await A.page.reload();
      await A.page.getByTestId('nav-order').click();
      await A.page.getByText(subject).first().click();

      const conf = A.page.getByTestId('chit-cancel-conf');
      await expect(conf, 'A was never told that B agreed — the return leg is not connected')
        .toBeVisible({ timeout: 20000 });
      await expect(conf).toContainText(/cancelled their copy/);
      /* ⚠️ A's copy has been terminal since they withdrew, so every "hide once settled" rule would have
         suppressed exactly this. That it is visible IS the assertion. */
      await expect(conf).toContainText(/agreed on both sides/);
    });

    await A.context.close();
    await B.context.close();
  });
});
