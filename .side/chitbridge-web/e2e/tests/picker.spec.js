/**
 * picker.spec.js — AMBIGUITY RESOLUTION, end to end.
 *
 * Athi, 2026-08-14, after three failed attempts by hand: *"can you do a playwright test for all the flow and
 * confirm all works … I am struggling to test now."*
 *
 * ⚠️ THIS IS THE FLOW THAT FAILED TWICE THIS MORNING, and both failures were invisible from the screen: the card
 * opened on a quantity stepper with no hint that the catalogue had two answers. The first was mine (the picker sat
 * one tap too deep); the second was also mine (the overlay was queried with the whole sentence rather than the item
 * phrase, so it returned nothing). Neither showed an error. That is exactly the class of bug a human tester cannot
 * distinguish from "the feature is not built yet", which is why it belongs in a spec.
 *
 * It mints its OWN entity rather than using a real one: the test writes chits, and a proving run must not leave
 * debris in an account someone is also testing by hand. ⚠️ That sentence was written here long before it was
 * TRUE — see the describe block below. It is true now, and enforced (mintInContext throws if a session leaks).
 *
 * Watch it:  npx playwright test picker --headed --project=authed
 * Time-travel it:  npx playwright test picker --project=authed --trace on   then  npx playwright show-trace
 */
const { test, expect } = require('@playwright/test');
const { mintInContext, composeChit, clickNav, settle } = require('../fixtures');

/* One synonym on TWO different catalogue names — the exact shape of Athi's veg catalogue, and the shape that makes
   the reader refuse: it knows both, so any price would be a coin toss. */
const SYN = 'thakkali';
const ITEMS = [
  { name: 'Tomato Native', unit: 'kg', price: 30, synonyms: [SYN, 'nattu thakkali'] },
  { name: 'Tomato Hybrid', unit: 'kg', price: 36, synonyms: [SYN, 'hybrid thakkali'] },
];

/**
 * ⭐⭐ SEED ONCE, BY NAME. THIS FUNCTION IS THE FIX FOR A WHOLE DAY OF FALSE REDS.
 *
 * Every test here used to call `api('prodAdd', …)` unconditionally, and every test in the `authed` project shares
 * ONE minted account — `mintEntity` short-circuits when a session already exists. So PICK-01 seeded Tomato
 * Native + Tomato Hybrid, and then PICK-03 seeded them AGAIN into the same catalogue.
 *
 * By the time PICK-03 opened the picker, four catalogue rows answered to "thakkali". The overlay said so, plainly
 * and correctly — *"which of these 4?"* over *"answers to 2 catalogue names"* — and the app was right every time.
 * The spec was the thing that was wrong.
 *
 * ⚠️ AND IT MADE THE SUITE NON-DETERMINISTIC IN A WAY THAT LOOKED LIKE A CODE REGRESSION. Whether a run passed
 * depended on whether auth.setup had minted a FRESH entity that run or reused a stale `.auth/` state with a
 * catalogue already seeded. On 2026-08-15 that produced "clean tree passes, my branch fails" across five runs and
 * a four-configuration bisect, all of it noise: the branch was never involved.
 *
 * Two lessons worth keeping:
 *   · a shared account plus non-idempotent seeding is a time bomb, and it goes off as somebody else's bug;
 *   · "it passes on main and fails on my branch" is evidence about the RUNS, not about the branch.
 */
async function seedProducts(page, items) {
  return page.evaluate(async (want) => {
    const have = (await api('prodList')) || [];
    const names = new Set(have.map((p) => String(((p.item_data || p).name || '')).toLowerCase()));
    const added = [];
    for (const it of want) {
      if (names.has(String(it.name).toLowerCase())) continue;   // already there — adding it again is the bug
      added.push(await api('prodAdd', { body: { item_data: it } }));
    }
    return { existing: have.length, added: added.length };
  }, items);
}

/**
 * ⭐⭐ THE ISOLATION, AND WHY THE HEADER COMMENT WAS A LIE (backlog 1 — "blocking a push").
 *
 * The comment at the top of this file said *"It mints its OWN entity rather than using a real one"*. It did not.
 * `mintEntity(page)` **short-circuits and returns `{existing:true}` whenever a session already exists**, and in
 * the `authed` project a saved session ALWAYS exists — so this spec silently inherited whatever entity ran
 * before it. Playwright orders spec files alphabetically, so when `chits.spec` was rewritten it began running
 * first, and `picker.spec` started failing. Nothing about the picker had changed.
 *
 * ⚠️ THE DOCUMENTED ISOLATION NEVER HAPPENED, WHICH IS WORSE THAN HAVING NONE. A file that says it is isolated
 * is a file nobody re-checks, so every later failure gets attributed to the code under test. This one cost a
 * four-configuration bisect and presented, twice, as *"clean tree passes, my branch fails"*.
 *
 * `mintInContext` is the fix and it already existed — a context with `storageState: undefined`, which forces a
 * real mint, and which THROWS rather than proceeding if a session leaks in. Adopt, don't reinvent.
 *
 * ⚠️ Serial, and one context for the FILE: the three tests share a seeded catalogue on purpose (seedProducts is
 * idempotent by name), and the point here is isolation from OTHER SPECS, not from each other.
 */
test.describe.serial('PICKER — two catalogue items answer to one name', () => {
  test.setTimeout(180_000);

  let CTX = null, PAGE = null;
  test.beforeAll(async ({ browser }) => {
    const who = await mintInContext(browser);
    CTX = who.context; PAGE = who.page;
  });
  test.afterAll(async () => { if (CTX) await CTX.close().catch(() => {}); });
  /* ⚠️ The page outlives each test, so its listeners do too. Without this, test 2 inherits test 1's `pageerror`
     handler pushing into an array test 1 has already asserted on — a leak that only shows up as a confusing
     error attributed to the wrong test. */
  test.afterEach(async () => {
    if (!PAGE) return;
    PAGE.removeAllListeners('pageerror');
    PAGE.removeAllListeners('console');
    PAGE.removeAllListeners('response');
  });

  test('PICK-01 · an ambiguous line offers both items with prices, and picking one prices the line', async () => {
    const page = PAGE;
    const timings = {};
    const mark = async (label, fn) => { const t = Date.now(); const r = await fn(); timings[label] = Date.now() - t; return r; };


    /* DIAGNOSTIC: what the browser actually asks the catalogue, and what it gets back. Two failures this
       morning were invisible because nobody could see this exchange. */
    const overlayCalls = [];
    /* ⚠️ A THROWN ERROR INSIDE amendLine WOULD BE COMPLETELY SILENT from the outside — the modal simply never
       opens, which is indistinguishable from "the feature is not built". Catching pageerror is the difference
       between debugging and guessing. */
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));
    page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()); });
    const amendCalls = [];
    page.on('response', async (r) => { if (/\/amend/.test(r.url())) {
      let b = null; try { b = await r.json(); } catch (e) {}
      amendCalls.push({ status: r.status(), body: JSON.stringify(b).slice(0, 300) });
    }});
    page.on("response", async (r) => { if (/catalogue-overlay/.test(r.url())) {
      let b = null; try { b = await r.json(); } catch (e) {}
      overlayCalls.push({ url: r.url(), status: r.status(),
        ambiguous: b && b.ambiguous, candidates: b && (b.candidates||[]).length, items: b && (b.items||[]).length });
    }});

    // ── setup · two products that share a synonym ───────────────────────────────────────────────────────────────
    // Through the app's own api() so the session and the entity context are the real ones, not a fabricated token.
    /* ⚠️ NOT `expect(made).toBe(2)` any more. Seeding is idempotent now, so on a reused account the correct
       result is 0 added — asserting that two were CREATED would fail on exactly the runs the helper fixes. What
       matters is that both exist afterwards, which the shortlist assertions below prove far better. */
    await seedProducts(page, ITEMS);

    // ── the line · raised with the AMBIGUOUS word, exactly as a customer would write it ──────────────────────────
    const subject = 'Picker ' + Date.now();
    await mark('compose+send', () => composeChit(page, { subject, item: SYN, qty: 3, self: true }));

    await clickNav(page, 'task');
    await settle(page);
    await mark('open chit', async () => {
      await page.getByText(subject).first().click();
      await page.waitForResponse((r) => /\/api\/chits\//.test(r.url()) && r.request().method() === 'GET', { timeout: 30000 }).catch(() => null);
      await settle(page);
    });

    // ── ⭐ THE ASSERTION THAT FAILED BY HAND TWICE ──────────────────────────────────────────────────────────────
    const pencil = page.getByTestId('amend-line').first();
    await expect(pencil, 'the ✎ must exist on the line — it did not exist at all in Design 2 until 13 Aug').toBeVisible();
    await mark('open picker', async () => {
      await pencil.click();
      /* The card fetches the catalogue before it can know there is a choice, so the picker appears asynchronously.
         Waiting on the OVERLAY response rather than a timeout is what makes this stable on a cold API. */
      await page.waitForResponse((r) => /catalogue-overlay/.test(r.url()), { timeout: 30000 }).catch(() => null);
    });

    const state = await page.evaluate(() => ({
      hasAmendLine: typeof amendLine,
      hasAmdOpen: typeof amdOpen,
      detailItems: (typeof UI !== 'undefined' && UI.detail && UI.detail.items || []).length,
      sel: (typeof UI !== 'undefined') ? UI.sel : null,
      amd: (typeof AMD !== 'undefined') ? { idx: AMD.idx, view: AMD.view, chit: AMD.chit, cat: !!AMD.cat } : 'no AMD',
      lineId: (typeof AMD !== 'undefined') ? AMD.lineId : 'n/a',
      codeHasLineIdFix: (typeof amdOpen === 'function') && /AMD.lineId/.test(amdOpen.toString()),
      modalOpen: !!document.querySelector('.mbody, .mhd, [data-testid="amd-save"]'),
    }));
    console.log('\n  OVERLAY CALLS: ' + JSON.stringify(overlayCalls));
    console.log('  PAGE ERRORS  : ' + JSON.stringify(pageErrors));
    console.log('  STATE        : ' + JSON.stringify(state) + '\n');
    /* ⭐ ONE OVERLAY: the choices, the quantity, the price and Remove are all on the SAME card now. */
    const picker = page.getByTestId('amd-cand').first();
    await expect(picker, 'the choices must be ON the card, not behind a tap').toBeVisible({ timeout: 15000 });

    const cands = page.getByTestId('amd-cand');
    await expect(cands, 'both catalogue items must be offered — a shortlist of one is not a choice').toHaveCount(2);

    /**
     * ⚠️ EACH ITEM BY NAME, NOT BY POSITION. These two rows TIE — both catalogue names carry the synonym
     * "thakkali", which is the entire point of the fixture — so the server has nothing to break the tie with and
     * the order it returns them in is not guaranteed. Asserting `first()` contains "30" therefore passes or
     * fails on luck: on 2026-08-15 it came back "Tomato Hybrid · INR 36" and reported a cart change as the cause.
     *
     * Row-by-name is also a STRONGER assertion than the pair it replaces: it says each named item shows ITS OWN
     * price on ITS OWN row, where `first()/nth(1)` only said the two prices appeared in some order, and the two
     * `body` assertions only said the names appeared somewhere on the page.
     */
    const native = cands.filter({ hasText: 'Tomato Native' });
    const hybrid = cands.filter({ hasText: 'Tomato Hybrid' });
    await expect(native, 'Tomato Native must be offered by name').toHaveCount(1);
    await expect(hybrid, 'Tomato Hybrid must be offered by name').toHaveCount(1);
    /* ⚠️ THE PRICE MUST BE ON THE ROW. The only reason the reader refused was that the prices differ; a picker that
       hides them lets someone resolve the ambiguity wrongly and never notice. */
    await expect(native, "the ₹30 item's price must be on the ₹30 item's row").toContainText('30');
    await expect(hybrid, "the ₹36 item's price must be on the ₹36 item's row").toContainText('36');

    // ── pick the HYBRID by name — the one every assertion below is about, and not whichever came back second ────
    await hybrid.click();
    await settle(page);

    const save = page.getByTestId('amd-save');
    await expect(save, 'picking returns to the card so one save covers the item AND the quantity').toBeVisible();
    await mark('save', async () => {
      const amended = page.waitForResponse((r) => /\/amend/.test(r.url()) && r.request().method() === 'POST', { timeout: 30000 }).catch(() => null);
      await save.click();
      await amended;
      await settle(page);
    });

    // ── the line now carries the catalogue's name and price ────────────────────────────────────────────────────
    /* ⚠️ DIAGNOSTICS BEFORE ASSERTIONS. They were after, so the first failing assertion aborted the test before
       anything printed — three runs produced a red with no evidence in it. A log that only appears when the test
       passes is not a diagnostic. */
    const sel = await page.evaluate(() => (typeof UI !== 'undefined') ? UI.sel : null);
    const after = await page.evaluate(() => ({
      nav: (typeof UI !== 'undefined') ? UI.nav : null,
      sel: (typeof UI !== 'undefined') ? UI.sel : null,
      modalOpen: !!document.querySelector('[data-testid="amd-save"]'),
      bodyHas: /Tomato Hybrid/.test(document.body.innerText || ''),
      snippet: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 240),
    }));
    console.log('\n  AMEND CALLS : ' + JSON.stringify(amendCalls));
    console.log('  AFTER SAVE  : ' + JSON.stringify(after));
    console.log('  PAGE ERRORS : ' + JSON.stringify(pageErrors) + '\n');

    /**
     * ⚠️ SAVING RETURNS YOU TO THE LIST, NOT THE CHIT. `UI.nav` comes back as 'task' with the detail closed, so the
     * corrected line is not on screen at all — which is why this assertion failed three times while the amendment
     * itself was landing perfectly (200, price 36, total 108, ref stamped).
     *
     * Recorded as a product observation, not fixed here: after correcting one line of a twelve-line order you are
     * put back at the top of the list and have to find the chit again. Athi has not raised it, so it stays his
     * call — but it is the kind of thing that makes a person stop correcting lines.
     */
    /**
     * ⭐ ASSERT ON WHAT WAS STORED, NOT ON WHAT THE PAGE HAPPENS TO SHOW. Three runs failed here while the
     * amendment was landing perfectly — because after saving the app returns to the list and the corrected line is
     * simply not on screen. Chasing that with re-open clicks tests the navigation, not the correction.
     */
    const live = await page.evaluate(async (id) => {
      const d = await api('chit', { params: { id } });
      const e = (d.live_set || [])[0] || {};
      const l = e.live || e.original || {};
      return { particulars: l.particulars, price: l.price, quantity: l.quantity, ref: l.ref || null };
    }, sel);
    console.log('  STORED LINE : ' + JSON.stringify(live) + '\n');

    expect(String(live.particulars), 'the chosen item name must replace the ambiguous word').toContain('Tomato Hybrid');
    expect(Number(live.price), "the chosen item's price must land on the line").toBe(36);
    expect(Number(live.quantity), 'the quantity the customer asked for must survive the correction').toBe(3);
    /* ⭐ b146 through the UI: the line knows WHICH catalogue row it came from and WHAT that row said at the time. */
    expect(live.ref, 'a human pick must leave a catalogue reference').toBeTruthy();
    expect(live.ref.how, 'a person chose this — not a machine guess').toBe('human');
    expect(live.ref.item_id, 'the reference must name the catalogue row').toBeTruthy();
    expect(live.ref.hash, 'and what that row said at the moment it was chosen').toBeTruthy();

    console.log('\n  ⏱  timings (ms): ' + JSON.stringify(timings, null, 0) + '\n');
    /* Not an assertion — a report. Athi: "my click takes time and it is taking time to load each screen." A number
       in the run beats an impression, and a threshold guessed today would just fail on a cold Railway container. */
  });

  /**
   * ⭐ PICK-03 · THE WHOLE LIFECYCLE IN ONE RUN — resolve, correct, remove.
   *
   * Athi, 2026-08-14: *"extend the spec to cover amend quantity and remove … cover all the screen please."*
   *
   * Each step asserts on what was STORED, not on what the page happens to render — after a save the app returns to
   * the list, so screen assertions test the navigation rather than the correction. That distinction cost three
   * red runs this morning.
   */
  test('PICK-03 · resolve the item, correct the quantity, then remove the line', async () => {
    const page = PAGE;
    const stored = async (id) => page.evaluate(async (cid) => {
      const d = await api('chit', { params: { id: cid } });
      const e = (d.live_set || [])[0] || {};
      const l = e.live || e.original || {};
      return { particulars: l.particulars, price: l.price, quantity: l.quantity,
               removed: !!e.removed, reason: e.reason_code || null, versions: e.versions || 0 };
    }, id);

    await seedProducts(page, ITEMS);

    const subject = 'Lifecycle ' + Date.now();
    await composeChit(page, { subject, item: SYN, qty: 3, self: true });
    await clickNav(page, 'task');
    await settle(page);
    await page.getByText(subject).first().click();
    await settle(page);
    const sel = await page.evaluate(() => UI.sel);

    // ── 1 · RESOLVE the ambiguity ───────────────────────────────────────────────────────────────────────────────
    await page.getByTestId('amend-line').first().click();
    await page.waitForResponse((r) => /catalogue-overlay/.test(r.url()), { timeout: 30000 }).catch(() => null);
    await expect(page.getByTestId('amd-cand').first(), 'the choices render INSIDE the one card now').toBeVisible({ timeout: 15000 });
    /**
     * ⚠️⚠️ WAIT FOR THE OVERLAY TO SETTLE TO TWO. THIS LINE IS THE WHOLE BUG.
     *
     * The card paints TWICE: once from the line's own shortlist, then again when the catalogue-overlay response
     * lands. For a moment BOTH are in the DOM and there are FOUR `amd-cand` rows, not two — the bisect artifact
     * named them exactly: "resolved to 2 elements … nth(1) … nth(3)".
     *
     * Clicking during that window is what made this test unreliable, in two different disguises:
     *   · with `nth(1)` it clicked the STALE card's second row, so the save stored the wrong item and the failure
     *     read `Expected substring: "Tomato Hybrid"` — which looks like the app choosing wrongly;
     *   · with a by-name filter it matched the same item in BOTH cards and died on strict mode.
     * One cause, two symptoms, and I chased the second one as though it were a new bug.
     *
     * PICK-01 never had this problem for a reason worth copying rather than admiring: it asserts
     * `toHaveCount(2)` before it touches anything, which waits the second paint out. Same here.
     *
     * ⭐ AND IT IS A REAL ASSERTION, not a sleep: a card that settles to anything other than two candidates for
     * a two-item ambiguity is a genuine defect, and this will now say so.
     */
    const cands03 = page.getByTestId('amd-cand');
    await expect(cands03, 'the card must settle to exactly the two ambiguous items').toHaveCount(2);
    await cands03.filter({ hasText: 'Tomato Hybrid' }).click();
    await settle(page);
    await page.getByTestId('amd-save').click();
    await page.waitForResponse((r) => /\/amend/.test(r.url()) && r.request().method() === 'POST').catch(() => null);
    await settle(page);

    let s = await stored(sel);
    expect(s.particulars, 'the ambiguity is resolved to the chosen item').toContain('Tomato Hybrid');
    expect(Number(s.price), 'and priced from the catalogue').toBe(36);
    console.log('  1 · resolved  -> ' + JSON.stringify(s));

    // ── 2 · CORRECT THE QUANTITY — the commonest correction of all ───────────────────────────────────────────────
    await page.getByText(subject).first().click();
    await settle(page);
    await page.getByTestId('amend-line').first().click();
    await page.waitForResponse((r) => /catalogue-overlay/.test(r.url()), { timeout: 30000 }).catch(() => null);
    await settle(page);
    /* ⚠️ THE CARD MUST NOT OPEN ON THE PICKER NOW. The line is resolved, so re-opening ✎ to fix a number must not
       drag someone back through a choice they already made — the exact regression the `!AMD.picked` guard exists
       to prevent, and the only way to catch it is to amend the same line twice. */
    await expect(page.getByTestId('amd-cand'), 'a resolved line shows no choices — the question is answered').toHaveCount(0);
    const qty = page.locator('input[inputmode="decimal"]').first();
    await qty.fill('5');
    await page.getByTestId('amd-save').click();
    await page.waitForResponse((r) => /\/amend/.test(r.url()) && r.request().method() === 'POST').catch(() => null);
    await settle(page);

    s = await stored(sel);
    expect(Number(s.quantity), 'the corrected quantity is stored').toBe(5);
    expect(s.particulars, 'and the resolved item survives a second correction').toContain('Tomato Hybrid');
    console.log('  2 · qty 3→5   -> ' + JSON.stringify(s));

    // ── 3 · REMOVE the line, with a reason ──────────────────────────────────────────────────────────────────────
    await page.getByText(subject).first().click();
    await settle(page);
    await page.getByTestId('amend-line').first().click();
    await page.waitForResponse((r) => /catalogue-overlay/.test(r.url()), { timeout: 30000 }).catch(() => null);
    await settle(page);
    await page.getByTestId('amd-remove').click();          // 🗑 → the reason sheet
    await settle(page);
    /* ⚠️ REMOVING ASKS WHY, and it is not bookkeeping: "they never asked for this" and "not available" produce an
       identical empty line and mean opposite things — the second leaves a customer expecting a delivery. */
    await page.getByText(/not available/i).first().click();
    await page.waitForResponse((r) => /\/amend/.test(r.url()) && r.request().method() === 'POST').catch(() => null);
    await settle(page);

    s = await stored(sel);
    expect(s.removed, 'the line is removed').toBe(true);
    expect(s.reason, 'and the reason is on the record — not just the fact of removal').toBe('stock_unavailable');
    console.log('  3 · removed   -> ' + JSON.stringify(s));

    /* ⚠️ REMOVED IS NOT DELETED. It must still be ON the chit, struck through, counting in nothing — deleting it
       would make the chit disagree with the message it came from. */
    await page.getByText(subject).first().click();
    await settle(page);
    /* ⚠️ IT SHOWS THE ORIGINAL WORDS, NOT THE RESOLVED NAME — and that is right, though it caught me out. Once a
       line is removed there is no live version, so the row falls back to what the customer actually wrote. The
       point of keeping it on screen is evidence of the request, and "thakkali" is the evidence; "Tomato Hybrid"
       was our interpretation of it. */
    await expect(page.locator('body'), 'a removed line stays visible as evidence it was asked for')
      .toContainText('thakkali');
    await expect(page.locator('body'), 'and says WHY — "not available" and "never asked for" mean opposite things')
      .toContainText(/not available/i);
  });

  test('PICK-02 · a line the catalogue answers unambiguously does NOT open a picker', async () => {
    const page = PAGE;
    /* ⚠️ THE NEGATIVE CASE, AND IT IS NOT PADDING. If the card opened on a picker for every line, PICK-01 would
       pass while the feature was wrong in the more common direction — asking a person to choose when there is
       nothing to choose between is worse than not asking, because it trains them to click through it. */
    /* Same helper — a second Carrot Ooty would make "one obvious match" into two, which is the case this test
       exists to prove does NOT happen. */
    await seedProducts(page, [{ name: 'Carrot Ooty', unit: 'kg', price: 55, synonyms: ['ooty carrot'] }]);

    const subject = 'Unambiguous ' + Date.now();
    await composeChit(page, { subject, item: 'ooty carrot', qty: 2, self: true });
    await clickNav(page, 'task');
    await settle(page);
    await page.getByText(subject).first().click();
    await settle(page);

    await page.getByTestId('amend-line').first().click();
    await page.waitForResponse((r) => /catalogue-overlay/.test(r.url()), { timeout: 30000 }).catch(() => null);
    await settle(page);

    await expect(page.getByTestId('amd-cand'),
      'one catalogue answer means no question — no choices on the card').toHaveCount(0);
    await expect(page.getByTestId('amd-save'), 'the ordinary correction card is what should appear').toBeVisible();
  });
});
