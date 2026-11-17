// [LOOP] THE WHOLE CYCLE: WRITE → CLOSE WITH A REASON → SURVIVE THE NEXT WRITE → REOPEN.
//
// ── ⭐⭐⭐ WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────────────
//
// Athi, 2026-09-13: *"if you can look at the entire loop for a couple of cycles, it may complete our test tool
// work."* Driving it twice found a fault that reading the code could not: the closing reason was written
// correctly, read back correctly ONCE, and was gone an hour later — stripped by the next import, because
// `importCases` composes `rules` from a named list and rebuilds the row without anything it does not mention.
// That was the SEVENTH field lost at that door.
//
// ⚠️⚠️ SO THE ASSERTION THAT MATTERS IS THE THIRD ONE. Closing and reading back immediately passes on the
// broken code. The bug only appears when something ELSE is written afterwards — which is exactly what nobody
// does when checking a feature they just built, and exactly what happens ten minutes later in real use.
//
// Run: npx playwright test tests/findings-loop.spec.js --reporter=line
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

test('[LOOP-01] a finding closes with its reason, and the reason survives', async ({ page }) => {
  test.setTimeout(240000);
  await mintEntity(page, { fresh: true, name: 'Loop ' + Date.now().toString().slice(-6) });
  const token = await page.evaluate(() => SESSION.token);
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  const KEY = 'RAL002-H91';
  const OTHER = 'RAL002-H92';
  const read = async (k) => {
    const r = await page.request.get(API + '/api/testing/cases?all=1&_=' + Date.now(), { headers: H });
    expect(r.ok(), 'could not read the cases').toBeTruthy();
    return ((await r.json()).cases || []).filter((x) => x.case_key === k)[0] || null;
  };
  /* ⚠ /cases/import, which is the path the PANEL uses — a spec that writes through a different door proves
     nothing about the door people go through */
  const write = (key, title) => page.request.post(API + '/api/testing/cases/import', {
    headers: H,
    data: { mode: 'add', cases: [{ case_key: key, module_key: 'RAL002', title, priority: 'Medium',
      test_type: 'screen', screen_code: 'RAL002', steps: [['do a thing', 'a thing happens']] }] },
  });

  /* ── 1 · written, and it names its author ── */
  expect((await write(KEY, 'the loop, cycle one')).ok()).toBeTruthy();
  let c = await read(KEY);
  expect(c, 'the case was not written').toBeTruthy();
  expect(c.status).toBe('live');
  /* ⚠️ the NAME, not the id: a board read six months later must not depend on a join to a row that may be gone */
  expect(c.written_by, 'the case does not name its author').toBeTruthy();

  /* ── 2 · closed, with a reason ── */
  const WHY = 'Closed by the loop test — the reason must outlive the next write.';
  const close = await page.request.post(API + '/api/testing/cases/close', {
    headers: H, data: { case_key: KEY, why: WHY },
  });
  expect(close.ok(), 'close was refused: ' + close.status()).toBeTruthy();
  c = await read(KEY);
  expect(c.status).toBe('retired');
  expect(c.closed_note).toBe(WHY);
  expect(c.closed_by, 'the closure does not name who closed it').toBeTruthy();

  /**
   * ── 3 · ⚠️⚠️ AND IT SURVIVES THE NEXT WRITE. This is the one that failed.
   *
   * Writing any other case runs the same importer over the board. Before the fix it rebuilt `rules` from a
   * named list and the closing reason simply was not on it, so a closure recorded ten minutes ago became a
   * closure with no account of itself — silently, with nothing in any log.
   */
  expect((await write(OTHER, 'the loop, cycle two')).ok()).toBeTruthy();
  c = await read(KEY);
  expect(c.status, 'the case came back to life after another write').toBe('retired');
  expect(c.closed_note, 'THE CLOSING REASON WAS STRIPPED BY THE NEXT WRITE').toBe(WHY);

  /* ── 4 · reopened, and the reason goes with the closure it explained ── */
  const back = await page.request.post(API + '/api/testing/cases/close', {
    headers: H, data: { case_key: KEY, open: true },
  });
  expect(back.ok()).toBeTruthy();
  c = await read(KEY);
  expect(c.status).toBe('live');
  /* ⚠️ a stale reason on a live case would explain a closure that has been undone */
  expect(c.closed_note == null || c.closed_note === '', 'the old reason outlived the closure').toBeTruthy();

  /* ── 5 · and the report counts it as raised by a person ── */
  const rep = await page.request.get(API + '/api/testing/report', { headers: H });
  expect(rep.ok()).toBeTruthy();
  const sec = ((await rep.json()).sections || []).filter((x) => x.id === '3b')[0];
  expect(sec, 'the report has no "Raised by people" section').toBeTruthy();
  const keys = (sec.body.items || []).map((i) => i.ref);
  expect(keys, 'the written cases are missing from the report').toContain(KEY);
  /**
   * ⚠️ SECTION 3 IS A DIFFERENT QUESTION and the two must not be conflated: 3 counts failed RESULTS, 3b counts
   * what a person RAISED. A day with no failures can still have findings, and it is usually the more useful list.
   */
  expect(sec.body.total).toBeGreaterThan(0);
});
