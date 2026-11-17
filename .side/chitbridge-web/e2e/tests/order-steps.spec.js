/**
 * step-flow.spec.js — the ORDER WIZARD, driven in a real browser.
 *
 * Athi, 2026-08-08: *"we do not want the left half, we are going to show just the product list and the cart,
 * nothing else, once all the selection is over, then we show the rest in order one by one."*
 * and: *"reduce number of clicks, otherwise no one will be interested."*
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────────────────────
 * scripts/step-flow.test.mjs proves the wizard's RULES headlessly — guards, the rail, the last step re-asking the
 * earlier ones. It cannot prove a screen wired them up. Every defect of 2026-08-09 was of exactly that kind: legal
 * JavaScript that no unit test could see, only a browser driving the real page.
 *
 * So this walks the flow the way a person does: pick a supplier, press +, check out, fill the details, review, and
 * confirm the primary button says what it will do. It stops SHORT of actually sending, deliberately — see below.
 *
 *      npx playwright test step-flow --project=authed
 */
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');

const API = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
const OTP = require('../fixtures').signinCode();   // SEC1: the tester code (E2E_TESTER_CODE) on a deployed api, the local code on a local one
require('../fixtures').needCode(test);   // no code → the file SKIPS with a CI warning naming the secret
// The same published shop variants.spec.js uses — a supplier that really has a catalogue to order from.
const SHOP = { email: 'beta@test-cb.com', name: 'Beta Fresh' };
/** ⚠️ BETA FRESH IS A SHARED SHOP AND OTHER SPECS TIDY UP AFTER THEMSELVES (variants.spec.js retires the lines it imported), so
 *  Beta can be EMPTY when this spec arrives — 2026-09-05: 'Beta Fresh has not published anything you can order yet', 15 s waiting
 *  for a + that could not exist. The precondition of this spec is one orderable line on Beta's shelf; the spec now makes it so,
 *  the way variants does: the dev OTP sign-in, then one product if the shelf is bare. */
async function ensureShopStocked() {
  const post = async (p, body) => { const r = await fetch(API + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return r.json().catch(() => ({})); };
  await post('/api/entities/register', { email: SHOP.email, display_name: SHOP.name });
  const v = await post('/api/entities/verify', { email: SHOP.email, otp: OTP }); const tok = v.token || (v.entity && v.entity.token);
  if (!tok) return;
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok };
  await fetch(API + '/api/entities/profile', { method: 'PATCH', headers: H, body: JSON.stringify({ catalogue_visibility: 'public' }) }).catch(() => {});
  const list = await (await fetch(API + '/api/products?limit=5', { headers: H })).json().catch(() => ({}));
  const items = list.items || list.products || list.rows || (Array.isArray(list) ? list : []);
  if (items.some((p) => p && p.item_data && p.item_data.status !== 'hidden')) return;
  await fetch(API + '/api/products', { method: 'POST', headers: H, body: JSON.stringify({ item_data: { name: 'Beta line ' + Date.now().toString().slice(-5), unit: 'piece', price: 120, status: 'available' } }) });
}

test.describe('Order step flow', () => {
  test('★★ SUPPLIERS — the catalogue IS the screen, and the flow walks Items → Details → Review', async ({ page }) => {
    await mintEntity(page);
    await ensureShopStocked();
    // addSupplier() confirms before it posts — via the app's own confirmAsk() modal since 2026-08-16, not a
    // native dialog, so it needs a real click rather than a page.on('dialog') handler.
    await page.getByTestId('nav-suppliers').click();
    await expect(page.getByTestId('sup-add-input')).toBeVisible();
    await page.getByTestId('sup-add-input').fill(SHOP.email);
    await page.getByTestId('sup-add').click();
    await page.getByTestId('confirm-ok').click();
    /* BETA'S row, by name — `.first()` was 'Our own stock' on a warm account (one-step rail, run 6 2026-09-06), the same trap variants.spec.js documents */
    const row = page.locator('[data-testid^="sup-row-"]').filter({ hasText: SHOP.name }).first();
    await expect(row).toBeVisible();
    await row.click();

    /**
     * ⭐ THE CLICK COUNT, WHICH IS THE POINT. Selecting a supplier means you intend to order from them, so their
     * catalogue is already on screen — no profile to read past, no "Compose order" modal to open first.
     */
    await expect(page.getByTestId('sup-catalogue'), 'the catalogue is not the default view').toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('sup-chip'), 'the supplier chip is missing').toBeVisible();

    // THREE steps — no "To". The recipient IS the supplier.
    const rail = page.locator('[data-testid^="steps-"]');
    await expect(rail).toBeVisible();
    await expect(rail.locator('.cbst')).toHaveCount(3);
    await expect(page.getByTestId('step-items')).toBeVisible();
    await expect(page.getByTestId('step-to'), 'Suppliers must NOT have a To step').toHaveCount(0);

    // ⚠️ A blocked step says WHY, in words — not just a dead button.
    const nextBtn = page.locator('[data-testid^="step-next-"]');
    await expect(nextBtn).toBeDisabled();
    await expect(page.locator('[data-testid^="step-why-"]')).toContainText('Add at least one item');

    // Press + on the first line.
    await page.getByTestId('cart-add').first().click();
    await expect(page.locator('[data-testid^="cart-count-"]').first()).toBeVisible();
    await expect(nextBtn, 'adding a line did not unblock the step').toBeEnabled();
    await expect(nextBtn).toContainText('Check out');

    await nextBtn.click();

    // ── DETAILS ──────────────────────────────────────────────────────────────────────────────────────────────
    await expect(page.getByTestId('sup-subject'), 'the Details step did not render').toBeVisible();
    // The subject is PROPOSED, not demanded — the schema requires one and nobody should be stopped by a blank box.
    await expect(page.getByTestId('sup-subject')).toHaveValue(/Order —/);
    await page.getByTestId('sup-addr').fill('16a Hill Side, 641001');
    await page.locator('[data-testid^="step-next-"]').click();

    // ── REVIEW ───────────────────────────────────────────────────────────────────────────────────────────────
    await expect(page.getByTestId('sup-total'), 'the Review step did not render').toBeVisible();
    const send = page.locator('[data-testid^="step-next-"]');
    await expect(send, 'the last step must name what it sends').toContainText('Send order to');
    await expect(send).toBeEnabled();
    // The escape hatch is present: three steps cannot express CC, attachments or an unlisted line.
    await expect(page.getByTestId('sup-open-compose')).toBeVisible();

    /**
     * ⚠️ IT DOES NOT PRESS SEND. This spec runs against PRODUCTION, and sending mints a real chit on a real
     * entity — a test that leaves live obligations behind every run is a test that makes the data untrustworthy.
     * What sending DOES is covered by the chit specs, which own their own cleanup. What this owns is the flow.
     */

    // ── GOING BACK IS FREE, and what was typed survives it ────────────────────────────────────────────────────
    await page.getByTestId('step-items').click();
    await expect(page.getByTestId('sup-catalogue')).toBeVisible();
    await expect(page.locator('[data-testid^="cart-count-"]').first(),
      'stepping back emptied the cart').toBeVisible();
    await page.getByTestId('step-details').click();
    await expect(page.getByTestId('sup-addr'), 'the details did not survive a walk back to Items')
      .toHaveValue('16a Hill Side, 641001');
  });

  test('★ SUPPLIERS — the rail cannot be used to skip a step that is not answered', async ({ page }) => {
    await mintEntity(page);
    await page.getByTestId('nav-suppliers').click();
    await page.getByTestId('sup-add-input').fill(SHOP.email);
    await page.getByTestId('sup-add').click();
    await page.getByTestId('confirm-ok').click();      // in-app confirm, not a browser dialog
    await page.locator('[data-testid^="sup-row-"]').first().click();
    await expect(page.getByTestId('sup-catalogue')).toBeVisible({ timeout: 15000 });

    /**
     * ⚠️ THE GUARD MUST NOT BE WALKABLE-AROUND. The chips are drawn for every step; with an empty cart, clicking
     * "Review" must do nothing at all. If the rail could jump the guard, the disabled footer button would be
     * decoration and an order with no lines could reach the send.
     */
    await page.getByTestId('step-review').click();
    await expect(page.getByTestId('sup-catalogue'), 'the rail jumped a guard — Review was reachable with an empty cart')
      .toBeVisible();
    await expect(page.locator('[data-testid^="step-next-"]')).toBeDisabled();
  });

  /**
   * ★★ COMPOSE — the only screen that keeps a "To" step, because the recipient is genuinely unknown.
   *
   * Compose was two dense columns with four tabs in the right-hand one. This walks what replaced it, and checks the
   * thing the restructure most easily breaks: values typed on one step must still be there when a LATER step sends.
   * submitCompose used to read cf_subject straight off the page — with Details no longer rendered on Review, that
   * would have sent an empty subject from the very screen that exists to confirm it.
   */
  test('★★ COMPOSE — four steps, To survives, and a value typed on step 3 is still there on step 4', async ({ page }) => {
    await mintEntity(page);
    await page.getByTestId('nav-compose').click();

    const rail = page.locator('[data-testid^="steps-"]');
    await expect(rail).toBeVisible();
    await expect(rail.locator('.cbst')).toHaveCount(4);
    await expect(page.getByTestId('step-to'), 'Compose MUST keep its To step').toBeVisible();

    // ── ITEMS ────────────────────────────────────────────────────────────────────────────────────────────────
    const next = page.locator('[data-testid^="step-next-"]');
    await expect(next).toBeDisabled();
    await expect(page.locator('[data-testid^="step-why-"]')).toContainText('Add at least one line item');
    await page.getByTestId('chit-item-name').fill('Widget');
    await page.getByTestId('chit-item-add').click();
    await expect(next, 'adding a line did not unblock Items').toBeEnabled();
    await next.click();

    // ── TO ───────────────────────────────────────────────────────────────────────────────────────────────────
    await expect(page.getByTestId('chit-add-self')).toBeVisible();
    await expect(page.locator('[data-testid^="step-next-"]')).toBeDisabled();
    await expect(page.locator('[data-testid^="step-why-"]')).toContainText('To recipient');
    await page.getByTestId('chit-add-self').click();
    await page.locator('[data-testid^="step-next-"]').click();

    // ── DETAILS ──────────────────────────────────────────────────────────────────────────────────────────────
    const SUBJ = 'Step flow ' + Date.now();
    await expect(page.getByTestId('chit-field-subject')).toBeVisible();
    await expect(page.locator('[data-testid^="step-next-"]')).toBeDisabled();
    await page.getByTestId('chit-field-subject').fill(SUBJ);
    await expect(page.locator('[data-testid^="step-next-"]'), 'a subject did not unblock Details').toBeEnabled();
    await page.locator('[data-testid^="step-next-"]').click();

    // ── REVIEW ───────────────────────────────────────────────────────────────────────────────────────────────
    // ⚠️ THE ASSERTION THAT MATTERS. The subject was typed on a step that is no longer on screen; if it lived only
    // in the DOM it is gone by now, and the send would go out blank.
    await expect(page.getByTestId('cc-review-total'), 'the Review step did not render').toBeVisible();
    await expect(page.locator('#cc_body'), 'the subject typed on Details did not survive to Review').toContainText(SUBJ);
    await expect(page.locator('#cc_body'), 'the line did not survive to Review').toContainText('Widget');
    await expect(page.getByTestId('chit-send'), 'the send button kept its published test id').toBeEnabled();

    // Walk back and confirm the field renders FROM state, not from a stale input.
    await page.getByTestId('step-details').click();
    await expect(page.getByTestId('chit-field-subject')).toHaveValue(SUBJ);

    // ⚠️ Does NOT send — this runs against production and a spec that mints real chits every run makes the data
    // untrustworthy. chits/keyboard/messages own the send, with their own cleanup.
    await page.locator('#modalhost .mx').first().click().catch(() => {});
  });

  /**
   * ★★ OUR OWN SHELF COMPLETES ITS CYCLE.
   *
   * Athi, observation-3: *"When I call our own stock, the entire cycle not completing. It has to create a self
   * chit, but hangs."*
   *
   * ⚠️⚠️ NOTHING HUNG. The guard read `cart.lines().length` — and `lines()` returns a COUNT, so `.length` on it
   * is `undefined`, falsy whatever the cart holds. The primary button could not enable by construction: the row
   * showed a quantity, the bar said "🛒 1 ₹100", and the footer went on saying "Add at least one item." A dead
   * end with no error looks exactly like a hang, which is why this asserts the BUTTON rather than the cart —
   * every cart-level assertion passed while the feature was unusable.
   *
   * ⭐ The same mistake had already been made in the worklist and DOCUMENTED in app/pick.js rather than guarded.
   * e2e/cart-api.cjs now fails the build on the shape; this proves the screen.
   */
  test('★★ OUR OWN STOCK — a line unblocks the send, and it opens a self-chit', async ({ page }) => {
    /**
     * ⚠️⚠️ IT SEEDS THROUGH THE API, NOT THE UI, and that is the whole reason this test is stable.
     *
     * This is about taking a line FROM your own catalogue, so the shelf cannot be empty — and it always is:
     * auth.setup mints a fresh entity into .auth/user.json on every run, so 'the saved session' is a new
     * business each time. Seeding through addProduct() instead put the product there but left the catalogue
     * ARRIVING while the test clicked, and the + was destroyed under the cursor for the full retry window
     * ('element was detached from the DOM'). One POST and one reload has neither problem.
     *
     * ⭐ Measured on a warm account (e2e/ownstock-repaint.cjs): ZERO mutations in 12s. The churn is the arrival,
     * not a loop — so arriving BEFORE the screen opens removes it entirely.
     */
    await page.goto('/app.html');
    await page.waitForTimeout(3000);
    const seeded = await page.evaluate(async (a) => {
      let tok = '';
      try { tok = (JSON.parse(localStorage.getItem('cb_sess') || '{}') || {}).token || ''; } catch (_) {}
      if (!tok) return 'no session';
      const r = await fetch(a.api + '/api/products', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
        body: JSON.stringify({ item_data: { name: a.name, unit: 'piece', price: 100, status: 'available' } }) });
      return r.status;
    }, { api: API, name: 'Shelf line ' + Date.now().toString().slice(-5) });
    expect(seeded, 'could not seed a product to take from the shelf').toBeLessThan(300);
    await page.reload();
    await page.waitForTimeout(3000);
    await page.getByTestId('nav-suppliers').click();
    const own = page.getByTestId('sup-row-own');
    await expect(own, 'our own shelf is not offered as a source').toBeVisible();
    await own.click();

    const next = page.locator('#sup_foot [data-testid^="step-next-"]');
    await expect(next, 'the own-stock step footer did not render').toBeVisible({ timeout: 20000 });
    await expect(next, 'an empty cart must still block, and say why').toBeDisabled();

    /* ⚠️ LET THE LIST SETTLE FIRST. A freshly seeded shelf lands in bursts — ensureCatalogue resolves, the pane
       repaints, and a click aimed mid-burst fails with 'element was detached from the DOM' for as long as
       Playwright will retry. Measured on a warm account (e2e/ownstock-repaint.cjs): ZERO mutations in 12s, so
       this is the arrival, not a loop — waiting for two identical reads is enough, and asserts that it IS. */
    await expect.poll(async () => page.locator('#sup_body [data-testid="cart-add"]').count(),
      { timeout: 20000, message: 'the shelf never showed a product to add' }).toBeGreaterThan(0);
    let prev = -1;
    await expect.poll(async () => {
      const n = await page.locator('#sup_body *').count();
      const same = n === prev; prev = n; return same;
    }, { timeout: 20000, intervals: [400, 400, 400], message: 'the shelf never stopped repainting' }).toBe(true);

    await page.getByTestId('cart-add').first().click();
    await expect(page.locator('[data-testid^="cart-count-"]').first()).toBeVisible();

    /* ⭐ THE ASSERTION THE BUG WOULD HAVE FAILED. */
    await expect(next, 'adding a line did not unblock the terminal action — the guard read a count as an array')
      .toBeEnabled({ timeout: 10000 });
    await expect(next).toContainText(/Use these lines/);

    await next.click();
    /* Taking from your own shelf has one possible addressee, so Compose opens with To already answered. */
    await expect(page.locator('.mhd .t'), 'the lines did not reach Compose').toContainText(/Compose/, { timeout: 15000 });
    await expect(page.locator('#cc_rail')).toContainText('Items');
    await page.locator('#modalhost .mx').first().click().catch(() => {});
  });

  /**
   * ★ AN AMOUNT CARRIES ITS CURRENCY.
   *
   * Athi: *"the cycle completes, the amount does not carry a currency symbol."* The review printed
   * `String(total.amount)` — a bare number on the one page whose job is to show what is about to be committed
   * to, and the Network review had copied it verbatim. The cart knows the shop's currency, so the cart is asked
   * now (`cart.money()`), rather than a third formatter being written beside the other two.
   *
   * ⚠️ It asserts "not bare digits" rather than a particular symbol: the entity under test may be in any
   * currency, and pinning ₹ would make this a test of the fixture rather than of the formatting.
   */
  test('★ the amounts on screen are money, not numbers', async ({ page }) => {
    /* Seeded through the API for the same reason as the test above — see the note there. */
    await page.goto('/app.html');
    await page.waitForTimeout(3000);
    await page.evaluate(async (a) => {
      let tok = '';
      try { tok = (JSON.parse(localStorage.getItem('cb_sess') || '{}') || {}).token || ''; } catch (_) {}
      if (!tok) return;
      await fetch(a.api + '/api/products', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
        body: JSON.stringify({ item_data: { name: a.name, unit: 'piece', price: 250, status: 'available' } }) });
    }, { api: API, name: 'Priced line ' + Date.now().toString().slice(-5) });
    await page.reload();
    await page.waitForTimeout(3000);
    await page.getByTestId('nav-suppliers').click();
    await page.getByTestId('sup-row-own').click();
    await expect(page.locator('#sup_body')).toBeVisible({ timeout: 20000 });
    await expect.poll(async () => page.locator('#sup_body [data-testid="cart-add"]').count(),
      { timeout: 20000 }).toBeGreaterThan(0);
    let p2 = -1;
    await expect.poll(async () => { const n = await page.locator('#sup_body *').count(); const same = n === p2; p2 = n; return same; },
      { timeout: 20000, intervals: [400, 400, 400] }).toBe(true);
    /* the + INSIDE the supplier pane (not the first + on the page), and when the count does not follow, say which cart the row
       spoke to and which one the screen holds — this step flaked in runs 1, 2 and 5 of 2026-09-05/06 with no such sentence */
    await page.locator('#sup_body [data-testid="cart-add"]').first().click();
    await expect.poll(async () => (await page.locator('[data-testid^="cart-count-"]').count()) > 0 ? '' : await page.evaluate(() => {
      const b = document.querySelector('#sup_body [data-testid="cart-add"]'); const on = b ? (b.getAttribute('onclick') || '') : '(no +)';
      /* ⚠️ `UI` is a script-scoped `let` — never on window, so window.UI was ALWAYS undefined and this always said
         "(no handle)"; and /cbcart-d+/ had lost its backslash, so it never matched a namespace (guard-static, 2026-09-27) */
      const held = (typeof UI !== 'undefined' && UI && UI._supCart && UI._supCart.ns) || '(no handle)'; const rowNs = (on.match(/cbcart-\d+/) || ['?'])[0];
      const live = window.CBCart && CBCart.state ? !!CBCart.state(rowNs) : null;
      return 'row → ' + rowNs + ' · screen holds ' + held + ' · row cart alive: ' + live + ' · bar: ' + ((document.getElementById('cbcartbar_sup') || {}).innerText || '').trim();
    }), { timeout: 8000, message: 'the count never appeared' }).toBe('');

    const bar = (await page.locator('#cbcartbar_sup').innerText()).replace(/\s+/g, ' ');
    expect(bar, 'the cart bar showed a bare number').toMatch(/[^\d\s.,]\s?[\d]/);
  });
});
