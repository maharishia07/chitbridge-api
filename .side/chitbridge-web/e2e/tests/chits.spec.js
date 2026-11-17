// MODULE: Chits — compose/send (create), open (read), advance status (update). Hard-delete is the bulk-select/trash flow.
// LOCATORS: nav-compose · chit-add-self · chit-field-* · chit-item-name/qty/price · chit-item-add · chit-send · nav-order ·
//           nav-task · chit-row-* · chit-status-btn · chit-unread · chit-void
const { test, expect } = require('@playwright/test');
const { mintEntity, clickNav, composeChit } = require('../fixtures');

/**
 * ⚠️ THE LOCAL composeSelfChit IS GONE — it was a COPY of the fixture, and it drifted the moment compose became a
 * four-step wizard: the shared one was updated, this one was not, and CHIT-01 then timed out waiting for
 * chit-add-self on a step that was no longer showing. Exactly the shape this codebase keeps paying for — the walk
 * was shared and a caller kept its own copy. One walk, in fixtures.js.
 */
/**
 * ⭐⭐ ONE WAY TO ASK "WHERE WAS THIS CHIT FILED" — used by CHIT-01 and CHIT-01b.
 *
 * ⚠️ SHARED FOR THE REASON THE NOTE ABOVE GIVES — a local copy is the recurring bug in this file. Writing this
 * inline in both tests would set the same trap for whoever next changes the response envelope.
 *
 * ⚠️ `api()` RETURNS THE ARRAY, NOT `{chits:[…]}` — it unwraps the envelope the raw route sends. Reading `.chits`
 * gets undefined and every case reports "not there", which looks exactly like the product suppressing copies it
 * is actually creating: a test that reads the wrong field fails in the shape of the bug it exists to catch.
 *
 * ⚠️ AND THE PAGE LIMIT IS THE ONE REMAINING ACCUMULATION RISK. The shared `authed` entity keeps filling, so
 * this asks for the newest 50 and relies on newest-first ordering. It is asking a LIST a targeted question,
 * which is still better than asking a SCREEN — but if these specs ever go flaky again in a long batch, this
 * limit is the first place to look, not the timeout.
 */
async function chitFiling(page, subject) {
  return page.evaluate(async (subj) => {
    /* the fan-out is not synchronous with the send */
    await new Promise((r) => setTimeout(r, 1200));
    const inList = async (ep) => ((await api(ep, { query: { page: 1, limit: 50 } })) || [])
      .some((c) => (c.manual_subject || '') === subj);
    return { inTask: await inList('inbox'), inOrder: await inList('sent') };
  }, subject);
}

test.describe('Module · Chits', () => {
  /**
   * ⚠️⚠️ THIS TEST USED TO ASSERT A SELF-CHIT APPEARS IN ORDER, AND IT WAS WRONG — not flaky, WRONG.
   *
   * It was red for days. The data was never missing: /api/chits/sent and /inbox both hold the chit. What the
   * spec did not know is that `self_copy_pref` DECIDES which copies a pure self-chit gets, and the unset default
   * is `received` — Task only. Order showing nothing was the governed behaviour working.
   *
   * routes/chits.js:292 says why, and the reasoning is the product's, not an implementation detail:
   *   *"The Order/Sent list is the record of obligations placed on SOMEONE ELSE, and a self-chit places none —
   *    filing it there asserts 'I sent this to a counterparty', which is false."*
   *
   * ⚠️ THE TEMPTING FIX WAS A LONGER TIMEOUT. It would have gone green by waiting for something that is never
   * coming, and buried a governance rule that nothing else tests.
   *
   * So the spec now DECLARES the setting it is testing instead of assuming a default, and covers all three —
   * each is a real, reachable behaviour and none of them had a test.
   */
  test('[CHIT-01] CREATE — compose + send a self-chit → it lands where the copy policy says', async ({ page }) => {
    await mintEntity(page);

    /* The UI wizard: composing and sending a self-chit must work end to end. Where it then LANDS is checked
       below, against the filing rather than against a rendered row. */
    const subject = 'E2E self ' + Date.now();
    await composeChit(page, { subject, qty: 3, price: 100, self: true });

    /**
     * ⚠️⚠️ THIS ASSERTED getByText(subject) ON THE TASK LIST AND FAILED ONLY IN A BATCH — 24 passed, CHIT-01
     * failed; re-run alone immediately after, 4 passed. The mechanism is established now: the `authed` project
     * shares ONE minted entity, so a long batch fills its lists. The chit was always created; by the time this
     * ran it was no longer on the first page of Task.
     *
     * ⚠️ THE TEMPTING FIX WAS A LONGER TIMEOUT, AGAIN. It would have waited for a row that a paging list is
     * never going to show, and the second tempting fix — scrolling or paging to find it — would make this spec
     * a test of pagination, which `chits` already covers elsewhere.
     *
     * ⭐ WHAT THIS TEST IS ACTUALLY FOR is the two things CHIT-01b does not do: drive the real four-step WIZARD,
     * and let the account's DEFAULT policy decide the filing rather than stating one. Neither needs a rendered
     * row. Which list paints which row depends on paging, sort and refresh; `inbox` and `sent` ARE the filing.
     */
    await clickNav(page, 'task');
    const filed = await chitFiling(page, subject);
    expect(filed.inTask,
      'a self-chit is Task work by default — it places no obligation on anyone else').toBe(true);
    /* ⭐ AND THE OTHER HALF OF THE DEFAULT, which the old assertion could not see at all: unset means
       `received`, so Order must NOT claim you sent this to a counterparty. */
    expect(filed.inOrder,
      'the unset default is `received` — Order must not claim you sent this to someone').toBe(false);
  });

  /**
   * ⭐ THE COPY POLICY ITSELF — three settings, three outcomes, nothing else covering them.
   *
   * Sent through `sendChit`, the real mint path every screen uses, so this tests the contract rather than a
   * fabricated request. Each case states its own `self_copy`; none relies on the account default.
   *
   * ⚠️ ASSERTED AGAINST THE API, NOT THE SCREEN. Which list renders a row depends on paging, sort and refresh —
   * none of which is what this rule is about. `sent` and `inbox` ARE the two copies; asking them directly is
   * asking the actual question.
   */
  test('[CHIT-01b] the self-copy policy decides which copies exist', async ({ page }) => {
    test.setTimeout(240000);   /* three sends at ~13 s each on the sfo↔Mumbai API (2026-09-06) — the 60 s default measured the region, not the code */
    await mintEntity(page);

    const send = (self_copy) => page.evaluate(async (sc) => {
      const subject = 'E2E copy ' + sc + ' ' + Date.now();
      await sendChit({
        recipients: [{ name: (SESSION.entity || ''), role: 'to', self: true }],
        subject, schema_values: { subject },
        line_items: [{ particulars: 'probe', unit: 'kg', quantity: 1, price: 1, total: 1 }],
        self_copy: sc
      });
      return subject;
    }, self_copy);

    await test.step('both — the chit is in Task AND Order', async () => {
      const r = await chitFiling(page, await send('both'));
      expect(r.inTask, 'both: the Task copy must exist').toBe(true);
      expect(r.inOrder, 'both: the Order copy must exist').toBe(true);
    });

    await test.step('received — Task only, the Order copy is suppressed', async () => {
      const r = await chitFiling(page, await send('received'));
      expect(r.inTask, 'received: Task keeps the work').toBe(true);
      /* ⭐ THE ASSERTION THE OLD SPEC HAD BACKWARDS. Order must NOT hold it — filing a self-chit there would
         assert "I sent this to a counterparty", which is untrue. */
      expect(r.inOrder, 'received: Order must NOT claim you sent this to someone').toBe(false);
    });

    await test.step('sent — Order only, the Task copy is suppressed', async () => {
      const r = await chitFiling(page, await send('sent'));
      expect(r.inOrder, 'sent: Order holds it').toBe(true);
      expect(r.inTask, 'sent: the Task copy is dropped').toBe(false);
    });
  });

  test('[CHIT-02] READ + UPDATE — open the received copy, advance status', async ({ page }) => {
    await mintEntity(page);
    const subject = 'E2E status ' + Date.now();
    await composeChit(page, { subject, qty: 3, price: 100, self: true });
    await test.step('READ — open the received copy in Task', async () => {
      await clickNav(page, 'task');
      await page.getByText(subject).first().click();   // subject appears as a title + a detail line
      await expect(page.locator('#mainbody')).toContainText(subject);
    });
    await test.step('UPDATE — advance status (picker opens)', async () => {
      await page.getByTestId('chit-status-btn').click();
      await expect(page.locator('#modalhost')).not.toBeEmpty();   // the status picker opened
    });
  });
});
