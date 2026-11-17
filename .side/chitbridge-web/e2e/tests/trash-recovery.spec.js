/**
 * trash-recovery.spec.js — A DELETED CHIT MUST BE FINDABLE, WITHOUT TOUCHING A FILTER.
 *
 * Backlog 2. Trash held ten chits and the screen said *"Nothing in Open"*. Two separate faults wearing one
 * symptom: the Open/Act/Close state filter was being applied to a view where a chit has no workflow state, and
 * the empty message named that filter even after the filtering stopped.
 *
 * ⚠️ THIS IS THE WORST CLASS OF BUG THERE IS. The data was fine and the screen denied it — someone trying to
 * recover something they deleted is told there is nothing there, which invites exactly one conclusion: that the
 * delete was permanent. A recovery path that lies is worse than no recovery path, because it stops the search.
 *
 * ⚠️ THE ASSERTION IS "VISIBLE WITHOUT TOUCHING ANYTHING". Not "the API returns it" — that was never in doubt,
 * and asserting it would pass on the broken build. The bug lives entirely between the response and the screen,
 * so the spec has to look at the screen, in the state the user arrives in.
 *
 * Watch it:  npx playwright test trash-recovery --headed --project=authed
 */
const { test, expect } = require('@playwright/test');
const { mintEntity, composeSelfChit, clickNav, settle } = require('../fixtures');

test.describe('Trash · recovering a deleted chit', () => {
  test.setTimeout(180_000);

  test('TRASH-01 · a trashed chit is visible in Trash on arrival, with no filter touched', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e)));

    await mintEntity(page);
    const subject = 'Trash recovery ' + String(Date.now()).slice(-6);
    await composeSelfChit(page, subject);   // takes the subject as a plain string, not an options object
    await settle(page);

    /* Trash it through the API — the point of this spec is the READ path, and driving the row menu here would
       make a failure ambiguous between "could not delete" and "deleted but not shown". */
    /* ⚠️ TWO THINGS HERE THAT DO NOT MATCH THEIR LABELS, both found by the spec failing on its own setup:
       · the subject lives on `code` — a list row has no `subject` field at all;
       · compose leaves you on the ORDER folder, but a self-chit lands in TASK, so the list read straight after
         composing is empty and says nothing about whether the chit exists. */
    await clickNav(page, 'task');
    await settle(page);
    const trashed = await page.evaluate(async (subj) => {
      await loadList();                                   // the app's own list — no endpoint alias to guess at
      const mine = (UI.rows || []).filter((c) => String(c.code || '') === subj);
      for (const c of mine) await api('delChit', { params: { id: c.id } }).catch(() => {});
      return mine.length;
    }, subject);
    expect(trashed, 'the chit we just composed should be findable to delete').toBeGreaterThan(0);

    await clickNav(page, 'trash');
    await settle(page);

    /* 1 · it is on screen. */
    await expect(page.getByText(subject).first()).toBeVisible({ timeout: 20_000 });

    /* 2 · and the state filter is genuinely not in force — visibleRows must not have dropped anything, and the
           state tabs must not even be offered. A chit in Trash is not in a workflow state any more. */
    const state = await page.evaluate(() => ({
      folder: UI.folder,
      rows: (UI.rows || []).length,
      visible: visibleRows().length,
      tabsShown: !!document.querySelector('.statetabs'),
      emptyShown: !!document.querySelector('.empty'),
    }));
    expect(state.folder).toBe('trash');
    expect(state.visible, 'every trashed chit is visible — no state filter applies here').toBe(state.rows);
    expect(state.tabsShown, 'Open/Act/Close must not be offered in Trash').toBe(false);
    expect(state.emptyShown, 'the empty state must not render while rows exist').toBe(false);

    /* 3 · and when Trash IS empty, the message names TRASH — never a state that is not applied. This is the
           half that survived the first fix, and the half the user actually read. */
    const wording = await page.evaluate(() => {
      const before = UI.rows;
      UI.rows = [];                       // force the empty branch without emptying anyone's real trash
      const html = renderRows();
      UI.rows = before;
      return html;
    });
    expect(wording).toContain('Nothing in Trash');
    expect(wording, 'must not name a workflow state in a view that has none').not.toMatch(/Nothing in (Open|Act|Close)/);

    expect(pageErrors, 'no page errors').toEqual([]);
  });
});
