// [COVER] COVERAGE IS A TO-DO LIST, NOT A STATISTIC.
//
// ── ⚠️⚠️ THE FAULT THIS FILE STANDS AGAINST ─────────────────────────────────────────────────────────────────
//
// Athi, twice: *"I still don't understand coverage."* The tab answered a question he had not asked — how many
// AUTOMATED TESTS NAME THE CODE behind the screen, in file paths. A developer's question, useless to somebody
// standing on the screen.
//
// ⭐ The register already names every control on every screen (426, each with a CTL code) and every case can
// cite the one it is about. So the answer is: which controls here have a case, and which do not — and the ones
// that do not are a LIST with a button on each.
//
// ⚠️⚠️ AND THE DANGEROUS CASE IS THE EMPTY ONE. A screen the register knows no controls for would count "0 of 0
// checked" and read as PERFECT COVERAGE. That is the sentence this tab must never print, so it is asserted.
//
// Run: npx playwright test tests/coverage.spec.js --reporter=line
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

async function openCoverage(page) {
  const sw = page.locator('[data-testid="vp-test"]');
  await expect(sw).toBeVisible({ timeout: 45000 });
  if (!((await sw.textContent()) || '').includes('on')) await sw.click();
  await page.locator('[data-testid="screen-cases"]').first().click();
  await expect(page.locator('#cbcasespanel')).toBeVisible({ timeout: 30000 });
  const modal = page.locator('#modalhost .modal');
  if (await modal.count()) await page.locator('#modalhost .modal button').last().click();
  await page.evaluate(() => testArea('behind'));
  return page.evaluate(() => CBTEST.popupFor);
}

test('[COVER-01] it lists the controls nobody has written a case for', async ({ page }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true, name: 'Cover ' + Date.now().toString().slice(-6) });
  const code = await openCoverage(page);
  const panel = page.locator('#cbcasespanel');

  const known = await page.evaluate((c) => testScrControls(c).length, code);
  await expect(panel).toContainText('What on this screen has been checked?');

  if (!known) {
    /**
     * ⚠️⚠️ THE ONE SENTENCE THIS TAB MUST NEVER PRINT. With no controls in the register, counting them gives
     * "0 of 0 checked" — perfect coverage, about a screen nobody has looked at.
     */
    await expect(panel).toContainText('The register does not name any control on this screen');
    await expect(panel, 'an unknown screen must never read as fully covered')
      .not.toContainText('Well covered');
    return;
  }

  /* nothing written yet, so every control is on the to-do list */
  await expect(panel).toContainText('Nothing here is checked');
  await expect(panel).toContainText('Never checked');
  /* ⚠ the figure and its word are separate elements — innerText joins them with no space */
  await expect(panel).toContainText('controls here');
  await expect(panel).toContainText(String(known) + 'never checked');
  const buttons = panel.locator('button', { hasText: 'Write a case' });
  expect(await buttons.count(), 'every unchecked control needs its own button').toBe(known);

  /* ── ⭐ and the button is the point: it opens Create with that control already chosen ── */
  const first = await page.evaluate((c) => testScrControls(c)[0], code);
  await buttons.first().click();
  await expect(page.locator('#wcTitle')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#wcCtl')).toHaveValue(first.code);
  await expect(page.locator('#wcDo')).toHaveValue(new RegExp(first.label.slice(0, 12)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('[COVER-02] a control with a case moves off the list', async ({ page }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true, name: 'Cover2 ' + Date.now().toString().slice(-6) });
  const token = await page.evaluate(() => SESSION.token);
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const code = await openCoverage(page);
  const known = await page.evaluate((c) => testScrControls(c), code);
  test.skip(!known.length, 'the register names no control on the screen this opened on');

  const ctl = known[0];
  const r = await page.request.post(API + '/api/testing/cases/import', {
    headers: H,
    data: { mode: 'add', cases: [{ case_key: code + '-H01', module_key: code, screen_code: code,
      control_code: ctl.code, title: 'the control does what it says', priority: 'Medium',
      test_type: 'screen', steps: [['press it', 'it does the thing']] }] } });
  expect(r.ok(), 'could not write the case').toBeTruthy();

  await page.evaluate(() => testLoad(true));
  await page.evaluate(() => testArea('behind'));
  const panel = page.locator('#cbcasespanel');
  await expect(panel).toContainText('1', { timeout: 15000 });

  const left = await page.evaluate((c) => {
    const by = testCtlCases(c);
    return testScrControls(c).filter((x) => !(by[x.code] || []).length).length;
  }, code);
  expect(left, 'writing one case must take one control off the list').toBe(known.length - 1);
  /* ⭐ and the good news is folded away — it does not need the room the to-do list needs */
  await expect(panel).toContainText('1 already checked');
});
