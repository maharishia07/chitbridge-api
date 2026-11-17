/**
 * e2e/till-unpriced.cjs — A BLANK PRICE IS UNPRICED, NOT FREE (decision D3, C:\dev\SPEC-money-one-reader.md).
 *
 * External review §21: a product imported with an empty price cell sold for ₹0.00 at the counter while the
 * storefront refused it. Athi chose "refuse to bill it". The snapshot now sends price:null for it (money.priceOf);
 * the counter refuses it while SELLING, keeps an explicit ₹0 (a decision somebody made), and still lets goods with
 * no price be RECEIVED. Run: node e2e/till-unpriced.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(58) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const srv = http.createServer((q, r) => {
    const url = q.url.split('?')[0];
    if (url.startsWith('/api/')) { r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{"ok":true}'); }
    const f = path.join(ROOT, decodeURIComponent(url).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 880 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(base + '/till.html');
  await p.waitForFunction(() => typeof window.modOpen === 'function' && typeof window.refuseUnpriced === 'function', null, { timeout: 30000 });
  await p.evaluate((api) => {
    CloudHost.key = 'demo-key'; CloudHost.api = api; HOST = CloudHost;
    window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR' }, at: new Date().toISOString(), offers: [],
      items: [{ item_id: 'blank', name: 'Blank Price Dosa', price: null, unit: 'plate' },
              { item_id: 'zero', name: 'Free Chutney', price: 0, unit: 'plate' },
              { item_id: 'ok', name: 'Masala Dosa', price: 70, unit: 'plate' }] };
    window.ageAllow = async () => true;
  }, base);

  const tryAdd = (id) => p.evaluate(async (id) => {
    CART.length = 0; MODE = 'sell';
    const i = S.items.filter((x) => x.item_id === id)[0];
    await modOpen(i, 1);
    return { lines: CART.length, price: CART[0] ? CART[0].price : null, note: (document.getElementById('lastnote') || {}).textContent || '' };
  }, id);

  console.log('\n── selling');
  const blank = await tryAdd('blank');
  say('a BLANK price is refused — nothing goes on the bill', blank.lines === 0, blank.lines + ' line(s)');
  say('and the counter says why, and where to fix it', /no price yet.*Maintenance/.test(blank.note), blank.note);
  const zero = await tryAdd('zero');
  say('an explicit ₹0 is still sold (a decision somebody made)', zero.lines === 1 && zero.price === 0, zero.lines + ' line · ₹' + zero.price);
  const ok = await tryAdd('ok');
  say('a priced product sells as before', ok.lines === 1 && ok.price === 70, ok.lines + ' line · ₹' + ok.price);

  console.log('\n── receiving is untouched');
  const rcv = await p.evaluate(() => { MODE = 'receive'; return refuseUnpriced(S.items[0]); });
  say('goods with no price can still be received', rcv === false, 'refused=' + rcv);

  say('console/page errors', !errs.length, errs.length ? errs.join(' | ').slice(0, 200) : 'none');
  await b.close(); srv.close();
  console.log(bad ? '\n' + bad + ' FAILED' : '\na blank price is unpriced at the counter, not free');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
