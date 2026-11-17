// [TILL-31] THE COUNTER MENU, PHONE FIRST — Athi's own menu style (quick-keys-design-handoff_2 /
// mobile-first-instructions.md §4), checked at the two widths that decide its shape.
//
// Athi, 2026-09-18: *"i gave a different menu style, so it can fit into mobile also"* — so the thing worth
// testing is not that the menu exists but that it CHANGES SHAPE and still carries everything: a full-height
// sheet with folded sections on a phone, a centred card on a terminal, the same five groups in the same order
// at both, and no horizontal scroll at 390px (§7's first acceptance line for every screen).
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct } = require('../fixtures');
const TILL = process.env.CB_TILL_BASE || '';

/**
 * §4: "Groups, in this order, always" — the order is the design, so the test states it literally.
 * ⚠️ "Start your day" was added at the FRONT on 2026-09-18 (Athi: *"bring that element as a first one in the
 * menu"*), so this list grew rather than changed: the handoff's five keep their order behind it.
 */
const ORDER = ['Start your day', 'Today', 'Bills', 'Shop & prices', 'This counter', 'How it looks', 'Careful'];

test('[TILL-31] the counter menu folds on a phone, opens out on a terminal, and drops nothing either way', async ({ page, context }) => {
  test.setTimeout(240000);
  await mintEntity(page, { fresh: true, name: 'menu' + Date.now().toString(36) });
  await addProduct(page, { name: 'Filter Coffee', unit: 'cup', price: 25, code: 'FC31' });
  const key = await page.evaluate(async () => {
    if (typeof ensureCap === 'function') await ensureCap('admin');
    const r = await api('keysMint', { body: { name: 'menu counter', scopes: ['till'], days: 1 } });
    return (r && (r.key || r.api_key)) || null;
  });

  const till = await context.newPage();
  await till.setViewportSize({ width: 390, height: 844 });          // a phone, the base range
  await till.goto(TILL + '/till.html#key=' + encodeURIComponent(key));
  await till.waitForFunction(() => typeof paintMenu === 'function', null, { timeout: 40000 });

  await test.step('base (390) — a sheet, five sections in order, folded, with Bills open', async () => {
    await till.evaluate(() => toggleMenu());
    const m = till.locator('#tillmenu');
    await expect(m).toBeVisible();

    const titles = await till.evaluate(() => [...document.querySelectorAll('.msec .mrow .mt b')].map((b) => b.textContent.trim()));
    expect(titles, 'the five groups, in the order the design fixes them').toEqual(ORDER);

    /* §4: accordion — one at a time. ⚠️ On a counter whose day has not been opened the FIRST section is
       "Start your day"; once it has, Bills leads as the handoff says (menuFirstSection). */
    const open = await till.evaluate(() => [...document.querySelectorAll('.msec .mbody')].map((b) => !b.hidden));
    expect(open, 'exactly one section open, and on a fresh counter it is Start your day')
      .toEqual([true, false, false, false, false, false, false]);

    /**
     * it is a SHEET here: it fills the screen rather than floating as a card.
     * ⚠️ measured against the VIEWPORT, not a magic number — 390 minus a scrollbar is 369, and a literal 380
     * made this fail for a reason that had nothing to do with the menu.
     * ⚠️ AND POLLED, because the panel animates open (`.side{transition:width .14s}`): measured the instant
     * toggleMenu() returns it is caught mid-slide, which is a test that fails on a slow machine and passes on
     * a fast one. A red-team pass caught exactly that, at 369.28 of 390.
     */
    const vw = await till.evaluate(() => document.documentElement.clientWidth);
    await expect.poll(async () => (await m.boundingBox()).width, { message: 'a sheet spans the phone' })
      .toBeGreaterThanOrEqual(vw - 1);

    /* §7: no horizontal scroll at any width, menu open or not */
    const scrolls = await till.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(scrolls, 'the page scrolls sideways on a phone').toBe(false);
  });

  await test.step('⭐ opening another section closes the first — one at a time, as the design says', async () => {
    await till.evaluate(() => menuSection('look'));
    const open = await till.evaluate(() => [...document.querySelectorAll('.msec .mbody')].map((b) => !b.hidden));
    expect(open).toEqual([false, false, false, false, false, true, false]);
    /* "How it looks" holds the three selects — folded away, never dropped (§2 rule 1) */
    await expect(till.locator('[data-testid="till-mq-fs"]')).toBeVisible();
    await expect(till.locator('[data-testid="till-mq-theme"]')).toBeVisible();
    await expect(till.locator('[data-testid="till-mq-layout"]')).toBeVisible();
  });

  await test.step('⚠️ Careful is last, says what it costs, and holds both stopping actions', async () => {
    await till.evaluate(() => menuSection('care'));
    const care = till.locator('[data-testid="till-msec-care"]');
    await expect(care).toContainText('These two stop billing for a moment. Everything is sent and checked first.');
    await expect(care.locator('[data-testid="till-close"]')).toBeVisible();
    await expect(care.locator('[data-testid="till-coldstart-menu"]')).toBeVisible();
  });

  await test.step('⭐ Escape closes it, and the caret goes back to the search box so the next scan lands', async () => {
    await till.keyboard.press('Escape');
    await expect(till.locator('#tillmenu')).toBeHidden();
    await expect(till.locator('#q')).toBeFocused();
  });

  await test.step('md/lg (1366) — the same five, now a centred card, still nothing dropped', async () => {
    await till.setViewportSize({ width: 1366, height: 768 });
    await till.evaluate(() => toggleMenu());
    const titles = await till.evaluate(() => [...document.querySelectorAll('.msec .mrow .mt b')].map((b) => b.textContent.trim()));
    expect(titles, 'the order never changes between a phone and a terminal (§2 rule 2)').toEqual(ORDER);

    /**
     * ⚠️ A DRAWER, NOT A CENTRED CARD (2026-09-18). This asserted `box.x > 100` — "and it is centred" — which
     * was true of the centred dialog §4 describes and is wrong for the right/left-edge drawer Athi asked for.
     * The assertion MOVED to the drawer's real shape rather than being deleted: narrow, full height, pinned to
     * whichever edge the Menu side setting names.
     */
    const vp = await till.evaluate(() => ({ w: document.documentElement.clientWidth, h: window.innerHeight,
                                            side: document.body.getAttribute('data-menuside') || 'left' }));
    /* settled, not mid-slide — see the note in the base step */
    await expect.poll(async () => Math.round((await till.locator('#tillmenu').boundingBox()).width))
      .toBeGreaterThan(200);
    const box = await till.locator('#tillmenu').boundingBox();
    expect(box.width, 'a drawer, not a full-width sheet, on a terminal').toBeLessThan(400);
    expect(box.height, 'and it runs the full height of the screen').toBeGreaterThan(vp.h * 0.8);
    if (vp.side === 'left') expect(box.x, 'a left-hand drawer starts at the left edge').toBeLessThan(60);
    else expect(box.x + box.width, 'a right-hand drawer ends at the right edge').toBeGreaterThan(vp.w - 60);

    const scrolls = await till.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(scrolls).toBe(false);
    await till.keyboard.press('Escape');
  });

  /**
   * ⭐⭐ ONE MENU, TWO HALVES (Athi, 2026-09-18: *"why do we need two menu? can we merge both"*). The strip is
   * the menu closed; the sections are the menu open. This asserts they cannot drift — which is the whole reason
   * they share TILL_OPS, and the reason a left rail and a ☰ sheet were merged into one object on the right.
   */
  await test.step('⭐ every operation on the collapsed strip is in the open menu too — one list, one door', async () => {
    const same = await till.evaluate(() => {
      const stripIds = [...document.querySelectorAll('#tillsideicons [data-testid^="till-side-"]')]
        .map((b) => b.dataset.testid.replace('till-side-', ''))
        .filter((x) => x !== 'open');
      const menuIds = TILL_MENU.reduce((a, s) => a.concat(s.ops || []), []);
      return { stripIds, menuIds };
    });
    expect(same.stripIds.length, 'the strip drew nothing — this check would pass on an empty page').toBeGreaterThan(3);
    for (const id of same.stripIds) {
      expect(same.menuIds, 'the strip offers ' + id + ' and the open menu does not — the halves have drifted').toContain(id);
    }
  });
});
