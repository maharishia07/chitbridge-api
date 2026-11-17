/* till-style-shot.cjs — SCREEN STYLE, ITS OWN ROOM ([TILL-84], design-style/png/StyleStudio.png)
 *
 * Athi 2026-09-17: "bring the miniature version in the popup to show this is how it looks and then ask for
 * the apply."  Athi 2026-09-19: "it has its own content and deserves own panel."
 *
 * ⚠️⚠️ THE RULE THIS RUN ENFORCES, and the one the old preview broke: A STYLE PREVIEW SHOWS THE WHOLE SCREEN.
 * Of the seven settings, five used to change nothing you could see in a grid of six tiles. So every check
 * below asks the MINIATURE what it looks like, not the store what it holds — a preview that agrees with the
 * store and disagrees with the screen is the exact failure being tested for.
 * [[feedback-shoot-the-screen-not-the-dom]]
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
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  const threw = []; p.on('pageerror', e => threw.push(e.message));
  await p.goto('http://127.0.0.1:' + srv.address().port + '/till.html');
  await p.waitForFunction(() => typeof window.setMode === 'function' && !!window.CBScreen, null, { timeout: 30000 });
  await p.evaluate(() => {
    window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR' }, items: [], offers: [], at: new Date().toISOString() };
    setMode('sell');
  });

  const before = await p.evaluate(() => screenCfg().theme + '/' + screenCfg().tile + '/' + screenCfg().layout);
  console.log('in force  · ' + before);

  /* ⚠️ DRIVE THE GATE a person drives: the strip, How it looks, then the door. [[feedback-probe-through-the-gate]] */
  await p.click('[data-testid="till-side-open"]');
  await p.waitForSelector('#tillmenu', { state: 'visible', timeout: 5000 });
  await p.click('[data-testid="till-msec-btn-look"]');
  const door = await p.textContent('[data-testid="till-msec-link-look"]');
  say('the door', !/preset|tile/i.test(door), '"' + door.trim() + '"  (no jargon)');
  await p.click('[data-testid="till-msec-link-look"]');
  await p.waitForSelector('#styledlg[open]', { timeout: 5000 });
  await p.waitForTimeout(150);

  /* ── 1 · the rows say what a shopkeeper would say ─────────────────────────────────────────────────── */
  /* ⚠️ "Shape" is new (design-handoff/06-card-shape §5, Phase 3.2) — sits above Key size, "what shape,
     then how big", moved here rather than deleted when the row landed. */
  const rows = await p.$$eval('#stylebody .strow>b', n => n.map(x => x.textContent.trim()));
  say('rows', rows.join('·') === 'Layout·Quick keys·Groups open·Colours·Size·Room·Shape·Key size·Photos', rows.join(' · '));

  /* ── 2 · ⚠️⚠️ EVERY SETTING VISIBLY CHANGES THE MINIATURE (spec §7.1) ─────────────────────────────── */
  /* ⚠️ THE WHOLE DRAWN STATE, not just the markup: the theme rides on the canvas's CSS VARIABLES, so an
     innerHTML-only comparison reports "theme changes nothing" about a miniature that visibly went black. */
  const shot = () => p.evaluate(() => {
    const c = document.getElementById('stcanvas');
    return c.getAttribute('style') + '|' + c.innerHTML;
  });
  const base = await shot();
  const moved = [];
  /* ⚠️ ROOM IS IN THIS LIST DELIBERATELY ([TILL-88]). Athi could not tell what "Balanced" or "Bill first"
     would do, and the answer was never a better diagram — it was drawing them. If this one ever stops
     changing the miniature, the presets are back to being five ratios nobody can read. */
  for (const [key, val] of [['layout','vertical'], ['tile','photo'], ['picker','groupRail'],
                            ['theme','dark'], ['density','compact'], ['room','nokeys']]) {
    await p.click(`[data-testid="till-style-${key}-${val}"]`);
    await p.waitForTimeout(60);
    const now = await shot();
    moved.push(key + (now === base ? ':NO' : ':yes'));
    /* back to where we were, so each one is measured on its own */
    await p.evaluate(() => { STYLE_DRAFT = {}; stylePaint(); });
    await p.waitForTimeout(40);
  }
  say('each one', moved.every(m => m.endsWith(':yes')), moved.join('  '));

  /* the theme also has to reach the FRAME, not only the tiles */
  await p.click('[data-testid="till-style-theme-dark"]');
  await p.waitForTimeout(60);
  const paper = await p.evaluate(() => getComputedStyle(document.getElementById('stcanvas')).backgroundColor);
  say('colours', /23, 21, 15|17, 21, 15/.test(paper) || paper !== 'rgb(252, 250, 245)', 'the whole miniature is ' + paper);

  /* ── 3 · ⚠️⚠️ THE COLUMN COUNT COMES FROM THE KEY WIDTH, NOT FROM THE LAYOUT ([TILL-93]) ─────────────
     This used to assert that changing LAYOUT changed the count, which it did — from LAYOUTS[].keysPerRow, a
     stored table the real grid has never read. The rule being protected is unchanged (the preview must
     reflect what the counter does); the answer moved, so the assertion moves with it.
     [[feedback-improvise-update-cases]] */
  await p.evaluate(() => { STYLE_DRAFT = {}; keySizePick(''); stylePaint(); });
  const cols = async () => p.evaluate(() =>
    getComputedStyle(document.querySelector('#stcanvas .sk-grid')).gridTemplateColumns.split(' ').length);
  const big = await (async () => { await p.click('[data-testid="till-style-keysize-xlarge"]');
    await p.waitForTimeout(80); return cols(); })();
  const small = await (async () => { await p.click('[data-testid="till-style-keysize-small"]');
    await p.waitForTimeout(80); return cols(); })();
  say('key size', small > big, 'Extra large ' + big + ' in a row → Small ' + small);

  /* ⚠️ AND THE BADGE AGREES WITH THE GRID, because both ask styleFit() — a badge saying 6 over a grid of 5
     is the exact fault this screen exists to prevent. */
  const badge = await p.textContent('#stybadge');
  say('badge', badge.includes(small + ' in a row'), '"' + badge.trim() + '"');

  /* ⚠️ a picture at Small would be ~40px, so pictures turn themselves off AND say why (spec §1) */
  const offWhy = await p.textContent('#stylebody');
  say('too small', /too small to tell one packet/.test(offWhy), 'Small says why pictures are off');

  /* ⭐ and Automatic is a stop on the control, not a checkbox — one tap gives the screen its say back */
  await p.click('[data-testid="till-style-keysize-auto"]');
  await p.waitForTimeout(80);
  const auto = await p.evaluate(() => ({ chosen: keySizeChosen(), now: keySizeNow(),
    suggests: !!document.querySelector('.schip.suggests') }));
  say('automatic', !auto.chosen && !!auto.now && auto.suggests,
    'nobody chose → the screen picks ' + auto.now + ', and its suggestion is shown dashed');
  /* ── 4 · the device tabs re-scale, and the label tells the truth ──────────────────────────────────── */
  await p.evaluate(() => { STYLE_DRAFT = {}; stylePaint(); });
  await p.click('[data-testid="till-style-dev-phone"]');
  await p.waitForTimeout(80);
  const ph = await p.evaluate(() => ({
    w: document.getElementById('stcanvas').style.width,
    lab: document.getElementById('styscale').textContent,
    cols: getComputedStyle(document.querySelector('#stcanvas .sk-grid')).gridTemplateColumns.split(' ').length
  }));
  say('phone', ph.w === '390px' && /390 × 844/.test(ph.lab) && ph.cols <= 3,
    ph.w + ', ' + ph.cols + ' in a row · "' + ph.lab + '"');
  await p.click('[data-testid="till-style-dev-screen"]');

  /* ── 5 · Now vs After swaps what is drawn, and nothing else ───────────────────────────────────────── */
  await p.click('[data-testid="till-style-theme-dark"]');
  await p.waitForTimeout(60);
  const after = await p.evaluate(() => getComputedStyle(document.getElementById('stcanvas')).backgroundColor);
  await p.click('[data-testid="till-style-show-now"]');
  await p.waitForTimeout(60);
  const nowc = await p.evaluate(() => getComputedStyle(document.getElementById('stcanvas')).backgroundColor);
  say('now/after', after !== nowc, 'after ' + after + ' vs now ' + nowc);
  await p.click('[data-testid="till-style-show-after"]');

  /* ── 6 · it says what changes, in consequences ────────────────────────────────────────────────────── */
  const changes = await p.$$eval('[data-testid="till-style-changes"] li', n => n.map(x => x.textContent.trim()));
  const pend = await p.textContent('[data-testid="till-style-pending"]');
  say('says', changes.length === 1 && /easier on the eyes/.test(changes[0]) && /1 change/.test(pend),
    '"' + pend.trim() + '" → ' + changes.join(' | '));

  /* ── 7 · ⚠️ NOTHING HAS MOVED ON THE COUNTER YET ──────────────────────────────────────────────────── */
  const still = await p.evaluate(() => screenCfg().theme + '/' + screenCfg().tile + '/' + screenCfg().layout);
  say('untouched', still === before, 'counter is still ' + still);

  await p.screenshot({ path: path.join(__dirname, 'shots', 'screen-style.png') });

  /* ── 8 · the nine, as pictures ────────────────────────────────────────────────────────────────────── */
  await p.click('[data-testid="till-style-seeall"]');
  await p.waitForSelector('#stylegal[open]', { timeout: 4000 });
  const gal = await p.$$eval('#stygal button', n => n.map(x => ({
    wire: !!x.querySelector('.wf'), name: (x.querySelector('.gn') || {}).textContent,
    good: ((x.querySelector('.gd') || {}).textContent || '').length })));
  say('the nine', gal.length === 9 && gal.every(g => g.wire && g.good > 20),
    gal.length + ' cards, every one a picture with a line saying what it is for');
  await p.screenshot({ path: path.join(__dirname, 'shots', 'screen-presets.png') });
  await p.click('[data-testid="till-gal-kiosk"]');
  await p.waitForTimeout(80);
  const loaded = await p.evaluate(() => styleCfg().layout + '/' + styleCfg().tile);
  say('pick one', loaded === 'vertical/photo', 'Kiosk loads as ' + loaded + ' — into the preview only');

  /* ── 9 · photos, by surface (moved from the old run — [TILL-80] still holds) ──────────────────────── */
  await p.click('[data-testid="till-style-photos-list"]');
  const both = await p.evaluate(() => ({ keys: !!styleCfg().photos, list: thumbsOn() }));
  say('photos', both.keys && both.list, 'keys=' + both.keys + ' list=' + both.list + ' — the list has its own switch');
  await p.click('[data-testid="till-style-photos-none"]');
  const off = await p.evaluate(() => ({ keys: !!styleCfg().photos, list: thumbsOn() }));
  say('all off', !off.keys && !off.list, 'every surface, one press');

  /* ── 10 · ⚠️⚠️ NEVER MID-BILL (spec §5.3) ─────────────────────────────────────────────────────────── */
  await p.click('[data-testid="till-style-theme-dark"]');
  await p.evaluate(() => { CART = [{ item_id: 'x', name: 'Tea', qty: 1, price: 25, key: 'x' }]; });
  await p.evaluate(() => stylePaint());
  const warn = await p.textContent('#stysays');
  /* ⚠️ WORDING MOVED, RULE UNCHANGED ([TILL-95]): the warning is now future tense before you press ("will
     wait") and past tense after ("Held."), because a refusal has to read differently from a prediction. */
  say('mid-bill', /will wait until the bill in hand/.test(warn), 'the screen says so BEFORE you apply');
  await p.click('[data-testid="till-style-apply"]');
  await p.waitForTimeout(150);
  /* ⚠️⚠️ AND IT STILL SAYS SO AFTERWARDS. A toast that vanishes over a dialog that closes is what Athi read as
     "apply to counter is not working" — the held state must be as visible as applying would have been. */
  const heldState = await p.evaluate(() => ({
    open: !!document.querySelector('#styledlg[open]'),
    held: !!document.querySelector('[data-testid="till-style-held"]'),
    btn: (document.getElementById('styapply') || {}).textContent || '' }));
  say('held, and said', heldState.open && heldState.held && /Waiting for the bill/.test(heldState.btn),
    'the studio stays open, the note says "Held", the button says "' + heldState.btn.trim() + '"');
  const held = await p.evaluate(() => ({ live: screenCfg().theme, pend: !!STYLE_PEND }));
  say('held', held.live === 'lightCream' && held.pend, 'applied nothing yet, and it is holding the change');
  await p.evaluate(() => clearBill());
  await p.waitForTimeout(80);
  const landed = await p.evaluate(() => ({ live: screenCfg().theme, pend: !!STYLE_PEND }));
  say('lands', landed.live === 'dark' && !landed.pend, 'the bill finished → ' + landed.live);

  if (threw.length) console.log('⚠️ threw: ' + threw.join(' | '));
  console.log(bad ? ('\n' + bad + ' FAILED') : '\nthe whole screen previews the whole screen');
  await b.close(); srv.close(); process.exit(bad ? 1 : 0);
})();
