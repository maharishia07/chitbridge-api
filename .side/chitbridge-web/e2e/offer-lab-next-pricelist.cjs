/* offer-lab-next-pricelist.cjs — THE PRICE LIST IS ONE WINDOW: EVERY ROW STAYS, THE SALE PRICE SITS RIGHT
 * BESIDE THE COST, AND NOTHING VANISHES WHEN YOU EDIT IT
 *
 * Athi, on the old inline "no cost" list: "when i updated the cost price, that row is getting removed, it
 * has to be there so if required that can be adjusted... it has to showcase all the updated value and the
 * empty row also, filter should enable to filter the rows without cost." And: "bring the product list as a
 * overlay... bring the sale price also on the right hand side... follow the window style, close button,
 * scrolling, select according to category and so on, search."
 *
 * Also covers the loyalty-bonus display bug ("hidden inside the %age symbol") and the removed sample
 * switcher ("there is a Sri button appearing... we have to speak about the shop only").
 *
 * Run: node e2e/offer-lab-next-pricelist.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(56) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

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

  console.log('\n── ⭐ the sample switcher is gone — one shop, no "Sri" button ' + '─'.repeat(0));
  const noSwitcher = await p.evaluate(() => ({
    bizSwEmpty: !document.getElementById('bizSw'),   // W36: the empty circle is gone, not just empty
    noPharmaButton: !document.querySelector('#bizSw button'),
  }));
  say('the switcher is gone', noSwitcher.bizSwEmpty, 'no #bizSw');
  say('there is no button to flip to a different example business', noSwitcher.noPharmaButton, 'confirmed absent');

  console.log('\n── ⭐⭐⭐ the loyalty bonus value is readable, not hidden behind the % sign ' + '─'.repeat(0));
  const loy = await p.evaluate(() => {
    S.custOn = true; S.cap = 10; document.getElementById('s0').innerHTML = renderS0();
    /* the row was renamed .loy → .loyrow in the Offer Lab class-collision fix (2026-09-26); same row, same behaviour */
    const box = document.querySelector('.loyrow.on');
    const input = box.querySelector('input[data-key="cap"]');
    const label = [...box.querySelectorAll('span')].find((s) => /up to/i.test(s.textContent));
    return {
      value: input.value,
      widthPx: input.closest('.sm').getBoundingClientRect().width,   /* the wrapper is .sm since the rebuild (was .inp) */
      clipped: input.scrollWidth > input.clientWidth + 1,
      labelOutsideBox: label && !label.closest('.sm'),
    };
  });
  say('the typed value is the real value, not truncated in the markup', loy.value === '10', 'input.value="' + loy.value + '"');
  /* ⚠️ MOVED (2026-09-28): this was `widthPx >= 90`, a number fitted to the pre-rebuild layout where the % sat inside the
     box. The promise is that two digits are never CLIPPED — so that is what is measured now, whatever the box's width. */
  say('the box shows the whole value — two digits are not clipped', loy.clipped === false, loy.widthPx + 'px, clipped=' + loy.clipped);
  say('"up to" no longer competes with the number inside the same tiny box', loy.labelOutsideBox, 'label sits outside .sm');

  console.log('\n── ⭐⭐⭐ opening the price list — a real window: title, close, search, categories ' + '─'.repeat(0));
  const opened = await p.evaluate(() => { openPriceOverlay(); return document.getElementById('priceOverlay').classList.contains('on'); });
  say('"📋 Typed against each item" opens the overlay', opened, 'priceOverlay is on');
  const chrome = await p.evaluate(() => ({
    title: document.getElementById('ovlTitle').textContent,
    hasClose: !!document.querySelector('[data-cbname="close"]'),
    hasSearch: !!document.getElementById('ovlSearch'),
    hasCats: document.querySelectorAll('#ovlCats .ovlchip').length > 1,
    rows: document.querySelectorAll('.ovltbl tbody tr').length,
  }));
  say('it has a title', /price list/i.test(chrome.title), '"' + chrome.title + '"');
  say('and a close button', chrome.hasClose, 'found');
  say('and a search box', chrome.hasSearch, 'found');
  say('and category chips, not just "All"', chrome.hasCats, chrome.hasCats + ' chips');
  say('every product is listed, not only the ones missing a cost', chrome.rows > 1, chrome.rows + ' rows');

  console.log('\n── ⭐⭐ the sale price sits beside the cost, for scale ' + '─'.repeat(0));
  const priceCol = await p.evaluate(() => {
    const first = document.querySelector('.ovltbl tbody tr');
    return { price: first.querySelector('.ovlprice').textContent, hasCostInput: !!first.querySelector('td .inp input') };
  });
  say('a real sale price shows in its own column', /₹/.test(priceCol.price) || /\d/.test(priceCol.price), priceCol.price);
  say('and the cost is right there, editable, in the same row', priceCol.hasCostInput, 'found');

  console.log('\n── ⚠️⚠️ [OFFR-02] MARKUP IS COMPUTED, NEVER STORED — reads straight off price and cost ' + '─'.repeat(0));
  const markup = await p.evaluate(() => {
    setCost(P[0].id, '50');    /* a known cost against a known sale price, so the % is checkable by hand */
    const wanted = Math.round(((P[0].price - 50) / 50) * 100);
    const row = Array.from(document.querySelectorAll('.ovltbl tbody tr')).find((r) => r.querySelector('.ovlname').textContent === P[0].name);
    const cells = row.querySelectorAll('.ovlprice');
    const shown = cells[cells.length - 1].textContent;
    setCost(P[0].id, '42');    /* leave the fixture as the next block expects it */
    return { wanted: wanted, shown: shown, noCostShown: (() => {
      const withoutCost = P.find((x) => x.cost == null);
      if (!withoutCost) return '—';
      const r2 = Array.from(document.querySelectorAll('.ovltbl tbody tr')).find((r) => r.querySelector('.ovlname').textContent === withoutCost.name);
      const c2 = r2.querySelectorAll('.ovlprice');
      return c2[c2.length - 1].textContent;
    })() };
  });
  say('a real cost turns into the exact markup a shopkeeper would compute by hand', markup.shown === markup.wanted + '%', markup.wanted + '% expected, "' + markup.shown + '" shown');
  say('no cost means no markup — a dash, never a division that would lie', markup.noCostShown === '—', '"' + markup.noCostShown + '"');

  console.log('\n── ⭐⭐⭐ A ROW NEVER VANISHES WHEN ITS COST IS EDITED (Athi’s own report) ' + '─'.repeat(0));
  const edited = await p.evaluate(() => {
    const before = document.querySelectorAll('.ovltbl tbody tr').length;
    const firstId = P[0].id;
    setCost(firstId, '42');
    const after = document.querySelectorAll('.ovltbl tbody tr').length;
    const input = document.querySelector('.ovltbl tbody tr td .inp input');
    return { before: before, after: after, stillThere: after === before, newValue: byId(firstId).cost };
  });
  say('the row count is unchanged after typing a cost', edited.stillThere, edited.before + ' → ' + edited.after);
  say('and the value actually saved', edited.newValue === 42, 'cost=' + edited.newValue);

  console.log('\n── ⭐⭐ clearing a cost also leaves the row exactly where it was ' + '─'.repeat(0));
  const cleared = await p.evaluate(() => {
    const before = document.querySelectorAll('.ovltbl tbody tr').length;
    setCost(P[0].id, '');
    return { before: before, after: document.querySelectorAll('.ovltbl tbody tr').length, cost: byId(P[0].id).cost };
  });
  say('still there with cost cleared, not filtered away', cleared.after === cleared.before, cleared.before + ' → ' + cleared.after);
  say('and the cost is genuinely empty, not zero', cleared.cost === null, 'cost=' + cleared.cost);

  console.log('\n── ⭐⭐⭐ THE NEW FILTER — "missing cost only", the thing Athi actually asked for ' + '─'.repeat(0));
  const filtered = await p.evaluate(() => {
    const total = P.length, missing = P.filter((x) => x.cost == null).length;
    priceOvToggleNoCost();
    const shown = document.querySelectorAll('.ovltbl tbody tr').length;
    const chipOn = document.querySelector('#ovlCats .ovlchip.on:last-child') ? document.querySelector('#ovlCats .ovlchip.on:last-child').textContent : '';
    priceOvToggleNoCost();   /* back off, for anything run after this */
    const shownAfter = document.querySelectorAll('.ovltbl tbody tr').length;
    return { total: total, missing: missing, shown: shown, chipOn: chipOn, restored: shownAfter === total };
  });
  say('the filter narrows to exactly the items with no cost', filtered.shown === filtered.missing,
    filtered.shown + ' shown vs ' + filtered.missing + ' actually missing');
  say('the chip names the count, so it is never a guess', new RegExp('\\(' + filtered.missing + '\\)').test(filtered.chipOn), '"' + filtered.chipOn + '"');
  say('and turning it back off restores the full list', filtered.restored, 'back to ' + filtered.total);

  console.log('\n── search and category still narrow the SAME list, unrelated to the cost filter ' + '─'.repeat(0));
  const search = await p.evaluate(() => {
    const q = P[0].name.slice(0, 3);
    priceOvSearch(q);
    const rows = document.querySelectorAll('.ovltbl tbody tr').length;
    priceOvSearch('');
    return { q: q, rows: rows, matches: P.filter((x) => x.name.toLowerCase().indexOf(q.toLowerCase()) >= 0).length };
  });
  say('typing a search term narrows the rows to what actually matches', search.rows === search.matches,
    search.rows + ' shown for "' + search.q + '"');

  console.log('\n── ⚠️⚠️⚠️ [OFFR-01] THE SAMPLE CANNOT BE MISTAKEN FOR A REAL SHOP ANY MORE ' + '─'.repeat(0));
  const identity = await p.evaluate(() => ({ bizName: document.getElementById('bizName').textContent, biz: S.biz }));
  say('the sample is no longer named after Athi\'s own real shop', identity.bizName !== 'Mayur Bhavan', '"' + identity.bizName + '"');
  const banner = await p.evaluate(() => {
    const n = document.getElementById('labSampleNote');
    return { hiddenOnSample: n.hidden, text: n.textContent };
  });
  say('a persistent banner says so on the very first screen, not only inside one overlay', banner.hiddenOnSample === false, '"' + banner.text + '"');
  /* ⚠️ MOVED (2026-09-28): the banner no longer repeats the sample's name (the copy budget trimmed it in the 09-26 rebuild);
     the page header carries it. So: the banner says SAMPLE and offers the door out, and the header names the sample. */
  say('and it says sample and offers the real door out', /Sample/.test(banner.text) && /Use my catalogue/.test(banner.text), banner.text);
  say('the header names the sample, so it cannot be mistaken for a real shop', /Sample/.test(identity.bizName), '"' + identity.bizName + '"');
  const footNote = await p.evaluate(() => {
    openPriceOverlay(); const foot = document.getElementById('ovlFoot').textContent; closePriceOverlay(); return foot;
  });
  say('the price overlay’s own footer repeats it — the screen a cost is actually typed on', /do not reach a real product/.test(footNote), '"' + footNote.replace(/\s+/g, ' ') + '"');

  console.log('\n── and once signed in to a real shop, both go quiet ' + '─'.repeat(0));
  const asMine = await p.evaluate(() => {
    localStorage.setItem('cb_sess', JSON.stringify({ token: 'demo-token', entity: 'Athi’s real shop' }));
    S.biz = 'mine'; BIZ.mine = BIZ.mine || { name: 'Athi’s real shop', cats: [], prods: [], margin: 25, cap: 10, d: {} };
    render();
    const bannerHidden = document.getElementById('labSampleNote').hidden;   /* read NOW — before the reset below */
    openPriceOverlay(); const foot = document.getElementById('ovlFoot').textContent; closePriceOverlay();
    S.biz = 'hotel'; localStorage.removeItem('cb_sess'); render();          /* leave the page as later tests expect it */
    return { bannerHidden: bannerHidden, footNote: foot };
  });
  say('the banner disappears once the real shop is showing', asMine.bannerHidden === true, 'labSampleNote.hidden');
  say('and the overlay footer says it now saves for real', /save to your real catalogue/.test(asMine.footNote), '"' + asMine.footNote.replace(/\s+/g, ' ') + '"');

  console.log('\n── closing the overlay actually closes it ' + '─'.repeat(0));
  const closed = await p.evaluate(() => { closePriceOverlay(); return document.getElementById('priceOverlay').classList.contains('on'); });
  say('close really closes', closed === false, 'priceOverlay.on removed');

  console.log('\nconsole/page errors:', errs.length ? errs.join(' | ') : 'none');
  await b.close(); srv.close();
  console.log(bad || errs.length ? '\n' + (bad + errs.length) + ' failed'
    : '\nthe price list is one reusable window — nothing vanishes, the sale price gives it scale, and missing-cost items are one filter away');
  process.exit(bad || errs.length ? 1 : 0);
})();
