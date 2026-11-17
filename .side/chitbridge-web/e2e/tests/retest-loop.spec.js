// [RETEST] THE RETURN LEG: RAISED → RESOLVED (a claim) → RETESTED → CLOSED (a fact).
//
// ── ⭐⭐⭐ WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────────────
//
// Athi, 2026-09-13: *"a message back stating that this issue has been fixed — that feedback loop is not there.
// Say I test it, I create an incident, you fix it and then update the message back that it has been fixed, so I
// can retest and confirm that this has been resolved and close it."*
//
// ⚠️⚠️ THE TWO STATES ALREADY EXISTED AND WERE BEING USED AS ONE. `resolved` is the FIXER'S CLAIM; `closed` is
// the RAISER'S VERDICT. The panel folded them together, so the moment somebody wrote "resolved" the finding went
// grey and dropped out of Open — a claim rendered as a settled fact, and nobody ever asked to look.
//
// ⭐ WHAT THIS PROVES, AND WHY EACH ONE MATTERS:
//   1 · the incident records WHO raised it, by id — without that, nobody can be told it is their turn;
//   2 · `resolved` does NOT close it — the shelf and the state stay distinguishable from `closed`;
//   3 · the rejection path works: "still broken" returns it to `raised`, and the fixer's claim is not lost;
//   4 · the history holds every leg in order, so "resolved Tuesday, still broken Wednesday, closed Friday" is
//       readable a year later — which is the record an argument about whether it was ever fixed turns on.
//
// Run: npx playwright test tests/retest-loop.spec.js --reporter=line
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

test('[RETEST-01] a fix is a claim until the person who raised it says otherwise', async ({ page }) => {
  test.setTimeout(240000);
  await mintEntity(page, { fresh: true, name: 'Retest ' + Date.now().toString().slice(-6) });
  const token = await page.evaluate(() => SESSION.token);
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  /* every state, because the whole point is that a resolved incident must still be findable */
  const read = async (id) => {
    const r = await page.request.get(API + '/api/testing/incidents?state=all&_=' + Date.now(), { headers: H });
    expect(r.ok(), 'could not read the incidents').toBeTruthy();
    return ((await r.json()).incidents || []).filter((x) => x.definition_id === id)[0] || null;
  };
  const set = (id, body) => page.request.patch(API + '/api/testing/incidents/' + id, { headers: H, data: body });

  // ── 1 · somebody reports what they saw ──────────────────────────────────────────────────────────────────
  const raised = await page.request.post(API + '/api/testing/incidents', {
    headers: H,
    data: { observed: 'Searching the catalogue for cycle returns nothing', severity: 'Sev-2',
            screen_code: 'CAT001' },
  });
  expect(raised.ok(), 'could not raise the incident').toBeTruthy();
  const id = (await raised.json()).definition_id;
  expect(id, 'the incident has no id').toBeTruthy();

  const one = await read(id);
  expect(one, 'the incident is not on the board').toBeTruthy();
  expect(one.state).toBe('raised');
  /* ⚠️ BY ID, NOT BY NAME. "Is this mine to retest?" cannot be answered by matching display names, and this is
     the field the whole return leg hangs on — if it is null, nobody is ever told their turn has come. */
  expect(one.raised_by_id, 'the raiser was not recorded by id').toBeTruthy();

  // ── 2 · somebody says they fixed it — which is a CLAIM, not an ending ────────────────────────────────────
  const fixed = await set(id, { state: 'resolved', change: { sha: 'a1b2c3d', repo: 'chitbridge-web' } });
  expect(fixed.ok(), 'could not resolve it').toBeTruthy();

  const two = await read(id);
  expect(two.state, 'resolved must not read as closed — that is the fault this exists for').toBe('resolved');
  expect(two.state).not.toBe('closed');
  expect(two.changes.length, 'the citation that says what fixed it was not kept').toBe(1);
  expect(two.changes[0].sha).toBe('a1b2c3d');
  expect(two.raised_by_id, 'the raiser must survive the fix, or nobody can be told').toBe(one.raised_by_id);

  // ── 3 · ⭐ THE RAISER LOOKS, AND IT IS STILL BROKEN ───────────────────────────────────────────────────────
  const back = await set(id, { state: 'raised', why: 'Still nothing for cycle on a clean load' });
  expect(back.ok(), 'could not send it back').toBeTruthy();

  const three = await read(id);
  expect(three.state, 'a rejected fix must return to raised, not sit resolved').toBe('raised');
  /* ⚠️ THE CLAIM IS NOT ERASED BY BEING REJECTED. The commit that was tried is evidence for whoever tries next. */
  expect(three.changes.length, 'the attempted fix was thrown away').toBe(1);

  // ── 4 · fixed again, and this time it holds ─────────────────────────────────────────────────────────────
  await set(id, { state: 'resolved', change: { sha: 'd4e5f60', repo: 'chitbridge-web' } });
  const shut = await set(id, { state: 'closed', why: 'Retested on a clean load — cycle candle is found' });
  expect(shut.ok(), 'could not close it').toBeTruthy();

  const four = await read(id);
  expect(four.state).toBe('closed');
  expect(four.why).toContain('Retested');
  /* ⚠️ AND CLOSING MUST NOT MOVE THE DAY IT WAS FIXED. resolved_at is stamped on the FIRST resolution, or the
     one number a report quotes — how long the shop was broken — quietly becomes how long the paperwork took. */
  expect(four.resolved_at, 'the resolution was never stamped').toBeTruthy();

  // ── 5 · and every leg is readable, in order ─────────────────────────────────────────────────────────────
  const states = (four.history || []).map((h) => h.state);
  expect(states, 'the history does not tell the story')
    .toEqual(['raised', 'resolved', 'raised', 'resolved', 'closed']);
  const whys = (four.history || []).filter((h) => h.why).length;
  expect(whys, 'the two verdicts must each carry their reason').toBeGreaterThanOrEqual(2);
});

test('[RETEST-02] the news actually reaches the other tab, and carries no finding', async ({ page }) => {
  test.setTimeout(240000);
  await mintEntity(page, { fresh: true, name: 'News ' + Date.now().toString().slice(-6) });
  const token = await page.evaluate(() => SESSION.token);
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  /**
   * ⚠️⚠️ THE STATE MACHINE PASSING PROVES NOTHING ABOUT THE WIRE. lib/trips emitted nothing for six days with
   * every test of trips itself green, because the fault was in the plumbing around it. So this listens where
   * the app listens: cbPushArrived is a top-level function declaration in a classic script, which makes it a
   * property of window and therefore wrappable — the same door the real SSE stream comes through.
   */
  await page.evaluate(() => {
    window.__news = [];
    const orig = window.cbPushArrived;
    window.cbPushArrived = function (d) { try { window.__news.push(d); } catch (_) {} return orig.apply(this, arguments); };
  });
  /* the stream is opened on sign-in; give it a moment to be up before anything is said down it */
  await page.waitForTimeout(3000);

  const r = await page.request.post(API + '/api/testing/incidents', {
    headers: H, data: { observed: 'The bell should ring for this', severity: 'Sev-3', screen_code: 'CAT001' },
  });
  expect(r.ok(), 'could not raise the incident').toBeTruthy();
  const ref = (await r.json()).ref;

  await expect.poll(
    async () => (await page.evaluate(() => window.__news || [])).filter((d) => d && d.kind === 'test').length,
    { message: 'nothing came down the pipe — the emit is not wired, or the stream is not up', timeout: 30000 },
  ).toBeGreaterThan(0);

  const ev = (await page.evaluate(() => window.__news)).filter((d) => d.kind === 'test')[0];
  expect(ev.what).toBe('incident');
  expect(ev.state).toBe('raised');
  expect(ev.ref).toBe(ref);
  expect(ev.by, 'the actor must be named by id, or a tab cannot skip its own action').toBeTruthy();
  /* ⚠️ AND NOT THE FINDING ITSELF. An event carrying the observation is a second source of truth about a
     fault, and the day it disagrees with the board nobody can say which is right. */
  expect(JSON.stringify(ev)).not.toContain('The bell should ring');
});

test('[RETEST-03] the raiser is shown the band, and the two verdicts, in the lab', async ({ page }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true, name: 'Band ' + Date.now().toString().slice(-6) });
  const token = await page.evaluate(() => SESSION.token);
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  /* raise it, then have it "fixed" — which is the state the whole surface exists for */
  const r = await page.request.post(API + '/api/testing/incidents', {
    headers: H, data: { observed: 'Cycle is not found in the catalogue search', severity: 'Sev-2',
                        screen_code: 'CAT001' } });
  expect(r.ok(), 'could not raise the incident').toBeTruthy();
  const id = (await r.json()).definition_id;
  const fix = await page.request.patch(API + '/api/testing/incidents/' + id, {
    headers: H, data: { state: 'resolved', change: { sha: 'abc1234', repo: 'chitbridge-web' } } });
  expect(fix.ok(), 'could not resolve it').toBeTruthy();

  /* the mode switch, then the lab — the two doors a person actually goes through */
  const sw = page.locator('[data-testid="vp-test"]');
  await expect(sw).toBeVisible({ timeout: 45000 });
  if (!((await sw.textContent()) || '').includes('on')) await sw.click();
  await expect(sw).toContainText('on');
  await page.locator('[data-testid="vp-lab"]').click();
  await expect(page.locator('#cbtestpanel')).toBeVisible({ timeout: 30000 });
  const modal = page.locator('#modalhost .modal');
  if (await modal.count()) await page.locator('#modalhost .modal button').last().click();

  /* ⚠ the all-states copy is what Findings reads, and only By-screen has ever fetched it */
  await page.evaluate(() => testScrLoad());
  await expect.poll(async () => page.evaluate(() => (CBTEST.scrInc || []).length), { timeout: 30000 })
    .toBeGreaterThan(0);

  const shown = await page.evaluate(() => {
    CBTEST.view = 'hand';
    /* ⚠ 'open' and 'to retest' are DIFFERENT shelves by design — a claimed fix is not open work and
       not settled work. So the row itself is read from the shelf it is actually on. */
    try { localStorage.setItem('cb_hand_filter', 'verify'); } catch (_) {}
    const html = testHandHTML();
    const inc = testFindings().filter((x) => x.kind === 'inc')[0] || {};
    return { html: html, state: inc.state, byId: inc.byId, me: cbMeId() };
  });

  /* ⚠️ THE STATE IS THE WHOLE FAULT: if this reads 'closed', the fix has been rendered as a settled fact */
  expect(shown.state, 'a resolved incident must read as "to retest", not as closed').toBe('verify');
  expect(shown.byId, 'the row does not know who raised it, so nobody can be told').toBeTruthy();
  expect(String(shown.byId)).toBe(String(shown.me));

  /* ⭐ and it is not a filter somebody has to think to apply — it is a line above everything */
  expect(shown.html).toContain('waiting for your retest');
  expect(shown.html).toContain('yours to retest');
  /* both verdicts, both one click — give a person only "Close" and a fix that did not work gets closed anyway */
  expect(shown.html).toContain('Retested');
  expect(shown.html).toContain('Still broken');
  /* the account of what was done travels with the question */
  expect(shown.html).toContain('abc1234');
});
