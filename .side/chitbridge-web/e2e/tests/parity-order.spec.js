// [PAR-03] THE ORDER PAGE IS THE CART — ditto. A buyer puts 2 kg of a supplier's Grapes (₹200, 5% GST, a live 10% offer) in the
// Suppliers cart, sends the order, and opens it on the Order page. The row there must print what the cart row printed (name · unit ·
// offer · slab · ~~₹200.00~~ ₹180.00 · +5% GST · ₹189.00 incl.) and the money block must print the cart's block line for line
// (Flat 10% −₹40.00 · After offers ₹360.00 · GST · 5% ₹18.00 · Total incl. tax ₹378.00).
// Athi, 2026-09-06 10:19: "4 products selected, but the order page is not reflecting the exact cart… it has to be the exact cart and the
// values and the information — ditto, including the format." Found: the send path priced with the SENDER's shelf, the chit carried list
// prices and no offer, and the Order tab drew its own rows. This spec is the proof that closes it, and the guard that keeps it closed.
const { test, expect } = require('@playwright/test');
const { mintEntity, mintInContext, addProduct, clickNav, settle } = require('../fixtures');

/** the money block as text: one line per row, "label | amount" */
async function rowsOf(loc) {
  return loc.evaluate((el) => Array.from(el.querySelectorAll('div')).filter((d) => d.children.length === 2 && d.style.display === 'flex').map((d) => Array.from(d.children).map((c) => c.textContent.trim().replace(/\s+/g, ' ')).join(' | ')));
}
/** (2026-10-02) the detail READS the frozen bill (CBSheet.moneyFor), it does not rebuild the cart's rows: what must equal the cart is the TOTAL, to the paisa */
const digitsOf = (s) => String(s || '').replace(/[^0-9.]/g, '');
const cartTotal = (rows) => digitsOf((rows.find((r) => /Total incl/.test(r)) || '').split('|').pop());
const norm = (rows) => rows.map((r) => r.replace(/[\s ]+/g, ' ').replace(/[—–]/g, '-')).filter((r) => !/^Goods/.test(r));
/** the row's price column and its tags, minus the stock stamp (presence data, not order data) */
async function rowFacts(row) {
  const price = (await row.locator('.cbcat-pr').innerText()).replace(/\s+/g, ' ').trim();
  const tags = (await row.locator('.cbcat-tags').innerText().catch(() => '')).split('\n').map((s) => s.trim()).filter((s) => s && !/in stock|as of/i.test(s)).join(' · ');
  const name = (await row.locator('.cbcat-nm').innerText()).trim();
  const unit = (await row.locator('.cbcat-sub').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  return { name, unit, tags, price };
}

test('[PAR-03] the order page prints the cart — row, offer, slab, price column and money block', async ({ page, browser }) => {
  test.setTimeout(420000);
  const sellerName = 'Ditto ' + Date.now().toString().slice(-6);
  await mintEntity(page, { fresh: true, name: sellerName });
  await page.evaluate(async () => { await api('saveProfile', { body: { gstn: '33AABCK1234F1Z6', catalogue_visibility: 'public' } }); });
  await clickNav(page, 'catalogue');
  await addProduct(page, { name: 'Grapes', unit: 'kg', price: 200, code: 'GRP-1' });
  const { handle, itemId } = await page.evaluate(async () => {
    const list = await api('prodList', { query: { limit: 50 } }); const items = list.items || list.products || list.rows || (Array.isArray(list) ? list : []);
    const g = items.find((x) => /^grapes$/i.test(((x.item_data || {}).name || '')));
    await api('prodEdit', { params: { id: g.item_id }, body: { item_data: Object.assign({}, g.item_data, { gst_rate: 5, hsn: '0806' }) } });
    const today = new Date().toISOString().slice(0, 10), later = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    await fetch(CFG.API_BASE + '/api/definitions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SESSION.token }, body: JSON.stringify({ kind: 'offer', sub_kind: 'percent_off', name: 'Flat 10%', status: 'live', confirmed: true, rules: { kind: 'percent_off', label: 'Flat 10%', percent: 10, scope: 'line', valid_from: today, valid_to: later } }) });
    const me = await api('me'); const e = (me && me.entity) || me || {};
    return { handle: e.user_id || e.bridge_id, itemId: g.item_id };
  });

  const buyer = await mintInContext(browser, { fresh: true, name: 'Buyer ' + Date.now().toString().slice(-5) });
  try {
    const b = buyer.page;
    await b.evaluate(async () => { await api('saveProfile', { body: { gstn: '33ABCPE1234F1Z7' } }); });
    await clickNav(b, 'suppliers'); await settle(b);
    await b.getByTestId('sup-add-input').fill(String(handle)); await b.getByTestId('sup-add').click();
    await b.getByTestId('confirm-ok').click({ timeout: 15000 }).catch(() => {}); await settle(b);
    const supRow = b.locator('[data-testid^="sup-row-"]').filter({ hasText: String(handle) }).first(); await supRow.waitFor({ timeout: 30000 }); await supRow.click(); await settle(b);
    const row = b.getByTestId('cbcat-row-' + itemId); await row.waitFor({ timeout: 40000 });
    await row.locator('[data-testid="cart-add"]').first().click(); await b.waitForTimeout(150);
    await row.locator('[data-testid="cart-add"]').first().click(); await b.waitForTimeout(500);

    /* THE CART, as printed */
    const cartRow = await rowFacts(row);
    const float = b.getByTestId('sup-side-money'); await float.waitFor({ timeout: 20000 });
    const cartMoney = norm(await rowsOf(float));
    expect(cartMoney, 'the cart block').toEqual(expect.arrayContaining([expect.stringMatching(/Flat 10%.*40/), expect.stringMatching(/After offers.*360/), expect.stringMatching(/GST.*5%.*18/), expect.stringMatching(/Total incl\. tax.*378/)]));

    /* CHECK OUT → send */
    await b.getByRole('button', { name: /Check out/ }).last().click(); await settle(b);
    for (let i = 0; i < 4; i++) {
      const next = b.getByRole('button', { name: /Next|Review|Check it|Continue/ }).last();
      if (await next.isVisible().catch(() => false)) { await next.click(); await settle(b); } else break;
    }
    const sent = b.waitForResponse((r) => /\/api\/chits\/send$/.test(r.url()) && r.request().method() === 'POST', { timeout: 60000 });
    const send = b.locator('[data-testid^="step-send-"], [data-testid="chit-send"]').first();
    if (await send.isVisible().catch(() => false)) await send.click(); else await b.getByRole('button', { name: /Send/ }).last().click();
    const sr = await sent; const sj = await sr.json().catch(() => ({}));
    expect(sr.status(), JSON.stringify(sj).slice(0, 200)).toBeLessThan(300);
    const chitId = sj.chit_id || (sj.chit && sj.chit.chit_id); expect(chitId, 'the chit id').toBeTruthy();

    /* THE ORDER PAGE, as printed — reached the way a person reaches it: the app's own post-send landing, then the row in Order.
       (Calling openChit the instant the send returned raced the app's own navigation and left "Loading record…" on screen, run 17.) */
    await settle(b); await b.waitForTimeout(1500);
    await clickNav(b, 'order'); await settle(b);
    const chitRow = b.locator('[data-testid^="chit-row-"], .row').filter({ hasText: /Order/ }).first();
    if (await chitRow.isVisible().catch(() => false)) { await chitRow.click(); await settle(b); }
    else { await b.evaluate((id) => openChit(id), chitId); await settle(b); }
    const ordTab = b.getByTestId('c2-tab-ord'); if (await ordTab.isVisible().catch(() => false)) { await ordTab.click(); await settle(b); }
    const oRow = b.locator('[data-testid="c2-line-0"], [data-testid="chit-line-0"]').first(); await oRow.waitFor({ timeout: 60000 });   /* Design 2's Order tab or Design 1's Content — both are the cart */
    const orderRow = await rowFacts(oRow);
    const oMoney = norm(await rowsOf(b.locator('[data-testid="c2-money"], [data-testid="chit-money"]').first()));

    /* DITTO */
    expect(orderRow.name).toBe(cartRow.name);
    expect(orderRow.unit).toBe(cartRow.unit);
    expect(orderRow.tags, 'offer badge and slab').toBe(cartRow.tags);
    expect(orderRow.price, 'the price column').toBe(cartRow.price);
    expect(digitsOf(await b.locator('[data-testid="c2-total"], [data-testid="chit-total"]').first().innerText()), 'the order page: the stored total equals the cart total').toBe(cartTotal(cartMoney));

    /* THE SUMMARY TAB — the cart's money again, nothing else (Athi, 2026-09-06 11:30: "nothing but the financial summary from the cart… and
       delivery summary… do not add anything without my knowledge"). Its block equals the cart's; no clearances, no commercial cover by default. */
    const sTab = b.getByTestId('dtab-summary'); if (await sTab.isVisible().catch(() => false)) {
      await sTab.click(); await settle(b);
      const sMoney = norm(await rowsOf(b.getByTestId('chit-summary-money')));
      expect(digitsOf(await b.getByTestId('chit-summary-total').innerText()), 'summary: the stored total equals the cart total').toBe(cartTotal(cartMoney));
      await expect(b.getByTestId('chit-summary-grand')).toHaveText(/378/);
      await expect(b.getByTestId('chit-summary-savings')).toHaveText(/40/);
      const extra = await b.locator('.dbody, #detail, body').first().innerText();
      expect(extra, 'summary: no cover without the flag').not.toMatch(/Commercial cover|Supplier clearances/);
    }

    /* THE SELLER'S TASK — Design 1 on the other side (Athi, 2026-09-06 11:2x: "design 1, which is the task, should be the same as the cart,
       no difference"): the same record, the same renderer, the same words and figures. */
    await page.evaluate((id) => openChit(id), chitId); await settle(page);
    const tRow = page.locator('[data-testid="c2-line-0"], [data-testid="chit-line-0"]').first(); await tRow.waitFor({ timeout: 60000 });
    const taskRow = await rowFacts(tRow);
    const tMoney = norm(await rowsOf(page.locator('[data-testid="c2-money"], [data-testid="chit-money"]').first()));
    expect(taskRow.name).toBe(cartRow.name);
    expect(taskRow.tags, 'task: offer badge and slab').toBe(cartRow.tags);
    expect(taskRow.price, 'task: the price column').toBe(cartRow.price);
    expect(digitsOf(await page.locator('[data-testid="c2-total"], [data-testid="chit-total"]').first().innerText()), 'task: the stored total equals the cart total').toBe(cartTotal(cartMoney));
  } finally { await buyer.context.close(); }
});
