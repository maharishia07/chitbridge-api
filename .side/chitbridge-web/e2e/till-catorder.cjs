/* till-catorder.cjs — A MENU HAS AN ORDER, AND IT IS NOT THE ALPHABET ([TILL-87])
 *
 * Athi, 2026-09-19: "can we order the category, when a menu is showcased, first starters, Drinks, main course
 * and so on, so it has to be in that order. but it is coming here in alphabetic or something."
 *
 * ⚠️⚠️ There were TWO orders, which is worse than one wrong one: the chip row sorted by COUNT DESCENDING and
 * the grouped keys used FIRST SEEN. So the first thing this asserts is that the two agree — and then that the
 * shopkeeper's order beats both.
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log(String(l).padEnd(10) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

/* ⚠️ A MENU SHAPED LIKE A REAL ONE: "Starters" is the SMALLEST category and must still come first once the
   shop says so — if the count were still deciding, this is the case that shows it. */
const MENU = [];
const add = (cat, names) => names.forEach((n, i) =>
  MENU.push({ item_id: cat[0] + i, name: n, code: cat[0].toUpperCase() + i, category: cat, unit: 'plate', price: 40 + i * 10 }));
add('Main course', ['Masala Dosa', 'Ghee Roast', 'Pongal', 'Idli', 'Poori', 'Uttapam']);
add('Drinks',      ['Filter Coffee', 'Tea', 'Buttermilk', 'Badam Milk']);
add('Desserts',    ['Gulab Jamun', 'Payasam']);
add('Starters',    ['Vada', 'Bonda']);

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
  await p.waitForFunction(() => typeof window.catsRanked === 'function', null, { timeout: 30000 });
  await p.evaluate((items) => {
    window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR' }, items: items, offers: [], at: new Date().toISOString() };
    setMode('sell');
    ls.set('cb_till_bycat', '1');          /* show the keys grouped, which is where the order is read */
    paintChips(); paintQuick();
  }, MENU);
  await p.waitForTimeout(150);

  /**
   * ⚠️ THE CHIPS ARE READ FROM THE SCREEN, because the chip row is the thing Athi is looking at. The three
   * fixed chips (Everything / On offer / Off the shelf) are not categories and are dropped by name.
   */
  const FIXED = ['till-chip-all', 'till-chip-offer', 'till-chip-off'];
  const chips = () => p.evaluate((fixed) => [...document.querySelectorAll('#chips button')]
    .filter((b) => (b.dataset.testid || '').startsWith('till-chip-') && !fixed.includes(b.dataset.testid))
    .map((b) => b.textContent.replace(/\s*\d+\s*$/, '').trim()), FIXED);
  /**
   * ⚠️ THE GROUPED KEYS ARE READ FROM byCatOrder(), NOT THE DOM, and that is a compromise worth stating: the
   * quick-key grid is filled by loadQuick(), which goes to the network, so a harness that paints real keys is
   * testing the loader rather than the order. byCatOrder() is the exact call paintQuick() makes to decide the
   * heading order — one line above the render. [[feedback-probe-the-right-scope]]
   */
  const heads = () => p.evaluate(() => byCatOrder(S.items).order.filter((c) => c !== '—'));

  /* ── 1 · the fallback, and the two surfaces agreeing ─────────────────────────────────────────────── */
  const c0 = await chips(), h0 = await heads();
  say('fallback', c0[0] === 'Main course' && JSON.stringify(c0) === JSON.stringify(h0),
    'most-used first · chips ' + c0.join(' › '));
  say('agree', JSON.stringify(c0) === JSON.stringify(h0), 'keys ' + h0.join(' › '));

  /* ── 2 · ⚠️⚠️ THE SHOP SAYS, AND EVERY SURFACE OBEYS ─────────────────────────────────────────────── */
  /* ⚠️⚠️ Phase 4.6: a saved order only counts once the mode is 'fixed' — "mode: most_used means fixed is
     ignored" (spec §5). Every direct catOrderSet() below now sets the mode alongside it, the way the real
     dialog would (choosing "The order I set" is what makes a manual order stick in the first place). */
  await p.evaluate(() => {
    catOrderModeSet('fixed');
    catOrderSet(['Starters', 'Drinks', 'Main course', 'Desserts']);
    paintChips(); paintQuick();
  });
  await p.waitForTimeout(120);
  const c1 = await chips(), h1 = await heads();
  const want = ['Starters', 'Drinks', 'Main course', 'Desserts'];
  say('the order', JSON.stringify(c1) === JSON.stringify(want), 'chips ' + c1.join(' › '));
  say('the keys', JSON.stringify(h1) === JSON.stringify(want), 'keys  ' + h1.join(' › '));
  /* ⚠️ Starters is the SMALLEST category — if the count were still deciding, it could not be first */
  say('not count', c1[0] === 'Starters', 'the smallest category leads because the shop said so');

  /* ── 3 · a category the shop has not placed follows, it does not jump into the middle ────────────── */
  await p.evaluate(() => {
    catOrderSet(['Starters', 'Drinks']);
    S.items.push({ item_id: 'z1', name: 'Bisibela Bath', code: 'Z1', category: 'Specials', unit: 'plate', price: 90 });
    paintChips(); paintQuick();
  });
  await p.waitForTimeout(120);
  const c2 = await chips();
  say('new one', c2[0] === 'Starters' && c2[1] === 'Drinks' && c2.indexOf('Specials') > 1,
    'unplaced follows: ' + c2.join(' › '));

  /* ── 4 · a saved name that no longer exists is dropped, not shown as an empty chip ───────────────── */
  await p.evaluate(() => {
    catOrderSet(['Tiffin', 'Starters', 'Drinks']);      /* 'Tiffin' is on no product */
    paintChips();
  });
  await p.waitForTimeout(100);
  const c3 = await chips();
  say('retired', c3.indexOf('Tiffin') < 0 && c3[0] === 'Starters', 'a retired name is dropped: ' + c3.join(' › '));

  /* ── 5 · the dialog a shopkeeper actually uses ───────────────────────────────────────────────────── */
  await p.evaluate(() => { catOrderSet([]); paintChips(); paintQuick(); });
  await p.click('[data-testid="till-catorder"]');
  await p.waitForSelector('#catdlg[open]', { timeout: 4000 });
  const rows = await p.$$eval('#catbody .catrow .ct', n => n.map(x => x.textContent.trim()));
  /* ⚠️ FIVE, not four — step 3 added Specials to the shop. Read the count, never assume the fixture's. */
  say('dialog', rows.length === 5 && rows[0] === 'Main course', 'lists ' + rows.join(' › '));

  /* ⭐ bubble the LAST one to the top with the buttons a finger would press, and name it from the list itself */
  const last = rows[rows.length - 1];
  for (let i = rows.length - 1; i > 0; i--) await p.click(`[data-testid="till-catup-${i}"]`);
  const moved = await p.$$eval('#catbody .catrow .ct', n => n.map(x => x.textContent.trim()));
  say('moved', moved[0] === last && moved.length === rows.length,
    '"' + last + '" pressed up to the top: ' + moved.join(' › '));

  /* ⚠️ NOTHING HAS CHANGED ON THE SCREEN BEHIND IT until Save */
  const midway = await chips();
  say('a draft', midway[0] === 'Main course', 'the screen behind is untouched: ' + midway[0] + ' still first');

  await p.screenshot({ path: path.join(__dirname, 'shots', 'cat-order.png') });
  await p.click('[data-testid="till-catorder-save"]');
  await p.waitForTimeout(150);
  const c4 = await chips(), h4 = await heads();
  say("saved", c4[0] === last && h4[0] === last, "chips and keys both start with " + c4[0]);

  /* ── 6 · ⭐⭐⭐ THE MODE, NOT A BUTTON (Phase 4.6) — "Most used first" replaces "Back to most-used
     first", asks before discarding the manual order, and means exactly that, not alphabetical ────────── */
  await p.click('[data-testid="till-catorder"]');
  await p.waitForSelector('#catdlg[open]', { timeout: 4000 });
  const modeBefore = await p.evaluate(() => ({
    checked: document.querySelector('[data-testid="till-catmode-fixed"]').checked,
    dragEnabled: !document.querySelector('[data-testid="till-catup-1"]').disabled,
  }));
  say('opens on "The order I set"', modeBefore.checked, 'this counter chose fixed in step 2');
  say('and the rows are draggable', modeBefore.dragEnabled, 'arrows are enabled in fixed mode');

  await p.click('[data-testid="till-catmode-most_used"]');
  /* ⚠️ sure() (not sureSheet()) drives this confirm — #askdlg/till-ask-*, the general-purpose two-way ask,
     not the live-figures bottom sheet close/repair use. Both exist; this one is the right fit for a plain
     yes/no with no numbers to show. */
  await p.waitForSelector('[data-testid="till-ask-ok"]', { timeout: 4000 });
  const confirmText = await p.evaluate(() => document.getElementById('askbody').innerText);
  say('it asks before discarding the manual order', /replaced by what sells most/i.test(confirmText),
    '"' + confirmText.trim() + '"');
  await p.click('[data-testid="till-ask-ok"]');
  await p.waitForTimeout(150);
  const afterMode = await p.evaluate(() => ({
    dragDisabled: document.querySelector('[data-testid="till-catup-1"]').disabled,
    rows: [...document.querySelectorAll('#catbody .catrow .ct')].map((x) => x.textContent.trim()),
  }));
  say('the rows stop being draggable', afterMode.dragDisabled, 'most_used is a preview, not a manual list');
  say('and it really is most-used order', afterMode.rows[0] === 'Main course', afterMode.rows.join(' › '));

  await p.click('[data-testid="till-catorder-save"]');
  await p.waitForTimeout(150);
  const c5 = await chips();
  say('saved, and the sell screen agrees', c5[0] === 'Main course', 'most-used first again: ' + c5.join(' › '));

  /* ── 7 · picture mode disables the option without lying about what is stored ─────────────────────── */
  await p.evaluate(() => { catOrderModeSet('most_used'); ls.set('cb_till_picture', '1'); });
  await p.click('[data-testid="till-catorder"]');
  await p.waitForSelector('#catdlg[open]', { timeout: 4000 });
  const picLock = await p.evaluate(() => ({
    disabled: document.querySelector('[data-testid="till-catmode-most_used"]').disabled,
    checked: document.querySelector('[data-testid="till-catmode-most_used"]').checked,
    effective: catOrderModeEffective(),
  }));
  say('the option is disabled in picture mode', picLock.disabled, 'cannot be turned on from here');
  say('but the honest stored preference still shows', picLock.checked, 'most_used is what this counter actually chose');
  say('while the EFFECTIVE mode is forced fixed', picLock.effective === 'fixed', 'nothing sorts by sales while picture mode is on');
  await p.evaluate(() => { document.getElementById('catdlg').close(); ls.set('cb_till_picture', ''); });

  if (threw.length) console.log('⚠️ threw: ' + threw.join(' | '));
  console.log(bad ? ('\n' + bad + ' FAILED') : '\none order, and the shop sets it');
  await b.close(); srv.close(); process.exit(bad ? 1 : 0);
})();
