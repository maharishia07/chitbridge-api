/* till-blank.cjs — WHAT A COUNTER CONNECTED TO NOTHING SAYS ([TILL-119])
 *
 * Athi, 2026-09-19: *"currently, if i give clear and reload it should say, you are not connected, no store id
 * exists etc?"*
 *
 * ── ⚠️⚠️⚠️ IT PARTLY DID, AND THE TWO SENTENCES THAT MATTERED MOST WERE BOTH WRONG ──────────────────────────
 *
 * The header was honest: "Not paired yet", "no key yet", "no prices yet", "nobody signed in". The body was not:
 *
 *   ⚠️⚠️ the footer said **"everything has reached ChitBridge"** — on a counter that has never reached
 *     ChitBridge at all. The queue is empty because nothing was ever taken, not because everything arrived. It
 *     is the line a shopkeeper reads before closing the shutters, and it was a false all-clear.
 *
 *   ⚠️ the shelf said **"press ↻ once, while online"** — advice that CANNOT BE FOLLOWED, because with no key ↻
 *     has nothing to ask. It sent a person to press a button that would do nothing and say nothing.
 *
 * ⭐ THE RULE: the advice must match the state. No key → pair it. Key but no shop → read the shop.
 * [[feedback-write-for-the-shopkeeper]] [[feedback-silence-is-the-bug]]
 *
 * Run: node e2e/till-blank.cjs [--shots]
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const SHOTS = process.argv.includes('--shots');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
            '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log(String(l).padEnd(26) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const f = path.join(ROOT, rel);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, r));
  const URL = 'http://127.0.0.1:' + srv.address().port + '/till.html';

  const b = await chromium.launch();
  /* ⚠️ A GENUINELY BLANK MACHINE: a fresh context, so no localStorage, no IndexedDB, no key — exactly what
     "clear and reload" leaves behind, and what a shop sees the first time it opens the page. */
  const ctx = await b.newContext({ viewport: { width: 1280, height: 880 } });
  const p = await ctx.newPage();
  await p.goto(URL);
  await p.waitForFunction(() => typeof window.paired === 'function', null, { timeout: 30000 });
  await p.waitForTimeout(600);

  console.log('\n── a counter that has never been connected ' + '─'.repeat(26));

  const st = await p.evaluate(() => ({
    paired: window.paired(),
    blank: window.blankWords(),
    queue: window.queueWords(),
    body: document.body.innerText,
  }));

  say('it knows', st.paired === false, 'paired() is false on a counter with no key');

  /**
   * ⚠️⚠️ THE FALSE ALL-CLEAR. This is the one that would cost a shopkeeper money, because it is the line they
   * read to decide whether the day is safe.
   */
  say('NO FALSE ALL-CLEAR', !/everything has reached ChitBridge/i.test(st.queue),
    'the footer does not claim everything arrived: "' + st.queue + '"');
  say('it says why', /not connected/i.test(st.queue), 'it says the counter is not connected to a shop');

  /** ⚠️ advice you cannot follow is worse than none */
  say('NO IMPOSSIBLE ADVICE', !/press .*once, while online/i.test(st.blank),
    'the shelf does not tell an unpaired counter to press ↻');
  say('it points somewhere', /not connected to a shop/i.test(st.blank),
    'it says what is actually true: "' + st.blank.slice(0, 60) + '…"');

  /** ⚠️ and the whole page must not contain the reassuring sentence anywhere */
  say('nowhere on the page', !/everything has reached ChitBridge/i.test(st.body),
    'the reassurance appears nowhere on a blank counter');

  /* ⭐ and there is a way forward, which is the point of saying any of this */
  const connect = await p.locator('[data-testid="till-connect"]').count();
  say('a way forward', connect > 0, 'the shelf offers a Connect button');

  console.log('\n── and the honest parts are still honest ' + '─'.repeat(27));
  /* ⭐ M08 (round W1): the shop-name slot says "Not signed in yet" on a blank browser — a phone is a person on a device,
     so the first thing it lacks is a sign-in, not a pairing. Same honesty, the current word. */
  for (const [what, re] of [['not paired', /not signed in yet/i], ['no key', /no key yet/i],
                            ['no prices', /no prices yet/i], ['nobody signed in', /nobody signed in/i]]) {
    say(what, re.test(st.body), 'the header still says it');
  }

  if (SHOTS) { await p.screenshot({ path: path.join(__dirname, '..', 'png', 'Blank.png'), fullPage: false });
               console.log('\nwrote png/Blank.png'); }

  await b.close(); await new Promise((r) => srv.close(r));
  console.log('\n' + (bad ? '✗ ' + bad + ' FAILED\n' : '✓ all good\n'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('\n✗ harness itself broke:\n' + (e && e.stack || e)); process.exit(1); });
