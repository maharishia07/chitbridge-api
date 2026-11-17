/* print-s1b-same-total.cjs — PRINT-1 S1b: THE PRINT-SETUP PREVIEW AND THE TILL'S BILL CARRY THE SAME TOTAL (2026-11-13)
 *
 * Two outputs are compared, never a third computation: the total, the taxable value and the tax that public/bill-print.html (the Print setup preview) PAINTS
 * for a set of lines, and the net / base / tax the TILL carries for the same lines (billMoney(), the figures its slip prints). Both are the one engine's answer
 * (CBTax.determine -> moneyOf); the preview page holds no sum of its own any more. India (CGST + SGST) and Australia (one GST head), each in 1366 x 768.
 * Run (on an Oracle box, not the laptop):  sh C:/dev/toolset/sit-box-run.sh <box> e2e <head> e2e/print-s1b-same-total.cjs
 *   or  NODE_PATH=$PWD/e2e/node_modules node e2e/print-s1b-same-total.cjs   (exit 1 on any failure)
 * OWNS the S1b same-total proof · CALLED BY the web e2e shards · FLOW stand-in shop -> Print setup preview (bill-print.html?preview=1) vs till billMoney().
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let bad = 0, n = 0;
const say = (l, ok, d) => { n++; console.log(String(l).padEnd(30) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

/* each shop: the lines (name, qty, shelf price incl tax, rate) the till is given and the preview is given */
const SHOPS = [
  { country: 'IN', currency: 'INR', gstin: '33AABCK1234F1Z6', state_code: '33', tax_id_word: 'GSTIN', split: true, word: 'GST', rate: 18, hand: { total: 441, taxable: 384.74, tax: 56.26 },
    lines: [{ name: 'Shirt', qty: 2, price: 118, rate: 18 }, { name: 'Belt', qty: 1, price: 100, rate: 18 }, { name: 'Soap', qty: 1, price: 105, rate: 5 }] },
  { country: 'AU', currency: 'AUD', gstin: '51824753556', tax_id_word: 'ABN', split: false, word: 'GST', rate: 10, hand: { total: 210, taxable: 200, tax: 10 },
    lines: [{ name: 'Fresh food', qty: 2, price: 50, rate: 0 }, { name: 'Gadget', qty: 1, price: 110, rate: 10 }] },
];

(async () => {
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const f = path.join(ROOT, rel);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();

  for (const sh of SHOPS) {
    /* the preview, as Print setup drives it: one message, then the sample's lines */
    const pv = await b.newPage({ viewport: { width: 1366, height: 768 } });
    await pv.goto(base + '/bill-print.html?preview=1');
    await pv.waitForFunction(() => typeof window.onPreviewMessage === 'function' && typeof window.CBTax !== 'undefined', null, { timeout: 30000 });
    const shown = await pv.evaluate(({ sh }) => {
      onPreviewMessage({ data: { cb_preview: true, paper: '80', kind: 'tax', refusal: '', country: sh.country, currency: sh.currency, tax_id: sh.gstin,
        tax: { word: sh.word, split: sh.split, rate: sh.rate, rates: [0, 5, 12, 18, 28], id_word: sh.tax_id_word } } });
      BILL.lines = sh.lines.map((l) => ({ name: l.name, hsn: '0000', qty: l.qty, unit: 'piece', price: l.price, rate: l.rate, sample_rate: l.rate }));
      show();
      const read = (id) => { const e = document.querySelector('[data-testid="' + id + '"]'); return e ? Number(e.textContent.replace(/[^\d.-]/g, '')) : null; };
      return { total: read('slip-total'), taxable: read('slip-taxable'), tax: read('slip-tax'), refused: !!document.querySelector('[data-testid="slip-no-country"]') };
    }, { sh });

    /* the till: the same lines, its own carried money */
    const tl = await b.newPage({ viewport: { width: 1366, height: 768 } });
    await tl.goto(base + '/till.html');
    await tl.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });
    const carried = await tl.evaluate(({ sh }) => {
      window.S = { shop: { name: 'A shop', currency: sh.currency, country: sh.country, gstin: sh.gstin, state_code: sh.state_code || null, reg_type: 'regular', tax_id_word: sh.tax_id_word },
        items: sh.lines.map((l, i) => ({ item_id: 'i' + i, name: l.name, code: 'C' + i, category: 'Kit', unit: 'pc', price: l.price, tax_slab: 's' + l.rate })),
        offers: [], slabs: sh.lines.map((l) => ({ id: 's' + l.rate, name: 'Rate ' + l.rate, rate: l.rate })), at: new Date().toISOString(), policy: { price_includes_tax: 'yes' } };
      setMode('sell'); paintChips();
      sh.lines.forEach((l, i) => addItem(S.items[i], l.qty));
      price();
      const m = billMoney();
      return { total: m.net, taxable: m.base, tax: m.tax, stop: m.why || null };
    }, { sh });

    say(sh.country + ' preview painted', !shown.refused && shown.total !== null, 'total ' + shown.total + ' · taxable ' + shown.taxable + ' · tax ' + shown.tax);
    say(sh.country + ' till carried', !carried.stop && carried.total > 0, 'total ' + carried.total + ' · taxable ' + carried.taxable + ' · tax ' + carried.tax);
    say(sh.country + ' hand values', shown.total === sh.hand.total && shown.taxable === sh.hand.taxable && shown.tax === sh.hand.tax, 'on paper ' + JSON.stringify(sh.hand));
    say(sh.country + ' same total', shown.total === carried.total, 'preview ' + shown.total + ' = till ' + carried.total);
    say(sh.country + ' same taxable', shown.taxable === carried.taxable, 'preview ' + shown.taxable + ' = till ' + carried.taxable);
    say(sh.country + ' same tax', shown.tax === carried.tax, 'preview ' + shown.tax + ' = till ' + carried.tax);
    await pv.close(); await tl.close();
  }
  await b.close(); srv.close();
  console.log('\n' + n + ' checks · ' + (bad ? bad + ' FAILED' : 'all passed'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
