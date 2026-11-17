/* till-netsim-autostop.cjs — PRETENDING IS LOUD, TIMED AND REVERSIBLE (design-handoff/03-the-line §4,
 * Phase 4.7 — "it can be left on today; after this it cannot")
 *
 * ⚠️⚠️⚠️ This risk is real: a throttle a shopkeeper forgets about is a real shop that quietly looks slow or
 * broken for the rest of the day. Phase 3.4 already built the mechanism (NET_UNTIL + a real setTimeout, never
 * a switch left to habit) — till-netsim.cjs proves the throttle is FAITHFUL (the page believes it), this
 * proves it is REVERSIBLE: it always ends on its own, it will not start over a bill in hand, and "Full
 * speed" is the same thing as Stop, not a fourth option beside it.
 *
 * Run: node e2e/till-netsim-autostop.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(56) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const srv = http.createServer((q, r) => {
    const url = q.url.split('?')[0];
    if (url.startsWith('/api/')) { r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{"ok":true}'); }
    const f = path.join(ROOT, decodeURIComponent(url).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((res) => srv.listen(0, res));
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('http://127.0.0.1:' + srv.address().port + '/till.html');
  await p.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });
  await p.evaluate(() => {
    ls.set(tillGivenKey(), 'C1');
    window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR' }, at: new Date().toISOString(), items: [] };
    setMode('sell');
  });

  console.log('\n── ⭐⭐⭐ it always ends on its own — a real timer, not a switch left to habit ' + '─'.repeat(0));
  const ended = await p.evaluate(async () => {
    NET_MINUTES = 0.001;                 /* a few ms, so the real countdown fires inside a test */
    netSet('g2');
    var wasSim = netNow() !== 'full', untilSet = !!NET_UNTIL;
    await new Promise((r) => setTimeout(r, 300));
    var backToFull = netNow() === 'full';
    var bannerGone = (document.getElementById('netbar') || {}).hidden;
    NET_MINUTES = 15;                    /* restore the real default for every later step */
    return { wasSim: wasSim, untilSet: untilSet, backToFull: backToFull, bannerGone: bannerGone };
  });
  say('it really started pretending', ended.wasSim && ended.untilSet, 'NET_UNTIL was set');
  say('and it really ended on its own, with nobody touching Stop', ended.backToFull, 'back to full speed');
  say('the header banner leaves with it', ended.bannerGone, 'no banner once real');

  console.log('\n── ⭐⭐ it will not start while a bill is open — held, not refused ' + '─'.repeat(0));
  const held = await p.evaluate(async () => {
    netSet('full');
    S.items = [{ item_id: 'i1', name: 'Tea', price: 15, unit: 'cup' }];
    CART = [{ item_id: 'i1', name: 'Tea', price: 15, qty: 1 }];
    netSet('g2');
    var stillFull = netNow() === 'full', pendSet = NET_PEND === 'g2';
    var toast = (document.getElementById('lastnote') || {}).textContent || '';
    return { stillFull: stillFull, pendSet: pendSet, toast: toast };
  });
  say('the line does not change under a bill in hand', held.stillFull, 'still full speed');
  say('it is HELD, not thrown away', held.pendSet, 'NET_PEND carries it for later');
  say('and it says so, in words, why nothing happened', /starts when this bill is done/i.test(held.toast),
    '"' + held.toast + '"');

  console.log('\n── and it starts the moment the bill is actually done ' + '─'.repeat(20));
  const flushed = await p.evaluate(() => {
    CART = [];                     /* the bill is done */
    netPendFlush();
    return { now: netNow(), pendCleared: NET_PEND == null };
  });
  say('the held pretence starts the moment the bill clears', flushed.now === 'g2', 'now ' + flushed.now);
  say('and the hold itself is spent, not left waiting again', flushed.pendCleared, 'NET_PEND cleared');

  console.log('\n── ⭐ "Full speed" IS Stop — one control, not two ways to mean the same thing ' + '─'.repeat(0));
  const stop = await p.evaluate(() => {
    document.querySelector('[data-testid="till-net-off"]').click();
    return { now: netNow(), until: NET_UNTIL, timerGone: NET_TIMER == null,
             bannerHidden: (document.getElementById('netbar') || {}).hidden };
  });
  say('"Stop now" on the banner is netSet(\'full\')', stop.now === 'full', 'now ' + stop.now);
  say('the countdown is gone, not just paused', stop.until == null && stop.timerGone, 'NET_UNTIL and NET_TIMER both cleared');
  say('and the banner itself is gone', stop.bannerHidden, 'hidden');

  console.log('\nconsole/page errors:', errs.length ? errs.join(' | ') : 'none');
  await b.close(); srv.close();
  console.log(bad || errs.length ? '\n' + (bad + errs.length) + ' failed'
    : '\npretending is loud, timed and reversible — it cannot be left on');
  process.exit(bad || errs.length ? 1 : 0);
})();
