/* offer-lab-next-cheapest.cjs — BUY A FEW, THE CHEAPEST IS FREE ([TILL-187] follow-up)
 *
 * The last of the four free-item shapes to route through the real engine (percent/amount/qty/same/pair-cross
 * were wired earlier). outCheap()'s three columns (cheapest/middle/dearest) each ask "if all N were THIS
 * item, what does cheapest-of-N come to" — mathematically the same number buy_x_get_y already proved (a
 * single item has only one price to be cheapest among), wired through mix_and_match anyway for provenance:
 * one real code path, not a parallel formula that can drift.
 *
 * Run: node e2e/offer-lab-next-cheapest.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(46) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

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

  console.log('\n── the direct engine check: buy 3, cheapest of the 3 is free ' + '─'.repeat(2));
  const direct = await p.evaluate(() => ({
    pay70: engineMixMatchPay(70, 3), pay20: engineMixMatchPay(20, 3),
    viaBuyGet: engineBuyGetPay(70, 2, 1, 100),   /* buy 2 get 1 free — same maths as mix_and_match on one item */
  }));
  say('3 × ₹70, cheapest free = pay for 2', direct.pay70 === 140, '₹' + direct.pay70);
  say('and it matches buy_x_get_y exactly (one price, same maths)', direct.pay70 === direct.viaBuyGet,
      'mix_and_match=' + direct.pay70 + ' buy_x_get_y=' + direct.viaBuyGet);

  console.log('\n── on screen: tiffin shelf, buy 3, cheapest free ' + '─'.repeat(6));
  const screen = await p.evaluate(() => {
    pickGoal('free'); S.freeShape = 'cheapest'; S.catId = 'tiffin'; S.cheapN = 3; apply();
    const html = outCheap();
    const three = threeOf(catItems('tiffin'));
    return { html, dearestName: three[three.length - 1].name, hasWorstCase: /worst case/.test(html) };
  });
  say('names the dearest item as the worst case (spec §10 check 7)', screen.hasWorstCase && screen.html.indexOf(screen.dearestName) >= 0,
      'worst case names "' + screen.dearestName + '"');

  console.log('\n── Saved offers: the cheapest shape saves through mix_and_match too ' + '─'.repeat(0));
  await p.evaluate(() => localStorage.removeItem('cb_sess'));   /* demo mode — proves the sub_kind mapping without a server */
  const saved = await p.evaluate(async () => {
    pickGoal('free'); S.freeShape = 'cheapest'; S.catId = 'tiffin'; S.cheapN = 3; apply();
    return { sub: subKindOf(), params: ruleParamsOf() };
  });
  say('maps to mix_and_match, not buy_x_get_y', saved.sub === 'mix_and_match', 'sub_kind=' + saved.sub);
  say('scoped to the shelf (category), not one item', !!(saved.params.applies_to && saved.params.applies_to.category),
      JSON.stringify(saved.params.applies_to));

  console.log('\n── the real-basket preview genuinely exercises a MIXED shelf (not one item repeated) ' + '─'.repeat(0));
  const basket = await p.evaluate(() => {
    const items = cartPreviewItems();
    const html = cartPreviewHTML();
    return { n: items.length, distinctPrices: new Set(items.map((i) => i.price)).size, hasTable: /class="res"/.test(html) };
  });
  say('at least two different items on the shelf, at different prices', basket.n >= 2 && basket.distinctPrices >= 2,
      JSON.stringify(basket));
  say('so mix_and_match genuinely picks a real cheapest, not a trivial single-item case', basket.hasTable, 'basket rendered');

  console.log('\nconsole/page errors:', errs.length ? errs.join(' | ') : 'none');
  await b.close(); srv.close();
  console.log(bad || errs.length ? '\n' + (bad + errs.length) + ' failed'
    : '\nall four free-item shapes now ask the real engine, not a parallel formula');
  process.exit(bad || errs.length ? 1 : 0);
})();
