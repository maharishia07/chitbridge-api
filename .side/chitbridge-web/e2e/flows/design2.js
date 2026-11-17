'use strict';
/* ── e2e/flows/design2.js — THE DESIGN 2 DRIVER ────────────────────────────────────────────────────────────────
 *
 * Athi, 2026-08-23: *"create a playwright script and complete the transaction, I am wasting my time here… this
 * has to clearly navigate through design 2 and keep it as a module so we should be able to plug in anywhere."*
 *
 * ⭐⭐ SO THIS IS A MODULE, NOT A TEST. It holds no assertions about a particular job, knows nothing about car
 * servicing, and imports no spec. It knows one thing: **how design 2 is operated** — which side, which tab,
 * where the material picker is, what the Take button does. A spec supplies the job; this supplies the hands.
 *
 * The reason it is worth separating: design 2 is *seven panes behind two switches*, and the walk to any one of
 * them (side → tab → row → control) is the part that breaks when the screen moves. Written out inside a spec,
 * that walk gets copied into the next spec and the two drift. Written here, a screen change is one edit.
 *
 *   const d2 = design2(page);
 *   await d2.open('Complaint 4471');          // design 1 → ⧉ Lines → design 2
 *   await d2.assign({ line: 'Engine', who: 'Arun', task: 'diagnose', due: '2026-08-30' });
 *   await d2.takeMaterial({ line: 'Engine', item: 'Oil filter', qty: 2 });   // ← from the catalogue, priced
 *   await d2.deliver({ line: 'Engine', qty: 1 });
 *   const money = await d2.money();           // { invoiced, recorded, accrued, lines[] }
 *
 * ── ⚠️ TWO RULES IT FOLLOWS THROUGHOUT, BOTH LEARNED THE HARD WAY ─────────────────────────────────────────────
 *
 * 1. **It waits on the WRITE, never on a repaint.** Every recording method waits for the actual POST to answer
 *    before returning. Waiting for text to appear instead would pass on a screen that painted an optimistic
 *    value the server later rejected — which is the one failure a driver exists to catch. (And design 2 now
 *    applies the server's own response rather than re-reading the chit, so the response IS the new state.)
 *
 * 2. **It reads by data-testid, never by CSS shape.** The panes are inline-styled divs; a padding change would
 *    otherwise break the driver. Where the app had no hook, one was added to `cap-chit2.js` rather than
 *    reaching through the styling — a driver that depends on the look is a driver that fails on a redesign.
 *
 * ⚠️ `open()` deliberately goes through DESIGN 1's "⧉ Lines" button rather than calling `openChit2()` in the
 * page. That button IS the only door a person has; calling the function directly would keep passing on the day
 * the door disappears — which is exactly the class of bug (a shipped feature nothing calls) already found in
 * this codebase with `openServiceClock`.
 */
const { expect } = require('@playwright/test');

/** '₹1,234.50' → 1234.5 · '—' → null. Any currency symbol, any grouping. */
function money(text) {
  if (text == null) return null;
  const t = String(text).replace(/ /g, ' ').trim();
  if (!t || /^—|^-$/.test(t)) return null;
  /**
   * ⚠️ TAKE THE FIRST NUMBER; DO NOT STRIP THE NON-DIGITS. Stripping globally worked on "6,300.00" and turned
   * the margin — figure and percentage in one span, "5,700.00 · 90.48%" — into "5700.0090.48", which is NaN,
   * which reads back as "the screen showed no margin". The parser was wrong and it accused the app.
   */
  const m = t.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!m) return null;
  const v = Number(m[0].replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
}

/**
 * Select the <option> whose visible text CONTAINS `needle`, and return that text.
 *
 * ⚠️ Not `selectOption({ label })` — every option on this screen is a composed label
 * ("Oil filter · unit · ₹450"), so an exact-label match would need the test to know the price it is about to
 * read. The caller names the part; the option carries whatever the catalogue says today.
 */
async function pickOption(select, needle, what) {
  await expect(select, `the ${what} picker never appeared`).toBeVisible({ timeout: 20000 });
  const hit = await select.evaluate((el, n) => {
    const opt = [...el.options].find((o) => o.textContent.toLowerCase().includes(String(n).toLowerCase()));
    return opt ? { value: opt.value, text: opt.textContent.trim() } : null;
  }, needle);
  if (!hit) {
    const all = await select.evaluate((el) => [...el.options].map((o) => o.textContent.trim()));
    throw new Error(`no ${what} matching "${needle}". Offered: ${all.join(' | ') || '(nothing)'}`);
  }
  await select.selectOption(hit.value);
  return hit.text;
}

/**
 * ⭐⭐ DRIVE THE PICKER, WHEREVER IT WAS OPENED FROM. `CBPick` is one module over any screen, so this is one
 * driver for it — the worklist, design 2, and whatever opens it next all present the same modal, so none of
 * them needs its own picking code. That is the test-side half of the reason the module exists.
 *
 * Search → press + on the row → set the quantity. It does NOT confirm: the caller confirms, because only the
 * caller knows which write to wait for.
 */
async function pick(page, { item, qty = 1 }) {
  const search = page.getByTestId('pick-search');
  await expect(search, 'the catalogue picker did not open').toBeVisible({ timeout: 30000 });
  await search.fill(item);
  const row = page.locator('[data-testid^="cbcat-row-"]').filter({ hasText: item }).first();
  await expect(row, `"${item}" is not in the catalogue this picker is showing`).toBeVisible({ timeout: 20000 });
  const name = ((await row.textContent()) || '').trim();
  await row.getByTestId('cart-add').first().click();
  if (Number(qty) > 1) {
    /* The row turns into a stepper once it holds one; typing the number beats pressing + n times. */
    const box = row.locator('.cbcat-stp input');
    await expect(box, 'the row did not become a stepper after +').toBeVisible({ timeout: 10000 });
    await box.fill(String(qty));
    await box.blur();
  }
  return name;
}

function design2(page) {
  const wrote = (re) => page.waitForResponse(
    (r) => re.test(r.url()) && r.request().method() === 'POST' && r.status() < 400, { timeout: 45000 });

  const d2 = {
    /* ── getting there ─────────────────────────────────────────────────────────────────────────────────── */

    /** design 1 → ⧉ Lines → design 2, opened on Them · Message (where openChit2 always starts). */
    async open(subject) {
      await page.getByTestId('nav-task').click();
      /* ⚠️ :visible — the same subject sits in the hidden detail header; matching it clicks nothing. */
      await page.getByText(subject).locator('visible=true').first().click();
      const door = page.getByTestId('open-design2');
      await expect(door, `design 1 offered no way into design 2 for "${subject}" — the ⧉ Lines button is missing`)
        .toBeVisible({ timeout: 20000 });
      await door.click();
      await expect(page.getByTestId('c2-side-them'), 'design 2 did not open').toBeVisible({ timeout: 30000 });
      /* The lines arrive with the chit; until they do, every row locator below would match nothing. */
      await expect(page.getByTestId('c2-tab-ord'), 'design 2 opened without its tabs').toBeVisible();
      return d2;
    },

    /** 'them' = the shared record · 'us' = assignment, notes and cost, which the counterparty never sees. */
    async side(s) {
      await page.getByTestId(`c2-side-${s}`).click();
      return d2;
    },

    /** msg · ord · del  (them)   ·   work · summary  (us) — switching sides resets the tab, so side first. */
    async tab(t) {
      const tab = page.getByTestId(`c2-tab-${t}`);
      if (!(await tab.isVisible().catch(() => false))) await d2.side(['work', 'summary'].includes(t) ? 'us' : 'them');
      await tab.click();
      return d2;
    },

    /* ── rows ──────────────────────────────────────────────────────────────────────────────────────────── */

    /** The delivery row for a line, matched on its particulars. */
    delRow(name) {
      return page.getByTestId('c2-del-row').filter({ hasText: name }).first();
    },
    workRow(name) {
      return page.getByTestId('c2-work-row').filter({ hasText: name }).first();
    },

    /* ── doing the work ────────────────────────────────────────────────────────────────────────────────── */

    /**
     * US · WORK — give the line to a person, with what they are to do and by when.
     * `who` matches a co-assist by name; the overlay closes itself on success.
     */
    async assign({ line, who, task, due }) {
      await d2.tab('work');
      const row = d2.workRow(line);
      await expect(row, `no work row for "${line}"`).toBeVisible({ timeout: 20000 });
      /**
       * ⚠️ THE ✎, NOT THE ROW. The row used to open the assign overlay; it now opens the line card (history,
       * delivery, cost, who and when), and assign moved to its own control. This driver clicked the row and
       * caught the change on the first run — which is the whole reason a driver exists rather than a habit.
       */
      const pencil = row.getByTestId('c2-work-assign');
      if (await pencil.count()) await pencil.click();
      else await row.click();                       // an older build where the row still opens assign
      const chosen = await pickOption(page.getByTestId('c2-assign-who'), who, 'co-assist');
      if (task) await page.getByTestId('c2-assign-task').fill(task);
      if (due) await page.getByTestId('c2-assign-due').fill(due);
      const done = wrote(/\/assign-lines/);
      await page.getByTestId('c2-assign-do').click();
      await done;
      await expect(page.locator('#modalhost'), 'the assign overlay stayed up after a successful assign')
        .toBeEmpty({ timeout: 10000 });
      return { line, who: chosen, task, due };
    },

    /**
     * THEM · DELIVERED & PAID — take a part off a shelf and record it against the line.
     *
     * ⚠️ This is an `add` event, not a delivery: fitting a compressor is not "2 of a brake service". The part
     * ACCRUES against the job at the CATALOGUE price — which is why the driver names the item and never types
     * a number. `from` picks the source (our own stock by default, or a supplier by name).
     */
    async takeMaterial({ line, item, qty, from }) {
      await d2.tab('del');
      const row = d2.delRow(line);
      await expect(row, `no delivery row for "${line}"`).toBeVisible({ timeout: 20000 });
      if (from) await pickOption(row.getByTestId('c2-mat-src'), from, 'source');
      await row.getByTestId('c2-take-material').click();
      const picked = await pick(page, { item, qty });
      const done = wrote(/\/deliver-lines/);
      await page.getByTestId('pick-confirm').click();
      await done;
      return { line, item: picked, qty };
    },

    /** THEM · DELIVERED & PAID — claim `qty` of the line delivered. This is what closes a line. */
    async deliver({ line, qty, reference }) {
      await d2.tab('del');
      const row = d2.delRow(line);
      await expect(row, `no delivery row for "${line}"`).toBeVisible({ timeout: 20000 });
      await row.getByTestId('c2-dq').fill(String(qty));
      if (reference) await row.locator('[id^="c2dr_"]').fill(reference);
      const done = wrote(/\/deliver-lines/);
      await row.getByTestId('c2-delivered').click();
      await done;
      return { line, qty };
    },

    /**
     * ⚠️⚠️ addCost IS GONE WITH THE COST TAB. It drove `chit_line_cost` rows that carried no `line_id`, so
     * they hung off the chit, belonged to no service, and never reached the total the rest of the screen
     * shows. Athi retired that ledger on 2026-08-24: everything a person records — a part, a service charge —
     * is an `add` event ON THE LINE, and the Summary reads those.
     *
     * ⚠️ A driver for the line card's own "Add a cost" is NOT written yet, so labour recorded that way is
     * not yet covered end to end. Said here rather than left as a silent gap.
     */

    /* ── reading it back ───────────────────────────────────────────────────────────────────────────────── */

    /** '3 of 4 lines delivered' → { complete: 3, lines: 4 } — the header, visible from every pane. */
    async progress() {
      /* ⚠️ The strip replaced the old c2-progress line — same fact, better place, and it is on BOTH designs
         now, so one reader serves both. */
      const t = (await page.getByTestId('chit-spend-work').textContent().catch(() => ''))
        || (await page.getByTestId('c2-progress').textContent().catch(() => '')) || '';
      const m = t.match(/(\d+)\s+of\s+(\d+)/);
      return m ? { complete: Number(m[1]), lines: Number(m[2]), text: t.trim() } : { text: t.trim() };
    },

    /**
     * One line, as the screen states it: what was ordered, what is in, what has been fitted or worked, and
     * what the line has come to. `added` is the service half — parts and hours, each with its money.
     */
    async line(name) {
      await d2.tab('del');
      const row = d2.delRow(name);
      await expect(row, `no delivery row for "${name}"`).toBeVisible({ timeout: 20000 });
      const count = ((await row.getByTestId('c2-del-count').textContent()) || '').replace(/\s+/g, ' ').trim();
      const m = count.match(/^([\d.]+)\s+of\s+([\d.—-]+)\s*(\S*)/);
      const added = [];
      for (const el of await row.getByTestId('c2-del-added').all()) {
        const text = ((await el.textContent()) || '').replace(/\s+/g, ' ').trim();
        added.push({ text, amount: money(text.split('·').pop()) });
      }
      return {
        name,
        state: ((await row.getByTestId('c2-del-state').textContent()) || '').trim(),
        delivered: m ? Number(m[1]) : null,
        ordered: m && /^[\d.]+$/.test(m[2]) ? Number(m[2]) : null,
        unit: m ? m[3] : '',
        count,
        added,
        charged: money(await row.getByTestId('c2-del-charged').textContent().catch(() => null)),
      };
    },

    /**
     * The money, read from the two places design 2 now shows it — and they must agree:
     *   `accrued`  — the running charge in the Delivered & paid header
     *   `recorded` — the Summary tree's total, and the strip's "Spent so far"
     *   `invoiced` — what was quoted, from the strip
     *   `lines`    — one entry per service in the tree, with what it came to
     *
     * ⭐ There is ONE ledger now, so there is one number: a caller comparing `recorded` against the sum of
     * `lines` is checking the tree adds up, not reconciling two records that were never the same thing.
     */
    async money() {
      await d2.tab('del');
      const accrued = money(await page.getByTestId('c2-accrued').textContent().catch(() => null));

      await d2.tab('summary');
      const tree = page.getByTestId('c2-summary');
      await expect(tree, 'the Summary never rendered').toBeVisible({ timeout: 30000 });

      const lines = [];
      for (const g of await tree.locator('.c2sgrp').all()) {
        const name = ((await g.locator('.c2sname').textContent()) || '').trim();
        const amt = money(await g.locator('.c2samt').textContent().catch(() => null));
        const items = [];
        for (const it of await g.locator('.c2sitem').all()) {
          items.push(((await it.textContent()) || '').replace(/\s+/g, ' ').trim());
        }
        lines.push({ name, amount: amt, items });
      }

      const strip = page.getByTestId('chit-spend');
      const invoiced = (await strip.count())
        ? money(await strip.locator('div').filter({ hasText: /Quoted/i }).first().textContent().catch(() => null))
        : null;

      return {
        accrued,
        recorded: money(await tree.locator('.c2stot b').textContent().catch(() => null)),
        invoiced: (await page.getByTestId('chit-spend-amt').count())
          ? money(await page.getByTestId('chit-spend-amt').textContent()) : invoiced,
        quoted: invoiced,
        lines,
      };
    },

    /**
     * ⚠️ THE GUARD FOR A DELIBERATE ABSENCE. Athi, 2026-08-23: *"calculate it but do not showcase anywhere, as
     * we are not the P&L holder."* An absence nothing checks comes back — someone adds the row again next time
     * the cost pane is touched, and it looks like a feature. Returns true if margin has reappeared anywhere on
     * the screen, by hook or by label.
     */
    async marginShown() {
      if (await page.getByTestId('c2-cost-margin').count()) return true;
      return (await page.getByText(/\bmargin\b/i).count()) > 0;
    },

    /** Which materials the picker offers on a line — proves the catalogue is actually reachable from here. */
    async materialsOffered(line) {
      await d2.tab('del');
      await d2.delRow(line).getByTestId('c2-take-material').click();
      await expect(page.getByTestId('pick-search'), 'the catalogue picker never opened').toBeVisible({ timeout: 30000 });
      /* ⚠️ Wait for the read to finish before reading the rows — the picker shows a skeleton first, and
         counting skeleton rows as products is exactly the confusion the reading state exists to prevent. */
      await expect(page.locator('.cbcat-skelrow'), 'the catalogue never finished loading')
        .toHaveCount(0, { timeout: 30000 });
      const names = await page.locator('[data-testid^="cbcat-row-"]').allTextContents();
      await page.getByTestId('pick-cancel').click();
      await expect(page.getByTestId('pick-search')).toBeHidden({ timeout: 10000 });
      return names.map((t) => t.replace(/\s+/g, ' ').trim());
    },
  };
  return d2;
}

module.exports = { design2, money, pickOption };
