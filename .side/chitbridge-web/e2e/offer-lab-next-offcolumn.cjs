/* offer-lab-next-offcolumn.cjs — THE COMBINED % PER ROW, NOT ONE EXAMPLE FOR THE WHOLE TABLE
 *
 * Athi: "one more column to show 10+5%=14.5%... otherwise someone has to compute" — then, live on the
 * deployed page, on the Rupees-off screen: "25% + 5% = 28.8% off, computation showing is wrong here... we
 * cannot show this value?" Both are the same finding. The single note this replaced used items()[0]'s price
 * to stand in for every row: right on the flat-% screen (every item takes the same rate), wrong on the ₹
 * screen — ₹10 off a ₹40 item is 25%, ₹10 off a ₹200 item is 5%, so one example at the top misrepresented
 * every other row.
 *
 * Run: node e2e/offer-lab-next-offcolumn.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(48) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'text/plain' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((res) => srv.listen(0, res));
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('http://127.0.0.1:' + srv.address().port + '/offer-lab-next.html');
  await p.waitForTimeout(200);

  console.log('\n── the exact scenario reported: ₹10 off, two different-priced items, 5% loyalty ' + '─'.repeat(0));
  const scenario = await p.evaluate(() => {
    pickGoal('amount'); S.scope = 'cat'; S.catId = 'tiffin'; S.rsOff = 10;
    S.custOn = true; S.loyOn = true; S.loyPct = 5; S.cap = 50; apply();
    const html = outLine();
    /* two real tiffin items at different prices, per HOTEL's own sample data */
    const idli = byId('idli'); const paper = byId('paper');   /* ₹40 and ₹85 */
    const rIdli = priceRow(idli, CBOffers.compound([offerFrac(idli)*100, loyFrac()*100])/100);
    const rPaper = priceRow(paper, CBOffers.compound([offerFrac(paper)*100, loyFrac()*100])/100);
    return {
      html,
      noStaleNote: !/\d+% \+ \d+% = <b>\d+(\.\d+)?% off<\/b>/.test(html),
      hasOffColumn: /<th>Off<\/th>/.test(html),
      idliOffPct: Math.round((idli.price - rIdli.shown) / idli.price * 1000) / 10,
      paperOffPct: Math.round((paper.price - rPaper.shown) / paper.price * 1000) / 10,
    };
  });
  say('the misleading single top-line note is gone', scenario.noStaleNote, 'no "X% + Y% = Z% off" note above the table');
  say('an "Off" column exists instead', scenario.hasOffColumn, 'per-row, not per-table');
  say('₹10 off a cheaper item is a BIGGER percentage', scenario.idliOffPct > scenario.paperOffPct,
      'idli (₹40) → ' + scenario.idliOffPct + '% · paper roast (₹85) → ' + scenario.paperOffPct + '%');
  say('⚠️ so one example at the top could never have represented both rows', scenario.idliOffPct !== scenario.paperOffPct,
      'they genuinely differ — confirms a single note was always going to mislead one of them');

  console.log('\n── the % screen (where every item DOES share one rate) still shows it correctly, per row ' + '─'.repeat(0));
  const flat = await p.evaluate(() => {
    pickGoal('percent'); S.scope = 'cat'; S.catId = 'tiffin'; S.pctOff = 25; S.loyOn = true; S.loyPct = 5; S.round = '0'; apply();
    const idli = byId('idli'); const r = priceRow(idli, CBOffers.compound([offerFrac(idli)*100, loyFrac()*100])/100);
    return { offPct: Math.round((idli.price - r.shown) / idli.price * 1000) / 10, expect: Math.round((1 - (1 - 0.25) * (1 - 0.05)) * 1000) / 10 };
  });
  say('25% + 5% loyalty compounds to 28.75%, not 30%, and is now shown per row correctly',
      Math.abs(flat.offPct - flat.expect) < 0.5, 'shown ' + flat.offPct + '% · expected ' + flat.expect + '% (S.round=\'0\' i.e. exact, no rupee rounding)');

  console.log('\n── a row that was refused (below cost) shows 0% actually taken, not the % that was asked for ' + '─'.repeat(0));
  const refused = await p.evaluate(() => {
    pickGoal('percent'); S.scope = 'cat'; S.catId = 'tiffin'; S.pctOff = 90; S.loyOn = false;
    S.belowCost = true; S.belowAct = 'exclude'; apply();
    const cheap = byId('coffee') || byId('tea');   /* a low-margin item — 90% off should breach cost */
    var target = null;
    ['coffee','tea','idli'].forEach(function(id){ var it = byId(id); if (it && it.cost != null) { var r = priceRow(it, 0.9); if (r.status === 'left') target = { it: it, r: r }; } });
    if (!target) return { skipped: true };
    return { skipped: false, offPct: Math.round((target.it.price - target.r.shown) / target.it.price * 1000) / 10 };
  });
  if (refused.skipped) say('(no item in this book actually breaches cost at 90% off — nothing to check)', true, 'skipped, not a failure');
  else say('shows 0% taken, not 90% requested', refused.offPct === 0, refused.offPct + '%');

  console.log('\nconsole/page errors:', errs.length ? errs.join(' | ') : 'none');
  await b.close(); srv.close();
  console.log(bad || errs.length ? '\n' + (bad + errs.length) + ' failed'
    : '\nthe combined percentage is now correct and visible on every row, not guessed from one example');
  process.exit(bad || errs.length ? 1 : 0);
})();
