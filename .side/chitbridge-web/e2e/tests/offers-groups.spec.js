// offers-groups.spec.js — [OFF-04] NAMED CUSTOMER GROUPS (decision 2, Athi 2026-09-06: "we should be having option to name them"). The seller adds a buyer by
// hand, places them in "dealers", and scopes an offer "Only for" that group, shown as "Dealer price". The buyer's Suppliers row carries
// the tag by the alias; taken out of the group, the tag is gone. Skips itself — and says so — until migration customer_groups is run.
const { test, expect } = require('@playwright/test');
const { mintEntity, mintInContext, clickNav, settle, addProduct } = require('../fixtures');

test('[OFF-04] an offer "Only for" a named group reaches the customers placed in it', async ({ page, browser }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true, name: 'Groups ' + Date.now().toString().slice(-6) });
  const mig = await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); return api('custGroupNames'); });
  test.skip(!mig || mig.migrated === false, 'named groups need migration customer_groups (run it in the Supabase SQL editor)');
  await page.evaluate(async () => { await api('saveProfile', { body: { catalogue_visibility: 'public' } }); });
  await clickNav(page, 'catalogue'); await addProduct(page, { name: 'Grapes', unit: 'kg', price: 200, code: 'GRP-1' });
  const handle = await page.evaluate(async () => { const me = await api('me'); const e = (me && me.entity) || me || {}; return e.user_id || e.bridge_id; });
  const buyer = await mintInContext(browser, { fresh: true, name: 'Dealer ' + Date.now().toString().slice(-5) });
  try {
    const b = buyer.page; const bh = await b.evaluate(async () => { const me = await api('me'); const e = (me && me.entity) || me || {}; return e.user_id || e.bridge_id; });
    const listId = await page.evaluate(async (h) => {
      const r = await api('custAdd', { body: { handle: h } }); await api('custGroupsSet', { params: { id: r.customer.customer_list_id }, body: { groups: ['dealers'] } });
      const today = new Date().toISOString().slice(0, 10), later = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      await fetch(CFG.API_BASE + '/api/definitions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SESSION.token }, body: JSON.stringify({ kind: 'offer', sub_kind: 'percent_off', name: 'dealers 15', alias: undefined, status: 'live', confirmed: true, rules: { kind: 'percent_off', label: 'dealers 15', alias: 'Dealer price', percent: 15, scope: 'line', customer_group: 'group:dealers', customer_name: 'dealers', valid_from: today, valid_to: later } }) });
      return r.customer.customer_list_id;
    }, bh);
    expect((await page.evaluate(async () => api('custGroupNames'))).names, 'the seller\'s names').toContain('dealers');
    await clickNav(b, 'suppliers'); await settle(b);
    await b.getByTestId('sup-add-input').fill(String(handle)); await b.getByTestId('sup-add').click(); await b.getByTestId('confirm-ok').click({ timeout: 15000 }).catch(() => {}); await settle(b);
    const tag = b.locator('[data-testid^="sup-foryou-"]').first(); await tag.waitFor({ timeout: 30000 });
    await expect(tag, 'the dealer sees the offer by its alias').toContainText('Dealer price'); await expect(tag).not.toContainText('dealers 15');
    /* taken out of the group */
    await page.evaluate(async (id) => { await api('custGroupsSet', { params: { id }, body: { groups: [] } }); }, listId);
    await clickNav(b, 'order'); await settle(b); await clickNav(b, 'suppliers'); await settle(b);
    await expect(b.locator('[data-testid^="sup-foryou-"]'), 'out of the group, no tag').toHaveCount(0, { timeout: 30000 });
  } finally { await buyer.context.close(); }
});
