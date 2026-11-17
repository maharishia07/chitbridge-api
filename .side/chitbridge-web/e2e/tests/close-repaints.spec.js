// [SHUT] CLOSING SOMETHING MUST CHANGE THE SCREEN YOU CLOSED IT ON.
//
// ── ⚠️⚠️⚠️ THE FAULT THIS FILE STANDS AGAINST ────────────────────────────────────────────────────────────────
//
// Athi, 2026-09-13: *"when I close a case in the Cases tab, the closed one should leave the queue or change the
// status — it is still the same."*
//
// AND THE WRITE HAD WORKED EVERY TIME. The case was retired on the server, both lists were dropped and re-read,
// and then `testPaint()` redrew `#cbtestbody` — the LAB. The Cases tab is in `#cbcasespanel`, the panel that
// opens on a screen, and nothing redrew it. The row sat there unchanged, and the only honest conclusion a
// person can draw is that the button does nothing.
//
// ⚠️⚠️ THREE REPORTS TODAY WERE THIS ONE FAULT IN DIFFERENT CLOTHES — the Findings row after a verdict, the
// Incidents list after a resolve, and this. Fixed twice by hand before anyone noticed the shape. Now every
// loader calls `testRepaint()`, which redraws whichever frame is open, because it is not a loader's business to
// know where the person is standing. [[feedback-no-duplicate-functions]]
//
// ⚠️ AND THIS SPEC PRESSES THE BUTTON IN THE POPUP. Calling testHandClose() directly would pass on the broken
// code — the data was always right. [[feedback-probe-through-the-gate]]
//
// Run: npx playwright test tests/close-repaints.spec.js --reporter=line
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

test('[SHUT-01] a case closed in the Cases tab leaves the tab', async ({ page }) => {
  test.setTimeout(420000);
  await mintEntity(page, { fresh: true, name: 'Shut ' + Date.now().toString().slice(-6) });
  const token = await page.evaluate(() => SESSION.token);
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  const sw = page.locator('[data-testid="vp-test"]');
  await expect(sw).toBeVisible({ timeout: 45000 });
  if (!((await sw.textContent()) || '').includes('on')) await sw.click();
  await page.locator('[data-testid="screen-cases"]').first().click();
  await expect(page.locator('#cbcasespanel')).toBeVisible({ timeout: 30000 });
  const modal = page.locator('#modalhost .modal');
  if (await modal.count()) await page.locator('#modalhost .modal button').last().click();

  /* ⚠ the popup opens on the screen the tester is STANDING on, whichever that is — so the cases are seeded
     against that code rather than a guessed one, which is what a person writing here would produce anyway */
  const code = await page.evaluate(() => CBTEST.popupFor);
  expect(code, 'the popup did not say which screen it is about').toBeTruthy();

  /* two, so "the list emptied" cannot pass for "the row left" */
  for (const n of ['01', '02']) {
    const r = await page.request.post(API + '/api/testing/cases/import', {
      headers: H, data: { mode: 'add', cases: [{ case_key: code + '-H' + n, module_key: code,
        title: 'hand written ' + n, priority: 'Medium', test_type: 'screen', screen_code: code,
        steps: [['do it', 'it works']] }] } });
    expect(r.ok(), 'could not seed a case').toBeTruthy();
  }
  await page.evaluate(() => testLoad(true));
  await page.evaluate(() => testArea('cases'));
  await expect(page.locator('#cbcasespanel')).toContainText('hand written 01', { timeout: 30000 });
  await expect(page.locator('#cbcasespanel')).toContainText('hand written 02');

  /* the real control, in the popup */
  await page.locator('#cbcasespanel button').filter({ hasText: /^✓ Close$/ }).first().click();
  const box = page.locator('#cbaskbox');
  await box.waitFor({ state: 'visible', timeout: 20000 });
  await box.fill('Not needed — covered by the documented case');
  await page.locator('[data-testid="ask-ok"]').click();

  /* ⭐ THE ASSERTION THAT MATTERS: the tab a person is looking at changes, without them touching anything */
  await expect(page.locator('#cbcasespanel'), 'the closed case did not leave the tab')
    .not.toContainText('hand written 01', { timeout: 30000 });
  await expect(page.locator('#cbcasespanel'), 'and it took the other one with it')
    .toContainText('hand written 02');

  /**
   * ⚠️ closed, not deleted: it is reachable from the same tab, on demand, with its reason.
   * ⚠️ WAITED FOR, NOT CLICKED BLIND. The chip only appears once `?all=1` has come back, and that is a second
   * round trip after the close — this flaked once on a slow Railway wake. A click with no wait in front of it
   * is a race that passes on a fast day.
   */
  const shutChip = page.locator('#cbcasespanel button').filter({ hasText: /show 1 closed/ });
  await shutChip.waitFor({ state: 'visible', timeout: 45000 });
  await shutChip.click();
  await expect(page.locator('#cbcasespanel')).toContainText('hand written 01');
  await expect(page.locator('#cbcasespanel')).toContainText('Not needed');

  /* and the server agrees, which is the half a repaint cannot fake */
  const all = await (await page.request.get(API + '/api/testing/cases?all=1&_=' + Date.now(),
    { headers: H })).json();
  const shut = (all.cases || []).filter((c) => c.case_key === code + '-H01')[0];
  expect(shut, 'the case vanished from the board entirely').toBeTruthy();
  expect(shut.status, 'it left the tab without being retired — the repaint was a lie').toBe('retired');
});
