/* till-overlay-dialog.cjs — THE MENU AND CHECK OVERLAYS ARE NATIVE MODAL DIALOGS (2026-11-14, decision pack till-popups-1114)
 * The till proof (sit-au, 2026-11-14rc) failed every keyboard item for these two: no dialog role, focus not returned, Tab escaped.
 * Opens each by KEYBOARD (focus the opener, press Enter) and checks: a real <dialog> open as a modal, focus lands inside,
 * Tab and Shift+Tab never reach the page behind, Esc closes it, focus is back on the opener. ROOT=<public dir> to test another copy.
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(process.env.ROOT || path.join(__dirname, '..', 'public'));
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const OPENERS = [['Menu', 'till-side-open', ''], ['Check', 'till-side-check', 'alerts']];
let failed = 0;
const ok = (c, w) => { if (!c) failed++; console.log((c ? 'PASS ' : 'FAIL ') + w); };
(async () => {
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html', f = path.join(ROOT, rel);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
  });
  await new Promise(r => srv.listen(0, r));
  const b = await chromium.launch();
  for (const w of [1366, 390]) {
    const p = await b.newPage({ viewport: { width: w, height: w === 390 ? 844 : 768 } });
    const threw = []; p.on('pageerror', e => threw.push(e.message));
    await p.goto('http://127.0.0.1:' + srv.address().port + '/till.html');
    await p.waitForFunction(() => typeof window.setMode === 'function', null, { timeout: 30000 });
    await p.evaluate(() => { window.S = { shop: { country: 'IN', name: 'X' }, items: [], offers: [], at: new Date().toISOString() }; setMode('sell'); });
    for (const [name, tid] of OPENERS) {
      const sel = w === 390 ? '[data-testid="till-menu"]' : '[data-testid="' + tid + '"]';
      if (w === 390 && name === 'Check') continue; /* phone: the header ☰ is the one door; Check is a section of it */
      const tag = name + '@' + w;
      await p.focus(sel); await p.keyboard.press('Enter');
      await p.waitForTimeout(300);
      const st = await p.evaluate(() => { const m = document.getElementById('tillmenu'), a = document.activeElement;
        return { tag: m.tagName, open: !!m.open, modal: m.matches(':modal'), inside: m.contains(a), role: m.getAttribute('role') || 'implicit' }; });
      ok(st.tag === 'DIALOG' && st.open && st.modal, tag + ' is a native <dialog> opened with showModal');
      ok(st.inside, tag + ' focus lands inside');
      let escaped = 0;
      for (const sh of [false, true]) for (let i = 0; i < 40; i++) {
        if (sh) await p.keyboard.press('Shift+Tab'); else await p.keyboard.press('Tab');
        const out = await p.evaluate(() => { const m = document.getElementById('tillmenu'), a = document.activeElement;
          return !(m.contains(a) || a === document.body || a === document.documentElement); });
        if (out) escaped++;
      }
      ok(escaped === 0, tag + ' Tab and Shift+Tab never reach the page behind (' + escaped + ' escapes in 80)');
      await p.keyboard.press('Escape'); await p.waitForTimeout(250);
      const cl = await p.evaluate((s) => { const m = document.getElementById('tillmenu'); return { closed: !m.open && m.hidden, scrim: document.getElementById('tillscrim').hidden, onOpener: document.activeElement === document.querySelector(s) }; }, sel);
      ok(cl.closed && cl.scrim, tag + ' Esc closes it (dialog, hidden, scrim)');
      ok(cl.onOpener, tag + ' focus returns to the opener');
      if (w === 390) continue; /* the phone sheet is the whole screen: no backdrop to press */
      await p.focus(sel); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
      await p.mouse.click(w - 3, 400); await p.waitForTimeout(250);
      ok(await p.evaluate(() => !document.getElementById('tillmenu').open), tag + ' a press on the backdrop closes it');
    }
    /* a scan with the menu open must still land on the bill: digits in #q, the menu shut, nothing lost */
    await p.focus(w === 390 ? '[data-testid="till-menu"]' : '[data-testid="till-side-open"]'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    await p.keyboard.type('8901234'); await p.waitForTimeout(100);
    const sc = await p.evaluate(() => ({ q: (document.getElementById('q') || {}).value, shut: !document.getElementById('tillmenu').open && document.getElementById('tillmenu').hidden }));
    await p.keyboard.press('Enter'); await p.waitForTimeout(200);
    const after = await p.evaluate(() => ({ q: (document.getElementById('q') || {}).value, cart: (window.CART || []).length, shut: !document.getElementById('tillmenu').open }));
    ok(sc.q === '8901234' && sc.shut, 'scan @' + w + ': 8901234 lands in the search box and the menu shuts (q=' + sc.q + ', shut=' + sc.shut + ')');
    ok(after.shut, 'scan @' + w + ': the trailing Enter does not touch the menu (q=' + after.q + ', cart ' + after.cart + ')');
    ok(threw.length === 0, 'no page errors @' + w + (threw.length ? ' ' + threw[0] : ''));
    await p.close();
  }
  await b.close(); srv.close();
  console.log(failed ? 'FAILED ' + failed : 'ALL PASS'); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
