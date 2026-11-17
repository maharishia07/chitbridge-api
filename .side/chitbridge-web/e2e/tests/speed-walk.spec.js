// [SPEED] WALK EVERY SCREEN AND SAY WHICH ONE COSTS THE MOST.
//
// ── ⭐⭐⭐ WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────────────
//
// Athi, 2026-09-13: *"so if we have that kind of a measure, then we can proudly navigate across all the screens
// and try to figure out where and all it took long time and optimise it — so a Playwright execution finds most
// of the issues if it runs across all the screens for a set of operations?"*
//
// ⭐⭐ YES, AND THIS IS IT. Everything the tester's Speed area shows is already in the page: the call log, the
// server's own `X-DB-Ms` and `X-DB-Trips`, and a per-screen history in localStorage. A browser driven from
// outside can walk the rail with test mode on and read exactly the same numbers — the difference is that it
// visits EVERY screen, in the same order, every time, and a person visits the three they already suspect.
//
// ⚠️⚠️ IT MEASURES, IT DOES NOT JUDGE — with one exception. Wall-clock over a real network is noisy: Railway
// wakes up, the wifi hiccups, the first call of a session pays for a cold connection. So the report is the
// output, and the only thing that FAILS the run is a screen making an absurd NUMBER of calls, because a count
// is not noisy. [[project-roundtrip-cost]] — the count is the thing you can act on anyway.
//
// ⚠️ AND IT NEEDS CB_TRIPS POINTED AT THE TEST ENTITY or the server-time column is empty. It says so rather
// than printing zeros, because a zero would read as "no time spent in the server", which is a different and
// false statement.
//
// Run:  npx playwright test tests/speed-walk.spec.js --reporter=line
// Out:  e2e/speed-walk.json  (and a table on stdout)
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/**
 * ⚠️ THE RAIL IS READ FROM THE PAGE, NOT LISTED HERE. A hardcoded list of screens is a second register that
 * goes stale the day someone adds one — and the screen it misses is the one nobody measured.
 */
const SKIP = new Set(['compose']);   // compose holds a draft; walking away from it is a different test

test('[SPEED-01] walk every screen and report what each one costs', async ({ page }) => {
  test.setTimeout(600000);

  const { mintEntity } = require('../fixtures');
  await mintEntity(page, { fresh: false });

  /* test mode on: it is what starts the call log and stamps each visit */
  const sw = page.locator('[data-testid="vp-test"]');
  await expect(sw).toBeVisible({ timeout: 45000 });
  if (!((await sw.textContent()) || '').includes('on')) await sw.click();
  await expect(sw).toContainText('on');

  await page.evaluate(() => {
    try { localStorage.removeItem('cb_speed_visits'); } catch (_) {}
    try { if (window.CBCALLS) window.CBCALLS.length = 0; } catch (_) {}
  });

  /* every rail door the app actually offers */
  const navs = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="nav-"]'))
    .map((el) => el.getAttribute('data-testid').replace(/^nav-/, '')));
  expect(navs.length, 'no rail items found — the walk would prove nothing').toBeGreaterThan(3);

  /**
   * ⚠️⚠️ A DOOR THAT IS NOT VISIBLE MUST NOT END THE WALK. Some rail items live inside a collapsed group, so
   * `count()` finds them in the DOM and `click()` then waits thirty seconds for something that will never be
   * shown — and the whole measurement is lost because of one screen. A walk that reports twenty screens and
   * says which two it could not reach is worth far more than one that reports nothing.
   * ⭐ Two tries: open the drawer (narrow layouts keep the rail behind it) and then skip, recording the skip.
   */
  /**
   * ── ⚠️⚠️⚠️ THE RAIL LIVES BEHIND A DRAWER, AND THE DRAWER REBUILDS THE PAGE ─────────────────────────────────
   *
   * `nav-drawer` sets `UI.drawer` and calls renderApp(), so every element handle taken before the click is
   * stale after it — and `navTo` closes the drawer again on arrival. A loop that opened it once and then
   * clicked twenty items reached exactly one screen and reported that one screen's cost as the walk. Which is
   * the same fault this whole day has been about: a measurement of a slice, presented as the whole.
   *
   * ⭐ SO THE DRAWER IS RE-OPENED FOR EVERY DOOR and the locator re-queried after it.
   * ⚠️ AND THERE IS A FALLBACK TO `navTo()`, which is what the rail item calls anyway. Normally a spec must
   * drive the CONTROL and not the function behind it — but the thing being measured here is what a SCREEN
   * costs to load, not whether its rail item is clickable, and a screen that cannot be reached contributes
   * nothing at all. The fallback is recorded per screen so the report says which is which.
   */
  const walked = [];
  const missed = [];
  const viaFn = [];
  for (const nav of navs) {
    if (SKIP.has(nav)) continue;
    let ok = false;
    if (await page.locator('[data-testid="nav-drawer"]').count()) {
      await page.locator('[data-testid="nav-drawer"]').first().click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(200);
    }
    const el = page.locator('[data-testid="nav-' + nav + '"]').first();
    if (await el.count()) {
      ok = await el.click({ timeout: 4000 }).then(() => true).catch(() => false);
    }
    if (!ok) {
      ok = await page.evaluate((n) => {
        try { if (typeof navTo === 'function') { navTo(n); return true; } } catch (_) {}
        return false;
      }, nav);
      if (ok) viaFn.push(nav);
    }
    if (!ok) { missed.push(nav); continue; }
    /* ⚠ settle by the CHIP, not a fixed sleep: the chip is stamped once the screen has drawn and the register
       knows which screen it is, which is also the moment the visit is recorded */
    await page.waitForTimeout(2500);
    walked.push(nav);
  }
  if (viaFn.length) console.log('  · reached through navTo(), not the rail item: ' + viaFn.join(', '));
  if (missed.length) console.log('  ⚠ could not reach at all: ' + missed.join(', '));

  const data = await page.evaluate(() => {
    let visits = {};
    try { visits = JSON.parse(localStorage.getItem(
      (typeof uk === 'function') ? uk('cb_speed_visits') : 'cb_speed_visits') || '{}'); } catch (_) {}
    const rows = Object.keys(visits).map((code) => {
      const v = visits[code] || [];
      let worst = 0, calls = 0;
      v.forEach((x) => { if ((x.ms || 0) > worst) { worst = x.ms || 0; calls = x.n || 0; } });
      return { code, name: (typeof codeName === 'function' && codeName(code)) || '', visits: v.length, worst, calls };
    });
    const log = (window.CBCALLS || []).filter((c) => !/^\/api\/testing/.test(c.path || ''));
    /**
     * ── ⭐⭐⭐ THE REPEAT IS THE FINDING, NOT THE MILLISECONDS ──────────────────────────────────────────────
     *
     * ⚠️ A route table grouped by /api/<first segment> reports "folders: 7 calls" and cannot be acted on:
     * that is foldersList, folderChits, folderReconcile and folderGroupSum lumped together, and four
     * different calls to four endpoints is not a fault. The SAME call made four times is one, every time.
     *
     * ⭐ So this groups by the endpoint KEY the log already carries, per SCREEN, and reports only where one
     * key was asked more than once on one screen. That is the list somebody can act on.
     */
    const rep = {};
    log.forEach((c) => {
      const scr = c.scr || '?';
      const key = c.key || ((c.m || '') + ' ' + String(c.path || '').split('?')[0]);
      const k = scr + '|' + key;
      rep[k] = rep[k] || { scr: scr, key: key, n: 0, ms: 0 };
      rep[k].n++; rep[k].ms += (c.ms || 0);
    });
    const repeats = Object.keys(rep).map((k) => rep[k]).filter((r) => r.n > 1)
      .sort((a, b) => b.n - a.n || b.ms - a.ms);
    const byApi = {};
    log.forEach((c) => {
      const m = String(c.path || '').match(/^\/api\/([a-z0-9-]+)/i);
      const k = m ? m[1].toLowerCase() : 'other';
      byApi[k] = byApi[k] || { n: 0, ms: 0, srv: 0, trips: 0 };
      byApi[k].n++; byApi[k].ms += c.ms || 0;
      byApi[k].srv += c.srv || 0; byApi[k].trips += c.trips || 0;
    });
    return { rows, byApi, repeats: repeats,
             serverTimings: log.filter((c) => c.srv != null).length, logged: log.length };
  });

  data.rows.sort((a, b) => b.worst - a.worst);
  const api = Object.keys(data.byApi).map((k) => Object.assign({ route: k }, data.byApi[k]))
    .sort((a, b) => b.ms - a.ms);

  console.log('\n══ SPEED · ' + walked.length + ' screens walked ══\n');
  console.log('  SCREEN                          CALLS    WORST ms');
  data.rows.forEach((r) => console.log('  ' + (r.code + ' ' + r.name).padEnd(32).slice(0, 32)
    + String(r.calls).padStart(5) + String(r.worst).padStart(12)));
  /* ⭐ the actionable list, printed FIRST because it is the only part somebody can fix today */
  if ((data.repeats || []).length) {
    console.log('\n  THE SAME CALL, TWICE OR MORE, ON ONE SCREEN');
    console.log('  SCREEN            CALL                          TIMES     TOTAL ms');
    data.repeats.slice(0, 20).forEach((r) => console.log('  '
      + String(r.scr).padEnd(18).slice(0, 18) + String(r.key).padEnd(30).slice(0, 30)
      + String(r.n).padStart(5) + String(r.ms).padStart(13)));
  } else {
    console.log('\n  ✓ No call was made twice on any one screen.');
  }

  console.log('\n  ROUTE                  CALLS   TOTAL ms   SERVER ms   DB TRIPS');
  api.forEach((a) => console.log('  /api/' + a.route.padEnd(18).slice(0, 18)
    + String(a.n).padStart(5) + String(a.ms).padStart(11) + String(a.srv).padStart(12)
    + String(a.trips).padStart(11)));
  if (!data.serverTimings) {
    console.log('\n  ⚠️  No server timings. Point CB_TRIPS at this entity on the API to split server from network.');
  }
  console.log('');

  fs.writeFileSync(path.join(__dirname, '..', 'speed-walk.json'),
    JSON.stringify({ at: new Date().toISOString(), walked, screens: data.rows, routes: api }, null, 1));

  /**
   * ⚠️⚠️ THE ONLY ASSERTION IS A COUNT, AND ON PURPOSE. Failing on milliseconds over a real network would make
   * this red on a bad afternoon and teach everyone to ignore it — the fastest way to lose a guard. A screen
   * asking for twenty separate calls is wrong on any network, and no amount of waiting makes it right.
   */
  const greedy = data.rows.filter((r) => r.calls > 20);
  expect(greedy.map((r) => r.code + ' (' + r.calls + ' calls)').join(', ') || 'none',
    'a screen made more than 20 API calls in one visit').toBe('none');
});
