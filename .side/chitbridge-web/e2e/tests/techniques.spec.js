// [TECH] THE TECHNIQUE HELPER READS THE FIELDS OFF THE WIRE, AND SHOWS ITS WORKING.
//
// ── ⚠️⚠️ THE FAULT THIS FILE STANDS AGAINST ─────────────────────────────────────────────────────────────────
//
// Athi, 2026-09-13: *"what field, where does it come from? From the current API? Can we figure this out and
// show these are the fields that have to be checked?"* and *"the screen has to be a little more usable — what
// field, highest, lowest — it has to be prominent. Also give some example as a 'try this', so people
// understand what we are saying here."*
//
// A blank box labelled "which field?" asks the tester to already know the product's field names, which is the
// one thing somebody testing a screen for the first time does not have. So the helper was usable only by
// people who did not need it.
//
// ⭐ THE CALL LOG ALREADY HELD THE ANSWER. Every request the screen made is in CBCALLS with its body, and those
// bodies are literally the fields it puts on the wire — not a guess and not a hand-maintained schema.
//
// Run: npx playwright test tests/techniques.spec.js --reporter=line
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');

test('[TECH-01] every technique says what it is for, with a worked example', async ({ page }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true, name: 'Tech ' + Date.now().toString().slice(-6) });

  const sw = page.locator('[data-testid="vp-test"]');
  await expect(sw).toBeVisible({ timeout: 45000 });
  if (!((await sw.textContent()) || '').includes('on')) await sw.click();
  await page.locator('[data-testid="screen-cases"]').first().click();
  await expect(page.locator('#cbcasespanel')).toBeVisible({ timeout: 30000 });
  const modal = page.locator('#modalhost .modal');
  if (await modal.count()) await page.locator('#modalhost .modal button').last().click();
  await page.evaluate(() => { CBTEST.tech = {}; testArea('tech'); });

  const panel = page.locator('#cbcasespanel');
  /**
   * ⚠️ WHAT EACH TECHNIQUE IS FOR NOW RIDES ON THE CHIP THAT CHOOSES IT. It used to print as five lines of
   * prose above the five chips, and the ▶ button below already DEMONSTRATED the same thing — the cut list
   * kept the demonstration and moved the definition onto the control. The fact is still asserted, on the
   * surface that now carries it. [[feedback-improvise-update-cases]]
   */
  await expect(page.locator('#cbcasespanel button', { hasText: 'A number range' }))
    .toHaveAttribute('title', /a lowest and a highest/);
  await expect(page.locator('#cbcasespanel button', { hasText: 'Kinds of value' }))
    .toHaveAttribute('title', /fall into KINDS/);
  await expect(page.locator('#cbcasespanel button', { hasText: 'A lifecycle' }))
    .toHaveAttribute('title', /MOVES THROUGH named stages/);

  /* ── choose one, and the button that shows its working is there ── */
  await page.locator('#cbcasespanel button', { hasText: 'A number range' }).click();
  await expect(page.locator('[data-testid="tech-try"]')).toBeVisible();

  /* the inputs are prominent and labelled, not a row of narrow boxes with placeholder-only hints */
  await expect(panel).toContainText('Lowest allowed');
  await expect(panel).toContainText('Highest allowed');
  await expect(page.locator('#tqLo')).toBeVisible();
  await expect(page.locator('#tqHi')).toBeVisible();
  await expect(page.locator('#cbcasespanel button', { hasText: 'Write the cases' })).toHaveCount(1);

  /* ⭐ AND IT STILL NAMES THE STANDARD'S OWN REASON once there are rows — the sentence a tester repeats to
     a sceptic. This used to be satisfied by the prose block; it is asserted where it actually lives now. */
  await page.locator('[data-testid="tech-try"]').click();
  await expect(panel).toContainText('Boundary value analysis');
  await expect(panel, 'the worked example is performed, not printed').toContainText('quantity');

  /**
   * ── ⭐ "TRY IT" MUST DO IT, NOT DESCRIBE IT ──────────────────────────────────────────────────────────
   * Athi: *"when I say try it, you provide the values yourself."* One press must leave finished rows on
   * screen — that is the whole difference between a definition and an example.
   */
  for (const k of ['classes', 'states', 'decision', 'guess']) {
    await page.evaluate((kk) => testTech(kk), k);
    await page.locator('[data-testid="tech-try"]').click();
    await expect(panel.locator('table'), k + ': Try it left no cases').toBeVisible({ timeout: 15000 });
    const n = await panel.locator('table tr').count();
    expect(n, k + ': Try it produced no rows').toBeGreaterThan(2);
  }
  /**
   * ── ⭐ A NEW TAB STARTS CLEAN, WHICH IS WHAT HE REPORTED TWICE ──────────────────────────────────────
   * Switching technique must leave neither the previous one's TABLE nor its BOXES. The table is kept
   * across an INPUT change on purpose, so only the technique change may clear it — both are asserted.
   */
  await page.evaluate(() => testTech('bounds'));
  await page.locator('#tqField').fill('quantity');
  await page.locator('#tqLo').fill('1');
  await page.locator('#tqHi').fill('999');
  await page.locator('#cbcasespanel button', { hasText: 'Write the cases' }).click();
  await expect(panel.locator('table')).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => testTech('states'));
  await expect(panel.locator('table'), 'the previous technique table survived the tab change')
    .toHaveCount(0);
  await expect(page.locator('#tqField'), 'the previous field survived the tab change').toHaveValue('');

  /* ⚠ back to the number range: the assertions below are about ITS boxes, and guess has none */
  await page.evaluate(() => testTech('bounds'));
  await expect(page.locator('#tqLo')).toBeVisible({ timeout: 15000 });

  /* ── ⭐ the cases come out as a TABLE, and it says what it was derived FROM ── */
  await page.locator('#tqField').fill('quantity');
  await page.locator('#tqLo').fill('1');
  await page.locator('#tqHi').fill('999');
  await page.locator('#cbcasespanel button', { hasText: 'Write the cases' }).click();
  await expect(panel.locator('table')).toBeVisible({ timeout: 15000 });
  /* ⚠️ the header names the field and the range, so the table can never be read as being about another one */
  await expect(panel).toContainText('for quantity, 1 to 999');
  /* boundary value analysis on 1..999 is eight cases: 0 1 2 998 999 1000 empty text */
  expect(await panel.locator('table tr').count(), 'eight cases and a header row').toBe(9);
  /* ⚠️ "Use" said nothing about where the row goes; the column is headed and the button says Add */
  await expect(panel).toContainText('→ Create');
  await expect(panel.locator('table button').first()).toHaveText('Add');

  /**
   * ⚠️⚠️ AND THE ROW THAT IS ADDED IS THE ROW THAT WAS CLICKED. It used to re-derive at press time, so
   * touching a box between reading and pressing inserted a different case — silently, and only sometimes.
   */
  await page.locator('#tqHi').fill('4');
  await panel.locator('table button').first().click();
  await expect(page.locator('#wcDo')).toHaveValue(/Put 0 in quantity/);
});

test('[TECH-02] the field chips are read from what the screen actually sent', async ({ page }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true, name: 'Tech2 ' + Date.now().toString().slice(-6) });

  const sw = page.locator('[data-testid="vp-test"]');
  await expect(sw).toBeVisible({ timeout: 45000 });
  if (!((await sw.textContent()) || '').includes('on')) await sw.click();
  /* ⚠ cap-testing.js is a LAZY capability: turning the mode on is not enough, the panel has to be opened or
     none of its functions exist yet. The first run of this failed on exactly that. */
  await page.locator('[data-testid="screen-cases"]').first().click();
  await expect(page.locator('#cbcasespanel')).toBeVisible({ timeout: 30000 });
  const modal = page.locator('#modalhost .modal');
  if (await modal.count()) await page.locator('#modalhost .modal button').last().click();

  /**
   * ⚠️ THE READER IS THE ASSERTION, NOT THE CHIPS. Which fields appear depends on what the screen the tester
   * happens to be standing on has posted, and a spec that demanded a particular field name would be testing
   * the fixture. What must hold is that it reads REQUEST BODIES and infers a kind from the VALUE — so this
   * feeds it a known body and checks what comes back out.
   */
  const got = await page.evaluate(() => {
    window.CBCALLS = window.CBCALLS || [];
    CBCALLS.unshift({
      key: 'probe', m: 'POST', path: '/api/probe', ms: 1, status: 200,
      scr: (typeof navScreenKey === 'function' ? navScreenKey() : null), gen: window.CBGEN || 0,
      sent: JSON.stringify({ quantity: 7, note: 'a longer sentence that is plainly free text here',
                             status: 'available', when: '2026-09-13', flag: true,
                             entity_id: 'ignore-me', secret: '[redacted]' }),
      body: null, at: Date.now(),
    });
    return testTechFields();
  });
  const by = {};
  got.forEach((f) => { by[f.key] = f.kind; });

  expect(by.quantity, 'a number was not seen as a number').toBe('number');
  expect(by.status, 'a short value was not offered for equivalence classes').toBe('short text');
  expect(by.when, 'an ISO date was not seen as a date').toBe('date');
  expect(by.flag).toBe('yes/no');
  expect(by.note, 'a sentence is text, not a class').toBe('text');
  /* ⚠️ plumbing is not a field a tester exercises — offering it buries the four that matter */
  expect(by.entity_id, 'an id was offered as a field to test').toBeUndefined();
  /* ⚠️⚠️ and a redacted value must never be shown back as a sample, having been redacted at capture */
  expect(by.secret, 'a redacted value was offered as a field').toBeUndefined();

  /* ⭐ the kind chooses the technique, and it is inferred from the VALUE — order_no would be wrong by name */
  const forKind = await page.evaluate(() => [testTechFor('number'), testTechFor('short text'),
    testTechFor('yes/no'), testTechFor('text')]);
  expect(forKind).toEqual(['bounds', 'classes', 'decision', 'guess']);
});
