'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
(async () => {
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'text/plain' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, r));
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://127.0.0.1:' + srv.address().port + '/offer-lab-next.html');
  await p.waitForTimeout(300);

  const engineLoaded = await p.evaluate(() => !!(window.CBOffers && window.CBOffers.evaluate));
  console.log('CBOffers loaded:', engineLoaded);

  // percent screen: 10% off masala dosa -> expect final 63, margin 40%
  const percentCheck = await p.evaluate(() => {
    pickGoal('percent');
    S.scope = 'item'; S.itemId = 'masala'; S.itemIds = ['masala']; S.pctOff = 10; apply();
    var r = priceRow(byId('masala'), CBOffers.compound([offerFrac(byId('masala'))*100, loyFrac()*100])/100);
    return { shown: r.shown, margin: r.margin, status: r.status };
  });
  console.log('10% off masala dosa:', JSON.stringify(percentCheck), '(expect shown=63 margin=40)');

  // qty ladder default tiers: [2,5],[5,10],[10,15] -> buy 2+ = 5% off
  const qtyCheck = await p.evaluate(() => {
    pickGoal('qty'); S.scope='item'; S.itemId='masala'; S.itemIds=['masala'];
    var r = priceRow(byId('masala'), 0.05);
    return { shown: r.shown, margin: r.margin };
  });
  console.log('5% off masala dosa (qty tier):', JSON.stringify(qtyCheck), '(expect shown=66.5 rounded down, margin ~42-43)');

  // buy1get1 same item (outSame path): expect pay=70 for 2 dosas
  const sameCheck = await p.evaluate(() => {
    return engineBuyGetPay(70, 1, 1, 100);
  });
  console.log('buy1get1 masala (pay for 2):', sameCheck, '(expect 70)');

  // cross-item buy A get B: masala (a) + coffee (b), pay = a.price = 70
  const crossCheck = await p.evaluate(() => {
    return engineBuyGetPayCross('masala', 70, 'coffee', 1, 100);
  });
  console.log('buy masala get coffee free, pay:', crossCheck, '(expect 70)');

  console.log('console/page errors:', errs.length ? errs.join(' | ') : 'none');
  await b.close(); srv.close();
  process.exit(errs.length ? 1 : 0);
})();
