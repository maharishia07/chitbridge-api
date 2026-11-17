#!/usr/bin/env node
/**
 * e2e/walk-cx4-shop.cjs — THE STOREFRONT FOR AN INDIAN, AN AUSTRALIAN AND A UAE SHOP (CX4, 2026-10-13).
 * Black box: the real shop.html; the API is a stand-in answering the catalogue the way lib/catalogue-view now does
 * (shop.country · shop.tax_id_word, no upi_id under a pack without UPI). For each shop, at 1366 and 390 px, light and dark:
 *   X1  the shop's head names its tax id with the pack's word — GSTIN · ABN · TRN — and never "GSTIN" for AU / AE
 *   X2  the price is in the shop's money (₹ · A$ / AUD · AED), never ₹ for AU / AE
 *   X3  every text element reads at AA (4.5:1, large 3:1) against what it sits on — lib/theme-measure.cjs, the one reader; no inner horizontal scroll; no link to app.html
 *   NODE_PATH=e2e/node_modules node e2e/walk-cx4-shop.cjs
 */
'use strict';
const W = require('./lib/walk.cjs');
const { measure } = require('./lib/theme-measure.cjs');   /* the one contrast reader */
const { audit } = require('./lib/rule13.cjs');           /* the one rule-13 audit: inner scroll · app.html */
const J = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });

const SHOPS = {
  IN: { display_name: 'Sim Stores', currency_code: 'INR', gstn: '33AAPFU0939F1ZV', country: 'IN', tax_id_word: 'GSTIN', upi_id: 'simstores@upi', address: 'Anna Salai, Chennai' },
  AU: { display_name: 'Sim Sydney', currency_code: 'AUD', gstn: '51824753556', country: 'AU', tax_id_word: 'ABN', upi_id: null, address: '1 George St, Sydney NSW' },
  AE: { display_name: 'Sim Dubai', currency_code: 'AED', gstn: '100123456700003', country: 'AE', tax_id_word: 'TRN', upi_id: null, address: 'Deira, Dubai' },
};
const SYM = { IN: /₹/, AU: /A\$|AUD/, AE: /AED|د\.إ/ };
const view = (s) => ({ available: true, visibility: 'public', categories: [],
  shop: Object.assign({ bridge_id: 'CBSIM' + s.country, is_verified: true, business_status: 'open', storefront_access: 'browse', unit_rules: {},
    showcase: { template: null, sections: [] }, viewer_groups: [], connector: null,
    order_input: { preset: 'cart', pipeline: 'commerce', showsPrice: true, negotiable: false, schema: null, documents: [] }, order_method: 'cart' }, s),
  schema: null, fields: [], offers: [],
  items: [{ item_id: 'i1', item_data: { name: 'Basmati rice 5 kg', unit: 'bag', price: 640, currency: s.currency_code } }] });

W.run('cx4-shop', async (w) => {
  const { page } = w;
  for (const cc of Object.keys(SHOPS)) {
    for (const vp of [{ width: 1366, height: 860 }, { width: 390, height: 844 }]) {
      for (const scheme of ['light', 'dark']) {
        const tag = cc + ' · ' + vp.width + ' · ' + scheme;
        await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
        await page.route('**/api/**', (r) => r.fulfill(J({ ok: true })));
        await page.route('**/api/catalogue/CBSIM' + cc + '*', (r) => r.fulfill(J(view(SHOPS[cc]))));
        await page.setViewportSize(vp);
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(w.base + '/shop.html?s=CBSIM' + cc + '&api=' + encodeURIComponent(w.base));
        await page.waitForSelector('[data-testid="shop-head"]', { timeout: 15000 });
        await page.waitForTimeout(400);

        await w.step('X1', tag + ' · the head names the tax id ' + SHOPS[cc].tax_id_word, async () => {
          const t = await page.evaluate(() => { const d = document.querySelector('[data-testid="shop-about"]'); if (d) d.open = true; return document.body.innerText || ''; });
          const want = SHOPS[cc].tax_id_word;
          const ok = t.indexOf(want + ' ' + SHOPS[cc].gstn) >= 0 && (cc === 'IN' || t.indexOf('GSTIN') < 0);
          return { ok, saw: ok ? want + ' ' + SHOPS[cc].gstn : 'head: ' + t.replace(/\s+/g, ' ').slice(0, 160) };
        });
        await w.step('X2', tag + ' · prices in the shop\'s money', async () => {
          const t = await page.evaluate(() => document.body.innerText || '');
          const ok = SYM[cc].test(t) && (cc === 'IN' || !/₹/.test(t));
          return { ok, saw: (t.match(/(₹|A\$|AUD|AED|د\.إ)\s?[\d,.]+/) || ['no price'])[0] };
        });
        /* INT7b-GREEN: measured by the ONE reader (lib/theme-measure.cjs — backgrounds composited, a color-mix's color() read; this walk's own parser
           read "Sign in" as 1.00 against the header) and the one audit (lib/rule13.cjs: inner scroll, app.html). The rule is unchanged: 4.5:1, large 3:1. */
        await w.step('X3', tag + ' · AA contrast · no inner scroll · no app.html link', async () => {
          const pairs = await page.evaluate(measure), auditOut = await audit(page, 'shell');
          const low = pairs.filter((x) => !x.grad && x.ratio < x.need);
          const ok = !low.length && !auditOut.scroll.length && !auditOut.app.length;
          return { ok, saw: pairs.length + ' texts' + (low.length ? ' · LOW: ' + low.slice(0, 3).map((x) => '"' + x.text + '" ' + x.ratio.toFixed(2)).join(', ') : ' · all AA')
            + (auditOut.scroll.length ? ' · inner scroll: ' + auditOut.scroll.slice(0, 2).join(',') : '') + (auditOut.app.length ? ' · app.html link' : '') };
        });
      }
    }
  }
});
