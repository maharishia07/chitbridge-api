/* till-hub-shape.cjs — ONE HUB, ONE SHAPE PER WIDTH ([TILL-86])
 *
 * Athi, 2026-09-19, with a screenshot: "when you click the menu, the white panel is coming and the popup is
 * not tied to it, it is coming in the center, i guess you have two different css mixed up."
 *
 * ⚠️⚠️ He was right. Above 900px the menu becomes a centred card and LEAVES the rail — while the rail was
 * still swelling to 348px to hold it and hiding its own icons to make room. An empty white panel on the left,
 * an unattached card in the middle.
 *
 * ⚠️ THIS IS MEASURED AT FIVE WIDTHS, because the fault only exists where two designs overlap, and a check at
 * one width is exactly how it shipped. [[feedback-shoot-the-screen-not-the-dom]]
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log(String(l).padEnd(10) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

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
  const base = 'http://127.0.0.1:' + srv.address().port + '/till.html';

  /* 390 = phone sheet · 720 = drawer · 899/900 = the two sides of the switch · 1600 = Athi's counter */
  for (const w of [390, 720, 899, 900, 1600]) {
    const p = await b.newPage({ viewport: { width: w, height: 900 } });
    await p.goto(base);
    await p.waitForFunction(() => typeof window.paintMenu === 'function', null, { timeout: 30000 });
    await p.evaluate(() => {
      window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR' }, items: [], offers: [], at: new Date().toISOString() };
      setMode('sell');
    });
    await p.evaluate(() => toggleMenu());
    await p.waitForTimeout(220);

    const m = await p.evaluate(() => {
      const side = document.getElementById('tillside');
      const menu = document.getElementById('tillmenu');
      const scrim = document.getElementById('tillscrim');
      const sr = side.getBoundingClientRect(), mr = menu.getBoundingClientRect();
      return {
        sideW: Math.round(sr.width),
        card: menu.classList.contains('asdialog'),
        /* is the menu drawn INSIDE the rail, or has it left it? */
        inside: mr.left >= sr.left - 1 && mr.right <= sr.right + 1,
        iconsShown: getComputedStyle(document.querySelector('#tillside .sicons')).display !== 'none',
        scrim: scrim && !scrim.hidden,
        scrimZ: scrim ? Number(getComputedStyle(scrim).zIndex) : null,
        menuZ: Number(getComputedStyle(menu).zIndex) || 0,
        vw: window.innerWidth
      };
    });

    if (m.card) {
      /* ⚠️⚠️ THE BUG: a card that left the rail, beside a rail that swelled to hold it */
      say(w + 'px', !m.inside && m.sideW <= 48 && m.iconsShown,
        'card in the middle · rail stays ' + m.sideW + 'px with its icons'
        + (m.sideW > 48 ? ' — AN EMPTY ' + m.sideW + 'px PANEL' : ''));
    } else {
      /* below the switch the drawer IS the menu, so it must be inside the rail and the rail must be wide */
      say(w + 'px', m.inside && m.sideW > 200 && !m.iconsShown,
        'drawer holds the menu · rail ' + m.sideW + 'px, icons put away');
    }

    /* the scrim must be on whenever the menu is, and UNDER the card, never over it */
    say('', m.scrim && m.scrimZ < (m.menuZ || 61),
      '  scrim on, z=' + m.scrimZ + ' under the menu');

    /* ⚠️ and it must go away again, from the one place that closes the menu */
    await p.evaluate(() => closeMenu());
    /* ⚠️ .side has `transition:width .14s` — measuring at 80ms caught the rail MID-SHRINK (21px, 80px, 161px)
       and reported a clean close as a failure. Wait past the transition, not past a guess. */
    await p.waitForTimeout(320);
    const gone = await p.evaluate(() => {
      const sc = document.getElementById('tillscrim');
      return { scrim: !sc || sc.hidden, sideW: Math.round(document.getElementById('tillside').getBoundingClientRect().width) };
    });
    say('', gone.scrim && gone.sideW <= (w <= 600 ? 1 : 48), '  closed clean · rail back to ' + gone.sideW + 'px');
    await p.close();
  }

  console.log(bad ? ('\n' + bad + ' FAILED') : '\none hub, one shape per width');
  await b.close(); srv.close(); process.exit(bad ? 1 : 0);
})();
