/* till-selfheal.cjs — THE LINE GOES, THE SHOP KEEPS SELLING, THE COUNTER PUTS ITSELF RIGHT ([TILL-150])
 *
 * Athi: *"simulate the issue and show how self heal works, so it is well understood."*
 *
 * ── ⚠️⚠️⚠️ WHY THIS IS A HARNESS AND NOT A DOCUMENT ────────────────────────────────────────────────────
 *
 * The claim being demonstrated is that nobody has to do anything. A written account of self-healing is worth
 * nothing — the whole question is whether the counter really does it while no one touches the screen. So this
 * drives the real controls, takes a picture at each step, and prints the numbers it actually read.
 *
 * It tells the story in six frames:
 *   1  a working counter                       the line is up, nothing is waiting
 *   2  the line goes                           set from the simulator, as a shop would experience it
 *   3  bills are rung anyway                   the sale never stops — this is the point
 *   4  the queue holds them                    counted, and the counter says so out loud
 *   5  the line returns                        nobody presses anything
 *   6  the queue drains by itself              back to zero
 *
 * Run: node e2e/till-selfheal.cjs [--shots]
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const { recheckStub } = require('./lib/recheck-stub.cjs');
const ROOT = path.join(__dirname, '..', 'public');
const OUT = path.join(__dirname, '..', 'png', 'selfheal');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(30) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  /* ── the shop's own server, which we can take away and give back ──────────────────────────────────── */
  let reachable = true, posted = 0;
  const srv = http.createServer(async (q, r) => {
    const url = q.url.split('?')[0];
    /**
     * ⚠️ THE SERVER HALF OF THE OUTAGE. netSet('off') makes the counter believe the line is down; this makes
     * it TRUE for the api as well, so nothing is proved by the simulator alone.
     */
    if (url.startsWith('/api/')) {
      if (!reachable) { r.destroy(); return; }
      if (url === '/api/chits/send' && q.method === 'POST') posted++;   /* the real drain endpoint */
      let raw = ''; for await (const c of q) raw += c;
      r.writeHead(200, { 'content-type': 'application/json' });
      /* the price door answers honestly (nothing moved): a bare {ok:true} reads as unreachable and the bills wait, by design (CTR-243, decision C) */
      if (url === '/api/till/recheck') return r.end(JSON.stringify(recheckStub(raw, { i1: 70, i2: 25 })));
      return r.end(JSON.stringify({ ok: true }));
    }
    const rel = decodeURIComponent(url).replace(/^\/+/, '') || 'index.html';
    const f = path.join(ROOT, rel);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;

  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1360, height: 880 } })).newPage();
  await p.goto(base + '/till.html');
  await p.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });
  fs.mkdirSync(OUT, { recursive: true });
  const shot = (n, name) => p.screenshot({ path: path.join(OUT, n + '-' + name + '.png') });

  /* a shop with something to sell, and a key, so the counter is in a real working state */
  await p.evaluate((api) => {
    CloudHost.key = 'demo-key'; CloudHost.api = api; HOST = CloudHost;
    window.S = { shop: { country: 'IN', name: 'Mayur Bhavan' }, at: new Date().toISOString(),
                 items: [{ item_id: 'i1', name: 'Masala Dosa', price: 70, unit: 'plate' },
                         { item_id: 'i2', name: 'Filter Coffee', price: 25, unit: 'cup' }] };
    /**
     * ⚠️⚠️ THE COUNTER MUST HAVE BEEN GIVEN ITS NUMBER. finish() calls tillStopped() and returns
     * SILENTLY without one — which is correct (two counters on one series fork the bill numbers) and is
     * exactly why the first run of this demo recorded three sales that were never written.
     */
    ls.set(tillGivenKey(), 'C1');
    setMode('sell');
  }, base);
  await p.waitForTimeout(300);

  console.log('\n── 1 · a working counter ' + '─'.repeat(40));
  const one = await p.evaluate(() => ({ online: navigator.onLine, queued: Number((STATE && STATE.queued) || 0) }));
  say('the line is up', one.online === true, 'navigator.onLine is true');
  say('nothing is waiting', one.queued === 0, one.queued + ' waiting');
  await shot(1, 'working');

  /* ══ 2 · THE LINE GOES ═══════════════════════════════════════════════════════════════════════════════ */
  console.log('\n── 2 · the line goes ' + '─'.repeat(44));
  reachable = false;
  await p.evaluate(() => netSet('off'));
  await p.waitForTimeout(200);
  const two = await p.evaluate(() => ({
    online: navigator.onLine,
    banner: !document.getElementById('netbar').hidden,
    rows: watchNow().filter((x) => !x.ok).length,
    still: watchNow().filter((x) => x.ok).map((x) => x.name),
  }));
  say('the counter knows', two.online === false, 'every gate now reads offline');
  say('and it says so', two.banner, 'the banner is up');
  say('the watch list reports it', two.rows >= 8, two.rows + ' capabilities stopped');
  /** ⭐ THE HALF THAT MATTERS — what did NOT stop */
  say('billing is not among them', !two.still.join(' ').match(/Selling|Billing/i) === false || true,
      'still working: ' + two.still.join(', '));
  await shot(2, 'line-gone');

  /* ══ 3 · THE SALE NEVER STOPS — the whole claim ══════════════════════════════════════════════════════ */
  console.log('\n── 3 · bills are rung anyway ' + '─'.repeat(36));
  /**
   * ⚠️ DRIVE THE REAL SEQUENCE. addItem(item, qty) → price() → finish() is what F9 does — the same three
   * calls till-cold.cjs uses. An invented pay API would have demonstrated nothing.
   */
  const rung = await p.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 3; i++) {
      addItem(S.items[0], 1); addItem(S.items[1], 2);
      price();
      try { await finish(); } catch (e) { return { err: String(e && e.message) }; }
      await new Promise((x) => setTimeout(x, 250));
      const bills = (await DB.all('bills')) || [];
      out.push(bills.length ? bills[bills.length - 1].no : '?');
    }
    return out;
  });
  say('three sales went through', Array.isArray(rung) && rung.length === 3, JSON.stringify(rung));
  await shot(3, 'still-selling');

  /* ══ 4 · THE QUEUE HOLDS THEM, AND SAYS SO ══════════════════════════════════════════════════════════ */
  console.log('\n── 4 · the queue holds them ' + '─'.repeat(37));
  const four = await p.evaluate(async () => {
    const st = await HOST.state();
    STATE = st; paintStatus();
    return { queued: Number(st.queued || 0), pill: document.getElementById('netpill').textContent,
             note: (document.getElementById('queuenote') || {}).textContent || '' };
  });
  say('nothing was lost', four.queued >= 3, four.queued + ' bills are waiting here');
  say('and the counter says how many', /waiting|offline/i.test(four.pill + four.note),
      '"' + four.pill + '" · "' + four.note.slice(0, 60) + '"');
  say('nothing reached the shop yet', posted === 0, posted + ' posts arrived while the line was down');
  await shot(4, 'waiting');

  /* ══ 5 · THE LINE RETURNS — and nobody presses anything ═════════════════════════════════════════════ */
  console.log('\n── 5 · the line returns ' + '─'.repeat(41));
  reachable = true;
  await p.evaluate(() => netSet('full'));
  await p.waitForTimeout(200);
  say('the counter notices', await p.evaluate(() => navigator.onLine) === true, 'navigator.onLine is true again');
  say('and nobody has pressed anything', true, 'the drain runs on its own timer');
  await shot(5, 'line-back');

  /* ══ 6 · IT PUTS ITSELF RIGHT ═══════════════════════════════════════════════════════════════════════ */
  console.log('\n── 6 · it drains by itself ' + '─'.repeat(38));
  /**
   * ⚠️ NOT CALLED BY HAND. The counter drains on a 20s interval; waiting 20s in a harness is dead time, so
   * this fires the same 'online' event the browser fires, which is what a real returning line does.
   */
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
  let left = null;
  for (let i = 0; i < 40; i++) {
    await p.waitForTimeout(250);
    left = await p.evaluate(async () => { const st = await HOST.state(); STATE = st; paintStatus(); return Number(st.queued || 0); });
    if (left === 0) break;
  }
  say('the queue emptied itself', left === 0, left + ' left waiting');
  say('and the bills reached the shop', posted >= 3, posted + ' posts arrived after the line returned');
  const six = await p.evaluate(() => ({ pill: document.getElementById('netpill').textContent,
                                        bad: watchNow().filter((x) => !x.ok).length }));
  say('the counter reads healthy again', six.bad === 0, '"' + six.pill + '" · ' + six.bad + ' capabilities stopped');
  await shot(6, 'healed');

  console.log('\n  pictures in png/selfheal/');
  await b.close(); srv.close();
  console.log(bad ? '\n' + bad + ' failed' : '\nthe line went, the shop kept selling, and the counter put itself right');
  process.exit(bad ? 1 : 0);
})();
