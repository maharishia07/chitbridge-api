/* till-morning.cjs — SETTING THE COUNTER UP FOR THE DAY ([TILL-182])
 *
 * Athi: *"once you sign-in, set up begins, say 'Loading product data', once done say completed, assigning a
 * counter, find which counter was already associated and provide that number, before that find if it is not
 * used by someone, receive the money in hand, and anything else, so the counter is setting up for the day."*
 *
 * ── ⚠️⚠️⚠️ WHAT IS BEING TESTED IS THAT IT SAYS SO ─────────────────────────────────────────────────────
 *
 * Every step below already worked before this harness existed — claimTill assigned the prefix, the clash was
 * detected, the drawer was recorded. What did not exist was a person being TOLD any of it. So the checks here
 * read the words on the screen, not the state behind them: a morning that settles everything silently is the
 * thing this replaces, and it would pass any test written against state alone.
 *
 * Run: node e2e/till-morning.cjs [--shots]
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const OUT = path.join(__dirname, '..', 'png');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(46) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const srv = http.createServer((q, r) => {
    const url = q.url.split('?')[0];
    if (url.startsWith('/api/')) { r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{"ok":true}'); }
    const f = path.join(ROOT, decodeURIComponent(url).replace(/^\/+/, '') || 'till.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  p.on('pageerror', (e) => { console.log('    PAGE ERROR: ' + e.message); bad++; });
  await p.goto(base + '/till.html');
  await p.waitForFunction(() => typeof window.setMode === 'function', null, { timeout: 30000 });

  /* a counter that is paired, stocked and signed into — the ordinary second morning */
  const shop = () => `(() => {
    ls.set(tillGivenKey(), 'C2');
    ls.set(shopLs('cb_till_counter_name'), 'Front');
    WHO = { id:'w1', name:'Bala', kind:'coassist', since:new Date().toISOString(), float:2000 };
    window.S = { shop:{ country: 'IN', name:'Mayur Bhavan', currency:'INR' }, at:new Date().toISOString(),
      items:[{item_id:'i1',name:'Masala Dosa',price:70,unit:'plate'},{item_id:'i2',name:'Filter Coffee',price:25,unit:'cup'}] };
    TILL_CLAIM = { resume_next: 43 }; TILL_CLASH = null;
    setMode('sell');
  })()`;
  await p.evaluate(shop());

  /**
   * ⚠️⚠️ ASK THE COUNTER WHAT IT IS CALLED. The first draft set C2 and then asserted C2 — and the page
   * reported C1, because tillGivenKey() is shop-scoped and the shop was not set when it was written. Every
   * clash check below then compared C2 against C1, found no clash, and reported "may open" for the right
   * reason and the wrong one. A fixture that states what it expects instead of reading it proves nothing.
   */
  const MINE = await p.evaluate(() => tillId());
  console.log('  (this counter calls itself ' + MINE + ')');

  console.log('\n══ the engine is on the page, and the page holds no rule ' + '═'.repeat(16));
  const wired = await p.evaluate(() => ({
    engine: !!window.CBDayOpen,
    steps: window.CBDayOpen ? CBDayOpen.STEPS.map((s) => s.id) : [],
    fromEngine: typeof dayLines === 'function',
  }));
  say('the morning engine is loaded', wired.engine, 'window.CBDayOpen');
  say('and the page asks it for the steps', wired.fromEngine && wired.steps.length === 5, wired.steps.join(' → '));

  /* ══ ⭐⭐ THE WORDS ON THE SCREEN ═══════════════════════════════════════════════════════════════════ */
  console.log('\n── what the morning says before it is opened ' + '─'.repeat(28));
  const rows = await p.evaluate(() => {
    const el = document.createElement('div'); el.innerHTML = dayLines(null);
    return [...el.querySelectorAll('[data-testid="till-day-step"]')].map((r) => ({
      step: r.dataset.step, state: r.dataset.state, text: r.innerText.replace(/\s+/g, ' ').trim() }));
  });
  rows.forEach((r) => console.log('      ' + r.state.padEnd(5) + ' ' + r.text));
  say('five rows, each with its answer', rows.length === 5, rows.map((r) => r.step).join(' · '));
  say('⭐ the counter number is PROVIDED', new RegExp(MINE).test((rows.filter((r) => r.step === 'counter')[0] || {}).text || ''),
      (rows.filter((r) => r.step === 'counter')[0] || {}).text);
  say('the drawer is said back', /2,000/.test((rows.filter((r) => r.step === 'float')[0] || {}).text || ''),
      (rows.filter((r) => r.step === 'float')[0] || {}).text);

  /** ⚠️ the thing Athi asked for in so many words: it must SAY what it is doing while it does it */
  console.log('\n── and while a step is running ' + '─'.repeat(41));
  const doing = await p.evaluate(() => {
    const el = document.createElement('div'); el.innerHTML = dayLines('products');
    const r = el.querySelector('[data-step="products"]');
    return { state: r.dataset.state, text: r.innerText.replace(/\s+/g, ' ').trim(), spin: !!r.querySelector('.spin') };
  });
  say('⭐⭐ it says "Loading product data"', /Loading product data/.test(doing.text), '"' + doing.text + '"');
  say('and it is visibly working', doing.state === 'doing' && doing.spin, 'a spinner, not a tick');

  /* ══ ⚠️⚠️⚠️ THE "BEFORE THAT" ═══════════════════════════════════════════════════════════════════════
   * "find which counter was already associated and provide that number, BEFORE THAT find if it is not used
   * by someone." Two PCs numbering as C1 put 29 duplicated bills in a shop's books. */
  console.log('\n── when somebody else is already on that counter ' + '─'.repeat(23));
  const held = await p.evaluate((mine) => {
    TILL_CLASH = { id: mine, held_by: 'Back office' };
    const el = document.createElement('div'); el.innerHTML = dayLines(null);
    const r = el.querySelector('[data-step="counter"]');
    const why = el.querySelector('[data-testid="till-day-why"]');
    return { state: r.dataset.state, text: r.innerText.replace(/\s+/g, ' ').trim(),
             why: why ? why.innerText.trim() : '', open: canOpenSaysWhat() };
    function canOpenSaysWhat(){ const v = CBDayOpen.canOpen(dayState()); return v.ok ? 'may open' : ('blocked at ' + v.step); }
  }, MINE);
  say('⚠️⚠️⚠️ the morning STOPS', held.open === 'blocked at counter', held.open);
  say('and it names who has it', /Back office/.test(held.why), '"' + held.why + '"');
  say('with the way out on the same line', /Close it there first/.test(held.why), 'not just a refusal');
  say('the row is marked, not merely unticked', held.state === 'stop', 'data-state=' + held.state);

  /** ⚠️ and the ordinary morning — this PC reopening its own counter — must NOT be blocked */
  const ownAgain = await p.evaluate(() => { TILL_CLASH = null; return CBDayOpen.canOpen(dayState()).ok; });
  say('⚠️ but reopening MY own counter is fine', ownAgain === true, 'a shop is not blocked by its own key');

  /* ══ things that are said and never block ══════════════════════════════════════════════════════════ */
  console.log('\n── what is said but never stops a shop selling ' + '─'.repeat(25));
  const soft = await p.evaluate(() => {
    const was = S.at;
    S.at = new Date(Date.now() - 50 * 3600000).toISOString();
    const stale = CBDayOpen.read('products', dayState());
    const noFloat = (() => { const f = WHO.float; delete WHO.float;
      const v = { read: CBDayOpen.read('float', dayState()), open: CBDayOpen.canOpen(dayState()).ok };
      WHO.float = f; return v; })();
    S.at = was;
    return { stale, noFloat };
  });
  say('day-old prices are said, not refused', soft.stale.done === true && soft.stale.stale === true, soft.stale.say);
  say('⚠️⚠️ an uncounted drawer is not zero', soft.noFloat.read.say === 'not counted', '"' + soft.noFloat.read.say + '"');
  say('and it does not block the day', soft.noFloat.open === true, 'a shop can sell while the drawer is uncounted');

  /* ══ ⭐ AND THE WHOLE THING, DRIVEN THE WAY A PERSON DRIVES IT ═════════════════════════════════════ */
  console.log('\n── opening the day, through the button ' + '─'.repeat(33));
  /* ⚠️ toggleMenu() is the page's own control — menuOpen() was a name I invented, and it threw. */
  await p.evaluate(() => { TILL_CLASH = null; toggleMenu(); });
  await p.waitForTimeout(300);
  await p.evaluate(() => { menuSection('day'); });
  await p.waitForTimeout(400);
  const btn = p.locator('[data-testid="till-day-begin"]');
  const there = await btn.count();
  say('the Open the day button is there', there === 1, there + ' found');
  if (there) {
    /**
     * ⚠️ THE BUTTON'S OWN onclick, not beginDay() by name. The menu panel scrolls, so a real pointer click
     * needs the row on screen and Playwright refused it as "not visible" — but clicking the ELEMENT still goes
     * through the control the page wired, which is the thing worth proving. Calling beginDay() directly would
     * prove the function works and say nothing about whether anything reaches it.
     * [[feedback-probe-through-the-gate]]
     */
    await p.$eval('[data-testid="till-day-begin"]', function(el){ el.click(); });
    /* ⭐ caught MID-RUN, which is the only way to prove it narrates rather than jumping to the end */
    await p.waitForTimeout(300);
    const mid = await p.evaluate(() => {
      const r = document.querySelector('[data-testid="till-day-step"][data-state="doing"]');
      return r ? r.innerText.replace(/\s+/g, ' ').trim() : '';
    });
    say('⭐⭐⭐ a step is caught SAYING what it does', !!mid, mid ? ('"' + mid + '"') : 'nothing was ever shown');
    await p.waitForFunction(() => typeof dayOpened === 'function' && dayOpened(), null, { timeout: 15000 }).catch(() => {});
    const end = await p.evaluate(() => ({ opened: dayOpened(), said: CBDayOpen.done(dayState()) }));
    say('and the day ends up open', end.opened === true, 'dayOpened()');
    say('with one sentence for what it settled', new RegExp('Bala is on counter ' + MINE).test(end.said), '"' + end.said + '"');
  }

  if (process.argv.includes('--shots')) {
    fs.mkdirSync(OUT, { recursive: true });
    await p.screenshot({ path: path.join(OUT, 'Morning.png') });
    console.log('\n  frame → ' + path.join(OUT, 'Morning.png'));
  }

  await b.close(); srv.close();
  console.log(bad ? '\n' + bad + ' failed' :
    '\nthe counter sets itself up out loud, names its number, and stops when somebody else holds it\n');
  process.exit(bad ? 1 : 0);
})();
