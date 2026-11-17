// standards.spec.js — the Standards page (/standards.html: the matrix, the list, the two sheets) and Settings › Standards (what YOU follow, and the door).
// CARD  21-compliance-attestation-and-trade/commerce-standards-and-standards-page
//
// 2026-10-03: the register moved off Settings onto its own page (docs/design/standards-page). The offline proof of the page is e2e/standards-page.cjs;
// this spec keeps the live-app checks — the register as the app loads it, Settings' live reading of your own settings, the Legend — and reads the page
// where it used to read Settings' tabs.
//
// ⚠️⚠️ THE STATUS COLUMN IS WHAT THIS SPEC PROTECTS. A standards page is the page someone quotes to a buyer, so
// an overstatement here does more harm than a gap. Every row declares live / part / plan, and anything not in
// force must say what is missing. A future edit that promoted a row to "In force" without shipping the work
// would look like progress in a diff and be a false claim in production — these tests are what would notice.

const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');

const open = async (page) => {
  await page.evaluate(() => window.navTo('settings'));
  await page.waitForTimeout(1200);
  await page.evaluate(() => setSetSec('standards'));
  /**
   * ⚠️ WAIT FOR THE REGISTER, NOT FOR A CLOCK. STANDARDS lives in cap-standards.js — its own lazily-loaded
   * capability, shared with the Legend — so the section paints "Loading the register…" first and fills in when
   * the script lands. A fixed 700ms held when this suite ran alone and failed under batch load, which is the
   * least useful kind of failure: it looks like the register is empty when it has simply not arrived.
   */
  await page.waitForFunction(() => Array.isArray(window.STANDARDS) && window.STANDARDS.length > 0,
    null, { timeout: 30_000 });
  await page.waitForTimeout(300);
};

/* the Standards page itself, as the deployed site serves it (a plain page: the register is read from cap-standards.js, no sign-in needed) */
const openPage = async (page) => {
  await page.goto('/standards.html');
  await page.waitForSelector('[data-testid="std-matrix"] .mx', { timeout: 30_000 });
};

test.describe('Settings › Standards', () => {
  test.describe.configure({ timeout: 240_000 });

  test('[STD-01] the section keeps what YOU follow, and is the door to the Standards page', async ({ page }) => {
    await mintEntity(page);
    await open(page);
    await expect(page.getByTestId('std-yours'), 'your own settings, read live').toBeVisible();
    await expect(page.getByTestId('std-open-page'), 'the door to /standards.html').toHaveAttribute('href', '/standards.html');
    /* the old tabs are gone: the register is not listed a second time here */
    await expect(page.getByTestId('std-tab-platform')).toHaveCount(0);
  });

  test('[STD-02] ⚠️ every standard declares a status, and nothing unfinished claims otherwise', async ({ page }) => {
    await mintEntity(page);
    /* ⚠️ OPEN THE SECTION FIRST. cap-admin.js is a LAZILY-LOADED capability — nothing in it exists on `window`
       until something navigates to Settings and ensureCap() fetches it. Reading STANDARDS before that returned
       an empty list, which read exactly like "the register is empty" and is really "the file is not here yet". */
    await open(page);
    const rows = await page.evaluate(() => (window.STANDARDS || []).map((s) => ({ n: s.n, s: s.s, note: s.note || '' })));
    expect(rows.length, 'the register is populated').toBeGreaterThan(15);

    for (const r of rows) {
      expect(['live', 'part', 'plan'], r.n + ' declares a known status').toContain(r.s);
      /* ⚠️ THE RULE THAT KEEPS THIS PAGE HONEST. "Partly" without saying what is missing is indistinguishable
         from "done" to anyone reading quickly — which is exactly the reader this page is written for. */
      if (r.s === 'part') {
        expect(r.note.length, r.n + ' is partial, so it must say what is missing').toBeGreaterThan(15);
      }
    }
  });

  test('[STD-03] the page counts them honestly rather than showing ticks', async ({ page }) => {
    await openPage(page);
    const real = await page.evaluate(() => { const n = { live: 0, part: 0, plan: 0 }; STANDARDS.forEach((x) => { n[x.s]++; }); return n; });
    /* the matrix's All row says each count once, and it is the register's own */
    for (const st of ['live', 'part', 'plan']) {
      await expect(page.getByTestId('std-cell-*-' + st), st + ' count is stated').toHaveText(String(real[st]));
    }
    /* The standards themselves — a page that named none of them would pass every structural check above. */
    const names = await page.evaluate(() => STANDARDS.map((x) => x.n).join('|'));
    for (const std of ['BCP 47', 'RFC 4647', 'Okabe', 'WCAG 2.2', 'RFC 7386', 'PostgreSQL RLS']) {
      expect(names, std + ' is named').toContain(std);
    }
    /* ⚠️ The RLS row must keep naming the carve-out. "Tenant isolation enforced by the database" alone would be
       true of the six direct tables and misleading about identities, which deliberately has no policy. It is in the row's opened note. */
    await page.getByTestId('listctl-search-standards').fill('PostgreSQL RLS');
    await page.getByTestId('std-row-' + (await page.evaluate(() => STANDARDS.findIndex((x) => x.n === 'PostgreSQL RLS')))).click();
    expect(await page.locator('[data-testid^="std-detail-"]').first().textContent(), 'the RLS carve-out is disclosed, not glossed').toMatch(/carve-out/i);
  });

  test('[STD-04] ⭐ "what you follow" is a LIVE reading, not a stored copy', async ({ page }) => {
    await mintEntity(page);
    try {
      await page.evaluate(() => { window.CBLocale.setRegion('AE'); window.CBLocale.setLangs(['ar', 'en']); });
      await open(page);
      let body = await page.locator('#setbody').textContent();
      expect(body, 'Arabic first means right-to-left').toMatch(/Right to left/i);

      /* Flip the order — same region, same two languages, opposite reading order. This is the assertion that
         proves direction follows the LANGUAGE rather than the region, from the UI rather than from a unit test. */
      await page.evaluate(() => window.CBLocale.setLangs(['en', 'ar']));
      await open(page);
      body = await page.locator('#setbody').textContent();
      expect(body, 'English first means left-to-right, in the SAME region').toMatch(/Left to right/i);
    } finally {
      await page.evaluate(() => {
        ['cb_region', 'cb_langs', 'cb_lang', 'cb_locale'].forEach((k) => { try { localStorage.removeItem(k); } catch (_) {} });
        try { window.CBLocale.apply(); window.api('savePrefs', { params: { kind: 'locale' }, body: {} }).catch(() => {}); } catch (_) {}
      });
    }
  });

  test('[STD-05] the page separates carried from enforced', async ({ page }) => {
    await openPage(page);
    await page.getByTestId('listctl-search-standards').fill('Incoterms');
    const row = page.locator('[data-testid^="std-row-"]').first();
    const body = await row.textContent();
    expect(body, 'Incoterms is named').toContain('Incoterms');
    /* ⚠️ The distinction a buyer would care about most, and the one easiest to blur. An Incoterm on a chit
       records what was agreed; it does not check the shipment against it. Saying so IN THE ROW is the difference
       between a standards page and a claim. */
    expect(body, 'and the gap is stated in the row rather than left for a dispute').toMatch(/Missing:.*not checked against the shipment/i);
  });
});

test.describe('Standards · where they bite, and why we bother', () => {
  test.describe.configure({ timeout: 240_000 });

  test('[STD-06] ⭐ every standard says WHERE it is used and WHAT it removes', async ({ page }) => {
    await mintEntity(page);
    await open(page);
    const rows = await page.evaluate(() => (window.STANDARDS || []).map((s) => ({ n: s.n, at: s.at || '', why: s.why || '' })));
    expect(rows.length).toBeGreaterThan(15);
    for (const r of rows) {
      /* ⚠️ A standard named without a place is trivia. "GS1 — SKU identity" tells a reader nothing they can act
         on; "used in Catalogue › product identity, because the three-way match needs both sides to agree this is
         the same product" is the difference between a compliance list and an explanation. */
      /* ⚠️ A LENGTH HEURISTIC IS A PROXY, AND THIS ONE MISJUDGED A CORRECT ANSWER. "IAM" is three characters
         and is exactly where ISO/IEC 24760 is used — the shortest true answer on the page. The rule I actually
         want is "not empty and not a dash", so that is what it now checks. A test that forces padding to pass
         teaches people to pad. */
      expect(r.at.trim(), r.n + ' says where it is used').not.toBe('');
      expect(r.at.trim(), r.n + ' names a place, not a dash').not.toMatch(/^[—–-]$/);
      expect(r.why.length, r.n + ' says what failure it removes').toBeGreaterThan(25);
    }
  });

  test('[STD-07] ⚠️ the argument states its COSTS, not only its benefits', async ({ page }) => {
    await openPage(page);
    await page.getByTestId('std-open-why').click();
    const body = await page.getByTestId('std-sheet-why').textContent();

    expect(body, 'the structural reason, not "quality"').toMatch(/crosses a boundary/i);
    /* ⚠️ A page listing only benefits would be the same overclaim the status column exists to prevent, one level
       up. If a later edit trimmed the costs to make the page read better, this is what would catch it. */
    expect(body, 'costs are stated').toMatch(/What it costs/i);
    expect(body, 'including the obligation a claim creates').toMatch(/broken promise/i);
    /* Evidence from this codebase rather than assertions — the part that turns an opinion into a case. */
    expect(body, 'and what it has actually caught here').toMatch(/117 real failures/);
  });

  test('[STD-08] governance links to where the choice is made, rather than swallowing it', async ({ page }) => {
    await mintEntity(page);
    await page.evaluate(() => window.navTo('settings'));
    await page.waitForTimeout(1200);
    await page.getByTestId('set-sec-governance').click();
    await page.waitForTimeout(800);
    /* ⚠️ Governance sets the ENVELOPE; Settings picks a point inside it. Merging them would bury a weekly
       control inside a screen visited twice a year — so the two are linked instead, and these are the links. */
    for (const id of ['gov-to-locale', 'gov-to-appearance', 'gov-to-standards']) {
      await expect(page.getByTestId(id).first(), id).toBeVisible();
    }
  });
});


/**
 * ⚠️ openLegend() TOGGLES — calling it while the lightbox is open CLOSES it, so a test that assumed "open"
 * could silently be asserting against a closed overlay. Force it open, then POLL for the content rather than
 * sleeping: the Standards register is a lazily-loaded capability and a fixed wait is a timing assumption that
 * holds alone and fails under batch load, which is exactly how this first failed.
 */
const openStdLegend = async (page) => {
  await page.evaluate(() => {
    /* ⚠️ BARE `_legendOpen`, not `window._legendOpen` — it is a top-level `let`, so it never lands on
       window. My own version of this helper read it off window, got undefined, and therefore never closed a
       stale lightbox: it just called openLegend(), which TOGGLES. Guard 16 caught it the same hour. */
    if (typeof closeLegend === 'function' && _legendOpen) closeLegend();
    if (typeof openLegend === 'function') openLegend();
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.setLbTab && window.setLbTab('std'));
  await page.waitForFunction(
    () => { const h = document.getElementById('lbhost'); return !!h && /crosses a boundary/i.test(h.textContent || ''); },
    null, { timeout: 30_000 }
  );
};

test.describe('Standards in the Legend', () => {
  test.describe.configure({ timeout: 240_000 });

  test('[STD-09] ⭐ the Legend carries the same argument, from the same renderer', async ({ page }) => {
    await mintEntity(page);
    await openStdLegend(page);
    const body = await page.locator('#lbhost').textContent();

    expect(body, 'the structural claim, word for word').toMatch(/crosses a boundary/i);
    /* ⚠️ THE COSTS MUST TRAVEL TOO. The Legend is where this is used to PERSUADE, which is exactly the surface
       where a benefits-only version would be tempting — and exactly where it would do most damage. */
    expect(body, 'the costs travel with the benefits').toMatch(/What it costs/i);
    expect(body, 'and the evidence from this codebase').toMatch(/117 real failures/);
  });

  test('[STD-10] the Legend counts are LIVE, not a sentence someone typed', async ({ page }) => {
    await mintEntity(page);
    await openStdLegend(page);
    const shown = await page.locator('#lbhost').textContent();
    const real = await page.evaluate(() => {
      const n = { live: 0, part: 0, plan: 0 };
      (window.STANDARDS || []).forEach((x) => { n[x.s]++; });
      return n;
    });
    /* A Legend claiming "26 standards" that had drifted from the register would be the overclaim this whole
       area exists to prevent — on the one surface where it is being used to persuade. */
    expect(real.live, 'the register is loaded').toBeGreaterThan(5);
    expect(shown, 'the in-force count matches the register').toContain(real.live + ' in force');
    expect(shown, 'and so does the partial count').toContain(real.part + ' partly');
  });
});

test.describe('Standards · made visible', () => {
  test.describe.configure({ timeout: 240_000 });

  test('[STD-11] ⭐ every claimed standard shows a worked value, and the unbuilt ones show none', async ({ page }) => {
    await mintEntity(page);
    await open(page);
    const rows = await page.evaluate(() => (window.STANDARDS || []).map((s) => ({ n: s.n, s: s.s, ex: s.ex || '', exWhy: s.exWhy || '' })));
    for (const r of rows) {
      if (r.s === 'live' || r.s === 'part') {
        /* ⚠️ "We follow GS1" is a claim a reader must take on trust. "08901234567894 — the last digit is
           computed from the other thirteen, so a typo is detectable" is one they can see working, and it
           survives being forwarded to a sceptical colleague. Anything we CLAIM must be demonstrable. */
        if (r.n.includes('full audit')) continue;         // the one live-ish row with nothing honest to show
        expect(r.ex.length, r.n + ' shows a worked value').toBeGreaterThan(2);
        expect(r.ex, r.n + ' shows a real value, not a dash').not.toBe('—');
        expect(r.exWhy.length, r.n + ' says what another system does with it').toBeGreaterThan(25);
      }
    }
  });

  test('[STD-12] ⚠️ the sample record marks what is NOT built rather than omitting it', async ({ page }) => {
    await openPage(page);
    await page.getByTestId('std-open-record').click();
    const body = await page.getByTestId('std-sheet-record').textContent();
    expect(body, 'the worked record is shown').toMatch(/One chit, every standard in it/i);
    expect(body, 'a real HS code').toContain('0904.11');
    expect(body, 'a real GTIN').toContain('08901234567894');
    /* ⚠️⚠️ THE ASSERTION THAT KEEPS THE DEMONSTRATION HONEST. A sample record showing ISO 6523 working today —
       when it is only decided — would be the exact overclaim the status column exists to prevent, dressed up as
       a demonstration. And a reader who spots one invented field stops believing the other twenty-five. */
    expect(body, 'planned fields are labelled planned, not quietly shown as working').toMatch(/ISO 6523 · planned/i);
    expect(body, 'and the reader is told greyed means not built').toMatch(/not built yet/i);
    /* The one field that must never carry a standard at all. */
    expect(body, 'the product name is marked as never translated').toMatch(/never translated/i);
  });
});
