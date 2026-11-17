// iam.spec.js — the IAM screen, driven in a real browser.
//
// IAM-SPEC.md §10 (three sections), §12 (trading status resolves the storefront sentence), §26.3 (two tabs).
//
// ⚠️ THE VALUE HERE IS THE SENTENCE, NOT THE LAYOUT. Every other check in this repo can prove a section exists.
// Only a browser can prove that setting "closed" changes what the screen SAYS about who can see your catalogue
// — and that sentence was wrong in the product for as long as `closed` only blocked orders while leaving the
// catalogue public. A person read a true-sounding note and drew a false conclusion about their own privacy.
//
// ⚠️ IT SIGNS IN AS A FRESH ENTITY. Athi, 2026-08: a shared account ACCUMULATES, so any assertion about counts
// or lists is sound alone and unsound in a batch. This asserts only about the entity it just created.
//
//   npx playwright test iam --project=noauth

const { test, expect } = require('@playwright/test');

const API = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
const OTP = require('../fixtures').signinCode();   // SEC1: the tester code (E2E_TESTER_CODE) on a deployed api, the local code on a local one
require('../fixtures').needCode(test);   // no code → the file SKIPS with a CI warning naming the secret

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null; try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}

async function freshEntity() {
  const stamp = Date.now() + '' + Math.floor(Math.random() * 1e5);
  const email = 'iam-' + stamp + '@test-cb.com';
  /**
   * ⚠️⚠️ THIS SPEC COULD NEVER PASS, AND THE PRODUCT WAS RIGHT TO REFUSE IT. `'iamtest' + stamp` is 7 + 13
   * (Date.now) + up to 5 (random) = 25 characters, against MAX_ROOT = 20 in lib/handle.js. Every run got:
   *
   *   USER_ID_INVALID · A User ID is at most 20 characters, and "iamtest1789324188198268" is 25
   *
   * ⭐ THE CAP IS DELIBERATE AND IS NOT THE BUG: staff sign in as `name@youruserid` and suppliers are
   * numbered under it, so it has to stay typeable. Shortening the FIXTURE is the fix; raising the cap to
   * make a test pass would be changing the product to fit the test. [[project-user-id-rule]]
   *
   * ⚠️ Base36 keeps it unique and short — Date.now() is ~8 chars in base36, not 13. 3 + 8 + 3 = 14 < 20.
   * `stamp` stays long for the email and the display name, where length costs nothing.
   */
  const user_id = 'iam' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const reg = await api('/api/entities/register', {
    method: 'POST', body: { email, display_name: 'IAM Test ' + stamp, user_id },
  });
  expect(reg.status, 'register: ' + JSON.stringify(reg.json)).toBe(200);
  const v = await api('/api/entities/verify', { method: 'POST', body: { email, otp: reg.json.dev_otp || OTP } });
  expect(v.status, 'verify: ' + JSON.stringify(v.json)).toBe(200);
  return { token: v.json.token, entity: v.json.entity, user_id };
}

async function openIam(page, sess) {
  await page.goto('/app.html');
  await page.evaluate((s) => {
    /**
     * ⚠️⚠️ POINT THE APP AT THE API THE TOKEN CAME FROM. A fresh browser context has no `cb_api_base`, so the
     * app falls back to its own stage default — and the token this test minted against CB_API is valid nowhere
     * the app looks. GET /me then fails, UI._me stays null, the profile body renders nothing, and the failure
     * surfaces as "iam-sec-ident not found": a rendering symptom for an authentication cause.
     *
     * This is the same shape as the hash-change problem above. Both times the test reported the LAST thing that
     * did not appear rather than the first thing that went wrong.
     */
    localStorage.setItem('cb_api_base', s.api);
    localStorage.setItem('cb_sess', JSON.stringify({
      token: s.token, role: 'entity', name: s.entity.display_name,
      entity: s.entity.display_name, bridgeId: s.entity.bridge_id, shop: 'open',
    }));
  }, { ...sess, api: API });
  /**
   * ⚠️⚠️ A HASH CHANGE IS NOT A RELOAD. `goto('/app.html')` then `goto('/app.html#/app')` is the SAME document
   * — Playwright changes the fragment and the app never re-boots, so it never reads the session I just wrote,
   * never signs in, and never lazy-loads cap-admin. The symptom was `profSetSec` timing out as undefined,
   * which reads like a missing function and is actually a page that was still sitting on the login screen.
   */
  await page.reload();
  await page.goto('/app.html#/app');

  /**
   * ⚠️ WAIT FOR THE APP TO EXIST BEFORE DRIVING IT. My first version called navTo() straight after goto and all
   * three tests failed with "element not found" — which reads exactly like a missing feature and was in fact a
   * race: cap-admin.js is loaded lazily by ensureCap(), so for the first few hundred milliseconds navTo is not
   * defined and the evaluate throws into the void.
   *
   * A test that fails for a timing reason but reports a rendering one costs more than no test at all: it sends
   * you to read the renderer.
   */
  await page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 20000 });
  await page.evaluate(() => navTo('profile'));
  await page.waitForFunction(() => typeof profSetSec === 'function', null, { timeout: 20000 });
  await page.evaluate(() => { profSetSec('identity'); });
  await expect(page.getByTestId('iam-sec-ident')).toBeVisible({ timeout: 20000 });
}

test.describe('IAM', () => {
  test('no tab bar, sections, and Identity opens by default', async ({ page }) => {
    const sess = await freshEntity();
    await openIam(page, sess);

    /**
     * ⚠️⚠️ THIS ASSERTED A TAB BAR THAT WAS REMOVED ON 2026-08-19, and the two halves failed differently —
     * which is why nobody noticed.
     *
     *   iam-tab-me / iam-tab-emp   toBeVisible()   → TIMEOUT, reported as the IAM screen being slow
     *   iam-tab-node / iam-tab-cust toHaveCount(0) → PASSED, VACUOUSLY
     *
     * ⚠️ THE VACUOUS HALF IS THE WORSE ONE. Those two lines were written to prove Network and Customer had been
     * removed — and they now pass because EVERYTHING has count 0. They would go on passing if the whole profile
     * failed to render. A green assertion that cannot fail is not coverage; it is a claim with nothing behind it.
     *
     * ⭐ THE SCREEN IS SECTIONS NOW, not tabs — iamSection('ident'|'profile'|'regional'|…). So the honest
     * version of "there are two tabs" is "there is no tab bar", asserted once, plus the sections below which
     * were already here and are what actually carries the structure.
     *
     * ⚠️ Found by e2e/locators.cjs, which reads every literal getByTestId in every spec and checks the app has
     * ever heard of the name — no browser, no API, no OTP. This spec had been walking a screen that no longer
     * existed and reporting it as a timeout.
     */
    await expect(page.locator('[data-testid^="iam-tab-"]'),
      'the tab bar was replaced by sections in §26.3 — no tab should render at all').toHaveCount(0);

    // §10 — three sections, and only the first is open.
    await expect(page.getByTestId('iam-sec-ident')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('iam-sec-profile')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('iam-sec-governed')).toHaveAttribute('aria-expanded', 'false');

    // the User ID is present and is NOT an input — it is chosen once, at registration.
    await expect(page.locator('#pf_name')).toBeVisible();
    await expect(page.locator('#pf_uid')).toHaveCount(0);
    await expect(page.getByText(sess.user_id, { exact: false }).first()).toBeVisible();
  });

  test('a section opens on click and stays open across a re-render', async ({ page }) => {
    const sess = await freshEntity();
    await openIam(page, sess);

    await page.getByTestId('iam-sec-profile').click();
    await expect(page.getByTestId('iam-sec-profile')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#pf_gstn')).toBeVisible();

    // ⚠️ the toggle writes to UI and re-renders; a naive implementation loses the state on the next paint
    await page.evaluate(() => { renderApp(); try { _capShowDetail(); loadProfile(); } catch (_) {} });
    await expect(page.getByTestId('iam-sec-profile')).toHaveAttribute('aria-expanded', 'true');
  });

  test('§12 — closing the shop changes what the screen SAYS about visibility', async ({ page }) => {
    const sess = await freshEntity();
    await openIam(page, sess);
    await page.getByTestId('iam-sec-governed').click();

    await expect(page.locator('body')).toContainText(/accepting orders|no public storefront/i);

    /**
     * ⚠️ SAVE IT, DO NOT JUST SELECT IT. My first version changed the dropdown and re-rendered, then asserted
     * the sentence had changed — and it had not, correctly: the sentence reads the SAVED status from UI._me,
     * not the value sitting unsaved in a <select>. The test was asserting a behaviour nobody asked for (a live
     * preview of an unsaved change) and reporting its absence as a bug in the feature.
     *
     * Going through the API is also the truer test: it proves what a reader sees after the change LANDS.
     */
    await api('/api/entities/profile', {
      method: 'PATCH', token: sess.token,
      body: { business_status: 'closed', catalogue_visibility: 'public' },
    });
    await page.reload();
    await page.waitForFunction(() => typeof profSetSec === 'function', null, { timeout: 20000 });
    await page.evaluate(() => { navTo('profile'); profSetSec('identity'); });
    await expect(page.getByTestId('iam-sec-governed')).toBeVisible({ timeout: 20000 });
    await page.getByTestId('iam-sec-governed').click();

    // ⚠️ THE ASSERTION THAT MATTERS: the sentence must say the catalogue is HIDDEN. For as long as `closed`
    // only blocked orders, a shopkeeper read a reassuring note and stayed fully public.
    await expect(page.locator('body')).toContainText(/hidden from everyone/i, { timeout: 15000 });
  });
});
