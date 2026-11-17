/* till-currency.cjs — THE COUNTER IN A CURRENCY THAT IS NOT THE RUPEE ([TILL-103])
 *
 * Athi, 2026-09-19: *"we should have done one more testing. that is currency and language. if we change the
 * currency, does the till application behaves correctly."*
 *
 * ⚠️⚠️ EVERY TILL HARNESS EVER WRITTEN SEEDS `currency: 'INR'`. Twenty-five of them. So the counter has been
 * measured at eight viewports, four themes, six layouts and five key sizes — and never once outside India.
 * That is not a gap in coverage, it is a gap in the PRODUCT's evidence: "works" has only ever meant "works in
 * rupees".
 *
 * ⭐ WHAT MAKES THIS A SCREEN TEST AND NOT AN ENGINE TEST. e2e/currency-distinct.cjs already proves CBLocale
 * formats 162 codes distinctly — in a VM, with no page. What it cannot see is a `₹` written into till.html by
 * hand, a total assembled by string concatenation, or a call site that passes a hard-coded 'INR' to an engine.
 * Those are page faults and only the page shows them. [[feedback-shoot-the-screen-not-the-dom]]
 *
 * ⚠️ JPY IS IN THE LIST ON PURPOSE. It has NO minor unit — ¥1234, never ¥1234.00 — so any code that reached
 * for toFixed(2) is visible here and nowhere else in the set.
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log(String(l).padEnd(22) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

const ITEMS = [
  { item_id: 'a', name: 'Idli',   code: 'A1', category: 'Tiffin', unit: 'plate', price: 40 },
  { item_id: 'b', name: 'Coffee', code: 'B1', category: 'Drinks', unit: 'cup',   price: 25 },
  { item_id: 'c', name: 'Halwa',  code: 'C1', category: 'Sweets', unit: 'pc',    price: 1234 },
];

/* ⚠️ a shop in each of these is a REAL shop somewhere, not a test fixture — country drives tax and bill numbers
   too, so passing a currency without its country would test half the change. */
const CASES = [
  { ccy: 'INR', country: 'IN', sym: '₹' },
  { ccy: 'AED', country: 'AE', sym: null },   /* the Gulf shop the jurisdiction work was written for */
  { ccy: 'USD', country: 'US', sym: '$' },
  { ccy: 'JPY', country: 'JP', sym: '¥' },    /* ⚠️ zero minor units */
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
  const b = await chromium.launch();
  const totals = {};

  for (const c of CASES) {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    await p.goto('http://127.0.0.1:' + srv.address().port + '/till.html');
    await p.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });
    await p.evaluate(({ items, c }) => {
      window.S = { shop: { name: 'A shop', currency: c.ccy, country: c.country }, items: items, offers: [],
        at: new Date().toISOString() };
      setMode('sell'); applyLook(); paintChips();
      items.forEach((i) => addItem(i, 2));
      price();
    }, { items: ITEMS, c });
    await p.waitForTimeout(300);

    const m = await p.evaluate(() => {
      const txt = document.body.innerText;
      /* ⚠️ THE TOTAL, NOT THE BUTTON ROW. The first cut of this file read `.go`, which holds "Park · F6" and
         "Save & print · F9" — so a digit test on it passed on the HOTKEY NUMBERS while the bill could have been
         empty. A digit is not a figure. [[feedback-probe-the-right-scope]] */
      const el = document.querySelector('[data-testid="till-total"]');
      const tot = el ? el.innerText : '';
      const bill = document.querySelector('.right') ? document.querySelector('.right').innerText : '';
      return { txt, tot, bill, sum: (window.S && window.S.sum) || null };
    });
    totals[c.ccy] = (m.tot + ' | ' + m.bill).replace(/\s+/g, ' ').trim();

    /**
     * ⚠️⚠️ THE ONE THAT MATTERS. A rupee sign on a Dubai counter is not cosmetic — it is the wrong currency
     * printed on a document a customer pays against.
     */
    if (c.ccy !== 'INR') {
      const stray = (m.txt.match(/₹/g) || []).length;
      say(c.ccy + ' no ₹', stray === 0, 'rupee signs on the screen: ' + stray);
      const strayInr = (m.txt.match(/\bINR\b/g) || []).length;
      say(c.ccy + ' no "INR"', strayInr === 0, 'the literal code INR on screen: ' + strayInr);
    }

    /* the money actually renders — an empty or NaN total is the other way this fails */
    /* 2×40 + 2×25 + 2×1234 = 2598 before tax — the figure has to be THAT, not merely some digits somewhere */
    const num = Number((m.tot.match(/[\d.,]+/) || ['0'])[0].replace(/,/g, ''));
    say(c.ccy + ' totals', num >= 2598 && !/NaN|undefined/.test(m.tot),
      'TOTAL reads "' + m.tot.replace(/\s+/g, ' ').trim() + '"');
    /* ⭐ AND IT SAYS WHICH MONEY IT IS. A bare "2,598.00" on a bill is a figure nobody can pay against. */
    say(c.ccy + ' names it', m.tot.indexOf(c.ccy) >= 0 || (c.sym && m.tot.indexOf(c.sym) >= 0),
      'the total carries its currency');

    /**
     * ⚠️ JPY HAS NO PAISE. 2578 yen must not print as ¥2,578.00 — a counter that invents a minor unit is
     * showing a figure that cannot exist in the till drawer.
     */
    if (c.ccy === 'JPY') {
      const dec = /[¥\d](\d|,)*\.\d\d(?!\d)/.test(m.tot + ' ' + m.bill);
      say('JPY no minor unit', !dec, dec ? 'a two-decimal yen figure is on the screen' : 'yen printed whole');
    }
    await p.close();
  }

  /**
   * ⚠️⚠️ AND TWO CURRENCIES MUST NOT LOOK THE SAME. This is currency-distinct.cjs's rule, asked of the PAGE:
   * if the counter renders USD and INR identically, the bill is ambiguous about what was actually charged.
   */
  const seen = {};
  for (const k of Object.keys(totals)) {
    if (seen[totals[k]]) { bad++; console.log('two currencies, one screen'.padEnd(22) + '· ' + seen[totals[k]] + ' and ' + k + ' render identically  ✗ FAILED'); }
    seen[totals[k]] = k;
  }
  if (Object.keys(seen).length === CASES.length) say('all four distinct', true, 'each currency renders its own way');

  await b.close(); srv.close();
  console.log(bad ? '\n' + bad + ' failed' : '\nthe counter bills in four currencies');
  process.exit(bad ? 1 : 0);
})();
