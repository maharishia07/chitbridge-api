/* till-render.cjs — Does the new paper actually DRAW? (2026-09-08)
 * The day-close arithmetic is unit-tested outside a browser; this is the other half — that dayCloseHTML renders in the real page, and
 * that a typed quantity puts its green line above the list. No key and no shop: the point is the render path, not the data.
 * Run: node e2e/till-render.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const WEB = process.env.CB_WEB_BASE || 'https://chitbridge-web.vercel.app';

const DAY = [
  { no: 'C1/26-27/0001', at: '2026-09-08T04:00:00Z', kind: 'tax', total: 236, taxable: 200, tax: 36, saved: 0,
    payments: [{ how: 'Cash', amount: 236 }], by: { name: 'Kavitha' },
    lines: [{ name: 'Oil 1 L', qty: 2, unit: 'litre', price: 118, net: 236, gst_rate: 18 }] },
  { no: 'C1/26-27/0002', at: '2026-09-08T05:00:00Z', kind: 'tax', total: 105, taxable: 100, tax: 5, saved: 9,
    payments: [{ how: 'UPI', amount: 105 }], by: { name: 'Murugan' },
    lines: [{ name: 'Rice 5 kg', qty: 1, unit: 'bag', price: 105, net: 105, gst_rate: 5 }] },
];

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ baseURL: WEB });
  const threw = [];
  p.on('pageerror', (e) => threw.push(e.message));
  await p.goto('/till.html');
  await p.waitForFunction(() => typeof window.dayCloseSheet === 'function' && !!window.CBSearch, null, { timeout: 30000 });

  const sheet = await p.evaluate((rows) => {
    window.S = { shop: { country: 'IN', name: 'Test Stores' } };
    window.WHO = { id: 'a1', name: 'Kavitha', float: 500 };
    const d = dayCloseSheet(rows);
    const html = dayCloseHTML(d);
    const box = document.createElement('div'); box.innerHTML = html; document.body.appendChild(box);
    const text = box.innerText.replace(/\s+/g, ' ');
    box.remove();
    return { total: d.total, expected: d.expected_cash, text: text };
  }, DAY);

  console.log('day close · taken ₹' + sheet.total + ' · should be in the drawer ₹' + sheet.expected);
  for (const want of ['DAY CLOSE', 'C1/26-27/0001', 'GST 18%', 'GST 5%', 'How it was paid', 'Should be there', 'Who billed', 'Most sold', 'This counter'])
    console.log((sheet.text.indexOf(want) >= 0 ? '  ok   ' : '  MISS ') + want);

  const hint = await p.evaluate(() => {
    document.getElementById('q').value = '3*rice';
    const t = typed();
    paintHits();
    const el = document.querySelector('[data-testid="till-qty-ahead"]');
    return { qty: t.qty, text: t.text, shown: el ? el.innerText : null };
  });
  console.log('typed "3*rice" → qty ' + hint.qty + ' · searching "' + hint.text + '" · above the list: ' + (hint.shown || 'NOTHING'));

  console.log(threw.length ? 'THREW: ' + threw.join(' | ') : 'no errors on the page');
  await b.close();
  process.exit(threw.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
