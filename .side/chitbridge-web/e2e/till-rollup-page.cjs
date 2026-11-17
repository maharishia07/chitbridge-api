/* till-rollup-page.cjs — THE PAGE, THE PROGRAM AND THE SERVER AGREE ON A DAY ([TILL-125])
 *
 * ── ⚠️⚠️⚠️ WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────────
 *
 * The day's arithmetic lived in THREE places and two of them disagreed. till.js counted a credit note as a sale
 * and kept its refund in the drawer; till.html had been fixed for exactly that on 2026-09-18 and the shop PC had
 * not. [TILL-122] gave the counter program and the server one engine. [TILL-125] puts the PAGE on it too.
 *
 * ⭐ SO THE TEST IS NOT "does the page compute a total" — it is "does the page compute the SAME total as the
 * engine the summary chit is folded from". A screen that says one number while the shop's permanent record says
 * another is the failure this whole thread has been about.
 *
 * ⚠️ It runs the REAL page in a browser and the REAL engine in node, on the same rows, and compares.
 *
 * Run: node e2e/till-rollup-page.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const R = require(path.join(__dirname, '..', '..', 'chitbridge-api', 'lib', 'rollup.js'));
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
            '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log(String(l).padEnd(30) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

/** a day with everything awkward in it: two tenders, a discount, and a return on a different tender */
const ROWS = [
  { no: 'A-1', at: '2026-09-14T10:00:00Z', total: 100, saved: 10, payments: [{ how: 'Cash', amount: 100 }] },
  { no: 'A-2', at: '2026-09-14T11:00:00Z', total: 250, payments: [{ how: 'UPI', amount: 250 }] },
  { no: 'A-3', at: '2026-09-14T12:00:00Z', total: 33.33, payments: [{ how: 'Cash', amount: 33.33 }] },
  { no: 'CN-1', at: '2026-09-14T13:00:00Z', kind: 'credit_note', total: -40, refunds: [{ how: 'Cash', amount: 40 }] },
  { no: 'CN-2', at: '2026-09-14T14:00:00Z', kind: 'credit_note', total: -15, refunds: [{ how: 'UPI', amount: 15 }] },
];

(async () => {
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const f = path.join(ROOT, rel);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r2) => srv.listen(0, r2));
  const URL = 'http://127.0.0.1:' + srv.address().port + '/till.html';

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  const p = await ctx.newPage();
  await p.goto(URL);
  await p.waitForFunction(() => typeof window.dayCloseSheet === 'function', null, { timeout: 30000 });

  console.log('\n── the engine reached the page ' + '─'.repeat(37));
  /**
   * ⚠️⚠️ THE ENGINE MUST ACTUALLY BE THERE. Every call on the page is written `CBRollup && CBRollup.x ? … :
   * fallback`, so a missing engine would be INVISIBLE — the page would quietly use its own copy and this whole
   * change would be a no-op that still passed its tests. [[feedback-silence-is-the-bug]]
   */
  const loaded = await p.evaluate(() => !!(window.CBRollup && window.CBRollup.totals && window.CBRollup.isReturn));
  say('CBRollup is on the page', loaded, 'the engine loaded and handed over its global');
  say('the page really uses it', await p.evaluate(() => {
    /* break the engine and the page must follow it, which proves the call is live rather than dead code */
    const real = window.CBRollup.totals;
    window.CBRollup.totals = () => ({ count: 999, returns: 0, gross: 0, refunds: 0, total: 0, by: {} });
    const got = window.dayCloseSheet([{ no: 'x', at: '2026-09-14T10:00:00Z', total: 1, payments: [] }]).bills;
    window.CBRollup.totals = real;
    return got === 999;
  }), 'dayCloseSheet takes its sale count from the engine, not from its own filter');

  console.log('\n── ⚠️⚠️ the page and the engine agree ' + '─'.repeat(33));
  const mine = R.totals(ROWS);
  const theirs = await p.evaluate((rows) => {
    const d = window.dayCloseSheet(rows);
    return { bills: d.bills, returns: d.returns, returned: d.returned, total: d.total,
             modes: d.modes, refunded: d.refunded, cash_back: d.cash_back, expected_cash: d.expected_cash };
  }, ROWS);

  say('how many SALES', theirs.bills === mine.count, 'page ' + theirs.bills + ' = engine ' + mine.count + ' (2 credit notes excluded)');
  say('how many returns', theirs.returns === mine.returns, 'page ' + theirs.returns + ' = engine ' + mine.returns);
  say('how much handed back', theirs.returned === mine.refunds, 'page ' + theirs.returned + ' = engine ' + mine.refunds);
  say('what the shop kept', theirs.total === mine.total, 'page ' + theirs.total + ' = engine ' + mine.total);

  console.log('\n── ⚠️ and what the sheet keeps as its OWN ' + '─'.repeat(27));
  /**
   * ⚠️⚠️ `gross` MEANS TWO DIFFERENT THINGS and must NOT be unified. On this sheet it is total + savings
   * — what the goods would have cost before DISCOUNT. In the engine it is sales before RETURNS. Mapping one onto
   * the other would have been a silent, plausible, wrong number on a cash sheet. [[feedback-name-vs-behaviour]]
   */
  const pageGross = await p.evaluate((rows) => window.dayCloseSheet(rows).gross, ROWS);
  say('gross is NOT the engine’s', pageGross !== mine.gross,
    'sheet ' + pageGross + ' (before discount) vs engine ' + mine.gross + ' (before returns) — deliberately different');

  /**
   * ⚠️ AND `modes` COUNTS MONEY TAKEN, leaving refunds on their own line, because a drawer count wants the two
   * apart. The engine's `by` nets them. Both are right for their own screen; they must not be swapped.
   */
  say('modes counts money TAKEN', theirs.modes.Cash === 133.33,
    'Cash taken ' + theirs.modes.Cash + ', with the 40 handed back on its own line (' + theirs.cash_back + ')');
  say('and the engine nets it', mine.by.Cash === 93.33, 'engine by.Cash ' + mine.by.Cash + ' = 133.33 − 40');
  say('the drawer still balances', theirs.expected_cash === 93.33,
    'expected cash ' + theirs.expected_cash + ' agrees with the engine’s netted Cash');

  console.log('\n── one definition of a return ' + '─'.repeat(38));
  say('isReturnRow uses the engine', await p.evaluate(() => {
    const real = window.CBRollup.isReturn;
    window.CBRollup.isReturn = () => true;
    const got = window.isReturnRow({ kind: 'not-a-credit-note' });
    window.CBRollup.isReturn = real;
    return got === true;
  }), 'the page asks the engine what a return is');

  await b.close(); await new Promise((r2) => srv.close(r2));
  console.log('\n' + (bad ? '✗ ' + bad + ' FAILED\n' : '✓ all good\n'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('\n✗ harness itself broke:\n' + (e && e.stack || e)); process.exit(1); });
