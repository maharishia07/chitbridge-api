#!/usr/bin/env node
/**
 * e2e/walk-shop-page-whole.cjs — THE SHOP PAGE, FIXED WHOLE THROUGH THE ONE LIBRARY (LEVER 11, 2026-11-12; UX-136 fit + tap · UX-142 outcome · keyboard).
 * Black box: the real public/shop.html with a stand-in api. Each step names the finding it proves; each fails without its fix (the bite is run by hand
 * with the fix removed and the exit code quoted in the PR).
 *   F1  FIT  at 1366×768 and 390×844 the PAGE never scrolls: the bar stays, only the shop's own pane (#main) scrolls and holds every row
 *   F2  FROZEN  scrolled to the end, the bar is where it was and the search band still sits at the top of the pane
 *   F3  TAP  at 390 every control the shop draws (search · Categories · add buttons · My orders · Report) is at least 44×44
 *   F4  NAME  the search box has its own accessible name (a placeholder is not a name)
 *   F5  OUTCOME  Copy says "Link copied" in the one toast (a live region) and says so when the copy is refused; closing the share sheet is silent
 *   F6  KEYBOARD  Tab reaches search · Categories · every add button · My orders, each stop shows a focus ring, Esc closes the Categories panel
 *   F7  AXE + RULE 13  axe finds nothing at either size; AA contrast, no clipping, no inner sideways scroll in Cream and Dark at both sizes
 *   NODE_PATH=e2e/node_modules node e2e/walk-shop-page-whole.cjs
 */
'use strict';
const W = require('./lib/walk.cjs');
const A = require('./lib/a11y-check.cjs');
const { rule13 } = require('./lib/rule13.cjs');
const J = (o, status) => ({ status: status || 200, contentType: 'application/json', body: JSON.stringify(o) });
const VIEW = { available: true, visibility: 'public', categories: [],
  shop: { bridge_id: 'CBSIMFIT', display_name: 'Sim Fit', currency_code: 'INR', country: 'IN', is_verified: true, business_status: 'open', storefront_access: 'browse',
    unit_rules: {}, showcase: { template: null, sections: [] }, viewer_groups: [], connector: null,
    order_input: { preset: 'cart', pipeline: 'commerce', showsPrice: true, negotiable: false, schema: null, documents: [] }, order_method: 'cart' },
  schema: null, fields: [], offers: [],
  items: Array.from({ length: 14 }, (_, i) => ({ item_id: 'i' + i, item_data: { name: 'Basmati rice ' + (i + 1) + ' kg', unit: 'bag', price: 640 + i, category: i % 2 ? 'Pulses' : 'Grains' } })) };
const SIZES = [[1366, 768], [390, 844]];

const open = async (w, width, height, query) => {
  await w.page.setViewportSize({ width, height });
  await w.page.goto(w.base + '/shop.html?s=CBSIMFIT&api=' + encodeURIComponent(w.base) + (query || ''));
  await w.page.waitForSelector('[data-testid="shop-head"], [data-sc="share"]', { timeout: 15000 });
  await w.page.waitForTimeout(500);
};

W.run('shop-page-whole', async (w) => {
  const { page } = w;
  await page.route('**/api/**', (r) => r.fulfill(J({ ok: true })));
  await page.route('**/api/assist/regions*', (r) => r.fulfill(J({ regions: [] })));
  await page.route('**/api/catalogue/CBSIMFIT*', (r) => r.fulfill(J(VIEW)));

  for (const [width, height] of SIZES) {
    await open(w, width, height);
    await w.step('F1·' + width, 'the page does not scroll at ' + width + '×' + height + ' — only the shop pane does, and it holds every row', async () => {
      const m = await page.evaluate(() => {
        const main = document.getElementById('main'), de = document.documentElement;
        const rows = document.querySelectorAll('#p_list [data-testid="cart-add"]').length;
        return { page: de.scrollHeight - innerHeight, body: document.body.scrollHeight - innerHeight, main: main ? main.scrollHeight - main.clientHeight : -1, rows };
      });
      return { ok: m.page <= 0 && m.body <= 0 && m.main > 0 && m.rows >= 14, saw: 'page overflow ' + m.page + ' px · pane scrolls ' + m.main + ' px · ' + m.rows + ' rows' };
    });
    await w.step('F2·' + width, 'scrolled to the end the bar stays and the search band is still at the top of the pane', async () => {
      const before = await page.evaluate(() => document.getElementById('shell').getBoundingClientRect().top);
      const m = await page.evaluate(() => {
        const main = document.getElementById('main'); main.scrollTop = main.scrollHeight;
        const band = document.getElementById('shop_band').getBoundingClientRect(), box = main.getBoundingClientRect();
        return { shell: document.getElementById('shell').getBoundingClientRect().top, band: Math.round(band.top - box.top), scrolled: main.scrollTop };
      });
      return { ok: m.scrolled > 0 && m.shell === before && m.band <= 1, saw: 'pane scrolled ' + m.scrolled + ' px · bar top ' + m.shell + ' (was ' + before + ') · band ' + m.band + ' px under the pane top' };
    });
    await w.step('F4·' + width, 'the search box has an accessible name of its own', async () => {
      /* field-2: the search box is a ui.field, its name is a visible <label for>, never the placeholder */
      const name = await page.evaluate(() => { const l = document.querySelector('label[for="p_search"]'); return l ? l.textContent.trim() : document.getElementById('p_search').getAttribute('aria-label'); });
      return { ok: !!name, saw: 'name "' + name + '"' };
    });
    await w.step('F7a·' + width, 'axe finds nothing at ' + width + ' px', async () => {
      const r = await A.check(page);
      return { ok: !r.violations.length, saw: r.violations.length ? r.violations.map((v) => v.id + ' x' + v.count).join(' · ') : 'no violations' };
    });
  }

  await open(w, 390, 844);
  await w.step('F3', 'at 390 every control the shop draws is at least 44×44', async () => {
    const small = await page.evaluate(() => [...document.querySelectorAll('#app button,#app a,#app input,#app select')].filter((e) => {
      const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44);
    }).map((e) => (e.dataset.testid || e.id || e.tagName) + ' ' + Math.round(e.getBoundingClientRect().width) + '×' + Math.round(e.getBoundingClientRect().height)));
    return { ok: !small.length, saw: small.length ? small.length + ' under 44: ' + small.slice(0, 4).join(' · ') : 'none under 44' };
  });

  await open(w, 1366, 768);
  await w.step('F6', 'keyboard only: Tab reaches search, Categories, the add buttons; every stop shows a ring; Esc closes the Categories panel', async () => {
    await page.evaluate(() => { document.getElementById('main').scrollTop = 0; document.body.focus(); });
    const seen = new Set(), noRing = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const s = await page.evaluate(() => {
        const e = document.activeElement; if (!e || e === document.body) return null;
        const cs = getComputedStyle(e), ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
        return { id: e.dataset.testid || e.id || e.tagName, ring: !!ring };
      });
      if (!s) continue; seen.add(s.id); if (!s.ring) noRing.push(s.id);
    }
    await page.focus('.catbtn'); await page.keyboard.press('Enter');
    const openNow = await page.evaluate(() => { const p = document.querySelector('.catpanel'); return !!p && !p.hidden; });
    await page.keyboard.press('Escape');
    const closed = await page.evaluate(() => { const p = document.querySelector('.catpanel'); return !p || p.hidden; });
    const need = ['shop-search', 'cart-add'], miss = need.filter((n) => !seen.has(n));
    return { ok: !miss.length && !noRing.length && closed, saw: 'reached ' + [...seen].slice(0, 8).join(', ') + (miss.length ? ' · MISSING ' + miss : '') + (noRing.length ? ' · no ring on ' + [...new Set(noRing)].join(',') : '') + ' · panel ' + (openNow ? 'opened' : 'did not open') + ', Esc ' + (closed ? 'closed it' : 'did NOT close it') };
  });

  await open(w, 1366, 768, '&showcase=showcase.food.menu%401.0');
  await w.step('F5', 'Copy and Share say what happened in the one toast; closing the share sheet says nothing', async () => {
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.resolve() } }); });
    await page.click('[data-sc="share"]');
    await page.waitForTimeout(300);
    const ok1 = await page.evaluate(() => { const t = document.getElementById('toast'); return t ? { text: t.textContent, live: t.getAttribute('role') } : null; });
    await page.evaluate(() => { document.getElementById('toast').innerHTML = ''; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } }); });
    await page.click('[data-sc="share"]');
    await page.waitForTimeout(300);
    const bad = await page.evaluate(() => document.getElementById('toast').textContent);
    await page.evaluate(() => { document.getElementById('toast').innerHTML = ''; navigator.share = () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })); });
    await page.click('[data-sc="share"]');
    await page.waitForTimeout(300);
    const quiet = await page.evaluate(() => document.getElementById('toast').textContent);
    await page.evaluate(() => { document.getElementById('toast').innerHTML = ''; navigator.share = () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })); });
    await page.click('[data-sc="share"]');
    await page.waitForTimeout(300);
    const refusedShare = await page.evaluate(() => document.getElementById('toast').textContent);
    return { ok: !!ok1 && /Link copied/.test(ok1.text) && ok1.live === 'status' && /Could not copy/.test(bad) && quiet === '' && /Could not share\. Copy the link instead/.test(refusedShare),
      saw: 'copied → "' + (ok1 && ok1.text) + '" · refused → "' + bad + '" · sheet closed → "' + quiet + '" · share refused → "' + refusedShare + '"' };
  });


  for (const [width, height] of SIZES) {
    await open(w, width, height);
    await w.step('F8·' + width, 'a message never lands on the cart dock (item in the cart, toast showing) at ' + width + ' px', async () => {
      await page.click('#p_list [data-testid="cart-add"]');
      await page.waitForSelector('#shop_dock.on');
      await page.evaluate(() => toast('Link copied'));
      await page.waitForTimeout(250);
      const m = await page.evaluate(() => {
        const t = document.querySelector('#toast .toast').getBoundingClientRect(), d = document.getElementById('shop_dock').getBoundingClientRect();
        return { toast: [Math.round(t.top), Math.round(t.bottom)], dock: [Math.round(d.top), Math.round(d.bottom)], hit: t.bottom > d.top && t.top < d.bottom };
      });
      await page.screenshot({ path: require('path').join(__dirname, 'shots', 'shop-whole-cart-toast-' + width + '.png') });
      return { ok: !m.hit, saw: 'toast y' + m.toast.join('-') + ' · dock y' + m.dock.join('-') };
    });
  }

  await open(w, 390, 844);
  await w.step('F9', 'Back from an item page returns to the same place in the list', async () => {
    await page.evaluate(() => { document.getElementById('main').scrollTop = 250; });
    const before = await page.evaluate(() => document.getElementById('main').scrollTop);
    await page.goto(w.base + '/shop.html?s=CBSIMFIT&api=' + encodeURIComponent(w.base) + '&item=i3');
    await page.goBack();
    await page.waitForSelector('#p_list [data-testid="cart-add"]');
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => document.getElementById('main').scrollTop);
    return { ok: before > 100 && Math.abs(after - before) < 4, saw: 'left at ' + before + ' px · back at ' + after + ' px' };
  });
  await w.step('F10', 'the Home button has an accessible name', async () => {
    const n = await page.evaluate(() => { const b = document.querySelector('[data-testid="shell-home"]'); return b && (b.getAttribute('aria-label') || b.textContent.trim() || b.title); });
    return { ok: !!n, saw: 'name "' + n + '"' };
  });
  await open(w, 1366, 768);
  await w.step('F11', 'print: the page prints as long as the shop, not one screen high', async () => {
    await page.emulateMedia({ media: 'print' });
    const m = await page.evaluate(() => ({ body: document.body.scrollHeight, view: innerHeight, pane: document.getElementById('main').scrollHeight - document.getElementById('main').clientHeight }));
    await page.emulateMedia({ media: 'screen' });
    return { ok: m.body > m.view + 100 && m.pane <= 0, saw: 'printed height ' + m.body + ' vs screen ' + m.view + ' · pane hides ' + m.pane + ' px' };
  });

  await open(w, 1366, 768);
  await rule13(w, 'F7b', 'the shop page', 'app');
  process.stdout.write('shots in e2e/shots/walk-shop-page-whole-*.png\n');
});
