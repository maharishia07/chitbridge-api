/* one-figure-live.cjs — l16-one-figure · Cash, BAS, Month lock, P&L, Terms and Dues say the same thing for Harbour Plumbing (opening GST balance + October trades), against a REAL api
 * (a SIT box's throwaway api; r3-e2e.sh pattern). Expected numbers are hand-computed in C:/dev/shots/l16-one-figure/EXPECTED.md. Shots 1366x768 and 390x844 into $OUT. */
'use strict';
const { chromium } = require('@playwright/test'), fs = require('fs'), path = require('path');
const L = require('./lib/live-harbour.cjs');
const OUT = process.env.OUT || 'e2e/shots';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const SCREENS = [
  ['cash', '/finance.html#/cash', '[data-testid="fc-list"]'],
  ['terms', '/finance.html#/terms', 'body'],
  ['dues', '/finance.html#/collections', 'body'],
  ['bas', '/accounts.html#gstclose', 'body'],
  ['lock', '/accounts.html#lock', 'body'],
  ['pl', '/accounts.html#pl', 'body']
];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { base } = await L.serve(), token = await L.signIn(process.env.HANDLE || 'harbour-plumbing-au');
  const b = await chromium.launch();
  const seen = {}, extra = {};
  for (const vp of [{ width: 1366, height: 768, tag: '1366' }, { width: 390, height: 844, tag: '390' }]) {
    const { ctx, page: p } = await L.open(b, base, token, vp);
    for (const [name, url, wait] of SCREENS) {
      await p.goto('about:blank');
      await p.goto(base + url);
      await p.waitForSelector(wait, { timeout: 20000 }).catch(() => {});
      await p.waitForTimeout(2500);
      if (name === 'bas') { /* l16-fin-ux: BAS opens on the quarter that holds the entries, nothing picked by hand */
        extra.basPeriod = await p.$eval('#pr_p', (s) => s.options[s.selectedIndex].textContent).catch(() => '');
        extra.navWord = await p.$eval('[data-testid="acc-nav-gstclose"]', (n) => n.textContent.trim()).catch(() => '');
        extra.title = await p.$eval('#title', (n) => n.textContent.trim()).catch(() => '');
      }
      if (name === 'lock' && vp.tag === '1366') {
        extra.lockTables = await p.locator('[data-testid="lk-table"]').count();
        extra.lockRows = await p.locator('[data-testid^="lk-row-"]').count();
        extra.lockFilled = await p.locator('[data-testid^="lk-lock-"].supact-pri:not([disabled])').count();
        extra.lockGreyWhy = await p.locator('[data-testid^="lk-lock-"][disabled]').count();
        extra.lockWhy = await p.locator('[data-testid^="lk-why-"]').count();
      }
      if (name === 'cash' && vp.tag === '1366') {
        extra.cashRows = await p.locator('[data-testid^="fc-row-"]').count();
        extra.cashQuiet = await p.locator('[data-testid="fc-quiet"]').count();
      }
      if (name === 'pl') { await p.waitForTimeout(1500); }
      const text = flat(await p.evaluate(() => document.body.innerText));
      if (vp.tag === '1366') seen[name] = text;
      const scroll = await p.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth }));
      console.log('   ' + name + ' ' + vp.tag + ' scrollH ' + scroll.sh + '/' + scroll.ih + ' scrollW ' + scroll.sw + '/' + scroll.iw);
      await p.screenshot({ path: path.join(OUT, 'of-' + name + '-' + vp.tag + '.png') });
    }
    await ctx.close();
  }
  { /* year close names the return too */
    const { ctx, page: p } = await L.open(b, base, token, { width: 1366, height: 768 });
    await p.goto(base + '/accounts.html#yearclose'); await p.waitForTimeout(4000);
    extra.yearText = flat(await p.evaluate(() => document.body.innerText)); await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, 'texts.json'), JSON.stringify(seen, null, 1));
  const has = (n, re) => re.test(seen[n] || '');
  ok(has('pl', /Sales\s*A\$4,800\.00/), '1 P&L Oct sales A$4,800.00');
  ok(has('bas', /A\$228\.00/) && has('bas', /480\.00/) && has('bas', /252\.00/), '2/3 BAS Oct-Dec 1A 480.00 · 1B 252.00 · to pay A$228.00');
  ok(has('cash', /BAS\s*A\$228\.00\s*·\s*28 Feb 2027/), '6 Cash: BAS A$228.00 · 28 Feb 2027');
  ok(has('cash', /GST owing from before 1 Oct 2026 · A\$1,462\.00 · due date not recorded/), '7 Cash: GST owing from before 1 Oct 2026 · A$1,462.00 · due date not recorded');
  ok(!has('cash', /A\$1,690\.00\s*·\s*28 Feb/), '8 Cash no longer lumps A$1,690.00 against 28 Feb');
  ok(has('lock', /Oct[^]{0,80}A\$4,800\.00/) && !has('lock', /5,280\.00/), '9 Month lock Oct: A$4,800.00 sales (not 5,280.00)');
  ok(/Oct/.test(extra.basPeriod) && has('bas', /A\$228\.00/), '12 BAS opens on Oct-Dec by itself (' + extra.basPeriod + ')');
  ok(extra.navWord === 'BAS' && extra.title === 'BAS' && /BAS/.test(extra.yearText) && !/Tax close/.test(extra.yearText), '13 the name is BAS in the sidebar, page and Year close (' + extra.navWord + '/' + extra.title + ')');
  ok(extra.lockTables === 1 && extra.lockRows === 12 && extra.lockFilled <= 1 && extra.lockGreyWhy >= 1 && extra.lockWhy >= 1, '14 Month lock: one table, 12 rows, at most one Lock filled, the rest grey with a reason ' + JSON.stringify(extra));
  ok(extra.cashRows >= 1 && extra.cashRows <= 3 && !has('cash', /\bquiet\b/) && !has('cash', /UPI and bank/) && (!has('cash', /Cash drawer/) || has('cash', /Bank A.19,963.00/)), '15 Cash: only days with money (' + extra.cashRows + ' rows), no quiet rows, Bank not UPI');
  ok(has('terms', /a bill is due on its own date/) && !has('terms', /has no due date/), '10 Terms: a bill is due on its own date');
  ok(has('dues', /14 Nov 2026/), '11 Dues: oldest due 14 Nov 2026 (the bill\'s own date)');
  console.log('RESULT pass ' + pass + ' fail ' + fail);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('CRASH', e && e.stack || e); process.exit(2); });
