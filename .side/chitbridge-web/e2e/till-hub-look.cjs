/* till-hub-look.cjs — THE HUB IS FOUND BY COLOUR, NOT READ ([TILL-85])
 *
 * Athi, 2026-09-19: "do some magic in the menu… so it looks better than anything in the market."
 *
 * ⚠️ The magic is not decoration: ten identical grey tiles have to be READ every single visit. This asserts
 * that every section carries its own hue, that the open one is visibly the open one, and — the thing that
 * actually rots — that the STRIP and the HUB agree about what colour a section is. A colour is only worth
 * having if it means the same thing in both halves of the menu.
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log(l.padEnd(10) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

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
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
  const threw = []; p.on('pageerror', e => threw.push(e.message));
  await p.goto('http://127.0.0.1:' + srv.address().port + '/till.html');
  await p.waitForFunction(() => typeof window.paintMenu === 'function', null, { timeout: 30000 });
  await p.evaluate(() => {
    window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR' }, items: [], offers: [], at: new Date().toISOString() };
    setMode('sell');
  });
  await p.click('[data-testid="till-side-open"]');
  await p.waitForSelector('#tillmenu', { state: 'visible', timeout: 5000 });
  await p.click('[data-testid="till-msec-btn-today"]');
  await p.waitForTimeout(200);

  /* ── 1 · every section has a hue of its own ───────────────────────────────────────────────────────── */
  const secs = await p.$$eval('#tillmenu .msec', n => n.map(m => ({
    id: m.getAttribute('data-testid').replace('till-msec-', ''),
    mh: m.style.getPropertyValue('--mh').trim()
  })));
  const grey = '120,116,110';
  const unset = secs.filter(x => !x.mh || x.mh === grey).map(x => x.id);
  /* ⚠️ COUNT-FREE ([TILL-99]). This asserted 'at least 8 sections' and failed when the hub was re-cut from
     nine overlapping sections to six themed ones — testing the arithmetic instead of the rule. The rule is
     that every section has a hue of its own. [[feedback-improvise-update-cases]] */
  say('hues', secs.length >= 5 && !unset.length,
    secs.length + ' sections, every one with its own hue' + (unset.length ? ' — except ' + unset.join(',') : ''));

  /* ⚠️ AND NO TWO MEAN THE SAME THING BY ACCIDENT. Slate is shared on purpose (both are "facts about a thing"),
     so the check is that the PALETTE is not collapsing, not that every value is unique. */
  const distinct = new Set(secs.map(x => x.mh)).size;
  /* ⭐ AND NOW EVERY ONE IS DIFFERENT. The re-cut removed the two slate sections that shared a hue, so this
     can be exact rather than a threshold: no two sections may look the same. */
  say('distinct', distinct === secs.length, distinct + ' different hues across ' + secs.length + ' sections');

  /* ── 2 · the open one is visibly the open one ─────────────────────────────────────────────────────── */
  const open = await p.evaluate(() => {
    const m = document.querySelector('#tillmenu .msec.open');
    if (!m) return null;
    const head = m.querySelector('.mrow'), ch = m.querySelector('.mch');
    return { bg: getComputedStyle(head).backgroundColor, rot: getComputedStyle(ch).transform,
      rail: getComputedStyle(m, '::before').width, closedBg:
        getComputedStyle(document.querySelector('#tillmenu .msec:not(.open) .mrow')).backgroundColor };
  });
  say('the open', open && open.bg !== open.closedBg && open.rot !== 'none' && open.rail === '3px',
    open ? ('heading ' + open.bg + ' vs closed ' + open.closedBg + ', chevron turned, ' + open.rail + ' rail') : 'none open');

  /* ── 3 · ⚠️⚠️ THE STRIP AND THE HUB AGREE ─────────────────────────────────────────────────────────── */
  const strip = await p.$$eval('.side .sicons button[data-mh]', n => n.map(x => ({
    id: x.getAttribute('data-testid').replace('till-side-', ''), mh: x.style.getPropertyValue('--mh').trim() })));
  const wrong = await p.evaluate((st) => st.filter(function (s) { return opHue(s.id) !== s.mh; }).map(s => s.id), strip);
  say('both halves', strip.length >= 4 && !wrong.length,
    strip.length + ' strip icons, every hue the one its section carries' + (wrong.length ? ' — except ' + wrong.join(',') : ''));

  /* ── 4 · ⚠️ ONE DOOR, NOT TWO ([TILL-88]) — the full-width button inside the section opened the same
     dialog as the heading link. The check is now that it is GONE and the link is the only way in. ──── */
  await p.click('[data-testid="till-msec-btn-look"]');
  await p.waitForTimeout(150);
  const doors = await p.$$eval('#tillmenu [data-testid="till-open-style"]', n => n.length);
  say('one door', doors === 0, 'the duplicate full-width door is gone');
  /* ── 5 · the section is called Screen, and the way in is in its heading ([TILL-88]) ──────────── */
  const head = await p.evaluate(() => {
    const b = document.querySelector('[data-testid="till-msec-btn-look"]');
    const l = document.querySelector('[data-testid="till-msec-link-look"]');
    return { title: b.querySelector('b').textContent.trim(), icon: b.querySelector('.mi').textContent.trim(),
             link: l ? l.textContent.trim() : null,
             /* ⚠️ it must be a SIBLING of the fold button — nested, it would fold what it tries to open */
             nested: !!(l && b.contains(l)) };
  });
  say('named', head.title === 'Screen' && head.icon !== '◐', '"' + head.icon + ' ' + head.title + '"');
  say('preview', head.link === 'Preview' && !head.nested, 'a "' + head.link + '" link beside it, not inside the button');
  /* ⭐ and it opens the studio without folding the section it sits on */
  await p.click('[data-testid="till-msec-link-look"]');
  await p.waitForSelector('#styledlg[open]', { timeout: 4000 });
  say('it opens', true, 'the studio, straight from the heading');
  await p.evaluate(() => styleClose());

  /* ⚠️ fromMenu() closes the hub before it runs, which is correct — so the shot has to open it again, or it
     photographs an empty counter and says nothing about the menu it is named after. */
  await p.evaluate(() => { toggleMenu(); menuSection('look'); });
  await p.waitForTimeout(250);
  await p.screenshot({ path: path.join(__dirname, 'shots', 'hub.png') });
  if (threw.length) console.log('⚠️ threw: ' + threw.join(' | '));
  console.log(bad ? ('\n' + bad + ' FAILED') : '\nthe hub is found by colour, not read');
  await b.close(); srv.close(); process.exit(bad ? 1 : 0);
})();
