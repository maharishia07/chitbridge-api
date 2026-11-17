// variants.spec.js — one product, several purchasable lines: does a SHOPPER see it that way?
//
// Athi, 2026-08-06: "so each variant can have its own price?" and "will the variant come one after another in the
// storefront or to the supplier?"
//
// The Medusa comparison measured the gap: one paint with three pack sizes rendered as THREE UNRELATED PRODUCTS.
// Unit tests can prove the grouping function groups. They cannot prove the browser SHOWS it — and the bug I nearly
// shipped was exactly that: catalogue-view built the `groups` payload and neither route forwarded it, so every unit
// test passed and the storefront would have rendered a flat list forever.
//
// So this arranges by API and asserts in the BROWSER, on the real storefront.
//
//   npx playwright test variants --project=noauth

const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');

const API = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
const OTP = require('../fixtures').signinCode();   // SEC1: the tester code (E2E_TESTER_CODE) on a deployed api, the local code on a local one
require('../fixtures').needCode(test);   // no code → the file SKIPS with a CI warning naming the secret
const SHOP = { email: 'beta@test-cb.com', name: 'Beta Fresh' };

// One paint, three pack sizes, three different prices — the exact case that flattened.
const LINES = [
  { sku: 'VR-1L',  size: '1L',  price: 950 },
  { sku: 'VR-4L',  size: '4L',  price: 3400 },
  { sku: 'VR-10L', size: '10L', price: 7900 },
];
const PRODUCT = 'vartest';
const NAME = 'Variant Test Paint';

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null; try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}

async function signIn() {
  await api('/api/entities/register', { method: 'POST', body: { email: SHOP.email, display_name: SHOP.name } });
  const v = await api('/api/entities/verify', { method: 'POST', body: { email: SHOP.email, otp: OTP } });
  const j = v.json || {};
  return j.token || (j.entity && j.entity.token) || null;
}

let TOKEN = null, BRIDGE = null, FACE0 = null, CREATED = [];

test.beforeAll(async () => {
  TOKEN = await signIn();
  expect(TOKEN, 'could not sign in — is the API up?').toBeTruthy();

  const me = await api('/api/entities/me', { token: TOKEN });
  BRIDGE = (me.json && (me.json.bridge_id || (me.json.entity && me.json.entity.bridge_id))) || null;
  expect(BRIDGE).toBeTruthy();

  // Keep the shop's own face so the teardown can put it back exactly. The face is saved WHOLE — replacing it with
  // only `identity` would wipe order_input and the shop would stop taking orders the way it declared.
  FACE0 = (await api('/api/catalogue-face', { token: TOKEN })).json?.face || {};
  /* the shop must be PUBLIC for /api/catalogue/<bridge> to answer — a fresh shop is private by default (found 2026-09-05: every
     storefront assertion here read "Shop not found" because nothing ever flipped it) */
  await api('/api/entities/profile', { method: 'PATCH', token: TOKEN, body: { catalogue_visibility: 'public' } });

  // Arrange by API: import the three lines, creating the `product` and `size` columns.
  const csv = 'sku,name,product,size,price\n'
    + LINES.map((l) => `${l.sku},${NAME},${PRODUCT},${l.size},${l.price}`).join('\n') + '\n';
  // Decisions come from the PREFLIGHT, exactly as the UI builds them: map where the catalogue already accepts the
  // column, create where it does not.
  //
  // Hardcoding `create` for product/size failed with a 400 the first time this ran — correctly, because an earlier
  // check had already created those columns and the guard refuses to create a second column meaning the same thing.
  // A spec that only passes against a pristine catalogue is a spec that will fail on the shop it is meant to
  // protect, so it asks the server what it accepts rather than assuming.
  const pf = await api('/api/products/import/preflight', { method: 'POST', token: TOKEN, body: { csv } });
  expect(pf.status, JSON.stringify(pf.json)).toBe(200);
  const decisions = (pf.json.report.mapping || [])
    .filter((m) => m.how !== 'blocked' && m.how !== 'empty')
    .map((m) => (m.canonical
      ? { incoming: m.incoming, action: 'map', field: m.canonical }
      : { incoming: m.incoming, action: 'create' }));
  const imp = await api('/api/products/import', { method: 'POST', token: TOKEN, body: { csv, decisions, confirm: true } });
  expect(imp.status, JSON.stringify(imp.json)).toBe(200);
  CREATED = (imp.json.outcome || []).map((o) => o.sku);

  // Declare the grouping — PATCHING the face, never replacing it.
  const face = { ...FACE0, identity: { key: ['sku'], group: 'product', options: ['size'] } };
  const put = await api('/api/catalogue-face', { method: 'PUT', token: TOKEN, body: { face } });
  expect(put.status, JSON.stringify(put.json)).toBe(200);
});

test.afterAll(async () => {
  if (!TOKEN) return;
  // Leave the shop as we found it — an earlier matrix run left Alpha declared `enquiry` for a day because it did not.
  const list = await api('/api/products', { token: TOKEN });
  for (const it of (list.json?.items || [])) {
    if (String(it.item_data?.sku || '').startsWith('VR-')) {
      await api('/api/products/' + it.item_id, { method: 'DELETE', token: TOKEN });
    }
  }
  await api('/api/catalogue-face', { method: 'PUT', token: TOKEN, body: { face: FACE0 } });
});

test.describe('variants', () => {
  test('★ the API groups three lines into ONE product', async () => {
    const pub = await api('/api/catalogue/' + BRIDGE);
    expect(pub.status).toBe(200);
    const g = (pub.json.groups || []).find((x) => x.label === NAME);
    expect(g, 'no group for the imported paint — is `groups` forwarded by the route?').toBeTruthy();
    expect(g.lines.length).toBe(3);
  });

  test('★ each variant keeps its OWN price', async () => {
    const pub = await api('/api/catalogue/' + BRIDGE);
    const byId = Object.fromEntries((pub.json.items || []).map((p) => [p.item_id, p.item_data]));
    const g = (pub.json.groups || []).find((x) => x.label === NAME);
    const prices = g.lines.map((l) => byId[l.item_id]?.price?.amount);
    expect(prices).toEqual([950, 3400, 7900]);
  });

  test('the variants come in the order they were listed, not newest-first', async () => {
    // Found live: a sheet listing 1L, 4L, 10L came back to the shopper as 10L, 4L, 1L, because the items query is
    // created_at DESC. Display order taken from the storage clock.
    const pub = await api('/api/catalogue/' + BRIDGE);
    const g = (pub.json.groups || []).find((x) => x.label === NAME);
    expect(g.lines.map((l) => l.variant)).toEqual(['1L', '4L', '10L']);
  });

  test('★ the STOREFRONT shows one product with its sizes underneath', async ({ page }) => {
    // The assertion that unit tests structurally cannot make.
    await page.goto(`/shop.html?bridge=${BRIDGE}&api=${encodeURIComponent(API)}`, { waitUntil: 'networkidle' });
    await expect(page.locator('.wrap')).toContainText(NAME);

    // The product name appears ONCE as a heading, not three times as three products.
    const body = await page.locator('.wrap').innerText();
    const occurrences = body.split(NAME).length - 1;
    expect(occurrences, 'the product name is repeated — it is still rendering as separate products').toBe(1);

    // …and each size is on the page with its own price.
    for (const l of LINES) {
      await expect(page.locator('.wrap')).toContainText(l.size);
      await expect(page.locator('.wrap')).toContainText(l.price.toLocaleString('en-IN'));   /* money, not numbers: ₹3,400.00 */
    }
    await expect(page.locator('.wrap')).toContainText('3 options');
  });

  test('the sizes appear one after another, in order, on the page', async ({ page }) => {
    await page.goto(`/shop.html?bridge=${BRIDGE}&api=${encodeURIComponent(API)}`, { waitUntil: 'networkidle' });
    const body = await page.locator('.wrap').innerText();

    // SCOPE TO THIS PRODUCT. Searching the whole page failed the first time this ran — and it was the test that was
    // wrong: the shop holds another paint whose sizes are also 1L/4L/10L, so indexOf found the neighbour's. A
    // positional assertion has to be scoped to the section it is asserting about, or it is asserting about the page.
    const start = body.indexOf(NAME);
    expect(start, 'the product is not on the page at all').toBeGreaterThanOrEqual(0);
    const section = body.slice(start, start + 400);

    const at = LINES.map((l) => section.indexOf(l.size));
    expect(at.every((x) => x >= 0), `a size is missing from the section: ${section}`).toBe(true);
    expect(at[0], '1L should come before 4L').toBeLessThan(at[1]);
    expect(at[1], '4L should come before 10L').toBeLessThan(at[2]);
  });

  test('★ THE SUPPLIER VIEW shows the same grouping — Alpha opens Beta', async ({ page }) => {
    // Athi, 2026-08-06: "you are logging into Alpha and calling Beta, and Beta's catalogue should render."
    //
    // The read was already shared (buildPublicView serves the storefront AND the B2B view), but the RENDER was not,
    // so the storefront learned to group variants and the supplier view did not. Worse, it only ever showed a
    // COUNT — "N item(s) in their catalogue" — and never listed anything.
    const alpha = await (async () => {
      await api('/api/entities/register', { method: 'POST', body: { email: 'alpha@test-cb.com', display_name: 'Alpha Paints' } });
      const v = await api('/api/entities/verify', { method: 'POST', body: { email: 'alpha@test-cb.com', otp: OTP } });
      return (v.json || {}).token;
    })();
    expect(alpha).toBeTruthy();

    // Alpha adds Beta as a supplier (idempotent — it may already be there from another run).
    const me = await api('/api/entities/me', { token: TOKEN });
    const betaBridge = (me.json && (me.json.bridge_id || (me.json.entity && me.json.entity.bridge_id)));
    await api('/api/relationships/suppliers', { method: 'POST', token: alpha, body: { supplier_bridge_id: betaBridge } });

    // The payload Alpha receives must carry the grouping, not just the lines.
    const sups = await api('/api/relationships/suppliers', { token: alpha });
    const row = (sups.json.suppliers || sups.json || []).find((s) => s.bridge_id === betaBridge);
    expect(row, 'Beta is not in Alpha\'s supplier list').toBeTruthy();
    const cat = await api('/api/relationships/suppliers/' + row.supplier_entity_id + '/catalogue', { token: alpha });
    expect(cat.status).toBe(200);
    const g = (cat.json.groups || []).find((x) => x.label === NAME);
    expect(g, 'the supplier payload carries no groups — is the route forwarding them?').toBeTruthy();
    expect(g.lines.map((l) => l.variant)).toEqual(['1L', '4L', '10L']);

    // …and the SUPPLIER's own currency, not the viewer's. Alpha is INR, Beta is INR here, but the field must be
    // the supplier's either way — that is what the currency matrix proved and this must not undo.
    expect(cat.json.shop && cat.json.shop.currency_code).toBeTruthy();
  });

  test('★★ ON SCREEN — Suppliers menu → open Beta → Beta\'s catalogue is visible, grouped', async ({ page }) => {
    // Athi, 2026-08-06: "there is a supplier menu, and from this menu Beta has to be called so the supplier is
    // connected and the Beta catalogue should be visible."
    //
    // The test above asserts the PAYLOAD. This one asserts the SCREEN — and that distinction is the whole reason
    // this spec exists: the payload has been correct for a while, and the supplier card still showed nothing but
    // "N item(s) in their catalogue".
    await mintEntity(page);                                   // a buyer, signed in

    /**
     * ⚠️ ACCEPT THE CONFIRM. addSupplier() asks "Add X as your supplier?" before it posts, and Playwright
     * auto-DISMISSES dialogs unless a handler says otherwise — so the add silently returned and no row ever
     * appeared. The spec then failed at `sup-row-` with "element(s) not found", ten lines before the catalogue it
     * exists to check, which made it read like a rendering fault when nothing had been rendered yet.
     *
     * A confirm() in the app is a real step a person takes; a spec that drives the app has to take it too.
     */
    /**
     * ⚠️ THE CONFIRM IS NO LONGER A BROWSER DIALOG (2026-08-16) — addSupplier() goes through the app's own
     * confirmAsk() modal now, so `page.on('dialog')` became a no-op: nobody pressed "Add supplier", no row
     * appeared, and this failed with "Beta was added but no row for them appeared". Which was TRUE — Beta was
     * never added.
     *
     * ⚠️ THIS SPEC WAS MISSED when suppliers.spec and order-steps.spec were converted, and only the FULL
     * regression found it — the scoped set does not include variants. Worth remembering: a change to a shared
     * interaction has to be swept across every spec that drives it, not just the ones named after the screen.
     */
    await page.getByTestId('nav-suppliers').click();
    await expect(page.getByTestId('sup-add-input')).toBeVisible();

    // Connect to Beta by email — create-or-reuse, so re-runs are fine.
    await page.getByTestId('sup-add-input').fill(SHOP.email);
    await page.getByTestId('sup-add').click();
    await page.getByTestId('confirm-ok').click();
    /**
     * ⚠️ BETA BY NAME, NOT `.first()`. This spec is titled "open Beta" and asserts Beta's products, but it used
     * to click whichever row sorted first — and the list is sorted by ★ Preferred, over an account that every
     * other spec in the `authed` project shares and adds its own suppliers to. So "first" is whoever happened to
     * get there, and on 2026-08-15 that was a supplier with NO catalogue: the picker rendered correctly and
     * said "Nothing published yet.", and the spec reported it as Beta's products being missing.
     *
     * A test that names one thing and clicks another cannot tell you which of the two is broken. This one cost
     * an afternoon deciding whether a cart change had emptied a catalogue it never touches.
     */
    const row = page.locator('[data-testid^="sup-row-"]').filter({ hasText: SHOP.name }).first();
    await expect(row, 'Beta was added but no row for them appeared').toBeVisible();

    // Open them.
    await row.click();
    const cat = page.getByTestId('sup-catalogue');
    await expect(cat, 'the supplier card is not rendering their catalogue at all').toBeVisible({ timeout: 15000 });

    // THE PRODUCT, ONCE — with its sizes underneath, not three separate products.
    await expect(cat).toContainText(NAME);
    await expect(cat).toContainText('3 options');
    for (const l of LINES) {
      await expect(cat).toContainText(l.size);
      await expect(cat).toContainText(l.price.toLocaleString('en-IN'));   /* money, not numbers: ₹3,400.00 */
    }
    const txt = await cat.innerText();
    expect(txt.split(NAME).length - 1, 'the product name repeats — still rendering as separate products').toBe(1);

    // …and in the order the owner listed them.
    const at = LINES.map((l) => txt.indexOf(l.size));
    expect(at[0]).toBeLessThan(at[1]);
    expect(at[1]).toBeLessThan(at[2]);
  });

  test('⚠ the ORDER PATH still works on a LINE, not on the product', async () => {
    // Grouping must change what a person SEES and nothing about what is agreed. Every one of the 7 presets works on
    // a purchasable line; if grouping had moved the price up to the product, this is where it would show.
    const pub = await api('/api/catalogue/' + BRIDGE);
    const g = (pub.json.groups || []).find((x) => x.label === NAME);
    for (const line of g.lines) {
      expect(line.item_id, 'a line must still be individually addressable').toBeTruthy();
      expect(line.identity, 'a line must still carry its own identity').toBeTruthy();
    }
    // The group itself carries no price — there is nothing there to order.
    expect(g.price).toBeUndefined();
  });
});
