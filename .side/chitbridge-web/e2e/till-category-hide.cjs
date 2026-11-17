/* till-category-hide.cjs — HIDING A CATEGORY LEAVES THE CHIPS AND THE KEYS, AND NOTHING ELSE
 * (design-handoff/02-category-order §2 "Hidden categories", Phase 4.3)
 *
 * ⚠️⚠️⚠️ THE RISK NAMED IN THE PACKAGE ITSELF: "Must leave the chips and the keys and nothing else; search,
 * barcode and code entry must still sell it." This drives the real dialog — Hide a category, save it — then
 * proves the chip is gone, both the ungrouped and grouped key grids drop its products, AND that search still
 * finds them, before reversing it with the Show button and proving everything comes back.
 *
 * Run: node e2e/till-category-hide.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(46) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const srv = http.createServer((q, r) => {
    const url = q.url.split('?')[0];
    if (url.startsWith('/api/')) { r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{"ok":true}'); }
    const f = path.join(ROOT, decodeURIComponent(url).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((res) => srv.listen(0, res));
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('http://127.0.0.1:' + srv.address().port + '/till.html');
  await p.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });

  await p.evaluate(async () => {
    ls.set(tillGivenKey(), 'C1');
    window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR' }, at: new Date().toISOString(),
      items: [
        { item_id: 'i1', name: 'Masala Dosa', price: 70, unit: 'plate', category: 'Tiffin' },
        { item_id: 'i2', name: 'Idli', price: 40, unit: 'plate', category: 'Tiffin' },
        { item_id: 'i3', name: 'Filter Coffee', price: 25, unit: 'cup', category: 'Drinks' },
        { item_id: 'i4', name: 'Tea', price: 15, unit: 'cup', category: 'Drinks' },
      ] };
    setMode('sell');
    await loadQuick();   /* QUICK is built here, not derived automatically from S.items */
  });

  console.log('\n── before hiding: Drinks is on the chips and reachable on the keys ' + '─'.repeat(1));
  const before = await p.evaluate(() => {
    paintChips();
    return {
      chipText: document.body.innerText.match(/Drinks\s*\d+/) ? 'present' : 'absent',
      inChips: catsVisible().map((c) => c.name),
      inKeys: quickShown().some((i) => i.category === 'Drinks'),
    };
  });
  say('Drinks chip exists before hiding', before.chipText === 'present', 'chip found');
  say('catsVisible() includes Drinks', before.inChips.indexOf('Drinks') >= 0, JSON.stringify(before.inChips));
  say('a Drinks item is among the quick keys', before.inKeys, 'true');

  console.log('\n── hide Drinks via the real dialog, then Save ' + '─'.repeat(10));
  const hidden = await p.evaluate(() => {
    catOrderOpen();
    var i = CATDRAFT.indexOf('Drinks');
    var found = i >= 0;
    if (found) catHideAt(i);
    var movedText = document.querySelector('[data-testid="till-catorder-save"]').textContent;
    catOrderSave();
    return { found: found, movedText: movedText, storedHidden: catHidden() };
  });
  say('Drinks was a real row in the draft', hidden.found, 'found at a real index');
  say('the Save button counts the visibility change ("N moved")', /1 moved/.test(hidden.movedText), '"' + hidden.movedText + '"');
  say('and it is actually persisted after Save', hidden.storedHidden.indexOf('Drinks') >= 0, JSON.stringify(hidden.storedHidden));

  console.log('\n── ⭐⭐⭐ after hiding: gone from the chips, gone from the keys — ungrouped AND grouped ' + '─'.repeat(0));
  const after = await p.evaluate(() => {
    paintChips(); paintQuick();
    var chipsHtml = document.getElementById('chips').innerHTML;
    ls.set('cb_till_bycat', '');   /* ungrouped mode */
    var ungrouped = quickShown();
    ls.set('cb_till_bycat', '1');  /* grouped mode */
    var grouped = byCatOrder(quickShown());
    return {
      chipGone: !/Drinks/.test(chipsHtml),
      ungroupedHasDrinks: ungrouped.some((i) => i.category === 'Drinks'),
      groupedOrderHasDrinks: grouped.order.indexOf('Drinks') >= 0,
      groupedListHasDrinks: grouped.list.some((i) => i.category === 'Drinks'),
    };
  });
  say('the chip itself is gone', after.chipGone, 'no "Drinks" in the chip row');
  say('gone from the ungrouped quick-key grid', !after.ungroupedHasDrinks, 'no Drinks item among quickShown()');
  say('gone from the grouped order (no section heading)', !after.groupedOrderHasDrinks, 'not in byCatOrder().order');
  say('and gone from the grouped list itself', !after.groupedListHasDrinks, 'not in byCatOrder().list');

  console.log('\n── ⭐⭐⭐ NOTHING ELSE — search still sells it, exactly as the spec demands ' + '─'.repeat(0));
  const searchStill = await p.evaluate(() => {
    FILTER = { cat: null, off: false, offer: false, job: null };
    var el = document.getElementById('q'); if (el) el.value = 'coffee';
    var found = hits();
    return { count: found.length, name: found[0] && found[0].name };
  });
  say('typing "coffee" still finds Filter Coffee (hidden category, real product)', searchStill.count === 1 && searchStill.name === 'Filter Coffee',
      JSON.stringify(searchStill));

  console.log('\n── the order dialog lists it under "Not on the keys", with a working Show ' + '─'.repeat(0));
  const dialogView = await p.evaluate(() => {
    catOrderOpen();
    var html = document.getElementById('catbody').innerHTML;
    var hasSection = /Not on the keys · 1/.test(html);
    var hasDrinks = /Drinks/.test(html);
    var hiddenIdx = CATDRAFT_HIDDEN.indexOf('Drinks');
    return { hasSection: hasSection, hasDrinks: hasDrinks, hiddenIdx: hiddenIdx };
  });
  say('shows "Not on the keys · 1"', dialogView.hasSection, 'section heading present');
  say('names Drinks in that section', dialogView.hasDrinks, 'found');
  say('CATDRAFT_HIDDEN carries it, ready for Show', dialogView.hiddenIdx >= 0, 'index ' + dialogView.hiddenIdx);

  console.log('\n── Show brings it all the way back ' + '─'.repeat(30));
  const shown = await p.evaluate(() => {
    catShowAt(CATDRAFT_HIDDEN.indexOf('Drinks'));
    var backInDraft = CATDRAFT.indexOf('Drinks') >= 0;
    catOrderSave();
    paintChips();
    var chipBack = /Drinks/.test(document.getElementById('chips').innerHTML);
    return { backInDraft: backInDraft, chipBack: chipBack, storedHidden: catHidden() };
  });
  say('back in the orderable draft', shown.backInDraft, 'true');
  say('the chip reappears after Save', shown.chipBack, 'true');
  say('and the persisted hidden list no longer carries it', shown.storedHidden.indexOf('Drinks') < 0, JSON.stringify(shown.storedHidden));

  console.log('\nconsole/page errors:', errs.length ? errs.join(' | ') : 'none');
  await b.close(); srv.close();
  console.log(bad || errs.length ? '\n' + (bad + errs.length) + ' failed'
    : '\na hidden category leaves the chips and the keys and nothing else — search still sells it');
  process.exit(bad || errs.length ? 1 : 0);
})();
