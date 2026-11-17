// [SUP-02] THE SUPPLIERS REDESIGN — two tabs, and a supplier who never registered.
//
// Athi, 2026-09-10: *"we have already the supplier menu — add the business here and set a flag: is he the supplier
// for my sales or is he the facilitator? Show them in two different tabs."* and *"still a non-CB person can be a
// supplier"* and *"still we need the user id, so we can attach item and so on against that id."*
//
// ⚠️ IT DRIVES THE SCREEN, NOT THE API. tests/local-supplier.test.js already covers the handle grammar, the
// numbering and the refusals. What is untested until something clicks the buttons is whether a person can reach
// any of it — whether the tabs paint, whether a plain name is accepted where it was refused for months, and
// whether the row that cannot be ordered from says so instead of offering a button that dies.
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');

test('[SUP-02] a shop can add a supplier who is not on ChitBridge, and it lands in the right tab', async ({ page }) => {
  test.setTimeout(300000);
  const stamp = Date.now().toString().slice(-6);
  await mintEntity(page, { fresh: true, name: 'Kirana ' + stamp });

  const LOCAL = 'Corner Hardware ' + stamp;

  await test.step('⭐ Suppliers opens on TRADE, with Other beside it', async () => {
    await page.locator('text=Suppliers').first().click();
    await expect(page.getByTestId('sup-tab-trade')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('sup-tab-other')).toBeVisible();
    /* ⚠️ TRADE IS THE DEFAULT, and it must be: goods to sell on are the common case, and a shop that landed on
       "things we use" would file its first delivery in the wrong place before noticing there were two tabs. */
    const cls = await page.getByTestId('sup-tab-trade').getAttribute('class');
    expect(cls || '', 'Suppliers must open on the Trade tab').toContain('on');
  });

  await test.step('⭐⭐⭐ a plain NAME is accepted — the thing that was refused until today', async () => {
    /**
     * ⚠️ THE BOX HAS ALWAYS SAID "type a name, User ID or email" AND THEN REFUSED EVERY NAME. A name only worked
     * if it happened to belong to a business already on ChitBridge, so the commonest supplier a small shop has —
     * the hardware shop with a paper bill — could not be written down at all.
     */
    await page.getByTestId('sup-add-input').fill(LOCAL);
    await page.getByTestId('sup-add').click();
    /* the confirmation must say what they will NOT be able to do, before the row exists rather than after
       somebody goes hunting for the missing button */
    await expect(page.locator('body')).toContainText(/not on ChitBridge/i, { timeout: 15000 });
    await page.getByTestId('confirm-ok').click();          /* ⚠️ the testid, not the label — confirmAsk owns the button */
    await expect(page.locator('#sup_rows')).toContainText(LOCAL, { timeout: 25000 });
  });

  await test.step('⭐⭐ the row SAYS it cannot be ordered from, rather than showing an empty catalogue', async () => {
    const row = page.locator('#sup_rows').locator('div.row', { hasText: LOCAL }).first();
    await expect(row).toContainText(/not on ChitBridge/i);
    /* ⚠️ "no catalogue" would be the misleading way to put it — that reads as an empty shelf they might fill,
       when the truth is there is nobody to ask. */
    await expect(row).not.toContainText(/no catalogue/i);
  });

  await test.step('⭐⭐⭐ they got a REAL id, numbered under this shop', async () => {
    /**
     * Athi: *"we create id internally, so the existing mechanism will not break"* and *"entity user id-sup-nnnn,
     * whatever, so he is specific to the user."* The id is what purchases, spend and stock attach to — a null
     * there would have needed a branch in every one of them.
     */
    const sup = await page.evaluate(async () => {
      const r = await api('supList');
      /* ⚠️ unwrap() collapses {suppliers,count} to a BARE ARRAY — read it the way loadSuppliers does */
      const rows = Array.isArray(r) ? r : ((r && r.suppliers) || []);
      return rows[0] || null;
    });
    expect(sup, 'the supplier came back with no row at all').toBeTruthy();
    expect(sup.supplier_entity_id, 'a local supplier must still have an id').toBeTruthy();
    expect(sup.user_id, 'the id must follow ~<entity user id>.sup-nnnn').toMatch(/^~.+\.sup-\d{4,}$/);
    expect(sup.on_rail, 'the screen must be told this one cannot be called').toBe(false);
    expect(sup.supply_kind).toBe('resale');
  });

  await test.step('⭐⭐ the detail pane offers what CAN be done — and never "order from them"', async () => {
    await page.locator('#sup_rows').locator('div.row', { hasText: LOCAL }).first().click();
    await expect(page.getByTestId('sup-record-delivery')).toBeVisible({ timeout: 25000 });
    const pane = await page.locator('#detailpane').textContent();
    expect(pane, 'the pane must show the generated id — it is theirs and it is real').toMatch(/~.+\.sup-\d{4,}/);
    /**
     * ⚠️ ASSERTED AGAINST WHAT THE ON-RAIL PANE ACTUALLY SAYS. My first version checked that a testid called
     * 'sup-order' was absent — and no such testid has ever existed anywhere, so it passed whatever the pane did.
     * An assertion with no subject is worse than none: it reports green and measures nothing.
     */
    expect(pane, 'the off-rail pane is offering a catalogue there is nobody to ask for')
      .not.toMatch(/what you can order from them/i);
  });

  await test.step('⭐⭐⭐ moving them to OTHER moves what a delivery from them DOES', async () => {
    /* Athi: *"while adding or may be later through edit set a flag"* — and the flag is not a label: it decides
       whether goods from them are offered to the catalogue or go to supplies. */
    const listId = await page.evaluate(async () => {
      const r = await api('supList'); return (Array.isArray(r)?r:(r.suppliers||[]))[0].supplier_list_id;
    });
    await page.getByTestId('sup-details-' + listId).click();     /* ⓘ — their full record */
    await page.getByTestId('sup-edit').click();
    await expect(page.getByTestId('sup-kind-own_use')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('sup-kind-own_use').click();

    /* ⭐ AND THE SCREEN FOLLOWS THEM. Leaving the shop looking at a list the supplier just vanished from is the
       kind of small dishonesty that makes people think the save failed and press it again. */
    await expect(page.getByTestId('sup-tab-other')).toHaveClass(/on/, { timeout: 20000 });
    await expect(page.locator('#sup_rows')).toContainText(LOCAL, { timeout: 20000 });

    const kind = await page.evaluate(async () => {
      const r = await api('supList'); return (Array.isArray(r)?r:(r.suppliers||[]))[0].supply_kind;
    });
    expect(kind, 'the flag did not persist — the tab is lying to the shop').toBe('own_use');
  });

  await test.step('⭐ and the Trade tab is now empty, which is the honest answer', async () => {
    await page.getByTestId('sup-tab-trade').click();
    await expect(page.locator('#sup_rows')).not.toContainText(LOCAL, { timeout: 15000 });
  });

  await test.step('⚠️⚠️ they cannot be sent a chit — "he is not a recipient"', async () => {
    /**
     * A chit addressed to someone who can never sign in would sit as sent for ever, with the sender waiting on an
     * answer that cannot come. The refusal is the ONE thing the ~ marker has to enforce.
     *
     * ⚠️ SENT AS `name`, WHICH IS THE SHAPE A PERSON ACTUALLY PRODUCES. My first version passed {user_id}, and it
     * WAS refused — by the recipient validator, which wants entity_id/display_name/name/self. That is a pass for
     * the wrong reason: it proved a different guard works and never exercised mine. A typed recipient arrives as
     * `name`, and that branch resolves by user_id and bridge_id before it ever looks at display names.
     */
    const sup = await page.evaluate(async () => {
      const r = await api('supList');
      return (Array.isArray(r) ? r : (r.suppliers || []))[0];
    });
    const trySend = (who) => page.evaluate(async (typed) => {
      try {
        await api('createChit', { body: { recipients: [{ name: typed, role: 'to' }],
          manual_subject: 'should not send', subject: 'should not send', purpose: 'order', line_items: [] } });
        return 'SENT';
      } catch (e) { return (e && e.message) || 'refused'; }
    }, who);

    const byHandle = await trySend(sup.user_id);
    expect(byHandle, 'a chit was accepted for a supplier who can never open it').not.toBe('SENT');
    expect(byHandle).toMatch(/cannot receive chits/i);

    /* ⚠️⚠️ AND BY THEIR NAME, which is the dangerous one: minted names are ordinary shop names, so this is the
       path by which ANOTHER business could reach a private supplier record just by typing what it is called. */
    const byName = await trySend(sup.display_name);
    expect(byName, 'a minted supplier was reachable by typing their display name').not.toBe('SENT');
  });

  await test.step('⚠️⚠️ and nobody else can find them — who supplies you is competitive', async () => {
    const found = await page.evaluate(async (q) => {
      const r = await api('entitySearch', { query: { q } });
      return ((r && r.results) || []).map((x) => x.user_id || x.display_name).join(' | ');
    }, 'Corner Hardware');
    /* ⚠️ asserted through the SEARCH, not through the row — the leak, if there is one, is in that endpoint's
       WHERE clause, and every assertion about minting would stay green while it was open. */
    expect(found, 'a minted supplier is visible in the global business search').not.toMatch(/~/);
  });
});
