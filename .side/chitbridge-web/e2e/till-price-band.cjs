/* till-price-band.cjs — INDIA APPAREL AND FOOTWEAR GST BY PRICE PER PIECE OR PAIR, ON THE COUNTER (CTRY-139, Athi 11 Nov 2026)
 *
 * The rate the LAW sets by price band is applied by the engine (CBTax.determine, asOf = the shop's calendar day) and SHOWN on the cart row, the bill slip
 * and the duplicate, in the engine's own words; nobody can lower it. Drives the real till page (the vendored copy), intra-state, price exclusive:
 *   hsn 6109 at 2,500.00 on 22 Sep 2025 = 5%, total 2,625.00 · at 2,500.01 = 18%, total 2,950.01 · a bill rung at 00:10 IST on 22 Sep reads the 22nd ·
 *   footwear 6403 per pair, the same figures · a 6406 line keeps its stated rate · a line that says 0% at 3,000 is still 18%.
 * Master of the page: chitbridge-api tools/tally-connector/till.html (api tests/ctry-139-till-band.test.cjs lifts the same functions without a browser).
 * Run: NODE_PATH=$PWD/e2e/node_modules node e2e/till-price-band.cjs (exit 1 on any failure)
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(58) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

const RANG = '2025-09-22T10:00:00.000Z';        /* 15:30 IST on 22 Sep 2025 */
const MIDNIGHT = '2025-09-21T18:40:00.000Z';    /* 00:10 IST on 22 Sep 2025 — 21 Sep in UTC */

(async () => {
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const f = path.join(ROOT, rel);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, r));
  const b = await chromium.launch();

  /** one bill on a fresh page whose clock stands at `now`: what the cart row says, the money, the slip and the duplicate */
  async function ring(now, hsn, cost, statedRate) {
    const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
    const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
    await p.addInitScript((iso) => {
      const T0 = Date.parse(iso), Real = Date;
      class Fixed extends Real { constructor(...a) { if (a.length) super(...a); else super(T0); } static now() { return T0; } }
      window.Date = Fixed;
    }, now);
    await p.goto('http://127.0.0.1:' + srv.address().port + '/till.html');
    await p.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });
    const out = await p.evaluate(({ hsn, cost, statedRate }) => {
      window.S = { shop: { name: 'Kolkata Garments', currency: 'INR', country: 'IN', gstin: '19AABCK1234F1Z6', state_code: '19', reg_type: 'regular', tax_id_word: 'GSTIN' },
        items: [{ item_id: 'a', name: 'Item ' + hsn, code: 'A1', category: 'Kit', unit: 'pc', price: cost, hsn, tax_slab: 'std' }],
        offers: [], slabs: [{ id: 'std', name: 'Standard', rate: statedRate }], at: new Date().toISOString(), policy: { price_includes_tax: 'no' } };
      setMode('sell'); paintChips(); addItem(S.items[0], 1); price();
      const m = billMoney(), item = (m.invoice.ItemList || [])[0] || {};
      const bill = { no: 'C1/1', at: new Date().toISOString(), kind: 'tax', invoice: m.invoice, total: m.net, taxable: m.base, tax: m.tax, by_rate: m.byRate, supply: m.supply,
                     lines: [{ name: 'Item ' + hsn, qty: 1, unit: 'pc', price: cost, gst_rate: statedRate, net: cost, hsn }], payments: [] };
      const strip = (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      return { net: m.net, day: shopDayOf(), rate: item.GstRt, band: item._band || '', cartBand: CART[0].band || '',
               row: ((document.querySelector('.cart .row') || {}).innerText || '').replace(/\s+/g, ' '),
               slip: strip(slipHTML(bill, { gross: m.net })), dup: strip(slipHTML(slipOfRow(bill), { gross: m.net })) };
    }, { hsn, cost, statedRate });
    out.errs = errs; await p.close(); return out;
  }

  const up = await ring(RANG, '6109', 2500, 12);
  say('6109 at 2,500.00, 22 Sep 2025: total', up.net === 2625, up.net);
  say('  rate 5% and the engine words on the cart row', up.rate === 5 && /5% · price up to Rs 2,500 per piece/.test(up.row), up.row);
  say('  the bill slip and the duplicate say the same', /5% · price up to Rs 2,500 per piece/.test(up.slip) && /5% · price up to Rs 2,500 per piece/.test(up.dup), up.slip.slice(-120));
  const above = await ring(RANG, '6109', 2500.01, 5);
  say('6109 at 2,500.01: total', above.net === 2950.01, above.net);
  say('  rate 18% · price above Rs 2,500 per piece on the row', above.rate === 18 && /18% · price above Rs 2,500 per piece/.test(above.row), above.row);
  const late = await ring(MIDNIGHT, '6109', 2500, 12);
  say('00:10 IST on 22 Sep 2025 reads the 22nd (UTC says the 21st)', late.day === '2025-09-22' && late.net === 2625, late.day + ' · ' + late.net);
  const eve = await ring('2025-09-21T18:20:00.000Z', '6109', 2500, 12);
  say('23:50 IST on 21 Sep 2025 reads the 21st, the old 12% row', eve.day === '2025-09-21' && eve.net === 2800, eve.day + ' · ' + eve.net);
  const shoe = await ring(RANG, '6403', 2500, 18), shoeUp = await ring(RANG, '6403', 2500.01, 12);
  say('footwear 6403 per pair: 2,500.00 and 2,500.01', shoe.net === 2625 && shoeUp.net === 2950.01 && /per pair/.test(shoeUp.row), shoe.net + ' · ' + shoeUp.net);
  const part = await ring(RANG, '6406', 3000, 12);
  say('a 6406 line keeps its stated rate, no band words', part.net === 3360 && part.band === '' && /12%/.test(part.row), part.net + ' · ' + part.row);
  const low = await ring(RANG, '6109', 3000, 0);
  say('a line that says 0% at 3,000 is still 18%', low.net === 3540 && low.rate === 18, low.net + ' · ' + low.rate);
  for (const r of [up, above, late, eve, shoe, shoeUp, part, low]) if (r.errs.length) say('page errors', false, r.errs[0]);

  await b.close(); srv.close();
  console.log(bad ? '\n✗ ' + bad + ' failed' : '\nAll OK');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
