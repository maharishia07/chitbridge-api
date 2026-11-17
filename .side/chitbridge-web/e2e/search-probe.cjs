/* Athi, 2026-09-08: "search is not working, can you check?" — drive the deployed counter and report what each query returns. */
'use strict';
const { chromium } = require('@playwright/test');
const KEY = process.env.TILL_KEY;
const WEB = process.env.CB_WEB_BASE || 'https://chitbridge-web.vercel.app';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ baseURL: WEB });
  p.on('pageerror', (e) => console.log('  THREW: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') console.log('  console error: ' + m.text().slice(0, 160)); });
  await p.goto('/till.html#key=' + encodeURIComponent(KEY));
  await p.waitForFunction(() => window.CBOffers && window.CBTax, null, { timeout: 30000 });
  await p.evaluate(() => refresh());
  await p.waitForTimeout(1500);

  const shop = await p.evaluate(() => ({ items: (S && S.items || []).length, offers: (S && S.offers || []).length, cats: Array.from(new Set((S && S.items || []).map((i) => i.category))).slice(0, 12) }));
  console.log('shop: ' + shop.items + ' items · ' + shop.offers + ' offers');
  console.log('categories: ' + shop.cats.join(' | '));

  for (const q of ['', 'rice', 'ac co', 'aa cor', 'tomato', 'BULK-000001']) {
    const r = await p.evaluate((query) => {
      document.getElementById('q').value = query;
      try { paintHits(); } catch (e) { return { error: String(e && e.message) }; }
      const rows = document.querySelectorAll('.hit').length;
      let n = 0; try { n = hits().length; } catch (e) { return { error: 'hits(): ' + String(e && e.message) }; }
      return { rows, n };
    }, q);
    console.log(('"' + q + '"').padEnd(16) + (r.error ? 'ERROR ' + r.error : r.n + ' hits · ' + r.rows + ' rows drawn'));
  }

  /* the chips */
  const chips = await p.evaluate(() => {
    const out = { chips: document.querySelectorAll('#chips button').length, err: null };
    try { setFilter('offer'); out.onOffer = hits().length; setFilter('all'); } catch (e) { out.err = String(e && e.message); }
    return out;
  });
  console.log('chips: ' + chips.chips + (chips.err ? ' · ERROR ' + chips.err : ' · on-offer hits ' + chips.onOffer));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
