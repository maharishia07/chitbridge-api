// tests/store.spec.js — network storefront + order loop, HUMAN-level (Playwright drives the real store UI).
// STORE-01 verifies each case of the requirement:
//   · one network store shows products across lines of business (Grocery + Meat)
//   · the internal department/node is NEVER shown to the customer
//   · the customer SEARCHES products (doesn't walk any tree)
//   · add to cart → place order (a real order, not API-only)
//   · the order routes to SILENT per-store fragments the customer can't see, while the OPERATOR can walk the
//     order forward to the fragments (convergence on the common ORDER_ID)
const { test, expect, request } = require('@playwright/test');
require('../fixtures').needCode(test);   // SEC1: no sign-in code for this target (E2E_TESTER_CODE) → the file SKIPS with a CI warning
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';
const H = (t) => ({ Authorization: 'Bearer ' + t });

async function mint(api, name){
  const email = `store-${name.replace(/\W+/g, '')}-${Date.now()}-${Math.floor(Math.random() * 1e5)}@node.cb`;
  await api.post(`${API}/api/entities/register`, { data: { display_name: name, email, user_id: 'e' + Date.now() + Math.floor(Math.random()*1e6) } });
  const v = await (await api.post(`${API}/api/entities/verify`, { data: { email, otp: require('../fixtures').signinCode() } })).json();
  return { id: v.entity.identity_id, token: v.token, name };
}

test('[STORE-01] customer orders across a network storefront; order routes to silent fragments', async ({ page }) => {
  const api = await request.newContext();
  // ── setup: one operator + two line-of-business nodes with PUBLIC products, one network ──
  const op = await mint(api, 'OpStore');
  const grocery = await mint(api, 'Grocery Dept');
  const meat = await mint(api, 'Meat Dept');
  const NET = 'store-e2e-' + Date.now();
  for (const [node, prod, cat, price] of [[grocery, 'Basmati Rice 5kg', 'Grocery', 499], [meat, 'Chicken 1kg', 'Meat', 280]]) {
    await api.patch(`${API}/api/schemas/visibility`, { headers: H(node.token), data: { visibility: 'public' } });
    const r = await api.post(`${API}/api/products`, { headers: H(node.token), data: { item_data: { name: prod, category: cat, price, unit: 'unit', network_id: NET, operator: op.id } } });
    expect(r.ok(), 'product added').toBeTruthy();
  }
  // internal-only nodes — part of the SAME network (do delivery / warehouse / internal workflows) but their
  // catalogue is declared PRIVATE, so they must NEVER appear in the public storefront even though tagged to it.
  const warehouse = await mint(api, 'Central Warehouse');
  const delivery = await mint(api, 'Delivery Fleet');
  for (const node of [warehouse, delivery]) {
    await api.patch(`${API}/api/schemas/visibility`, { headers: H(node.token), data: { visibility: 'private' } });
    await api.post(`${API}/api/products`, { headers: H(node.token), data: { item_data: { name: node.name + ' internal item', category: 'Internal', price: 0, unit: 'unit', network_id: NET, operator: op.id } } });
  }

  // ── the customer opens the store (human activity, UI) ──
  await page.goto('/store.html?net=' + NET);
  await expect(page.getByText('Basmati Rice 5kg')).toBeVisible();
  await expect(page.getByText('Chicken 1kg')).toBeVisible();

  // CASE: the internal department/node is NEVER shown
  await expect(page.getByText('Grocery Dept')).toHaveCount(0);
  await expect(page.getByText('Meat Dept')).toHaveCount(0);

  // CASE: internal-only nodes (private catalogue, doing delivery/warehouse workflows) are NEVER in the storefront,
  //       even though tagged to the same network — the 'Internal' category never surfaces either
  await expect(page.getByText('Central Warehouse')).toHaveCount(0);
  await expect(page.getByText('Delivery Fleet')).toHaveCount(0);
  await expect(page.getByText('Internal', { exact: true })).toHaveCount(0);

  // CASE: search by product (the customer searches; there is no tree to walk)
  await page.getByPlaceholder('Search products').fill('rice');
  await expect(page.getByText('Chicken 1kg')).toHaveCount(0);
  await expect(page.getByText('Basmati Rice 5kg')).toBeVisible();
  await page.getByPlaceholder('Search products').fill('');

  // CASE: category chips = the lines of business (scope to the chip bar — the label also appears on product cards)
  await expect(page.locator('#cats').getByText('Grocery', { exact: true })).toBeVisible();
  await expect(page.locator('#cats').getByText('Meat', { exact: true })).toBeVisible();

  // CASE: add to cart
  await page.getByRole('button', { name: 'Add' }).first().click();
  await expect(page.locator('#cartbar')).toContainText('item');

  // CASE: place order — the customer fills name/email; the confirmation alert carries the order id
  let orderMsg = '';
  page.on('dialog', async (d) => {
    const t = d.message();
    if (/name/i.test(t)) await d.accept('E2E Buyer');
    else if (/email/i.test(t)) await d.accept('e2e-buyer-' + Date.now() + '@shopper.cb');
    else { orderMsg = t; await d.accept(); }   // the "Order placed" alert
  });
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect.poll(() => orderMsg, { timeout: 15000 }).toContain('Order placed');
  await expect(page.locator('#cartbar')).not.toHaveClass(/show/);

  // ── verify convergence + silent routing (as the operator) ──
  const batches = await (await api.get(`${API}/api/chits/trace/batches`, { headers: H(op.token) })).json();
  const order = (batches.batches || []).find((b) => b.network === NET && b.is_origin);
  expect(order, 'operator co-holds the customer order').toBeTruthy();
  const walk = await (await api.get(`${API}/api/chits/${order.chit_id}/trace?dir=forward&network=${NET}`, { headers: H(op.token) })).json();
  expect(walk.reachable_count, 'the order + at least one fulfilment fragment converge under the operator').toBeGreaterThan(1);
});
