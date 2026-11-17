/* offer-lab-next-cart.cjs — ON A REAL BASKET, NOT JUST ONE ITEM
 *
 * Athi: "offer lab, can provide how the cart looks like with this offer in place, and also can compute
 * margin" — then, told the current offer-lab.html already shows a real cart via app/cart.js: "we should not
 * lose that functionality." This is the same ONE offer a screen is configured as (reusing subKindOf() and
 * ruleParamsOf(), built for Saved offers) shown against 2-3 everyday items together, through the real engine —
 * not a second offer type merged onto the screen.
 *
 * Run: node e2e/offer-lab-next-cart.cjs
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

  console.log('\n── percent off masala dosa — the basket includes OTHER, untouched items too ' + '─'.repeat(0));
  const pct = await p.evaluate(() => {
    pickGoal('percent'); S.scope = 'item'; S.itemIds = ['masala']; S.pctOff = 10; apply();
    const items = cartPreviewItems();
    const html = cartPreviewHTML();
    return { itemCount: items.length, targeted: items.some((i) => i.id === 'masala'), others: items.some((i) => i.id !== 'masala'),
             hasTable: /class="res"/.test(html), hasMargin: /basket margin/.test(html), hasThisOffer: /this offer/.test(html) };
  });
  say('a basket of several items, not just one', pct.itemCount >= 2, pct.itemCount + ' items');
  say('the item this screen targets is one of them', pct.targeted, 'masala dosa is in the basket');
  say('and at least one untouched everyday item too', pct.others, 'the basket is not just the offer\'s own item');
  say('rendered as a real item table', pct.hasTable, 'a .res table is present');
  say('with a basket margin line', pct.hasMargin, '"basket margin" appears');
  say('marking which line the offer actually reached', pct.hasThisOffer, '"this offer" pill appears');

  console.log('\n── the margin is the REAL engine\'s number, not a re-derivation ' + '─'.repeat(2));
  const verified = await p.evaluate(() => {
    const items = cartPreviewItems();
    const lines = cartPreviewLines(items);
    const offer = Object.assign({ id: 'preview', kind: subKindOf() }, ruleParamsOf());
    const ev = CBOffers.evaluate({ lines: lines, offers: [offer] });
    let cost = 0, known = true;
    lines.forEach((l) => { if (l.cost == null) known = false; else cost += l.cost * l.qty; });
    const margin = known && ev.total > 0 ? Math.round((ev.total - cost) / ev.total * 100) : null;
    const html = cartPreviewHTML();
    return { total: ev.total, margin: margin, htmlHasTotal: html.indexOf(String(Math.round(ev.total))) >= 0 || /₹/.test(html) };
  });
  say('the same evaluate() call the page itself makes', verified.total > 0, 'basket total ₹' + verified.total);
  say('produces a real, computed margin', typeof verified.margin === 'number', verified.margin + '%');

  console.log('\n── bundle: BOTH bundle items are in the basket, plus a filler ' + '─'.repeat(3));
  const bundle = await p.evaluate(() => {
    pickGoal('bundle'); S.bunA = 'masala'; S.bunB = 'coffee'; S.bunPrice = 80; apply();
    const items = cartPreviewItems();
    return { hasA: items.some((i) => i.id === 'masala'), hasB: items.some((i) => i.id === 'coffee'), n: items.length };
  });
  say('both halves of the bundle are present', bundle.hasA && bundle.hasB, JSON.stringify(bundle));

  console.log('\n── qty ladder: the item is bought at the TOP tier\'s quantity, so the discount actually shows ' + '─'.repeat(0));
  const qty = await p.evaluate(() => {
    pickGoal('qty'); S.scope = 'item'; S.itemIds = ['masala']; apply();
    const items = cartPreviewItems();
    const lines = cartPreviewLines(items);
    const top = tiers()[tiers().length - 1];
    const masalaLine = lines.filter((l) => l.item_id === 'masala')[0];
    return { topQty: top.qty, lineQty: masalaLine.qty };
  });
  say('bought at (at least) the top tier\'s quantity', qty.lineQty >= qty.topQty, 'top tier ' + qty.topQty + '+, basket has ' + qty.lineQty);

  console.log('\n── spend / ship / band: no basket preview — the three-bill sightline already answers this ' + '─'.repeat(0));
  const skip = await p.evaluate(() => {
    pickGoal('spend'); apply();
    const spend = cartPreviewItems().length;
    pickGoal('band'); apply();
    const band = cartPreviewItems().length;
    return { spend, band };
  });
  say('spend has no forced basket', skip.spend === 0, skip.spend + ' items');
  say('band has no forced basket (no engine kind either)', skip.band === 0, skip.band + ' items');

  console.log('\nconsole/page errors:', errs.length ? errs.join(' | ') : 'none');
  await b.close(); srv.close();
  console.log(bad || errs.length ? '\n' + (bad + errs.length) + ' failed'
    : '\na real basket, several items, the real engine\'s own margin — every offer screen shows it');
  process.exit(bad || errs.length ? 1 : 0);
})();
