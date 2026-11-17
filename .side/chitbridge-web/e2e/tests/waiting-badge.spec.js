// [WAIT] AN OFFLINE RAISER IS TOLD — the count is on the chip before anything is opened.
//
// ── ⚠️ THE GAP THIS CLOSES ──────────────────────────────────────────────────────────────────────────────────
//
// The retest loop's SSE event only reaches a session that is OPEN. Fix something overnight and the person who
// reported it is told nothing; they find out when they next happen to open the lab. That is the right floor
// and it is not a notification.
//
// ⭐ The count rides on the Test lab chip, which is on screen the moment the app loads.
// ⚠️ And ONLY while test mode is on — a shopkeeper billing a customer must not pay a round trip for a tester's
// number. That condition is asserted, because it is the one that could quietly cost everybody something.
//
// Run: npx playwright test tests/waiting-badge.spec.js --reporter=line
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

test('[WAIT-01] the chip carries the count, and only when testing', async ({ page }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true, name: 'Wait ' + Date.now().toString().slice(-6) });
  const token = await page.evaluate(() => SESSION.token);
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  /* raise two, resolve one — so the badge must say 1 and not 2 */
  const ids = [];
  for (const n of [1, 2]) {
    const r = await page.request.post(API + '/api/testing/incidents', {
      headers: H, data: { observed: 'something is wrong ' + n, severity: 'Sev-3', screen_code: 'CAT001' } });
    ids.push((await r.json()).definition_id);
  }
  const fix = await page.request.patch(API + '/api/testing/incidents/' + ids[0], {
    headers: H, data: { state: 'resolved', why: 'fixed it' } });
  expect(fix.ok()).toBeTruthy();

  /* ⚠️ TEST MODE OFF: no badge, and no call. This is the assertion that protects everybody else. */
  const badge = page.locator('#cbwaitbadge');
  await expect(badge).toBeHidden();

  const sw = page.locator('[data-testid="vp-test"]');
  await expect(sw).toBeVisible({ timeout: 45000 });
  if (!((await sw.textContent()) || '').includes('on')) await sw.click();
  await expect(sw).toContainText('on');

  /* ⭐ on, and the chip says it — without the lab being opened at all */
  await expect(badge).toBeVisible({ timeout: 45000 });
  await expect(badge, 'one is resolved and awaiting retest, the other is still raised').toHaveText('1');
  await expect(page.locator('[data-testid="vp-lab"]'))
    .toHaveAttribute('title', /waiting for you to retest/);

  /* ── and it goes when the raiser has looked ── */
  await page.request.patch(API + '/api/testing/incidents/' + ids[0], {
    headers: H, data: { state: 'closed', why: 'retested, it holds' } });
  await page.evaluate(() => testWaitingLoad());
  await expect(badge, 'closing it must take it off the chip').toBeHidden({ timeout: 30000 });
});
