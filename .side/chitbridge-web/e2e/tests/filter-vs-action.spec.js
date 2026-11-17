// [FILTER] A FILTER NARROWS WHAT YOU SEE · AN ACTION CHANGES WHAT IS. They must never be confusable.
//
// ── ⚠️⚠️⚠️ THE FAULT THIS FILE STANDS AGAINST ────────────────────────────────────────────────────────────────
//
// Athi, 2026-09-13: *"when I update as resolved, it is not getting reflected?"* and *"the status is not changing
// when I close it — it has to change the status, and the closed one should leave the queue."*
//
// Driving it from outside settled it in one run: **the wire carried no PATCH at all**, only
// `GET /incidents?state=resolved`. He was pressing the FILTER. The chip row read
// `Open · Raised · Being looked at · Resolved · Closed · Everything`, the action on the row also said
// `Resolved`, and both were rendered from the SAME `base` style string forty pixels apart. Pressing the top one
// showed "nothing in this state" — which reads exactly like "I marked it and nothing happened".
//
// ⚠️⚠️ AND NO EARLIER SPEC COULD HAVE CAUGHT IT, because every one of them called the function
// (`testIncSet(id,'resolved')`) instead of pressing what a person presses. [[feedback-probe-through-the-gate]]
// So this file only ever clicks, and it asserts on the SERVER, not on the panel.
//
// Run: npx playwright test tests/filter-vs-action.spec.js --reporter=line
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

/**
 * ⭐ THE PRODUCT ASKS ITS OWN QUESTIONS NOW (CAT001-H08: *"the toaster message comes from the browser — it has
 * to be from the app"*), so a spec that stubs window.prompt would be testing a door that no longer exists.
 * This types into the real dialog and presses the real button. [[feedback-probe-through-the-gate]]
 */
async function answer(page, text) {
  const box = page.locator('#cbaskbox');
  await box.waitFor({ state: 'visible', timeout: 20000 });
  await box.fill(text);
  await page.locator('[data-testid="ask-ok"]').click();
  await page.locator('#cbaskbox').waitFor({ state: 'detached', timeout: 20000 });
}
async function board(page, name) {
  await mintEntity(page, { fresh: true, name: name + ' ' + Date.now().toString().slice(-6) });
  const token = await page.evaluate(() => SESSION.token);
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  await page.request.post(API + '/api/testing/incidents', {
    headers: H, data: { observed: 'The total is wrong on the counter', severity: 'Sev-2',
                        screen_code: 'CAT001' } });
  /* ⚠ the lab short-circuits to "no test cases on this board yet" and paints NO view when the board is empty —
     so an entity with incidents and no cases cannot reach its incidents at all. Seeded here; noted in BACKLOG. */
  await page.request.post(API + '/api/testing/cases/import', {
    headers: H, data: { mode: 'add', cases: [{ case_key: 'CAT001-H01', module_key: 'CAT001',
      title: 'the board is not empty', priority: 'Medium', test_type: 'screen', screen_code: 'CAT001',
      steps: [['do', 'see']] }] } });

  const sw = page.locator('[data-testid="vp-test"]');
  await expect(sw).toBeVisible({ timeout: 45000 });
  if (!((await sw.textContent()) || '').includes('on')) await sw.click();
  await page.locator('[data-testid="vp-lab"]').click();
  await expect(page.locator('#cbtestpanel')).toBeVisible({ timeout: 30000 });
  const modal = page.locator('#modalhost .modal');
  if (await modal.count()) await page.locator('#modalhost .modal button').last().click();
  return H;
}

const states = async (page, H) => {
  const r = await page.request.get(API + '/api/testing/incidents?state=all&_=' + Date.now(), { headers: H });
  return ((await r.json()).incidents || []).map((x) => x.state);
};

test('[FILTER-01] pressing the Resolved FILTER changes nothing on the server', async ({ page }) => {
  test.setTimeout(300000);
  const H = await board(page, 'Filt');
  await page.evaluate(() => testSetView('inc'));
  await expect(page.locator('[data-testid="incf-resolved"]')).toBeVisible({ timeout: 30000 });

  await page.locator('[data-testid="incf-resolved"]').click();
  await page.waitForTimeout(4000);
  /* ⭐ THIS IS THE WHOLE POINT: a filter is allowed to show nothing. It is NOT allowed to look like an action. */
  expect(await states(page, H), 'a filter wrote to the server').toEqual(['raised']);
  /* and it says which empty it is, rather than looking like a state that failed to change */
  await expect(page.locator('#cbtestbody')).toContainText('Nothing in this state');
});

test('[FILTER-02] pressing the ACTION does change it, and the row leaves the queue', async ({ page }) => {
  test.setTimeout(300000);
  const H = await board(page, 'Act');
  await page.evaluate(() => testSetView('inc'));

  /* ⚠️ the action is a VERB and it is on its own labelled line — "Resolved" as a bare word was the fault */
  const fix = page.locator('[data-testid="inc-act-resolved"]');
  await expect(fix).toBeVisible({ timeout: 30000 });
  await expect(fix).toHaveText('Mark it fixed');
  await fix.click();
  await answer(page, 'fixed in abc1234');
  await expect.poll(async () => (await states(page, H))[0], { timeout: 45000 }).toBe('resolved');

  /* ── and now the raiser's half: it holds, so it closes and leaves ── */
  /* ⚠️ IT HAS LEFT THE "OPEN" SHELF, which is right and is also why this view alone is not enough: you have to
     know to look under Resolved. The Worklist exists for exactly that — a Retest shelf you cannot miss. */
  await page.locator('[data-testid="incf-resolved"]').click();
  await page.waitForTimeout(2500);
  const close = page.locator('[data-testid="inc-act-closed"]');
  await expect(close).toBeVisible({ timeout: 30000 });
  await close.click();
  await answer(page, 'Retested and the total is right');
  await expect.poll(async () => (await states(page, H))[0], { timeout: 45000 }).toBe('closed');

  /* ⭐ "the closed one should leave the queue" — the open list is the queue, and it is now empty */
  await page.locator('[data-testid="incf-open"]').click();
  await page.waitForTimeout(3000);
  await expect(page.locator('#cbtestbody')).toContainText('Nothing in this state');
});

test('[FILTER-03] Close in the Findings view writes closed, not resolved', async ({ page }) => {
  test.setTimeout(300000);
  const H = await board(page, 'Find');
  await page.evaluate(() => { testSetView('hand'); testScrLoad(); });
  await expect.poll(async () => page.evaluate(() => (CBTEST.scrInc || []).length), { timeout: 30000 })
    .toBeGreaterThan(0);
  await page.evaluate(() => { try { localStorage.setItem('cb_hand_filter', 'open'); } catch (_) {} testPaint(); });

  /**
   * ⚠️⚠️ THE BUTTON SAID "Close" AND SENT `resolved`. On your OWN finding that is nonsense: it put the row on
   * the "waiting for your retest" shelf and asked you to verify a decision you had just taken.
   */
  const btn = page.locator('#cbtestbody button').filter({ hasText: 'Close it' }).first();
  await expect(btn).toBeVisible({ timeout: 30000 });
  await btn.click();
  await answer(page, 'I looked again, it is fine');
  await expect.poll(async () => (await states(page, H))[0], { timeout: 45000 }).toBe('closed');
});
