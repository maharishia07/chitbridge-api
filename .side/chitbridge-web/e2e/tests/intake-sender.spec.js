'use strict';
/* intake-sender.spec.js — ── A CAPTURED JOB MUST KNOW WHO ASKED ────────────────────────────────────────────────────────────────────────
 *
 * Athi, 2026-08-24, after testing design 2 on WhatsApp jobs: *"data was not moving from customer to supplier."*
 *
 * ⚠️⚠️ IT NEVER HAD BEEN, AND THE REASON WAS ONE EMPTY BOX. Those jobs were recorded through Intake with the
 * "from" field blank, so `sender_ref` was null → `summary_json.via.from` was null → every screen that asks *who
 * asked for this* had nobody to name. The chit read as the workshop writing to itself, the party line warned
 * there was no other party, and the whole Them side looked hollow — for want of a phone number nobody was made
 * to type.
 *
 * ⭐ A real webhook always carries the sender; the provider supplies it. So this only ever bit the hand-driven
 * path — which is exactly the path the product is tested and judged on.
 */
const { test, expect } = require('@playwright/test');
const { mintEntity, clickNav, settle } = require('../fixtures');

const stamp = () => Date.now().toString().slice(-6);

test.describe('Intake · a captured message names its sender', () => {
  test('[INT-10] a message cannot be recorded without saying who it is from', async ({ page }) => {
    test.setTimeout(6 * 60 * 1000);
    const s = stamp();
    const from = '+9198765' + s;

    await mintEntity(page);
    await settle(page);
    await clickNav(page, 'intake');
    await page.getByTestId('intake-simulate-open').click();
    await expect(page.getByTestId('intake-sim-from'), 'the Record a message form did not open')
      .toBeVisible({ timeout: 20000 });

    await test.step('REFUSED — text but no sender', async () => {
      await page.getByTestId('intake-sim-text').fill('brake noise from the front ' + s);
      /* ⚠️ Watch the WRITE, not the screen: the proof that it was refused is that nothing was posted. */
      let posted = false;
      const listen = (r) => { if (/\/capture\/simulate/.test(r.url())) posted = true; };
      page.on('request', listen);
      await page.getByTestId('intake-sim-add').click();
      await page.waitForTimeout(2500);
      page.off('request', listen);
      expect(posted, 'a message with no sender was recorded — the job it becomes can never name a customer')
        .toBe(false);
    });

    await test.step('ACCEPTED — and the sender is carried', async () => {
      /* ⚠️ FILL BOTH AGAIN. The queue repaints the form, so nothing typed in an earlier step can be assumed to
         survive into this one — and an empty text box makes this click a no-op that looks like a refusal. */
      await page.getByTestId('intake-sim-from').fill(from);
      await page.getByTestId('intake-sim-text').fill('brake noise from the front ' + s);
      const wrote = page.waitForResponse((r) => /\/capture\/simulate/.test(r.url())
        && r.request().method() === 'POST' && r.status() < 400, { timeout: 30000 });
      await page.getByTestId('intake-sim-add').click();
      const res = await wrote;
      const body = await res.json().catch(() => ({}));
      /**
       * ⭐ ASSERTED ON THE RECORD, not the screen. `sender_ref` is what becomes `via.from` on the chit, and it
       * is the single field the whole "who asked for this" chain hangs off — every screen downstream is only
       * as good as this one value.
       */
      expect(body.sender_ref || (body.capture && body.capture.sender_ref),
        'the capture was stored without the sender that was typed').toBe(from);
    });

    await test.step('AND THE QUEUE SHOWS THEM', async () => {
      await settle(page);
      await expect(page.getByText(from).first(),
        'the intake queue does not show who the message came from').toBeVisible({ timeout: 20000 });
    });
  });
});
