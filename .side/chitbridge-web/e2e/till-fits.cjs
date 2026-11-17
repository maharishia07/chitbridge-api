/* till-fits.cjs — THE COUNTER FITS ITS SCREEN, AND ONLY ITS PANES SCROLL ([TILL-94])
 *
 * Athi, 2026-09-19, on the vertical layout: "everything become scrolling, the entire screen scrolls, the
 * entire application has to rightly fit into to the screen and also the cart comes on the top?"
 *
 * ⚠️⚠️ A TILL IS AN APPLICATION, NOT A DOCUMENT. If the page itself scrolls, the bill can slide off the top
 * mid-sale, the pay buttons are wherever the scroll happens to be, and a barcode scan lands on a total nobody
 * can see. `height:100dvh` on the shell and `overflow:auto` on the panes is the whole contract, and exactly
 * one shape had opted out of it.
 *
 * ⭐ AND FOR A TALL SCREEN THE KEYS COME FIRST. Turning a monitor upright is done to see more product; a bill
 * above the keys pushes them off the fold and defeats the reason for the shape.
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log(String(l).padEnd(26) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

/* enough products that the shelf and the keys both genuinely overflow — an empty counter fits anything */
const ITEMS = [];
for (let i = 0; i < 60; i++) ITEMS.push({ item_id: 'p' + i, name: 'Product number ' + i, code: 'P' + i,
  category: ['Tiffin', 'Drinks', 'Sweets'][i % 3], unit: 'plate', price: 20 + i });

(async () => {
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const f = path.join(ROOT, rel);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise(r => srv.listen(0, r));
  const b = await chromium.launch();

  /* ⚠️ the shape Athi hit is a TALL layout on a WIDE monitor — a portrait kiosk, and a desk screen someone
     turned. Both must fit. The phone is excluded: it sells in three steps and is its own contract. */
  const CASES = [
    ['horizontal', 1600, 900], ['horizontal', 1280, 800],
    ['vertical', 1080, 1920], ['vertical', 1280, 1000], ['vertical', 1024, 1366],
    ['tablet', 1180, 820], ['compact', 1024, 768], ['rail', 1440, 900],
  ];

  for (const [layout, w, h] of CASES) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.goto('http://127.0.0.1:' + srv.address().port + '/till.html');
    await p.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });
    await p.evaluate(({ items, layout }) => {
      window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR' }, items: items, offers: [], at: new Date().toISOString() };
      setMode('sell');
      screenSet({ layout: layout });
      /* ⚠️ THE SHAPE FOLLOWS THE LAYOUT, and only styleApply() does that — screenSet alone leaves the shape
         alone, so a harness that calls screenSet is not reproducing what a shopkeeper gets. Same two lines. */
      var L = CBScreen.LAYOUTS[layout];
      if (L && L.shape) tillOptSet({ shape: L.shape });
      applyLook();
      /* a bill in hand, because an empty bill is the easy case */
      paintChips();
      items.slice(0, 6).forEach((i) => addItem(i, 1));
      price();
    }, { items: ITEMS, layout });
    await p.waitForTimeout(350);

    const m = await p.evaluate(() => {
      const de = document.documentElement;
      const wrap = document.querySelector('.wrap');
      const left = document.querySelector('.left'), right = document.querySelector('.right');
      const lr = left.getBoundingClientRect(), rr = right.getBoundingClientRect();
      return {
        /* ⚠️ THE ONE THAT MATTERS: does the DOCUMENT scroll? */
        docOver: Math.max(de.scrollHeight - de.clientHeight, document.body.scrollHeight - window.innerHeight),
        wrapH: Math.round(wrap.getBoundingClientRect().height),
        vh: window.innerHeight,
        shape: (document.body.className.match(/shape-\w+/) || [''])[0],
        /* on a tall screen the keys must be ABOVE the bill */
        keysFirst: lr.top < rr.top,
        /* ⚠️⚠️ THE THINGS THAT MUST NOT BE SQUASHED. A chip row flattened to 8px and a shelf list at 0 was
           what Athi saw as "all get mixed up" — flex children shrink unless told not to. */
        chips: Math.round((document.querySelector('.chips')||{getBoundingClientRect:()=>({height:0})}).getBoundingClientRect().height),
        /* ⭐ AND THE ONE CONTROL A TILL MAY NEVER HIDE: Save & print must be on the screen, not below it. */
        goBottom: Math.round(document.querySelector('.go').getBoundingClientRect().bottom),
        /* ⚠️⚠️ AND NOTHING IS PRINTED ON TOP OF ANYTHING ELSE. Athi: "look at the bottom some text
           overlapping" — the GST note under "Clear · Esc". A squeezed box whose CONTENT is not squeezed
           paints over its neighbour, and only a rect comparison catches it. */
        overlap: (() => {
          const f = document.querySelector('.foot').getBoundingClientRect();
          const g = document.querySelector('.go').getBoundingClientRect();
          return g.bottom > f.top + 1 && g.top < f.bottom - 1;
        })(),
        billPc: Math.round(rr.height / window.innerHeight * 100),
      };
    });

    const want = { vertical: 'shape-tall', phone: 'shape-mobile', handheld: 'shape-mobile' }[layout] || 'shape-wide';
    /* ⚠️ A RUN THAT DID NOT REACH THE SHAPE PROVES NOTHING — the first cut of this file reported vertical as
       'mobile' and passed, testing a rule that was never applied. */
    if (m.shape !== want) { bad++; console.log(String(layout+' '+w+'x'+h).padEnd(26)+'· asked for '+want+', got "'+m.shape+'"  ✗ NOT THE SHAPE UNDER TEST'); }
    const tall = m.shape === 'shape-tall';
    const fits = m.docOver <= 1 && Math.abs(m.wrapH - m.vh) <= 2;
    say(layout + ' ' + w + 'x' + h, fits,
      m.shape.replace('shape-', '') + ' · page overflows by ' + m.docOver + 'px · shell ' + m.wrapH + ' of ' + m.vh);
    if (tall) {
      say('', m.keysFirst && m.billPc <= 52,
        '  keys above the bill, bill takes ' + m.billPc + '% of the height');
    }
    /* ⚠️ these two hold for EVERY shape, not only the tall one */
    say('', m.chips >= 28, '  the chip row is ' + m.chips + 'px, not squashed');
    say('', m.goBottom <= m.vh + 1, '  Save & print ends at ' + m.goBottom + ' of ' + m.vh);
    say('', !m.overlap, '  the foot and the pay row do not overlap');
    await p.close();
  }

  console.log(bad ? ('\n' + bad + ' FAILED') : '\nthe counter fits its screen, whatever shape it is in');
  await b.close(); srv.close(); process.exit(bad ? 1 : 0);
})();
