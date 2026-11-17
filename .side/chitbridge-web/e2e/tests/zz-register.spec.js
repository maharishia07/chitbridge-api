// ONE-OFF — writes this run's measured findings into the real register, and retires what is not useful.
//
// ⚠️ EVERY ROW HERE IS A MEASURED NUMBER, not an opinion. The speed walk drove all 20 screens twice, before and
// after each fix, and the figures below are what it printed. A performance case with no number on it is an
// argument, and it gets settled by whoever talks longest.
//
// Run: npx playwright test tests/zz-register.spec.js --reporter=line
const { test, expect } = require('@playwright/test');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';
const APP = process.env.CB_APP_BASE || 'https://chitbridge-web.vercel.app';
const OTP = require('../fixtures').signinCode();   // SEC1: the tester code (E2E_TESTER_CODE) on a deployed api, the local code on a local one
require('../fixtures').needCode(test);   // no code → the file SKIPS with a CI warning naming the secret
const WHO = 'tallytest';

/* what the walk measured, fixed, and re-measured */
const CASES = [
  { key: 'INS001-H01', screen: 'INS001', title: 'Opening MIS must not fetch the same endpoint twice',
    doIt: 'Open MIS with test mode on and read Speed › the same call, twice or more.',
    see: 'No endpoint appears more than once.',
    got: 'WAS: inbox, sent, disputeQueue, actors, supList, misMsgs and misMetrics each twice — 7 wasted '
      + 'round trips, about 6 s. NOW: none. renderApp calls loadMIS on every paint and paints twice on '
      + 'arrival; fixed with an in-flight latch AND a 10 s freshness guard.', pass: true },
  { key: 'RAL002-H10', screen: 'RAL002', title: 'Opening Task must not fetch the rollup twice',
    doIt: 'Open Task with test mode on and read Speed › the same call, twice or more.',
    see: 'rollup is asked for once.',
    got: 'rollup twice, 766 ms. loadList fetches it with the list and refreshRollup fetches it alone. A 4 s '
      + 'freshness guard is in; still measuring twice on the last walk, so the two queries may differ by '
      + 'scope — not yet closed.', pass: false },
  { key: 'CAT001-H10', screen: 'CAT001', title: 'Opening the Catalogue must not fetch prodList twice',
    doIt: 'Open Catalogue with test mode on and read Speed › the same call, twice or more.',
    see: 'prodList is asked for once.',
    got: 'prodList twice, 718 ms. Latch plus 4 s freshness guard applied; still measuring twice on the last '
      + 'walk — not yet closed.', pass: false },
  { key: 'INS002-H01', screen: 'INS004', title: 'Trade ready must not ask readiness once per section',
    doIt: 'Open Trade ready with test mode on and read Speed.',
    see: 'One readiness call, or one per destination and no more.',
    got: 'readinessOwn twice, 1,131 ms — cap-readiness.js line 348 loops the sections and asks once each. '
      + 'Legitimate per-section queries, but a batched endpoint would halve the screen.', pass: false },
];

async function signIn(page) {
  await page.goto(APP + '/app.html#/login');
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (_) {} });
  await page.goto(APP + '/app.html#/login');
  await page.locator('#l_id').waitFor({ state: 'visible', timeout: 45000 });
  await page.locator('#l_id').fill(WHO);
  await page.locator('#l_go').click();
  await page.locator('#l_otp').waitFor({ state: 'visible', timeout: 45000 });
  await page.locator('#l_otp').fill(OTP);
  await page.locator('#l_go').click();
  await expect.poll(async () => page.evaluate(() => (typeof SESSION !== 'undefined' && SESSION.token) ? 1 : 0),
    { timeout: 60000 }).toBe(1);
  return page.evaluate(() => SESSION.token);
}

test.use({ storageState: { cookies: [], origins: [] } });

test('[REG] record what was measured, and retire what is not useful', async ({ page }) => {
  test.setTimeout(600000);
  const token = await signIn(page);
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const done = [];

  for (const c of CASES) {
    const w = await page.request.post(API + '/api/testing/cases/import', {
      headers: H,
      data: { mode: 'add', cases: [{ case_key: c.key, module_key: c.screen, screen_code: c.screen,
        module_name: c.screen, title: c.title, priority: 'Medium', test_type: 'screen',
        steps: [[c.doIt, c.see]], observed: c.got,
        note: 'Measured by e2e/tests/speed-walk.spec.js on 2026-09-13.' }] } });
    done.push(c.key + ' written ' + w.status());
    const r = await page.request.post(API + '/api/testing/results', {
      headers: H,
      data: { results: [{ case_key: c.key, status: c.pass ? 'pass' : 'fail', run_kind: 'manual',
        layer: 'web', note: c.got.slice(0, 400) }] } });
    done.push('  result ' + (c.pass ? 'pass' : 'fail') + ' ' + r.status());
  }

  /**
   * ⚠️ RETIRING A CASE IS NOT TIDYING. Each of these was written to prove the tool worked, and each one
   * inflates the board's denominator for ever after — "1,459 cases" reads as coverage. A case that can never
   * fail tells nobody anything, and the reason goes on the record so the next person does not re-add it.
   */
  const all = await (await page.request.get(API + '/api/testing/cases?all=1&_=' + Date.now(),
    { headers: H })).json();
  const junk = (all.cases || []).filter((c) => {
    if (c.status === 'retired') return false;
    if (!/-H\d+$/.test(String(c.case_key || ''))) return false;
    const t = String(c.title || '').toLowerCase();
    return /^(line1|probe|testing this screen|test)/.test(t) || t.length < 12;
  });
  for (const c of junk) {
    const r = await page.request.post(API + '/api/testing/cases/close', {
      headers: H,
      data: { case_key: c.case_key, open: false,
        why: 'Retired in the sweep of 2026-09-13: written to prove the tool worked, not to check the '
          + 'product. It can never fail, so it only inflates the coverage denominator.' } });
    done.push('retired ' + c.case_key + ' (' + String(c.title || '').slice(0, 30) + ') ' + r.status());
  }

  console.log('\n### REGISTER');
  done.forEach((d) => console.log('  ' + d));
  const after = await (await page.request.get(API + '/api/testing/cases?all=1&_=' + Date.now(),
    { headers: H })).json();
  const hand = (after.cases || []).filter((c) => /-H\d+$/.test(String(c.case_key || '')));
  console.log('  hand-written cases now: ' + hand.length
    + ' (' + hand.filter((c) => c.status === 'retired').length + ' retired)');
});
