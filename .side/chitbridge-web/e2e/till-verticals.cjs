/* till-verticals.cjs — THE SAME COUNTER SELLING TWO DIFFERENT TRADES ([TILL-104])
 *
 * Athi, 2026-09-19: *"we have to ensure that end to end hotel is working and end to end veg shop is working…
 * none of them are super set, it is the small subset that makes both as a separate application. so we need to
 * see both working as well. how to differentiate at the app level."*
 *
 * ⭐⭐⭐ THIS FILE IS THE ANSWER TO "HOW DO WE DIFFERENTIATE", written as a test rather than a memo: it runs ONE
 * till.html twice, changing nothing but the shop's products, and asserts that each trade gets a bill that makes
 * sense in its own words. If a second application were needed, this file could not exist.
 *
 * ⚠️⚠️ AND IT PINS THE SUBSET. Everything the two trades share — keys, search, the bill, offers, tax, pay,
 * print, the day — is asserted identically for both. What differs is asserted SEPARATELY and is, so far,
 * exactly one thing: whether a quantity is counted or measured. That is the whole differentiator found by
 * measurement, and the list is deliberately short so that anything added to it has to argue for itself.
 *
 * ⚠️ THE HOTEL CASE IS THE CONTROL. The count was rewritten for the greengrocer; if the hotel's bill changed by
 * so much as a word, the rewrite would have been a second rule wearing one name.
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const SHOTS = process.argv.includes('--shots');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log(String(l).padEnd(24) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

/**
 * ⭐ TWO REAL SHOPS, NOT TWO FIXTURES. Mayur Bhavan is the tiffin room the counter was built against; the
 * greengrocer is the trade it has never once been run as.
 */
const TRADES = {
  hotel: {
    label: 'Hotel · Mayur Bhavan',
    shop: { name: 'Mayur Bhavan', currency: 'INR', country: 'IN' },
    items: [
      { item_id: 'h1', name: 'Idli',    code: 'H1', category: 'Tiffin', unit: 'plate', price: 40 },
      { item_id: 'h2', name: 'Coffee',  code: 'H2', category: 'Drinks', unit: 'cup',   price: 25 },
      { item_id: 'h3', name: 'Vada',    code: 'H3', category: 'Tiffin', unit: 'pc',    price: 15 },
    ],
    /* 2 plates, 1 coffee, 3 vada — every unit a hotel sells in is COUNTED */
    bill: [['h1', 2], ['h2', 1], ['h3', 3]],
    wantTotal: 2 * 40 + 25 + 3 * 15,          /* 150 */
    wantWords: ['3 products', '6 items'],
    wantChip: '6',                            /* the toolbar chip, which had its own sum until [TILL-104] */
    mustNot: ['kg', 'g ·'],                   /* nothing weighed can appear on a hotel bill */
  },
  greengrocer: {
    label: 'Vegetables · a market shop',
    shop: { name: 'Anbu Vegetables', currency: 'INR', country: 'IN' },
    items: [
      { item_id: 'v1', name: 'Tomato',  code: 'V1', category: 'Vegetables', unit: 'kg', price: 40 },
      { item_id: 'v2', name: 'Onion',   code: 'V2', category: 'Vegetables', unit: 'kg', price: 30 },
      { item_id: 'v3', name: 'Coconut', code: 'V3', category: 'Vegetables', unit: 'pc', price: 25 },
    ],
    /* ⚠️ THE SALE THE COUNTER COULD NOT DESCRIBE: a quarter kilo, two kilos, and three whole coconuts */
    bill: [['v1', 0.25], ['v2', 2], ['v3', 3]],
    wantTotal: 0.25 * 40 + 2 * 30 + 3 * 25,   /* 145 */
    wantWords: ['3 products', '3 items', '2.25 kg'],
    /* ⚠⚠ THE RENDER CAUGHT THIS AND THE ASSERTIONS DID NOT: the chip read "5.25" — 0.25 + 2 + 3 — while the
       bill beside it read correctly. Three renderings, one of them tested. */
    wantChip: '3 · 2.25 kg',
    /* ⚠️⚠️ THE OLD BUG, NAMED SO IT CANNOT COME BACK: 0.25 + 2 + 3 summed and called "items" */
    mustNot: ['5.25 item', '0.25 item', '2.25 item'],
  },
};

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

  for (const key of Object.keys(TRADES)) {
    const t = TRADES[key];
    console.log('\n── ' + t.label + ' ' + '─'.repeat(Math.max(0, 50 - t.label.length)));
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    await p.goto('http://127.0.0.1:' + srv.address().port + '/till.html');
    await p.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });

    const m = await p.evaluate(({ t }) => {
      window.S = { shop: t.shop, items: t.items, offers: [], at: new Date().toISOString() };
      setMode('sell'); applyLook(); paintChips();
      const byId = {};
      t.items.forEach((i) => { byId[i.item_id] = i; });
      t.bill.forEach(([id, qty]) => addItem(byId[id], qty));
      price();
      const el = document.querySelector('[data-testid="till-total"]');
      return {
        /* ⚠️ THE ENGINE HAS TO HAVE LOADED, or every difference below is untested rather than absent */
        unitsEngine: !!(window.CBUnits && window.CBUnits.isMeasured),
        total: el ? el.innerText : '',
        words: typeof countWords === 'function' ? countWords() : '(no countWords)',
        /* ⚠️ the toolbar chip, read off the SCREEN rather than from the function behind it */
        chip: (document.querySelector('[data-testid="till-cart-chip"]') || { innerText: '(no chip)' }).innerText.replace(/\s+/g, ' ').trim(),
        /* ⚠⚠ and the PREP SLIP, which is a printed document — the one place a wrong count cannot be corrected */
        /* ⚠️⚠️ NO SILENT FALLBACK. The first cut of this probe called prepSlipHtml — which does not exist — and
           fell back to countWords(), so it re-tested the function already asserted two lines above and reported
           the SLIP as passing. The real one is kotHTML, the kitchen ticket. [[feedback-silence-is-the-bug]] */
        slip: (function(){ try { return typeof kotHTML === 'function' ? kotHTML(window.CART, 1, new Date()) : 'NO kotHTML'; } catch (e) { return 'ERR ' + e; } })(),
        lines: (window.CART || []).length,
        /* the shared surface — the same on both, which is the point */
        shared: {
          keys:   !!document.querySelector('.quick'),
          search: !!document.querySelector('.right input, .left input'),
          pay:    /Cash/.test(document.body.innerText),
          print:  /Save & print/.test(document.body.innerText),
          tax:    /tax/i.test(document.body.innerText),
        },
      };
    }, { t });

    say('units engine', m.unitsEngine, 'CBUnits.isMeasured is on the page');
    say('the bill has lines', m.lines === t.bill.length, m.lines + ' of ' + t.bill.length + ' lines');
    /* ⚠️ the figure, not merely a figure — a wrong total that renders is the worst pass available */
    const num = Number((m.total.match(/[\d.,]+/) || ['0'])[0].replace(/,/g, ''));
    say('the total', Math.abs(num - t.wantTotal) < 0.01, 'TOTAL reads "' + m.total + '", expected ' + t.wantTotal);

    /**
     * ⭐⭐ THE DIFFERENTIATOR ITSELF. This one sentence is the only thing on the whole screen that has to know
     * what trade it is in — and it works it out from the UNITS, never from a shop type.
     */
    say('what is on the bill', t.wantWords.every((w) => m.words.indexOf(w) >= 0),
      '"' + m.words + '"' + (t.wantWords.every((w) => m.words.indexOf(w) >= 0) ? '' : '  wanted: ' + t.wantWords.join(' + ')));
    const wrong = t.mustNot.filter((w) => m.words.indexOf(w) >= 0);
    say('and not the old way', wrong.length === 0, wrong.length ? 'still says ' + wrong.join(', ') : 'no meaningless quantity');

    /* ⚠️ THE CHIP IS A THIRD RENDERING OF THE SAME COUNT and had its own arithmetic until [TILL-104] */
    say('the toolbar chip', m.chip.indexOf(t.wantChip) >= 0,
      '"' + m.chip + '"' + (m.chip.indexOf(t.wantChip) >= 0 ? '' : '  wanted to contain: ' + t.wantChip));
    /* ⚠⚠ and the slip must never carry a quantity the screen would not print */
    /* ⚠️⚠️ IT MUST CARRY THE COUNT, not merely lack the wrong one. Checking only for the OLD string meant a
       slip that had lost the line entirely — or a kotHTML that no longer existed — passed clean. */
    const slipWrong = t.mustNot.filter((w) => String(m.slip).indexOf(w) >= 0);
    const slipHas = t.wantWords.every((w) => String(m.slip).indexOf(w) >= 0);
    say('the printed slip', slipWrong.length === 0 && slipHas && !/NO kotHTML|^ERR /.test(String(m.slip)),
      slipWrong.length ? 'prints ' + slipWrong.join(', ')
        : (slipHas ? 'carries "' + t.wantWords.join(' · ') + '", same as the screen' : 'does NOT carry the count: ' + String(m.slip).slice(0, 80)));

    /* ⭐ EVERYTHING ELSE IS SHARED, and asserting it per trade is what proves there is one application */
    const missing = Object.keys(m.shared).filter((k) => !m.shared[k]);
    say('the shared counter', missing.length === 0,
      missing.length ? 'missing: ' + missing.join(', ') : 'keys · search · pay · print · tax all present');

    if (SHOTS) {
      const out = path.join(__dirname, '..', 'png', 'Trade-' + key + '.png');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await p.screenshot({ path: out });
      console.log('  shot                  · png/Trade-' + key + '.png');
    }
    await p.close();
  }

  await b.close(); srv.close();
  console.log(bad ? '\n' + bad + ' failed' : '\nboth trades bill correctly on one counter');
  process.exit(bad ? 1 : 0);
})();
