/* walk-phone-fit.cjs — UX-101 remainder: phone fit, measured at 390x844 and 1366x768 (2026-11-12)
 *   Home (signed out)  : the phone bar is FIVE tabs, each >= 44 px tall and wide (the old "7 tabs ~55 px" finding is gone since HOME-PHONE-BAR)
 *   network-design     : the 300 px list used to push the design pane off a phone; list now stacks, nothing past the right edge
 *   conversion-lab     : the Lines grid fits (no sideways scroll); the price / rate tables keep their own scroll by design
 *   list-lab           : the prototype strip wraps on a phone, every switch is on screen
 *   keyboard-only      : Tab reaches the first field of each fixed screen, and that field is inside the viewport
 * Run: node e2e/walk-phone-fit.cjs   (own port; /api answers 401, nothing real is touched)  */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(66) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, 'FAILED'))); };

const srv = http.createServer((q, r) => {
  const u = q.url.split('?')[0];
  if (u.startsWith('/api')) { r.writeHead(401, { 'content-type': 'application/json' }); return r.end('{}'); }
  let f = u === '/' ? path.join(ROOT, 'index.html') : path.join(PUB, u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f));
});

/** every visible element whose right edge passes the window (fixed ones are overlays and excluded) */
const pastEdge = () => [...document.querySelectorAll('body *')].filter((e) => {
  const b = e.getBoundingClientRect(); if (!b.width || getComputedStyle(e).position === 'fixed') return false;
  for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return false; }
  return b.right > innerWidth + 1;
}).map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '.' + String(e.className).slice(0, 24)));

(async () => {
  await new Promise((r) => srv.listen(0, r));
  const base = 'http://localhost:' + srv.address().port;
  const b = await chromium.launch();
  const open = async (w, h, url) => { const c = await b.newContext({ viewport: { width: w, height: h }, hasTouch: w < 500 }); const p = await c.newPage(); await p.goto(base + url); await p.waitForTimeout(1200); return p; };
  const SH = path.join(__dirname, 'shots');
  try {
    let p = await open(390, 844, '/');
    const tabs = await p.evaluate(() => [...document.querySelectorAll('.cbsh-nav button, .cbsh-nav a')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
    say('Home phone: five tabs', tabs.length === 5, tabs.length + ' tabs');
    say('Home phone: every tab at least 44 x 44', tabs.every((t) => t[0] >= 44 && t[1] >= 44), JSON.stringify(tabs[0]));
    say('Home phone: page does not scroll sideways', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '');
    await p.screenshot({ path: path.join(SH, 'ux101-home-390.png') });

    p = await open(390, 844, '/network-design.html');
    const edge = await p.evaluate(pastEdge);
    say('network-design 390: nothing past the right edge', edge.length === 0, edge.slice(0, 3).join(' '));
    const rw = await p.evaluate(() => Math.round(document.querySelector('.right').getBoundingClientRect().width));
    say('network-design 390: the design pane keeps a usable width', rw >= 300, rw + ' px');
    await p.keyboard.press('Tab'); for (let i = 0; i < 12; i++) { const hit = await p.evaluate(() => document.activeElement && document.activeElement.classList.contains('lsrch')); if (hit) break; await p.keyboard.press('Tab'); }
    say('network-design 390: keyboard Tab reaches the store search, in view', await p.evaluate(() => { const e = document.activeElement, r = e.getBoundingClientRect(); return e.classList.contains('lsrch') && r.right <= innerWidth && r.left >= 0; }), '');
    await p.screenshot({ path: path.join(SH, 'ux101-network-design-390.png') });

    p = await open(390, 844, '/conversion-lab.html');
    const lines = await p.evaluate(() => { const s = document.querySelector('[data-testid=lab-lines]').parentElement; return [s.scrollWidth, s.clientWidth]; });
    say('conversion-lab 390: the Lines grid fits, no sideways scroll', lines[0] <= lines[1], lines.join(' > '));
    for (let i = 0; i < 30; i++) { await p.keyboard.press('Tab'); if (await p.evaluate(() => !!document.activeElement.closest('[data-testid=lab-lines]'))) break; }
    say('conversion-lab 390: keyboard reaches a Lines field, fully in view', await p.evaluate(() => { const e = document.activeElement; const r = e.getBoundingClientRect(); return !!e.closest('[data-testid=lab-lines]') && r.left >= 0 && r.right <= innerWidth; }), '');
    await p.screenshot({ path: path.join(SH, 'ux101-conversion-lab-390.png') });

    p = await open(390, 844, '/list-lab.html');
    const pr = await p.evaluate(() => { const e = document.querySelector('.proto'); return [e.scrollWidth, e.clientWidth]; });
    say('list-lab 390: the prototype strip has no sideways scroll', pr[0] <= pr[1], pr.join(' > '));
    await p.screenshot({ path: path.join(SH, 'ux101-list-lab-390.png') });

    for (const u of ['/network-design.html', '/conversion-lab.html', '/list-lab.html', '/']) {
      p = await open(1366, 768, u);
      say('1366x768 ' + u + ': page does not scroll or overflow', await p.evaluate(() => { const d = document.documentElement; return d.scrollWidth <= d.clientWidth && d.scrollHeight <= innerHeight + 1; }), '');
    }
    await p.screenshot({ path: path.join(SH, 'ux101-home-1366.png') });
  } finally { await b.close(); srv.close(); }
  console.log(bad ? '\n' + bad + ' FAILED' : '\nALL OK');
  process.exit(bad ? 1 : 0);
})();
