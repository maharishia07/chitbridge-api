/**
 * CARD  22-channels-capture-and-messaging/intake-screen
 * intake.spec.js — THE CAPTURE CONNECTOR, end to end in a browser.
 *
 * channel → CAPTURE (raw, untrusted) → AI STRUCTURE → HUMAN CONFIRM → chit on the rail.
 *
 * The backend for this has been live for a while (routes/capture.js, lib/capture.js, migration b104 — the `capture`
 * table, per-entity, WITH RLS). What was missing was a way to reach it from inside the app. This drives the new
 * Intake screen against the REAL API: it records a message, has the real AI structure it, and confirms that the
 * proposed lines reach Compose — where a human still has to press Send.
 *
 * ⚠️ IT NEVER SENDS. Running against production, a spec that mints real chits on every run makes the data
 * untrustworthy. The confirm gate is asserted by showing Compose OPEN with the lines in it, which is exactly the
 * boundary that matters: a message is a notice, a chit is an obligation, and nothing crosses that line by itself.
 *
 *      npx playwright test intake --project=authed
 */
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');

test.describe('Capture connector · Intake', () => {
  test('★★ a WhatsApp message becomes a draft chit — captured, structured, confirmed by a human', async ({ page }) => {
    await mintEntity(page);
    page.on('dialog', (d) => d.accept());

    await page.getByTestId('nav-intake').click();
    // The capability is lazy (ensureCap('intake') → /app/cap-intake.js), so the screen arrives a moment later.
    await expect(page.getByTestId('intake-simulate-open')).toBeVisible({ timeout: 15000 });

    /**
     * ⚠️ THE QUEUE IS NOT ASSUMED EMPTY. mintEntity short-circuits when the authed project's saved session is
     * present, so every run of this file lands in the SAME entity and sees whatever earlier runs left behind.
     * A spec that asserted "0 rows" passed once and then failed forever for a reason that was nothing to do
     * with the code. So: work relative to what is there, and clean up after yourself at the end.
     */
    const before = await page.getByTestId('intake-row').count();

    // ── RECORD an inbound message. This is the SAME createCapture the WhatsApp webhook calls; the webhooks exist
    //    but have no provider or entity mapping yet, so this is the honest way in today.
    await page.getByTestId('intake-simulate-open').click();
    await page.getByTestId('intake-sim-channel').selectOption('whatsapp');
    await page.getByTestId('intake-sim-from').fill('+919876543210');
    await page.getByTestId('intake-sim-text').fill('need 2 boxes of bolts and 5 m cable by friday');
    await page.getByTestId('intake-sim-add').click();

    await expect(page.getByTestId('intake-row'), 'the message never reached the queue')
      .toHaveCount(before + 1, { timeout: 15000 });
    const row = page.getByTestId('intake-row').first();     // newest first — the queue is created_at DESC
    await expect(row).toContainText('bolts');
    await expect(row).toContainText('WhatsApp');

    // ── STRUCTURE it with the real co-assist. It PROPOSES; it does not decide.
    await page.getByTestId('intake-structure').first().click();
    await expect(page.getByTestId('intake-make-chit').first(),
      'the AI draft never came back').toBeVisible({ timeout: 45000 });
    await expect(row, 'the draft must say it is a proposal, not evidence').toContainText('AI draft');

    /**
     * ── CONFIRM. This opens Compose with the lines already in it — and stops there.
     *
     * ⚠️ Compose is a four-step wizard, so it opens on ITEMS; `chit-send` lives on Review and is deliberately
     * several deliberate actions away. That distance IS the confirm gate: a message becomes an obligation only
     * because a person walked it.
     */
    await page.getByTestId('intake-make-chit').first().click();
    await expect(page.getByTestId('chit-item-name'), 'Compose did not open for the human confirm').toBeVisible({ timeout: 20000 });
    await expect(page.locator('#cc_items'), 'the captured lines did not reach the chit').toContainText(/bolts/i);
    await expect(page.locator('#cc_items'), 'only one of the two captured lines arrived').toContainText(/cable/i);

    /**
     * ⚠️ ARRIVING IS NOT THE SAME AS BEING SEEN, and this spec used to stop one assertion short of the difference.
     *
     * Athi, 2026-08-09: *"it just opened the compose screen, the data is not going to the chit."* Everything above
     * passed at the time. CC.items held both lines, the subject was filled, the capture was linked — and the top of
     * the screen was an empty cart reading "Press + on what this chit is for", with the lines six catalogue rows
     * below the fold. A defect found by eye that a green suite had no opinion about is a gap in the suite, so the
     * two things a person actually needs are asserted here: WAS I TOLD, and CAN I SEE IT WITHOUT HUNTING.
     */
    const origin = page.getByTestId('cc-origin');
    await expect(origin, 'compose never said the lines came from a message').toBeVisible();
    await expect(origin, 'the banner must name the channel it came from').toContainText(/WhatsApp/i);
    await expect(origin, 'an AI proposal must never present itself as evidence').toContainText(/not evidence/i);
    // ⚠️ NO PRICE IS NOT ZERO PRICE — an item the catalogue does not stock renders ₹0.00, identical to a real free
    //    line. The count is said out loud; sending an obligation for goods at nothing is never silent.
    await expect(origin, 'unpriced ad-hoc lines were not called out').toContainText(/no price/i);

    // The lines must come BEFORE the catalogue picker: the question has changed from "what are you sending" to
    // "is this right", and whichever is on top is the question the screen is really asking.
    const order = await page.evaluate(() => {
      const items = document.getElementById('cc_items'), pick = document.getElementById('cc_catpick');
      if (!items || !pick) return 'missing';
      // DOCUMENT_POSITION_FOLLOWING === 4 → the picker comes after the lines
      return (items.compareDocumentPosition(pick) & 4) ? 'lines-first' : 'picker-first';
    });
    expect(order, 'the chit lines are below the picker — they read as "nothing arrived"').toBe('lines-first');

    // Walk to Details and confirm the capture's SUBJECT survived the handoff. It is carried in state, not in an
    // input — the Details step is not even rendered at the moment intakeMakeChit sets it.
    await page.locator('[data-testid^="step-next-"]').click();
    await page.getByTestId('chit-add-self').click();
    await page.locator('[data-testid^="step-next-"]').click();
    await expect(page.getByTestId('chit-field-subject'),
      'the capture\'s subject did not survive into the chit').not.toHaveValue('');

    // ⚠️ NOT SENT. The gate is that a person still has to finish this.
    await page.locator('#modalhost .mx').first().click().catch(() => {});

    // Put the queue back as it was found.
    await page.getByTestId('nav-intake').click();
    await expect(page.getByTestId('intake-dismiss').first()).toBeVisible({ timeout: 15000 });
    await page.getByTestId('intake-dismiss').first().click();
    await page.getByTestId('confirm-ok').click();     // in-app confirm since the native-dialog sweep
    await expect(page.getByTestId('intake-row')).toHaveCount(before, { timeout: 15000 });
  });

  test('★ a message can be dismissed — and that is recorded, not forgotten', async ({ page }) => {
    await mintEntity(page);
    page.on('dialog', (d) => d.accept());
    await page.getByTestId('nav-intake').click();
    await expect(page.getByTestId('intake-simulate-open')).toBeVisible({ timeout: 15000 });
    const before = await page.getByTestId('intake-row').count();

    const TEXT = 'wrong number, ignore this ' + Date.now();
    await page.getByTestId('intake-simulate-open').click();
    await page.getByTestId('intake-sim-text').fill(TEXT);
    await page.getByTestId('intake-sim-add').click();
    await expect(page.getByTestId('intake-row')).toHaveCount(before + 1, { timeout: 15000 });
    await expect(page.locator('#intake_body')).toContainText(TEXT);

    await page.getByTestId('intake-dismiss').first().click();
    /* ⚠️ IN-APP CONFIRM NOW (2026-08-16 native-dialog sweep) — the `page.on('dialog')` above no longer fires for
       this one. It stays for the simulate step; THIS click is what actually dismisses. Without it the assertion
       below would fail with the message still on screen, looking like a broken dismiss rather than a spec that
       never pressed the button. */
    await page.getByTestId('confirm-ok').click();
    /**
     * It leaves the PENDING queue — and the row is NOT deleted. The capture stays in the table marked dismissed,
     * as a receipt that the message arrived and was deliberately not turned into a chit. "We never got it" and
     * "we saw it and said no" are different answers, and only one of them is true.
     */
    await expect(page.locator('#intake_body'), 'dismiss did not clear it from the queue').not.toContainText(TEXT, { timeout: 15000 });
    await expect(page.getByTestId('intake-row')).toHaveCount(before, { timeout: 15000 });
  });
});
