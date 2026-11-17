// [TILL-36] [TILL-39] [TILL-35] THE THREE THAT HAD NO STANDING ASSERTION.
//
// Written on 2026-09-18 during a coverage sweep. Each of these was built, verified by hand against a real shop,
// and then had nothing that would say when it broke — and two of the three had ALREADY broken silently once:
//
//   [TILL-36] the shop's groups reached nobody. /api/quick-keys wrote them, both key allow-lists passed
//             GET /api/till/quick-keys/groups, and the counter never called it. A chain would have built the
//             same group by hand on ten machines.
//   [TILL-43] combos and modifiers were dead on real shop data, because tillItem() did not carry the field.
//   [TILL-39] Arrange is a MODE in which a key must not sell — the one property that makes drag-to-reorder
//             safe on a touchscreen. Nothing asserted it.
//
// ⚠️ These drive the counter through its own functions rather than through mouse gestures. HTML5 drag events
// do not fire from Playwright in a way that is worth the flake, and the property under test is not "a drag
// happened" — it is "the order changed, and nothing was billed while it was changing".
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct } = require('../fixtures');
const TILL = process.env.CB_TILL_BASE || '';
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

/**
 * shopWith(), but the products carry a CATEGORY. addProduct() walks the Catalogue form and its parameter list
 * is { name, price, desc, unit, code } — a category passed to it is dropped without a word, which would have
 * left [TILL-40] hunting a chip for a category no product had. POST /api/products/bulk is the same door the
 * importer uses, so the field reaches the counter's snapshot exactly as a real shop's would.
 */
async function shopWithCategories(page, context, name, products) {
  await mintEntity(page, { fresh: true, name: name + Date.now().toString(36) });
  const made = await page.evaluate(async (items) => {
    if (typeof ensureCap === 'function') await ensureCap('admin');
    const r = await api('prodAddMany', { body: { items } });
    const k = await api('keysMint', { body: { name: 'counter', scopes: ['till'], days: 1 } });
    return { n: (r && (r.created || (r.items || []).length)) || 0, key: (k && (k.key || k.api_key)) || null };
  }, products);
  return made;
}

async function shopWith(page, context, name, products) {
  await mintEntity(page, { fresh: true, name: name + Date.now().toString(36) });
  for (const p of products) await addProduct(page, p);
  const key = await page.evaluate(async () => {
    if (typeof ensureCap === 'function') await ensureCap('admin');
    const r = await api('keysMint', { body: { name: 'counter', scopes: ['till'], days: 1 } });
    return (r && (r.key || r.api_key)) || null;
  });
  return { key };
}

test('[TILL-36] a group authored in the back office reaches the counter, and the counter can keep its own copy',
  async ({ page, context }) => {
    test.setTimeout(240000);
    const { key } = await shopWith(page, context, 'shopgroups', [
      { name: 'Idli', unit: 'plate', price: 40 },
      { name: 'Dosa', unit: 'plate', price: 70 },
      { name: 'Coffee', unit: 'cup', price: 25 },
    ]);

    /* the shop authors a group — the back-office path, session-only, exactly as a person would */
    const made = await page.evaluate(async (base) => {
      /* ⚠️ the app holds its token in SESSION, not in a localStorage key of its own name — cb_sess is the
         persisted copy, and reading the wrong one gives a silent 401 that looks like an empty shop */
      const tok = (typeof SESSION !== 'undefined' && SESSION.token)
        || (JSON.parse(localStorage.getItem('cb_sess') || '{}').token);
      const post = (p, b) => fetch(base + p, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
        body: JSON.stringify(b),
      }).then((r) => r.json());
      const list = await fetch(base + '/api/products?limit=100', { headers: { Authorization: 'Bearer ' + tok } })
        .then((r) => r.json());
      const ids = (list.items || []).map((x) => x.item_id);
      const g = await post('/api/quick-keys/groups', { name: 'Morning', sort_order: 0 });
      const gid = (g.group || g).id;
      for (let i = 0; i < ids.length; i++) await post('/api/quick-keys/groups/' + gid + '/items', { product_id: ids[i], position: i });
      return { gid, n: ids.length };
    }, API);
    expect(made.n, 'the shop has products to group').toBeGreaterThan(0);

    const till = await context.newPage();
    await till.goto(TILL + '/till.html#key=' + encodeURIComponent(key));
    await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 60000 });
    await till.evaluate(async () => { await quickSyncGroups(); });
    await till.waitForTimeout(1500);

    const seen = await till.evaluate(() => ({
      groups: Object.keys(shopGroups()),
      chosen: tillOpt().group,
      source: tillOpt().quickSource,
      ids: groupIds().length,
    }));
    expect(seen.groups, 'the shop\'s group reached the counter').toContain('Morning');
    /* ⚠️ AND A COUNTER WITH NO CHOICE ADOPTS IT — otherwise a shop publishes groups, the cashier sees the same
       learned keys as before, and concludes nothing arrived. */
    expect(seen.chosen).toBe('Morning');
    expect(seen.source).toBe('groups');
    expect(seen.ids).toBe(made.n);

    /**
     * ⚠️⚠️ COPY-ON-WRITE. Editing a SHOP group at a counter must change this counter's copy and leave the
     * shop's publication alone — otherwise one cashier's tidy-up silently re-orders every counter in the chain.
     */
    const after = await till.evaluate(() => {
      const before = groupIds().slice();
      quickGroupToggle(before[0]);                       /* take the first one out, here */
      return { before: before.length, mine: (tillOpt().groups || {}).Morning.length, shopStill: shopGroups().Morning.length };
    });
    expect(after.mine, 'this counter now keeps its own, shorter copy').toBe(after.before - 1);
    expect(after.shopStill, 'and the shop\'s published group is untouched').toBe(after.before);
  });

test('[TILL-39] Arrange sets the order by hand, and nothing can be billed while it is on',
  async ({ page, context }) => {
    test.setTimeout(240000);
    const { key } = await shopWith(page, context, 'arrange', [
      { name: 'Alpha', unit: 'piece', price: 10 },
      { name: 'Bravo', unit: 'piece', price: 20 },
      { name: 'Delta', unit: 'piece', price: 30 },
      { name: 'Echo', unit: 'piece', price: 40 },
    ]);
    const till = await context.newPage();
    await till.goto(TILL + '/till.html#key=' + encodeURIComponent(key));
    await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 60000 });

    /* a group of this counter's own, so there is a hand-made order to arrange */
    await till.evaluate(() => {
      const ids = (S.items || []).slice(0, 4).map((i) => i.item_id);
      const o = tillOpt();
      o.groups['Mine'] = ids.slice();
      tillOptSet({ groups: o.groups, group: 'Mine', quickSource: 'groups' });
      clearBill();
    });
    await till.waitForTimeout(500);

    const first = await till.evaluate(() => groupIds()[0]);

    await till.evaluate(() => { qkArrangeToggle(); });
    await till.waitForTimeout(400);
    expect(await till.evaluate(() => QK_ARRANGE), 'the mode is on').toBe(true);
    expect(await till.evaluate(() => !!document.querySelector('[data-testid="till-arrange-note"]')),
      'and it says so — a mode that stops selling without explaining itself is a fault report waiting to happen').toBe(true);

    /* ⚠️⚠️ THE SAFETY PROPERTY. A tap while arranging must not sell — a slipped thumb on a touchscreen would
       otherwise move a key AND bill it mid-rush. */
    await till.evaluate(() => { document.querySelector('[data-testid="till-quick-0"]').click(); });
    await till.waitForTimeout(400);
    expect(await till.evaluate(() => CART.length), 'nothing was billed while arranging').toBe(0);
    expect(await till.evaluate(() => QK_FROM), 'the key was picked up instead').toBe(first);

    /* drop it on the fourth place */
    await till.evaluate(() => { document.querySelector('[data-testid="till-quick-3"]').click(); });
    await till.waitForTimeout(500);
    expect(await till.evaluate(() => groupIds()[3]), 'the key moved to where it was dropped').toBe(first);
    expect(await till.evaluate(() => CART.length), 'and still nothing was billed').toBe(0);

    /**
     * ⚠️⚠️ ESCAPE MUST NOT REACH THE BASKET. Escape clears the bill, and [TILL-30] is the scar from somebody
     * pressing it to back out of something and losing the sale.
     */
    await till.evaluate(() => {
      clearBill();
      addItem(S.items[0], 1, null);
      price();
    });
    await till.waitForTimeout(400);
    await till.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await till.waitForTimeout(400);
    expect(await till.evaluate(() => CART.length), 'Escape left the mode, not the sale').toBe(1);
    expect(await till.evaluate(() => QK_ARRANGE)).toBe(false);

    /* and once the mode is off, a key sells again */
    await till.evaluate(() => { clearBill(); document.querySelector('[data-testid="till-quick-0"]').click(); });
    await till.waitForTimeout(600);
    expect(await till.evaluate(() => CART.length), 'arranging was a mode, not a one-way door').toBe(1);
  });

test('[TILL-35] a kitchen ticket goes once, and only the new lines go on the next one',
  async ({ page, context }) => {
    test.setTimeout(240000);
    const { key } = await shopWith(page, context, 'kot', [
      { name: 'Dosa', unit: 'plate', price: 70 },
      { name: 'Idli', unit: 'plate', price: 40 },
      { name: 'Coffee', unit: 'cup', price: 25 },
    ]);
    const till = await context.newPage();
    await till.goto(TILL + '/till.html#key=' + encodeURIComponent(key));
    await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 60000 });

    await till.evaluate(() => { tillOptSet({ kot: true }); clearBill(); });
    await till.waitForTimeout(400);
    expect(await till.evaluate(() => kotOn()), 'a kitchen is a hotel\'s thing, switched on per shop').toBe(true);

    await till.evaluate(() => {
      addItem(S.items[0], 2, null);
      addItem(S.items[1], 1, null);
      price();
    });
    await till.waitForTimeout(500);
    expect(await till.evaluate(() => kotPending().length), 'two lines the kitchen has not been told about').toBe(2);

    await till.evaluate(() => { sendKOT(); });
    await till.waitForTimeout(700);
    await till.evaluate(() => { try { document.getElementById('slipdlg').close(); } catch (_) {} });

    expect(await till.evaluate(() => kotPending().length), 'the kitchen now has everything on the bill').toBe(0);
    expect(await till.evaluate(() => CART.every((c) => c.kot === 1)), 'and each line remembers which ticket took it').toBe(true);

    /**
     * ⚠️⚠️ SENT ONCE. Re-sending the whole table on the second round is the classic way this feature is got
     * wrong — the kitchen cooks the first two dishes again.
     */
    const third = await till.evaluate(() => { addItem(S.items[2], 1, null); price(); return S.items[2].name; });
    await till.waitForTimeout(500);
    const second = await till.evaluate(() => kotPending().map((c) => c.name));
    /* the shelf comes back in the catalogue's own order, not the order these were added — an expectation
       typed here ('Coffee') failed on ['Dosa'] while the feature was perfectly right. Ask the page. */
    expect(second, 'only the dish added since the last ticket').toEqual([third]);

    await till.evaluate(() => { sendKOT(); });
    await till.waitForTimeout(700);
    const tickets = await till.evaluate(() => ({ n: KOT_N, kots: CART.map((c) => c.kot) }));
    expect(tickets.n, 'a second ticket, not a reprint of the first').toBe(2);
    expect(tickets.kots).toEqual([1, 1, 2]);

    /* ⚠️ AND NO MONEY ON IT. A cook needs the dish, the count and what was asked for — a price on a kitchen
       ticket is noise at best and a wrong number to argue about at worst. */
    const slip = await till.evaluate(() => kotHTML(CART.slice(0, 1), 1, new Date()));
    expect(slip, 'the kitchen ticket carries no money').not.toMatch(/₹/);

    /* a new customer is a new set of tickets */
    await till.evaluate(() => { clearBill(); });
    await till.waitForTimeout(300);
    expect(await till.evaluate(() => KOT_N)).toBe(0);
  });

test('[TILL-40] a category chip narrows the quick keys too, says so, and lets go of it',
  async ({ page, context }) => {
    test.setTimeout(240000);
    /* the shape Athi described: one group, most of it one category and the rest another */
    const { key } = await shopWithCategories(page, context, 'catkeys', [
      { name: 'Idli', unit: 'plate', price: 40, category: 'Tiffin' },
      { name: 'Dosa', unit: 'plate', price: 70, category: 'Tiffin' },
      { name: 'Vada', unit: 'plate', price: 35, category: 'Tiffin' },
      { name: 'Coffee', unit: 'cup', price: 25, category: 'Drinks' },
      { name: 'Jalebi', unit: 'piece', price: 20, category: 'Sweets' },   /* on the shelf, NOT in the group */
    ]);
    const till = await context.newPage();
    await till.goto(TILL + '/till.html#key=' + encodeURIComponent(key));
    await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 60000 });

    await till.evaluate(() => {
      const o = tillOpt();
      o.groups['Morning'] = (S.items || []).filter((i) => i.category !== 'Sweets').map((i) => i.item_id);
      tillOptSet({ groups: o.groups, group: 'Morning', quickSource: 'groups' });
      clearBill();
    });
    await till.waitForTimeout(600);
    expect(await till.evaluate(() => document.querySelectorAll('#quick button[data-qk]').length),
      'the whole group is on the keys to begin with').toBe(4);

    /* ⚠️ THE CHIP IS PRESSED, not the function — the point under test is that the shelf control reaches the keys */
    await till.evaluate(() => document.querySelector('[data-testid="till-chip-tiffin"]').click());
    await till.waitForTimeout(500);
    expect(await till.evaluate(() => document.querySelectorAll('#quick button[data-qk]').length),
      'only the Tiffin keys are left').toBe(3);
    /**
     * ⚠️⚠️ AND IT SAYS SO. Keys gone without a reason read as keys LOST, and the chip that did it is a row away.
     * This is the assertion that stops the feature becoming a fault report. [[feedback-silence-is-the-bug]]
     */
    expect(await till.evaluate(() => (document.querySelector('[data-testid="till-quick-cat"]') || {}).textContent))
      .toContain('Tiffin only');
    expect(await till.evaluate(() => QUICK.length), 'the group itself is untouched — this is a view, not an edit').toBe(4);

    /* ⚠️ a narrowed key still sells; narrowing the grid must never narrow what a press does */
    await till.evaluate(() => document.querySelector('#quick button[data-qk]').click());
    await till.waitForTimeout(500);
    expect(await till.evaluate(() => CART.length), 'a key still bills while the grid is narrowed').toBe(1);

    /**
     * ⚠️⚠️ ARRANGING SEES THE GROUP WHOLE. qkDropOn() places a key at the position it was dropped on; against a
     * filtered list that writes an order nobody chose, so the narrowing is dropped for the duration and said out loud.
     */
    await till.evaluate(() => qkArrangeToggle());
    await till.waitForTimeout(500);
    expect(await till.evaluate(() => document.querySelectorAll('#quick button[data-qk]').length),
      'every key is back while an order is being written').toBe(4);
    expect(await till.evaluate(() => document.querySelector('[data-testid="till-arrange-note"]').textContent))
      .toContain('Every key in the group is shown');
    await till.evaluate(() => qkArrangeToggle());
    await till.waitForTimeout(400);

    /* and the way out is one tap, with the bill untouched */
    await till.evaluate(() => document.querySelector('[data-testid="till-quick-catall"]').click());
    await till.waitForTimeout(500);
    expect(await till.evaluate(() => document.querySelectorAll('#quick button[data-qk]').length)).toBe(4);
    expect(await till.evaluate(() => CART.length), 'letting go of a filter is not an edit to the bill').toBe(1);

    /**
     * ⚠️ A CATEGORY WITH NOTHING IN THE GROUP ANSWERS THE QUESTION rather than drawing a blank panel. Jalebi is
     * on the shelf and not in Morning, which is the case an empty grid would have made look like a broken one.
     */
    await till.evaluate(() => document.querySelector('[data-testid="till-chip-sweets"]').click());
    await till.waitForTimeout(500);
    expect(await till.evaluate(() => document.querySelectorAll('#quick button[data-qk]').length)).toBe(0);
    expect(await till.evaluate(() => (document.querySelector('[data-testid="till-quick-catempty"]') || {}).textContent))
      .toContain('No Sweets');
    /* ⚠️ and it is still sellable — the keys are a shortcut, never the shelf */
    expect(await till.evaluate(() => hits().some((i) => i.name === 'Jalebi')), 'the shelf still carries it').toBe(true);
  });
