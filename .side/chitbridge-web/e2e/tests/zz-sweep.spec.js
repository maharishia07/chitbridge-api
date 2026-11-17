// ONE-OFF SWEEP — signs in as the real board and clears what is not a finding, then hands back what is.
//
// ⚠️⚠️ TWO DIFFERENT ACTS, AND THEY MUST NOT BE CONFUSED:
//   · a PROBE ("filing it now, to prove the loop") is not a finding at all → closed, with the reason.
//   · something I FIXED → `resolved`, which is the fixer's claim, NOT closed. Closing it myself would be me
//     marking my own homework; it lands on Athi's "Yours to retest" shelf, which is the whole point of the loop.
//
// Run: npx playwright test tests/zz-sweep.spec.js --reporter=line
const { test, expect } = require('@playwright/test');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';
const APP = process.env.CB_APP_BASE || 'https://chitbridge-web.vercel.app';
const OTP = require('../fixtures').signinCode();   // SEC1: the tester code (E2E_TESTER_CODE) on a deployed api, the local code on a local one
require('../fixtures').needCode(test);   // no code → the file SKIPS with a CI warning naming the secret
const WHO = 'tallytest';

/* not findings — written to prove the tool worked */
const PROBES = {
  'INC-260913-1OSC': 'A probe of the raise flow, not a finding. Closed in the sweep of 2026-09-13.',
  'INC-260912-EATQ': 'A probe of the incident form, not a finding. Closed in the sweep of 2026-09-13.',
  'INC-260912-Q2OW': 'A probe of the incident record, not a finding. Closed in the sweep of 2026-09-13.',
};
const REQ_PROBES = {
  'REQ-260913-5IUH': 'A probe of the raise flow, not a requirement. Closed in the sweep of 2026-09-13.',
  'REQ-260912-G1DL': 'A probe of the requirement form, not a requirement. Closed in the sweep of 2026-09-13.',
};
/* fixed — handed BACK for retest, never closed by the person who fixed them */
const FIXED = {
  'INC-260912-0XJN': 'Fixed in ab539b8 (chitbridge-web). The count was right and the list was wrong: lazyWrap '
    + 'reset its window to 50 rows on every repaint, and the catalogue repaints on a 20s timer and on every '
    + 'late loader — so "Show 50 more" was undone seconds later. The window is now kept. Please retest.',
  'INC-260913-N2QI': 'Fixed. Two faults in one path: unwrap() dropped `truncated`, so the server search never '
    + 'fired; and prodSearchServer read page.items on an already-collapsed array, throwing away all 96 matches '
    + 'for "cycle". Both corrected. Please search for cycle again and confirm.',
  'INC-260912-J89Q': 'Fixed. The five separate defList calls are now batched into one (cbDefsFlush/cbDefsLive), '
    + 'in-flight GETs are de-duplicated, and /me went from three calls to one. Please reopen the Catalogue and '
    + 'check the Speed tab again.',
};

/* ⚠️⚠️ THE SAVED SESSION IS SOMEBODY ELSE. The `authed` project starts every spec signed in as the pooled test
   entity, so the first run of this swept an empty board and reported "not on the board" for all eight —
   truthfully, about the wrong shop. Signing in as a REAL account means starting from nothing. */
test.use({ storageState: { cookies: [], origins: [] } });

test('[SWEEP] clear the probes, hand back what is fixed', async ({ page }) => {
  test.setTimeout(600000);
  /* the ordinary sign-in screen (#/login), with the dev OTP this environment already runs on */
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

  const token = await page.evaluate(() => SESSION.token);
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  const inc = await (await page.request.get(API + '/api/testing/incidents?state=all&_=' + Date.now(),
    { headers: H })).json();
  const req = await (await page.request.get(API + '/api/testing/requirements?state=all&_=' + Date.now(),
    { headers: H })).json();
  const byRef = {}; (inc.incidents || []).forEach((x) => { byRef[x.ref] = x; });
  const byClause = {}; (req.requirements || []).forEach((x) => { byClause[x.clause] = x; });

  const done = [];
  for (const ref of Object.keys(PROBES)) {
    const x = byRef[ref];
    if (!x) { done.push(ref + ' — not on the board'); continue; }
    if (x.state === 'closed') { done.push(ref + ' — already closed'); continue; }
    const r = await page.request.patch(API + '/api/testing/incidents/' + x.definition_id,
      { headers: H, data: { state: 'closed', why: PROBES[ref] } });
    done.push(ref + ' → closed ' + r.status());
  }
  for (const cl of Object.keys(REQ_PROBES)) {
    const x = byClause[cl];
    if (!x) { done.push(cl + ' — not on the board'); continue; }
    if (x.state === 'rejected' || x.state === 'accepted') { done.push(cl + ' — already decided'); continue; }
    const r = await page.request.patch(API + '/api/testing/requirements/' + x.definition_id,
      { headers: H, data: { state: 'rejected', why: REQ_PROBES[cl] } });
    done.push(cl + ' → rejected ' + r.status());
  }
  for (const ref of Object.keys(FIXED)) {
    const x = byRef[ref];
    if (!x) { done.push(ref + ' — not on the board'); continue; }
    if (x.state === 'resolved' || x.state === 'closed') { done.push(ref + ' — already ' + x.state); continue; }
    const r = await page.request.patch(API + '/api/testing/incidents/' + x.definition_id,
      { headers: H, data: { state: 'resolved', why: FIXED[ref] } });
    done.push(ref + ' → resolved (yours to retest) ' + r.status());
  }

  console.log('\n### SWEEP');
  done.forEach((d) => console.log('  ' + d));

  const after = await (await page.request.get(API + '/api/testing/incidents?state=all&_=' + Date.now(),
    { headers: H })).json();
  console.log('  incident counts now:', JSON.stringify(after.counts));
  const stillOpen = (after.incidents || []).filter((x) => x.state === 'raised' || x.state === 'investigating');
  console.log('  STILL OPEN (real, not swept):');
  stillOpen.forEach((x) => console.log('    ' + x.ref + ' ' + x.severity + ' ' + (x.screen_code || '—') + ' · '
    + String(x.observed || '').slice(0, 90).replace(/\s+/g, ' ')));
});
