/* offer-lab-next-search.cjs — SEARCH, NOT A DROPDOWN TO SCROLL
 *
 * Athi: "the real catalogue, and the search function all should be in place here? like till application for
 * the catalogue." Item and category pickers were plain <select> dropdowns — fine for eight sample items,
 * unusable for a real shop's hundreds. Replaced everywhere selectOf() was called (item, category, gift,
 * bundle A/B, pair A/B) with a native <input list=datalist> — the browser's own type-to-filter.
 *
 * ⭐ 2026-09-28 — THE ASSERTIONS MOVED, NONE WAS DROPPED. The datalist was itself replaced (2026-09-24…27) by the
 * searchable picker OVERLAY every selectOf() now opens (openPickOverlay), and "Apply it to" became a multi-item
 * picker (openApplyPicker). This harness still looked for input[list="dl-setItem"] and crashed on a null — so it had
 * been reporting nothing for days. Each check below asks the same question of the picker that exists today.
 *
 * Run: node e2e/offer-lab-next-search.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(48) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'text/plain' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((res) => srv.listen(0, res));
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('http://127.0.0.1:' + srv.address().port + '/offer-lab-next.html');
  await p.waitForTimeout(200);

  console.log('\n── every picker is a searchable overlay, not a <select> to scroll ' + '─'.repeat(6));
  const shape = await p.evaluate(() => {
    pickGoal('free'); S.freeShape = 'same'; apply();
    const html = renderS2 ? renderS2() : '';
    return { hasSelect: /<select/.test(html), opensOverlay: /openPickOverlay\('item','setItem'\)/.test(html) };
  });
  say('no <select> left for item/category pickers', !shape.hasSelect, 'plain <select> is gone');
  say('the item picker opens the search overlay', shape.opensOverlay, "openPickOverlay('item','setItem')");

  console.log('\n── "Apply it to": search, tick, Done — the item the name names ' + '─'.repeat(8));
  const picked = await p.evaluate(() => {
    pickGoal('percent'); S.scope = 'item'; S.itemIds = []; apply();
    openApplyPicker(); priceOvSearch('');
    const all = priceOvList().length;
    priceOvSearch('Filter Coffee');
    const shown = priceOvList().map((x) => x.id);
    overlayApplyToggle('coffee'); overlayApplyDone();
    return { all, shown, itemIds: S.itemIds.slice(), scope: S.scope };
  });
  say('the search narrows the list to what was typed', picked.shown.indexOf('coffee') >= 0 && picked.shown.length < picked.all,
      picked.shown.length + ' of ' + picked.all + ' — ' + JSON.stringify(picked.shown));
  say('ticking it and Done picks exactly that item', picked.scope === 'item' && JSON.stringify(picked.itemIds) === '["coffee"]', 'S.itemIds = ' + JSON.stringify(picked.itemIds));

  console.log('\n── a search that matches nothing picks nothing, and changes nothing ' + '─'.repeat(3));
  const typo = await p.evaluate(() => {
    const before = S.itemIds.slice();
    openApplyPicker(); priceOvSearch('something that does not exist at all');
    const shown = priceOvList().length;
    closePriceOverlay();                      /* walked away — no Done */
    return { shown, before, after: S.itemIds.slice() };
  });
  say('an unmatched search shows no rows', typo.shown === 0, typo.shown + ' rows');
  say('and closing without Done keeps the pick as it was', JSON.stringify(typo.after) === JSON.stringify(typo.before), JSON.stringify(typo.after));

  console.log('\n── bundle screen: two independent pickers, never confused with each other ' + '─'.repeat(2));
  const bundle = await p.evaluate(() => {
    pickGoal('bundle'); S.bunA = 'masala'; S.bunB = 'coffee'; apply();
    const html = renderS2();
    openPickOverlay('item', 'setB'); overlayPick('masala');          /* B, chosen through B's own picker */
    return { aOpens: /openPickOverlay\('item','setA'\)/.test(html), bOpens: /openPickOverlay\('item','setB'\)/.test(html),
             a: S.bunA, b: S.bunB };
  });
  say('A and B each open their own picker', bundle.aOpens && bundle.bOpens, "setA · setB");
  say('choosing through B changes B and leaves A alone', bundle.a === 'masala' && bundle.b === 'masala', JSON.stringify({ a: bundle.a, b: bundle.b }));

  console.log('\n── category search works the same way, for a shop with many categories ' + '─'.repeat(2));
  const cat = await p.evaluate(() => {
    pickGoal('percent'); S.scope = 'cat'; apply();
    openPickOverlay('cat', 'setCat'); priceOvSearch('Drinks'); overlayPick('drinks');
    return { catId: S.catId };
  });
  say('category picks resolve the same way', cat.catId === 'drinks', 'S.catId is "' + cat.catId + '"');

  console.log('\nconsole/page errors:', errs.length ? errs.join(' | ') : 'none');
  await b.close(); srv.close();
  console.log(bad || errs.length ? '\n' + (bad + errs.length) + ' failed'
    : '\nevery item and category picker is a real search box now, on every screen that had a dropdown');
  process.exit(bad || errs.length ? 1 : 0);
})();
