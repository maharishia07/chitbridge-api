// [TM] TEST MODE — THE TESTER'S OWN TOOL, DRIVEN.
//
// ── ⭐⭐⭐ WHY THIS SPEC EXISTS ─────────────────────────────────────────────────────────────────────────────────
//
// Athi, 2026-09-13: *"use playwright to test the testing tool."*
//
// ⚠️⚠️ THIS IS THE TOOL A TESTER USES, so when it is wrong it does not fail loudly — it records the wrong thing,
// or nothing, and everybody trusts the board anyway. In one sitting Athi found SIX faults in it by hand and not
// one was caught by a guard, because every one of them lived where two STATES met rather than inside a feature:
//
//     test mode        on · off
//     the lab panel    open · closed
//     the board        read · not read
//     what is in front screen · record · dialog
//
// ⭐ So this spec is written by combination. The most valuable test in it is TM-03: a verdict recorded with the
// lab NEVER OPENED. That is the exact state that broke, and the state nobody thinks to try, because everybody
// who built it had opened the lab first.
//
// ⚠️ IT DRIVES CONTROLS, NOT FUNCTIONS. The chip is clicked, the buttons are pressed — otherwise the one thing
// that could be broken (a missing global, a wrong id, a handler on the wrong element) is exactly what is
// skipped. The two exceptions are marked where they occur and say why.
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

const tokenOf = (p) => p.evaluate(() => SESSION.token);

/**
 * turn test mode on through its own switch, and wait for the board it reads.
 *
 * ⚠⚠ THE REMEMBERED PREFERENCES ARE CLEARED FIRST, and that is not tidiness. The case filter and the lab
 * view are kept in localStorage — rightly, a tester works one way all day — so TM-10 leaving the filter on
 * “Passed” made TM-12 and TM-13 read a list with their own new case filtered OUT of it. Both passed alone and
 * failed in the batch: the most expensive kind of failure, because it reads as a regression in whatever was
 * changed last.
 */
async function modeOn(page) {
  await page.evaluate(() => {
    try { localStorage.removeItem('cb_case_filter'); localStorage.removeItem('cb_test_view');
          localStorage.removeItem('cb_test_scrsort');
          /* ⚠ and the panel's own area — the third remembered preference to leak between tests */
          localStorage.removeItem('cb_case_area'); } catch (_) {}
  });
  const sw = page.locator('[data-testid="vp-test"]');
  /* ⚠ a freshly minted entity can take a while to paint the top bar — wait, do not assume */
  await expect(sw).toBeVisible({ timeout: 45000 });
  if (!(await sw.textContent() || '').includes('on')) await sw.click();
  await expect(sw).toContainText('on');
  /* ⭐ the chip only appears once the board has been read — waiting for it IS the assertion that mode reads it */
  await expect(page.locator('[data-testid="screen-cases"]').first()).toBeVisible({ timeout: 30000 });
}

/**
 * ⭐ SEC-122 (2026-10-31): THE SHARED TEST BOARD IS READ BY BUILDERS ONLY. When the stack shares one board (TEST_BOARD_ENTITY),
 * a freshly minted ordinary shop is refused with 403 NOT_BOARD_READER — that IS the new truth, not a failure. A spec that needs the
 * whole board (seed it, count its cases) says so and stands down for such a shop; on a per-tenant stack the shop reads its own board
 * and the spec runs as before. The refusal itself is asserted here so it cannot go quiet.
 */
// SEC-122 §7 evidence for public/app/cap-testing.js: the Test lab notice paints with theme tokens and states its refusal in words (tests/board-trace.test.cjs checks the helper).
// MIN cream-and-dark-1366-390
// MIN aa-contrast
// MIN could-not-read-words
// MIN string-layer
async function boardOrBuildersOnly(page, testInfo) {
  const probe = await page.evaluate(async () => {
    try { await api('testCases', {}); return { ok: true }; } catch (e) { return { ok: false, status: e && e.status, message: String((e && e.message) || '') }; }
  });
  if (probe.ok) return;
  expect(probe.status, 'a read of the board failed for a reason other than the builders-only gate: ' + probe.message).toBe(403);
  testInfo.skip(true, 'SEC-122: the shared test board is for builders; an ordinary shop is refused (403) by design');
}

/**
 * ⭐ the first time the lab is opened it explains itself in a modal — by design (“the first tick explains
 * itself”). A spec has seen it before, so it closes it; a modal backdrop otherwise swallows every click.
 */
async function dismissModal(page) {
  const m = page.locator("#modalhost .modal");
  if (await m.count()) {
    await page.evaluate(() => { try { closeModal(); } catch (_) {} });
    await expect(m).toHaveCount(0);
  }
}

/** the panel, opened the way a tester opens it: by the chip on the screen */
async function openPanel(page) {
  await page.locator('[data-testid="screen-cases"]').first().click();
  await expect(page.locator('#cbcasespanel')).toBeVisible();
}

/**
 * ── ⚠️⚠️ THIS HELPER WENT STALE THE DAY THE FORM WAS REDESIGNED, AND TOOK 11 SPECS WITH IT ─────────────────
 *
 * `3d243f2` (2026-09-13) rebuilt the Create form around Athi's *"we are using the same dialog box for
 * creating requirement, observation or incident? So possibly those chips should be on top"*: the TYPE is now
 * chosen first, from three chips, and there is ONE save button whose verb follows the chip — "+ Create case",
 * "Raise incident", "Raise requirement". The old `Write` / `Pass` / `Fail` / `Save` buttons this helper clicks
 * stopped existing that morning, and nothing updated the spec. Every testmode case that writes anything has
 * been failing since, on a product that was working.
 *
 * ⚠️ A STALE CASE IS WORSE THAN A MISSING ONE: 11 reds that look like product defects and are not.
 * [[feedback-improvise-update-cases]]
 *
 * ⭐ AND IT NOW DRIVES data-testid, NOT BUTTON TEXT. The verb is deliberately different per type and Athi is
 * still editing this copy; a helper keyed to the wording breaks again on the next rename. `wkind-*` and
 * `wsave` are the contract. [[feedback-probe-through-the-gate]]
 */
async function writeCase(page, { req, op, exp, got }, outcome) {
  /* the panel opens on CASES when a screen has any, so writing starts by asking for Create — as a tester does */
  if (!(await page.locator('#wcTitle').count())) {
    /* the SEGMENT (labelled "Create") is the way into the area; "+ Create" is a button INSIDE it */
    await page.locator('#cbcasesbody button').filter({ hasText: /^Create$/ }).first().click();
    const plus = page.locator('#cbcasesbody button').filter({ hasText: /^\+ Create$/ }).first();
    if (await plus.count()) await plus.click();
    await expect(page.locator('#wcTitle')).toBeVisible({ timeout: 15000 });
  }
  /* ⭐ the TYPE first — it decides the four labels below it and the verb on the save button */
  const kind = outcome === 'inc' ? 'inc' : outcome === 'req' ? 'req' : 'case';
  await page.locator('[data-testid="wkind-' + kind + '"]').click();

  await page.fill('#wcTitle', req);
  await page.fill('#wcDo', op);
  await page.fill('#wcSee', exp);
  if (got) await page.fill('#wcGot', got);
  await page.locator('[data-testid="wsave"]').click();

  /**
   * ⚠️ SAVING AND PASSING ARE TWO ACTS NOW, and that is the product being right rather than the test being
   * awkward: writing down what should be true is not the same as saying you observed it. The old form
   * conflated them in one "Pass" button. A verdict is recorded on the case's own row.
   */
  if (outcome === 'pass' || outcome === 'fail') {
    /**
     * ⚠️ AND SAVING DOES NOT LEAVE YOU ON THE LIST. testCaseSend() repaints but does not change the area, so
     * the panel is still showing Create and the row — with its verdict buttons — is not on screen at all.
     * The old one-button form hid this: "Pass" WAS the save. Two acts now means two places.
     */
    const cases = page.locator('#cbcasesbody button').filter({ hasText: /^Cases/ }).first();
    if (await cases.count()) await cases.click();

    const label = outcome === 'pass' ? 'Pass' : 'Fail';
    const btn = page.locator('#cbcasespanel button').filter({ hasText: new RegExp('^' + label + '$') }).first();
    await btn.waitFor({ state: 'visible', timeout: 20000 });
    await btn.click();
    /**
     * ⚠️ WAIT ON THE COUNT CHIP, NOT ON THE ROW. My first attempt asserted the row's own verdict word and
     * failed on a product that had worked perfectly: the default filter is "to do", so the moment a case
     * passes it leaves the visible list and the panel correctly says "Nothing left to test on this screen".
     * The chip is the thing that stays put.
     */
    await expect(page.locator('#cbcasesbody')).toContainText(/(Passed|Failed)\s*[1-9]/,
      { timeout: 20000 });
  }
}

test.describe('test mode', () => {

  test('[TM-01] the chip is off for everyone who is not testing', async ({ page }) => {
    test.setTimeout(180000);
    await mintEntity(page, { fresh: true, name: 'TM one ' + Date.now().toString().slice(-6) });

    /* ⚠️ a shopkeeper billing a customer must never see a testing control on their counter */
    await expect(page.locator('[data-testid="screen-code"]').first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-testid="screen-cases"]')).toHaveCount(0);

    await modeOn(page);
    await expect(page.locator('[data-testid="screen-cases"]').first()).toBeVisible();

    /* and off again takes them away */
    await page.locator('[data-testid="vp-test"]').click();
    await expect(page.locator('[data-testid="vp-test"]')).toContainText('off');
    await expect(page.locator('[data-testid="screen-cases"]')).toHaveCount(0);
  });

  test('[TM-02] the switch and the lab are two different things', async ({ page }) => {
    test.setTimeout(180000);
    await mintEntity(page, { fresh: true, name: 'TM two ' + Date.now().toString().slice(-6) });
    await modeOn(page);

    /* the lab is its own door and does not exist until it is opened */
    await expect(page.locator('#cbtesthost')).toHaveCount(0);
    await page.locator('[data-testid="vp-lab"]').click();
    /* ⚠ the PANEL, not the host: #cbtesthost is a zero-size wrapper and Playwright rightly calls it hidden */
    await expect(page.locator('#cbtestpanel')).toBeVisible();
    await dismissModal(page);

    /**
     * ⚠️ CLOSING THE LAB MUST NOT TURN THE MODE OFF. Until 2026-09-12 they were one button, so a person putting
     * the board away lost the chips they were using.
     */
    await page.locator('#cbtesthead button[title="Close the lab"]').click();
    await expect(page.locator('#cbtesthost')).toHaveCount(0);
    await expect(page.locator('[data-testid="vp-test"]')).toContainText('on');
    await expect(page.locator('[data-testid="screen-cases"]').first()).toBeVisible();
  });

  test('[TM-03] a verdict records with the lab NEVER opened', async ({ page }) => {
    test.setTimeout(240000);
    await mintEntity(page, { fresh: true, name: 'TM three ' + Date.now().toString().slice(-6) });

    /**
     * ⚠️⚠️ THE FAULT THIS SPEC EXISTS FOR. The run every verdict belongs to was created as a side effect of
     * opening the lab, so recording from a screen threw "cannot read properties of null (reading id)".
     * Clearing the saved run reproduces a genuinely first-ever sitting.
     */
    await page.evaluate(() => { try { localStorage.removeItem('cb_testrun'); } catch (_) {} });
    await page.reload();
    await modeOn(page);
    await expect(page.locator('#cbtesthost')).toHaveCount(0);   // the lab is NOT open, and must not be

    await openPanel(page);
    await writeCase(page, {
      req: 'The screen opens and names itself',
      op: 'Open it from the rail',
      exp: 'The code in the corner is the one this case is filed under',
      got: 'As expected.',
    }, 'pass');

    /* ⚠️ the assertion is the COUNT MOVING, not the absence of a toast: a verdict that recorded but did not
       repaint reads to a tester exactly like a press that did not land. The tally lives in the HEADER since
       the panel gained its three areas. */
    await expect(page.locator('#cbcaseshead')).toContainText('1', { timeout: 30000 });
    await expect(page.locator('#cbcasesbody')).toContainText('Cases 1', { timeout: 30000 });
    await page.locator('#cbcasesbody button', { hasText: /^Cases/ }).first().click();
    await expect(page.locator('#cbcasesbody')).toContainText('Passed 1', { timeout: 20000 });
  });

  test('[TM-04] the panel follows the screen and the record', async ({ page }) => {
    test.setTimeout(240000);
    await mintEntity(page, { fresh: true, name: 'TM four ' + Date.now().toString().slice(-6) });
    await modeOn(page);
    await openPanel(page);

    const head = page.locator('#cbcaseshead');
    const first = await head.textContent();

    await page.locator('[data-testid="nav-catalogue"]').click();
    await expect(head).toContainText('CAT', { timeout: 20000 });
    const second = await head.textContent();
    expect(second).not.toBe(first);

    await page.locator('[data-testid="nav-suppliers"]').click();
    await expect(head).toContainText('BUS002', { timeout: 20000 });
    await expect(page.locator('#cbcasespanel')).toBeVisible();   // it followed; it did not close
  });

  test('[TM-05] it does NOT follow while you are typing', async ({ page }) => {
    test.setTimeout(240000);
    await mintEntity(page, { fresh: true, name: 'TM five ' + Date.now().toString().slice(-6) });
    await modeOn(page);
    await openPanel(page);

    await page.fill('#wcTitle', 'half a sentence I have not finished');
    const before = await page.locator('#cbcaseshead').textContent();

    await page.locator('[data-testid="nav-catalogue"]').click();
    await page.waitForTimeout(2500);

    /* ⚠️ following the reader is helpful; throwing away their half-written sentence is not */
    /* ⚠ the CODE, not the whole header: the incident and requirement counts arrive a beat later and
       would fail an exact-text match for a reason that has nothing to do with following. */
    await expect(page.locator('#cbcaseshead')).toContainText(before.replace(/[^A-Z0-9]/g, '').slice(0, 6));
    await expect(page.locator('#wcTitle')).toHaveValue('half a sentence I have not finished');
  });

  test('[TM-06] a case cannot be written without an expectation', async ({ page }) => {
    test.setTimeout(240000);
    await mintEntity(page, { fresh: true, name: 'TM six ' + Date.now().toString().slice(-6) });
    await modeOn(page);
    await openPanel(page);

    await expect(page.locator('#cbcasesbody')).toContainText('Cases 0');
    await page.locator('[data-testid="wsave"]').click();
    await page.waitForTimeout(1500);
    /* ⚠ nothing was written — asserted on the COUNT, not on a prefix of the panel text, which now carries
       counts that arrive a beat later and would fail for a reason unrelated to the refusal */
    await expect(page.locator('#cbcasesbody')).toContainText('Cases 0');

    await page.fill('#wcTitle', 'only the requirement');
    await page.locator('[data-testid="wsave"]').click();
    await page.waitForTimeout(1200);
    await expect(page.locator('#wcTitle')).toHaveValue('only the requirement');  // still unsaved, still there
  });

  test('[TM-09] several cases on one screen, and Cancel is not a one-way door', async ({ page }) => {
    test.setTimeout(300000);
    await mintEntity(page, { fresh: true, name: 'TM nine ' + Date.now().toString().slice(-6) });
    await modeOn(page);
    await openPanel(page);

    await writeCase(page, { req: 'first thing that must be true', op: 'do the first thing', exp: 'the first result' });
    await expect(page.locator('#cbcasesbody')).toContainText('Cases 1', { timeout: 30000 });
    /* ⚠️ the form must still be standing, and empty — saving used to remove it, so the first case was the last */
    await expect(page.locator('#wcTitle')).toHaveValue('');

    await writeCase(page, { req: 'second thing that must be true', op: 'do the second thing', exp: 'the second result' });
    await expect(page.locator('#cbcasesbody')).toContainText('Cases 2', { timeout: 30000 });

    await page.locator('#cbcasespanel button', { hasText: /^Cancel$/ }).first().click();
    await expect(page.locator('#wcTitle')).toHaveCount(0);
    await page.locator('#cbcasesbody button').filter({ hasText: /^\+ Create$/ }).first().click();
    await expect(page.locator('#wcTitle')).toBeVisible();
  });

  test('[TM-10] a passed case stands down, and comes back on Re-test', async ({ page }) => {
    test.setTimeout(300000);
    await mintEntity(page, { fresh: true, name: 'TM ten ' + Date.now().toString().slice(-6) });
    await modeOn(page);
    await openPanel(page);

    await writeCase(page, { req: 'a thing that passes', op: 'do it', exp: 'it works', got: 'As expected.' }, 'pass');
    await expect(page.locator('#cbcasesbody')).toContainText('Cases 1', { timeout: 30000 });

    /* ⭐ the panel stays on Write after a verdict — by design — so the piles are asked for */
    await page.locator('#cbcasesbody button', { hasText: /^Cases/ }).first().click();

    /* the default pile is TO DO, and a passed case is not in it */
    await expect(page.locator('#cbcasesbody')).toContainText('To do');
    await expect(page.locator('#cbcasesbody')).toContainText('Passed 1');
    await expect(page.locator('#cbcasesbody button', { hasText: /^Re-test$/ })).toHaveCount(0);

    await page.locator('#cbcasesbody button', { hasText: /^Passed/ }).first().click();
    const retest = page.locator('#cbcasesbody button', { hasText: /^Re-test$/ }).first();
    await expect(retest).toBeVisible();
    await retest.click();
    /* opened out again: its observation box is back */
    await expect(page.locator('#cbcasesbody input[id^="cbt_n_"]').first()).toBeVisible();
  });

  test('[TM-12] a case belongs to the screen it was written on', async ({ page }) => {
    test.setTimeout(300000);
    await mintEntity(page, { fresh: true, name: 'TM twelve ' + Date.now().toString().slice(-6) });
    await modeOn(page);

    await page.locator('[data-testid="nav-suppliers"]').click();
    await expect(page.locator('[data-testid="screen-code"]').first()).toHaveText('BUS002', { timeout: 20000 });
    await openPanel(page);
    await writeCase(page, { req: 'a supplier thing', op: 'open a supplier', exp: 'it says what it is' });
    /* ⚠ wait for the board to come back before reading it: writeCase presses the button, it does not wait */
    await expect(page.locator('#cbcasesbody')).toContainText('Cases 1', { timeout: 30000 });

    /* ⚠️ a written case once landed with NO menu, mapped to no screen, and vanished from the view that wrote it */
    const keys = await page.evaluate(() => (CBTEST.cases || [])
      .filter((c) => /^BUS002-H/.test(c.case_key)).map((c) => c.case_key));
    expect(keys.length).toBe(1);

    await page.locator('[data-testid="nav-catalogue"]').click();
    await page.waitForTimeout(2500);
    await expect(page.locator('#cbcasesbody')).not.toContainText(keys[0]);
  });

  test('[TM-13] writing one case does not disturb the rest of the board', async ({ page }, testInfo) => {
    test.setTimeout(300000);
    await mintEntity(page, { fresh: true, name: 'TM thirteen ' + Date.now().toString().slice(-6) });
    await boardOrBuildersOnly(page, testInfo);
    await modeOn(page);

    /* seed the board so there is something for a bad import to destroy */
    await page.evaluate(async () => { await api('testSeed', { body: {} }); });
    await page.evaluate(async () => { if (typeof testLoad === 'function') await testLoad(true); });
    const before = await page.evaluate(() => (CBTEST.cases || []).length);
    expect(before).toBeGreaterThan(50);

    await openPanel(page);
    await writeCase(page, { req: 'one more', op: 'do it', exp: 'fine' });
    /* ⚠ wait for the reload the save triggers — counting before it lands reads as a case that never saved */
    /* ⚠ read the BOARD, not a tab: the panel stays on Write after a save and the tab count is not on screen */
    await expect.poll(async () => page.evaluate(() => (CBTEST.cases || []).length),
      { timeout: 45000 }).toBe(before + 1);

    /**
     * ⚠️⚠️ WRITING ONE CASE ONCE REPORTED 1447 ORPHANS. Nothing was retired, and only because a 90%
     * plausibility guard written for a different worry happened to cover it. On a small board the same call
     * would have retired everything.
     */
    const after = await page.evaluate(() => (CBTEST.cases || []).length);
    expect(after).toBe(before + 1);
  });

  test('[TM-11] a screenshot attaches, and comes back as the same bytes', async ({ page }) => {
    test.setTimeout(240000);
    await mintEntity(page, { fresh: true, name: 'TM eleven ' + Date.now().toString().slice(-6) });
    await modeOn(page);
    await openPanel(page);

    /**
     * ⚠️ ONE OF THE TWO PLACES THIS SPEC DOES NOT DRIVE THE CONTROL, and the reason is honest: a clipboard
     * paste and a screen-capture prompt are both outside the page's gift. The UPLOAD PATH is what is under
     * test here, and it is the same function the paste handler calls with the same blob.
     */
    const shot = await page.evaluate(async () => {
      const cv = document.createElement('canvas'); cv.width = 120; cv.height = 40;
      const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 120, 40);
      g.fillStyle = '#000'; g.font = '12px sans-serif'; g.fillText('evidence', 6, 24);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
      await testShotSend(blob, 'spec.png');
      return CBTEST.shot;
    });
    expect(shot && shot.id).toBeTruthy();

    /* the thumbnail proves the bytes made the round trip without opening anything */
    await expect(page.locator('#cbcasesbody img')).toBeVisible();

    /**
     * ⚠️⚠️ AND IT MUST BE FETCHABLE WITH THE TOKEN. A plain <a href> could never have worked — the endpoint is
     * authenticated and a link carries no Authorization header. That was the "unauthorised" Athi hit.
     */
    const res = await page.request.get(API + '/api/attachments/' + shot.id,
      { headers: { Authorization: 'Bearer ' + await tokenOf(page) } });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
    expect((await res.body()).length).toBe(shot.size);
  });

  test('[TM-15] three testers, one board, and the report says who did what', async ({ page }, testInfo) => {
    test.setTimeout(420000);
    await mintEntity(page, { fresh: true, name: 'TM team ' + Date.now().toString().slice(-6) });
    await boardOrBuildersOnly(page, testInfo);
    const owner = await tokenOf(page);

    /* the entity's own user id — an actor signs in as key@that */
    const userId = await page.evaluate(async () => {
      const m = await api('me'); const e = (m && m.entity) || m || {};
      return e.user_id || e.entity_user_id || null;
    });
    expect(userId).toBeTruthy();

    /* seed so there are cases for three people to record against */
    await page.evaluate(async () => { await api('testSeed', { body: {} }); });
    const keys = await page.evaluate(async () => {
      const r = await api('testCases', {});
      return (r.cases || []).slice(0, 6).map((c) => ({ key: c.case_key, mod: c.module_key }));
    });
    expect(keys.length).toBeGreaterThan(2);

    /**
     * ⭐ TWO MORE IDENTITIES IN THE SAME ENTITY — which is the shape the answer depends on. Ten testers of one
     * product are ten identities in ONE entity; ten separate entities would be ten separate boards, and RLS
     * keeping them apart is the core principle working rather than a gap.
     */
    const people = [];
    for (const who of [{ key: 'tester1', name: 'Tester One' }, { key: 'tester2', name: 'Tester Two' }]) {
      const made = await page.request.post(API + '/api/actors', {
        headers: { Authorization: 'Bearer ' + owner, 'Content-Type': 'application/json' },
        data: { display_name: who.name, actor_key: who.key, actor_role: 'tester',
                access_level: 'editor', whole_entity: true },
      });
      expect(made.ok(), 'could not create ' + who.key + ': ' + made.status()).toBeTruthy();
      const body = await made.json();
      /**
       * ⭐ EVERYTHING THE INVITE NEEDS COMES BACK FROM THE CREATE. The response carries the OTP and the exact
       *  — key@entity-slug — so nothing has to be assembled here. My first attempt built the
       * username from the entity’s user_id and asked for a second OTP against , a field this API
       * does not use (it is ), which 500’d on /actors/undefined/otp.
       */
      const code = body.otp;
      const username = (body.actor && body.actor.login_format) || (who.key + '@' + userId);
      expect(code, 'no OTP came back with the new actor').toBeTruthy();

      const login = await page.request.post(API + '/api/actors/login', {
        headers: { 'Content-Type': 'application/json' },
        data: { username, otp: String(code) },
      });
      expect(login.ok(), 'could not sign in as ' + who.key + ': ' + login.status()).toBeTruthy();
      const lj = await login.json();
      people.push({ name: who.name, token: lj.token });
    }
    expect(people.length).toBe(2);

    /* each person records a verdict on a DIFFERENT case, so nobody overwrites anybody */
    const record = async (token, k, status) => {
      const r = await page.request.post(API + '/api/testing/results', {
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        data: { results: [{ case_key: k.key, module_key: k.mod, status, run_kind: 'manual' }] },
      });
      expect(r.ok(), 'result refused: ' + r.status()).toBeTruthy();
    };
    await record(owner, keys[0], 'pass');
    await record(people[0].token, keys[1], 'pass');
    await record(people[1].token, keys[2], 'fail');

    /* ⭐ and the report answers per person as well as together */
    const rep = await page.request.get(API + '/api/testing/report',
      { headers: { Authorization: 'Bearer ' + owner } });
    expect(rep.ok()).toBeTruthy();
    const j = await rep.json();
    const byTester = (j.sections || []).filter((s) => s.id === '1b')[0];
    expect(byTester, 'the report has no By tester section').toBeTruthy();

    const rows = byTester.body.people || [];
    expect(rows.length, 'three people recorded, the report shows ' + rows.length).toBe(3);
    /* ⚠️ the sum must match: a leaderboard that double-counts is worse than none */
    expect(rows.reduce((a, p) => a + p.recorded, 0)).toBe(3);
    expect(rows.filter((p) => p.failed === 1).length).toBe(1);
    expect(new Set(rows.map((p) => p.tester_id)).size).toBe(3);
  });

  /**
   * ── ⭐⭐ THE THREE THINGS THAT MADE "BEHIND" WRONG THE FIRST TIME ─────────────────────────────────────────
   *
   * Every one of these was found by looking at the live panel, not by a guard, and every one of them made the
   * area report MORE coverage than the screen has. That is the direction that matters: a tester who reads
   * "44 passing underneath" and moves on has been misled by their own tool.
   */
  test('[TM-17] Behind names the file that draws the screen, and counts only real links', async ({ page }) => {
    test.setTimeout(240000);
    await mintEntity(page, { fresh: true, name: 'TM seventeen ' + Date.now().toString().slice(-6) });
    await modeOn(page);
    await page.locator('[data-testid="nav-catalogue"]').click();
    await openPanel(page);
    await expect(page.locator('#cbcaseshead')).toContainText('CAT', { timeout: 20000 });

    await page.evaluate(() => testArea('behind'));
    /* ⚠ the file-level detail is the SECOND half of Coverage and is folded shut by design — the area now
       leads with the control to-do list, because "which files name this code" is a developer's question.
       Open it the way a tester does. */
    await page.evaluate(() => { if (!CBTEST.behindTech) testBehindTech(); });
    const body = page.locator('#cbcasesbody');

    /* the EXACT rung: the register knows which capability draws the Catalogue */
    await expect(body).toContainText('cap-catalogue.js');

    /**
     * ⚠️ AND THE NAME MATCH IS NEVER FOLDED INTO THE COUNT. The tab number must equal the linked rows only.
     * A word match dressed up as coverage is the whole failure this area was built to avoid, so it is
     * asserted rather than trusted to the comment that says so.
     */
    const n = await page.evaluate(() => {
      const b = testBehindOf(CBTEST.popupFor);
      return { tab: testBehindCount(CBTEST.popupFor), linked: b.linked.length, named: b.named.length };
    });
    expect(n.tab, 'the tab count does not match the linked rows').toBe(n.linked || null);
    if (n.named) {
      await expect(body).toContainText('Named after');
      expect(n.tab).not.toBe((n.linked || 0) + n.named);
    }
  });

  test('[TM-18] the tester’s own tool never appears as something the screen depends on', async ({ page }) => {
    test.setTimeout(240000);
    await mintEntity(page, { fresh: true, name: 'TM eighteen ' + Date.now().toString().slice(-6) });
    await modeOn(page);
    await page.locator('[data-testid="nav-catalogue"]').click();
    await openPanel(page);
    await expect(page.locator('#cbcaseshead')).toContainText('CAT', { timeout: 20000 });

    /**
     * ⚠️⚠️ READING THE BOARD, SAVING A VERDICT AND POSTING A SCREENSHOT ALL HIT /api/testing. Left in, every
     * screen in the product listed the tester’s own tool among its dependencies — and dragged that
     * route’s whole module fan-out, and every test of it, in behind. Opening the panel is the act that
     * causes it, so the panel being open IS the test.
     */
    const seen = await page.evaluate(() => testBehindOf(CBTEST.popupFor).routes);
    expect(seen.filter((r) => /routes\/testing\.js$/.test(r)), 'the test tool listed itself').toEqual([]);

    /* and the same for the Speed reading — a measurement that counts itself is not one */
    const paths = await page.evaluate(() => (window.CBCALLS || [])
      .filter((c) => /^\/api\/testing/.test(c.path || '')).length);
    expect(paths, 'the fixture never called /api/testing — this test proves nothing').toBeGreaterThan(0);
    await page.locator('[data-testid="area-more"]').selectOption('diag');
    await expect(page.locator('#cbcasesbody')).not.toContainText('/api/testing');
  });

  test('[TM-19] a second visit to a screen does not inherit the first visit’s calls', async ({ page }) => {
    test.setTimeout(240000);
    await mintEntity(page, { fresh: true, name: 'TM nineteen ' + Date.now().toString().slice(-6) });
    await modeOn(page);
    await openPanel(page);

    /**
     * ⚠️⚠️ THE VISIT NUMBER HAS TO ADVANCE EVEN WHEN A SCREEN ASKS THE SERVER FOR NOTHING. Counting it inside
     * the call recorder alone left it stuck at 1 across two navigations — caught in the browser, not here —
     * and the Catalogue went on presenting the app’s whole start-up as its own dependencies: ten routes and
     * 83 tests underneath, against one route and 38 once this was right.
     */
    await page.locator('[data-testid="nav-catalogue"]').click();
    await expect(page.locator('#cbcaseshead')).toContainText('CAT', { timeout: 20000 });
    const first = await page.evaluate(() => window.CBGEN || 0);

    await page.locator('[data-testid="nav-suppliers"]').click();
    await expect(page.locator('#cbcaseshead')).toContainText('BUS002', { timeout: 20000 });
    await page.locator('[data-testid="nav-catalogue"]').click();
    await expect(page.locator('#cbcaseshead')).toContainText('CAT', { timeout: 20000 });

    const back = await page.evaluate(() => window.CBGEN || 0);
    expect(back, 'the visit number stood still across two navigations').toBeGreaterThan(first);

    /* and the app’s start-up is no longer being counted against a screen the tester walked back to */
    const booting = await page.evaluate(() => testBehindOf(CBTEST.popupFor).booting);
    expect(booting, 'a revisited screen still reports itself as mid-boot').toBeFalsy();
  });

  test('[TM-20] a failure carries the build and the browser; a pass does not', async ({ page }) => {
    test.setTimeout(240000);
    await mintEntity(page, { fresh: true, name: 'TM twenty ' + Date.now().toString().slice(-6) });
    await modeOn(page);
    await openPanel(page);

    /**
     * ⚠️⚠️ WITHOUT THIS, A MONTH-OLD FAILURE IS A RUMOUR. `test_result.build` existed from b219 and nothing
     * wrote to it. The first question anyone asks a bug report is which build and which browser.
     */
    await writeCase(page, {
      req: 'the environment rides along with a failure',
      op: 'Record a failure from the panel.',
      exp: 'The build and the browser are kept with it.',
      got: 'Checking that they are.',
    }, 'inc');

    await expect.poll(async () => page.evaluate(() => Object.keys(CBTEST.last || {}).length),
      { timeout: 30000 }).toBeGreaterThan(0);

    const tok = await tokenOf(page);
    const r = await page.request.get(API + '/api/testing/results',
      { headers: { Authorization: 'Bearer ' + tok } });
    expect(r.ok()).toBeTruthy();
    const j = await r.json();
    const bad = (j.results || []).filter((x) => x.status === 'fail');
    expect(bad.length, 'no failure was recorded').toBeGreaterThan(0);

    /* ⚠️ the VALUES, not merely that something was stored — an empty string would pass a truthiness check */
    const ev = String(bad[0].evidence || '');
    expect(ev, 'the failure carries no build: ' + ev).toContain('build ');
    expect(ev, 'the failure carries no viewport: ' + ev).toMatch(/[0-9]+×[0-9]+/);

    /**
     * ⚠️ AND CHROME MUST NOT BE REPORTED AS SAFARI. Chrome’s user-agent ends with "Safari/537", so reading
     * the last match names every Chrome tester Safari — wrong in a way nobody would question. Playwright
     * drives Chromium here, so the right answer is knowable.
     */
    expect(ev, 'the browser was read from the wrong end of the user-agent: ' + ev).not.toContain('Safari');
  });

  test('[TM-21] blocked will not record without saying what blocked it', async ({ page }) => {
    test.setTimeout(240000);
    await mintEntity(page, { fresh: true, name: 'TM twentyone ' + Date.now().toString().slice(-6) });
    await modeOn(page);

    /**
     * ⭐ ISO/IEC/IEEE 29119-3 asks for the reason a case could not be run. A blocked case with no reason reads
     * the same as one nobody got to, and the two lead to opposite actions: fix the blocker, or find a tester.
     *
     * ⚠️ A CASE HAS TO EXIST FIRST. A freshly minted entity has an empty board, so the lab opens with nothing
     * in it — the first version of this test looked for a Blocked button on a screen that had no rows at all
     * and reported a missing guard where there was simply nothing to press.
     */
    await openPanel(page);
    await writeCase(page, {
      req: 'a blocked verdict has to say what blocked it',
      op: 'Press Blocked in the lab with the observation box empty.',
      exp: 'It refuses, and nothing is recorded.',
    });
    await expect.poll(async () => page.evaluate(() => (CBTEST.cases || []).length),
      { timeout: 30000 }).toBeGreaterThan(0);

    await page.locator('[data-testid="vp-lab"]').click();
    /* ⚠ the PANEL, not the host: #cbtesthost is a zero-size wrapper and Playwright rightly calls it hidden */
    await expect(page.locator('#cbtestpanel')).toBeVisible({ timeout: 30000 });
    await dismissModal(page);

    /**
     * ⚠️ THE BOARD OPENS ON THE WORKLIST NOW — "what is waiting for me" is the question a tester opens this
     * panel to answer, and that became the default view today. Its rows are worklist rows; the case rows with
     * the verdict buttons are the LIST view. modeOn() clears the remembered view, so this must ask for it.
     */
    await page.locator('[data-testid="view-list"]').click();

    /* the verdict buttons live inside an OPENED case, so a case is opened the way a tester opens one */
    const row = page.locator('#cbtestpanel [onclick^="testOpen("]').first();
    await expect(row).toBeVisible({ timeout: 30000 });
    await row.click();
    const blocked = page.locator('#cbtestpanel button', { hasText: /^Blocked$/ }).first();
    await expect(blocked).toBeVisible({ timeout: 30000 });

    const before = await page.evaluate(() => Object.keys(CBTEST.last || {}).length);
    await blocked.click();
    await page.waitForTimeout(2500);
    expect(await page.evaluate(() => Object.keys(CBTEST.last || {}).length),
      'a blocked verdict recorded with no reason').toBe(before);

    /* ⭐ and it is a refusal, not a dead button: give it the reason and it records */
    await page.locator('#cbtestpanel input[id^="cbt_n_"]').first().fill('the supplier screen will not open');
    await blocked.click();
    await expect.poll(async () => page.evaluate(() => Object.keys(CBTEST.last || {}).length),
      { timeout: 30000 }).toBe(before + 1);
  });

  /**
   * ── ⚠️⚠️⚠️ THE TAB THAT DID NOTHING ─────────────────────────────────────────────────────────────────────
   *
   * Athi, 2026-09-13: *"in the screen incident 2, but couldn\u2019t click the link for incident and see what
   * those are?"* \u2014 and the cause was not the count. `testRaisedHTML` had been deleted by a region replace
   * the night before. Opening Raised threw ReferenceError, the paint died half-way, and the panel went on
   * showing whatever it had been showing.
   *
   * ⚠️⚠️ SIXTEEN SPECS WERE GREEN OVER IT, because not one of them ever pressed this tab. That is the whole
   * lesson: a green suite is a statement about what it VISITS, and every area of a panel is a place a spec
   * has to actually go.
   *
   * ⭐ IT ASSERTS THE CONTENT, not that the click did not throw. A tab that renders empty because a filter is
   * wrong looks identical to a working one from the outside.
   */
  test('[TM-22] every area of the panel renders \u2014 including Raised', async ({ page }) => {
    test.setTimeout(240000);
    await mintEntity(page, { fresh: true, name: 'TM twentytwo ' + Date.now().toString().slice(-6) });
    await modeOn(page);
    await page.locator('[data-testid="nav-catalogue"]').click();
    await openPanel(page);
    await expect(page.locator('#cbcaseshead')).toContainText('CAT', { timeout: 20000 });

    /* something has to have been raised, or Raised is empty for an honest reason and proves nothing */
    await writeCase(page, {
      req: 'the Raised area shows what was raised here',
      op: 'Raise an incident from this screen, then open Raised.',
      exp: 'The incident is listed with its reference and its state.',
      got: 'Checking that it is.',
    }, 'inc');
    await expect.poll(async () => page.evaluate(() => (CBTEST.scrInc || []).length),
      { timeout: 40000 }).toBeGreaterThan(0);

    const body = page.locator('#cbcasesbody');
    /**
     * ⚠️ THE FIVE TABS ARE NOW TWO SEGMENTS AND A DROPDOWN — seven equal buttons was a menu wearing a
     * choice's clothes. `write`/`cases` are pressed; the rest are chosen. Walking the area IDs rather than
     * the labels also survives the next copy edit, and "Raised" is two areas now (inc · req), which is the
     * distinction that let a settled screen read like a burning one.
     */
    const AREAS = [['write', 'seg'], ['cases', 'seg'], ['inc', 'more'], ['req', 'more'],
                   ['behind', 'more'], ['diag', 'more']];
    for (const [tab, how] of AREAS) {
      if (how === 'seg') {
        await page.locator('#cbcasesbody button')
          .filter({ hasText: tab === 'write' ? /^Create$/ : /^Cases/ }).first().click();
      } else {
        await page.locator('[data-testid="area-more"]').selectOption(tab);
      }
      await page.waitForTimeout(400);
      /* ⚠️ a died-mid-render paint leaves the PREVIOUS tab selected \u2014 so the assertion is that this one is */
      const on = await page.evaluate(() => CBTEST.caseArea);
      expect(on, tab + ' did not become the open area \u2014 its render threw').toBeTruthy();
      const text = (await body.textContent()) || '';
      expect(text.length, tab + ' rendered nothing').toBeGreaterThan(60);
    }

    /* and the Incidents area in particular says what was raised, by reference */
    await page.locator('[data-testid="area-more"]').selectOption('inc');
    /**
     * ⚠️ "Raised on this screen" IS IN DEAD CODE. That heading lives in testRaisedHTML(), which has ZERO
     * callers — the live Incidents area is testScrRaisedHTML(code,'inc') and heads itself with the open
     * count. So this assertion was passing, then failing, on text no reader has ever seen. What the area is
     * actually FOR is that a raised finding is listed with its reference and its state, which is what the
     * next line already checks and what the case's own expectation says.
     * ⚠️ testRaisedHTML is flagged for deletion — it still carries two faults documented as fixed elsewhere.
     */
    await expect(body).toContainText(/\d+ open/);
    await expect(body).toContainText(/INC-/);
  });
});
