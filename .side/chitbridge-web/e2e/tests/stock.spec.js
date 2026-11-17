// stock.spec.js — [STK-01] Stock with a stamp, then on demand. The connector reads closing stock from its source (here the CSV's stock
// column) and writes it in one call with the moment it was read; the storefront shows the figure ONLY with its age;
// when the storefront asks, the connector holding the bell re-reads the source and the stamp moves.
// Athi, 2026-09-05: "does it read on demand, for example availability?" → "go ahead with both, stock with stamp first".
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { mintEntity } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';
const KIT = path.resolve(__dirname, '..', '..', '..', 'chitbridge-api', 'tools', 'tally-connector');

test('[STK-01] stamped stock from the connector; the storefront shows it with its age; an ask moves the stamp', async ({ page, browser, request }) => {
  test.setTimeout(300000);
  const core = require(path.join(KIT, 'core.js'));
  const csvAdapter = require(path.join(KIT, 'adapters', 'csv.js'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-stock-'));
  fs.copyFileSync(path.join(KIT, 'samples', 'products.csv'), path.join(work, 'products.csv'));
  await mintEntity(page, { fresh: true });
  const key = await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); return (await api('keysMint', { body: { name: 'stock spec', scopes: ['connector', 'services'], days: 1 } })).key; });
  let streamUp = false;
  const log = (m) => { if (/stream up/.test(m)) streamUp = true; console.log('[stock] ' + m); };
  const cb = new core.CB({ api: API, key, log }); cb.name = 'stock spec';
  const adapter = csvAdapter({ csv: { products: path.join(work, 'products.csv'), orders: path.join(work, 'orders') }, log });
  const receipts = new core.Receipts(path.join(work, 'receipts.jsonl'));
  await core.syncProducts({ cb, adapter, receipts, log });
  const handle = await page.evaluate(async () => { await api('saveProfile', { body: { catalogue_visibility: 'public' } }); const me = await api('me'); const e = (me && me.entity) || me || {}; return e.user_id || e.bridge_id; });

  let firstAsOf = null;
  await test.step('STAMPED — closing stock written in one call; the product carries qty + as_of + source', async () => {
    const r = await core.syncStock({ cb, adapter, receipts, log });
    expect(r.written).toBe(30); expect(r.unknown).toBe(0);
    const s = await request.get(API + '/api/integrations/stock/' + encodeURIComponent(handle)); expect(s.status()).toBe(200);
    const j = await s.json(); expect(j.stock.length).toBe(30);
    const one = j.stock.find((x) => x.avail && Number(x.avail.qty) === 120); expect(one, 'Basmati 120').toBeTruthy();
    expect(one.avail.source).toBe('erp'); expect(one.avail.as_of).toBeTruthy(); firstAsOf = one.avail.as_of;
  });

  await test.step('THE STOREFRONT — the figure with its age, never bare', async () => {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } }); const shop = await ctx.newPage();
    try {
      await shop.goto('/shop.html?s=' + encodeURIComponent(handle), { waitUntil: 'load' });
      await shop.locator('text=Basmati Rice 25kg').first().waitFor({ timeout: 40000 });
      /* the badge on THIS product's row — the list holds thirty, in the shop's own order */
      const badge = shop.getByTestId('shop-stock').filter({ hasText: 'in stock 120' }).first(); await expect(badge).toBeVisible({ timeout: 20000 });
      const t = await badge.textContent(); expect(t).toMatch(/in stock 120/); expect(t).toMatch(/as of (just now|\d+ min ago)/);
    } finally { await ctx.close(); }
  });

  await test.step('ON DEMAND — a connector holding the bell answers the storefront\'s ask; the stamp moves', async () => {
    const ac = new AbortController();
    const watching = core.watchOrders({ cb, adapter, receipts, log, signal: ac.signal, onEvent: (d) => log('bell ' + JSON.stringify(d)) }).catch(() => {});
    /* the seller's own app page holds a stream too — wait for the CONNECTOR's, not just any listener */
    for (let i = 0; i < 30 && !streamUp; i++) await page.waitForTimeout(1000);
    expect(streamUp, 'the connector holds the bell').toBe(true);
    const ask = await request.post(API + '/api/integrations/ask/' + encodeURIComponent(handle) + '/stock', { data: {} });
    expect(ask.status()).toBe(200); const aj = await ask.json(); expect(aj.asked, JSON.stringify(aj)).toBe(true);
    /* the answer takes a few Pacific round trips: bell → connector reads → one bulk write; poll up to 30 s */
    let moved = null;
    for (let i = 0; i < 15 && !moved; i++) { await page.waitForTimeout(2000); const s2 = await (await request.get(API + '/api/integrations/stock/' + encodeURIComponent(handle))).json(); const one2 = s2.stock.find((x) => x.avail && Number(x.avail.qty) === 120); if (one2 && new Date(one2.avail.as_of).getTime() > new Date(firstAsOf).getTime()) moved = one2.avail.as_of; }
    log('first ' + firstAsOf + ' → after the ask ' + moved);
    expect(moved, 'the stamp moved after the ask').toBeTruthy();
    ac.abort(); await watching;
  });
  fs.rmSync(work, { recursive: true, force: true });
});
