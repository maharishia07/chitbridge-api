// offers-customer.spec.js — [OFF-03] A CUSTOMER-ONLY OFFER THROUGH THE SUPPLIERS MENU. Athi, 2026-09-06: "assume Chola Auto Care is the registered customer of
// tallytest — can he pass additional off through the link? … so each customer gets a personalised discount"; "see how you can pass
// customer based discount through supplier menu". The seller writes "Regulars 10%" Only for → New customers. A buyer who has never
// traded sees the list price (₹200) and no badge; the anonymous storefront payload carries no such offer at all. After one order the
// buyer is on the seller's Customers list as "new" — the same Suppliers screen now prints the badge and ₹180. The seller moves them to
// the "High value" group on the Customers pane; the offer (for new customers) leaves again. Nothing here is self-asserted: what the
// buyer sees follows the SELLER's list, read in the same catalogue round trip.
const { test, expect } = require('@playwright/test');
const { mintEntity, mintInContext, addProduct, clickNav, settle } = require('../fixtures');

/** the money block as text: one line per row, "label | amount" (the reading PAR-03 makes) */
async function rowsOf(loc) {
  return loc.evaluate((el) => Array.from(el.querySelectorAll('div')).filter((d) => d.children.length === 2 && d.style.display === 'flex').map((d) => Array.from(d.children).map((c) => c.textContent.trim().replace(/\s+/g, ' ')).join(' | ')));
}
const digitsOf = (s) => String(s || '').replace(/[^0-9.]/g, '');   /* (2026-10-02) the detail reads the frozen bill: compare the TOTAL, not rebuilt rows */
const norm = (rows) => rows.map((r) => r.replace(/[\s ]+/g, ' ').replace(/[—–]/g, '-')).filter((r) => !/^Goods/.test(r));
/** the row's price column and its tags (minus the stock stamp) — the same reading PAR-03 makes */
async function rowFacts(row) {
  const price = (await row.locator('.cbcat-pr').innerText()).replace(/\s+/g, ' ').trim();
  const tags = (await row.locator('.cbcat-tags').innerText().catch(() => '')).split('\n').map((s) => s.trim()).filter((s) => s && !/in stock|as of/i.test(s)).join(' · ');
  return { tags, price };
}
/** open (or re-open) the supplier on the Suppliers screen and return the product row */
async function openSupplier(b, handle, itemId) {
  await clickNav(b, 'order'); await settle(b);            /* leave and come back — a fresh catalogue read, never a cached view */
  await clickNav(b, 'suppliers'); await settle(b);
  const supRow = b.locator('[data-testid^="sup-row-"]').filter({ hasText: String(handle) }).first(); await supRow.waitFor({ timeout: 30000 }); await supRow.click(); await settle(b);
  const row = b.getByTestId('cbcat-row-' + itemId); await row.waitFor({ timeout: 40000 }); await b.waitForTimeout(800);
  return row;
}

test('[OFF-03] an offer "Only for" a customer group reaches the customer on Suppliers, nobody else', async ({ page, browser }) => {
  test.setTimeout(480000);
  const sellerName = 'OnlyFor ' + Date.now().toString().slice(-6);
  await mintEntity(page, { fresh: true, name: sellerName });
  await page.evaluate(async () => { await api('saveProfile', { body: { catalogue_visibility: 'public' } }); });
  await clickNav(page, 'catalogue');
  await addProduct(page, { name: 'Grapes', unit: 'kg', price: 200, code: 'GRP-1' });
  const { handle, bridge, itemId } = await page.evaluate(async () => {
    const list = await api('prodList', { query: { limit: 50 } }); const items = list.items || list.products || list.rows || (Array.isArray(list) ? list : []);
    const g = items.find((x) => /^grapes$/i.test(((x.item_data || {}).name || '')));
    const today = new Date().toISOString().slice(0, 10), later = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    /* the rule the editor's "Only for" picker writes: customer_group + its travelling name */
    await fetch(CFG.API_BASE + '/api/definitions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SESSION.token }, body: JSON.stringify({ kind: 'offer', sub_kind: 'percent_off', name: 'Regulars 10%', status: 'live', confirmed: true, rules: { kind: 'percent_off', label: 'Regulars 10%', alias: 'Tier1 customer', percent: 10, scope: 'line', customer_group: 'new', customer_name: 'New customers', valid_from: today, valid_to: later } }) });
    /* a CART-scope offer only for new customers — the case that reached the cart and not the order (Athi, 2026-09-06 18:2x) */
    await fetch(CFG.API_BASE + '/api/definitions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SESSION.token }, body: JSON.stringify({ kind: 'offer', sub_kind: 'percent_off', name: 'Tier1 basket 5%', status: 'live', confirmed: true, rules: { kind: 'percent_off', label: 'Tier1 basket 5%', percent: 5, scope: 'cart', customer_group: 'new', customer_name: 'New customers', valid_from: today, valid_to: later } }) });
    const me = await api('me'); const e = (me && me.entity) || me || {};
    return { handle: e.user_id || e.bridge_id, bridge: e.bridge_id, itemId: g.item_id };
  });

  const buyer = await mintInContext(browser, { fresh: true, name: 'Stranger ' + Date.now().toString().slice(-5) });
  try {
    const b = buyer.page;
    await clickNav(b, 'suppliers'); await settle(b);
    await b.getByTestId('sup-add-input').fill(String(handle)); await b.getByTestId('sup-add').click();
    await b.getByTestId('confirm-ok').click({ timeout: 15000 }).catch(() => {}); await settle(b);

    /* 1 · A STRANGER: list price, no badge */
    let row = await openSupplier(b, handle, itemId);
    let f = await rowFacts(row);
    expect(f.price, 'a stranger sees the list price').toMatch(/200\.00/);
    expect(f.price, 'a stranger sees no offered price').not.toMatch(/180\.00|170\.00/);
    expect(f.tags, 'a stranger sees no badge').not.toMatch(/10% off|Regulars/);
    expect(await b.locator('[data-testid^="sup-foryou-"]').count(), 'a stranger\'s supplier row carries no tag').toBe(0);

    /* 2 · THE PUBLIC STOREFRONT: the offer is not in the payload at all */
    const pub = await b.evaluate(async (bid) => { const r = await fetch(CFG.API_BASE + '/api/catalogue/' + bid); const j = await r.json(); return { offers: (j.offers || []).map((o) => o.label), groups: j.shop && j.shop.viewer_groups }; }, bridge);
    expect(pub.offers, 'the anonymous payload carries no customer-only offer').toEqual([]);

    /* 3 · ONE ORDER makes them a customer ("new") */
    await row.locator('[data-testid="cart-add"]').first().click(); await b.waitForTimeout(400);
    await b.getByRole('button', { name: /Check out/ }).last().click(); await settle(b);
    for (let i = 0; i < 4; i++) {
      const next = b.getByRole('button', { name: /Next|Review|Check it|Continue/ }).last();
      if (await next.isVisible().catch(() => false)) { await next.click(); await settle(b); } else break;
    }
    const sent = b.waitForResponse((r) => /\/api\/chits\/send$/.test(r.url()) && r.request().method() === 'POST', { timeout: 60000 });
    const send = b.locator('[data-testid^="step-send-"], [data-testid="chit-send"]').first();
    if (await send.isVisible().catch(() => false)) await send.click(); else await b.getByRole('button', { name: /Send/ }).last().click();
    const sr = await sent; expect(sr.status(), 'the order went').toBeLessThan(300);
    await settle(b); await b.waitForTimeout(1500);

    /* 4 · THE CUSTOMER: the badge and the offered price, on the same screen */
    row = await openSupplier(b, handle, itemId);
    f = await rowFacts(row);
    expect(f.tags, 'the customer sees the badge, by the ALIAS the seller chose').toMatch(/Tier1 customer · 10% off/);
    expect(f.tags, 'the internal name never leaves the shop').not.toMatch(/Regulars/);
    expect(f.tags, 'a basket offer is not on the row (decision 3)').not.toMatch(/Tier1 basket 5%/);
    await expect(b.locator('[data-testid^="sup-foryou-"]').first(), 'the supplier row says what is special for this customer, by the alias').toContainText('Tier1 customer');
    expect(await b.locator('[data-testid="sup-standing"]').count(), 'no standing line in the header').toBe(0);
    expect(f.price, 'the customer sees the price after the line offer (a basket offer lives in the money block — decision 3)').toMatch(/180\.00/);
    const groups = await b.evaluate(() => { try { const st = UI._supCart && UI._supCart.state ? UI._supCart.state() : null; return st && st.cat && st.cat.shop && st.cat.shop.viewer_groups; } catch (_) { return null; } });
    if (groups) expect(groups, 'the view names the customer and their group').toEqual(expect.arrayContaining(['new']));

    /* 4b · THE ORDER IS THE CART, customer-only offers included: two rows in the float (one line-scope, one cart-scope), the same two on the order page */
    await row.locator('[data-testid="cart-add"]').first().click(); await b.waitForTimeout(150);
    await row.locator('[data-testid="cart-add"]').first().click(); await b.waitForTimeout(500);
    const float = b.getByTestId('sup-side-money'); await float.waitFor({ timeout: 20000 });
    const cartMoney = norm(await rowsOf(float));
    expect(cartMoney, 'the cart shows both customer-only offers, by alias and name').toEqual(expect.arrayContaining([expect.stringMatching(/Tier1 customer/), expect.stringMatching(/Tier1 basket 5%/)]));
    expect(await float.locator('[data-testid="cbcart-foryou"]').count(), 'customer-only rows say "only for you"').toBeGreaterThanOrEqual(2);
    /* the bar's headline is the after-offers figure, basket-level offer included (Athi, 2026-09-06: "cart also didn't consider the offer"): 3 kg × 200 − 10% − 5% of the rest */
    const after = cartMoney.find((r) => /After offers/.test(r)) || ''; const afterAmt = (after.match(/[0-9][0-9,]*.[0-9]{2}/) || [''])[0];
    expect(afterAmt, 'the block says an after-offers figure').toBeTruthy();
    await expect(b.locator('.cbcart-bar').first(), 'the bar says the same figure as the block').toContainText(afterAmt);
    await b.getByRole('button', { name: /Check out/ }).last().click(); await settle(b);
    for (let i = 0; i < 4; i++) { const next = b.getByRole('button', { name: /Next|Review|Check it|Continue/ }).last(); if (await next.isVisible().catch(() => false)) { await next.click(); await settle(b); } else break; }
    const sent2 = b.waitForResponse((r) => /\/api\/chits\/send$/.test(r.url()) && r.request().method() === 'POST', { timeout: 60000 });
    const send2 = b.locator('[data-testid^="step-send-"], [data-testid="chit-send"]').first();
    if (await send2.isVisible().catch(() => false)) await send2.click(); else await b.getByRole('button', { name: /Send/ }).last().click();
    const sj2 = await (await sent2).json().catch(() => ({})); const chit2 = sj2.chit_id || (sj2.chit && sj2.chit.chit_id); expect(chit2).toBeTruthy();
    await settle(b); await b.waitForTimeout(1500);
    await clickNav(b, 'order'); await settle(b);
    await b.evaluate((id) => openChit(id), chit2); await settle(b);
    const oRow = b.locator('[data-testid="c2-line-0"], [data-testid="chit-line-0"]').first(); await oRow.waitFor({ timeout: 60000 });
    const oMoney = norm(await rowsOf(b.locator('[data-testid="c2-money"], [data-testid="chit-money"]').first()));
    const strip = (rows) => rows.map((r) => r.replace(/only for you/g, '').replace(/\s+\|/, ' |').replace(/\s+/g, ' ').trim());
    expect(digitsOf(await b.locator('[data-testid="c2-total"], [data-testid="chit-total"]').first().innerText()), 'the order page reads the stored total, equal to the cart total').toBe(digitsOf((cartMoney.find((r) => /Total incl/.test(r)) || '').split('|').pop()));

    /* 5 · THE SELLER MOVES THEM TO ANOTHER GROUP on the Customers pane — the offer for new customers leaves */
    await clickNav(page, 'customers'); await settle(page);
    const cRow = page.locator('[data-testid^="cust-row-"]').first(); await cRow.waitFor({ timeout: 30000 }); await cRow.click(); await settle(page);
    const saved = page.waitForResponse((r) => /\/api\/relationships\/customers\//.test(r.url()) && r.request().method() === 'PATCH', { timeout: 30000 });
    await page.getByTestId('cust-group').selectOption('high_value');
    expect((await saved).status(), 'the group saved').toBeLessThan(300);
    row = await openSupplier(b, handle, itemId);
    f = await rowFacts(row);
    expect(f.tags, 'a high-value customer is not a new one').not.toMatch(/10% off/);
    expect(f.price, 'back to the list price').toMatch(/200\.00/);
  } finally { await buyer.context.close(); }
});
