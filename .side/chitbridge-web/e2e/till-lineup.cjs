/* till-lineup.cjs — THE LINE IS BELIEVED FROM WHAT GOT THROUGH, NOT FROM THE INTERFACE (Phase 4.1)
 *
 * design-handoff/04-settings (or wherever §7 lives now) is blunt about the risk: "changes when the app
 * believes it is offline, which changes what queues." Before this, ~30 call sites asked navigator.onLine
 * directly — a flag that says whether the device HAS an interface, not whether the shop ANSWERS. A counter
 * on wifi with a dead upstream link reports navigator.onLine === true for ever.
 *
 * ⭐⭐⭐ THE ONE THING THIS FILE MUST PROVE: a counter can have a working interface (navigator.onLine stays
 * true throughout — never toggled) and still have the page believe the line is down, because the last three
 * real sends failed. That is lineUp() doing its job; before Phase 4.1, every one of these would have said
 * "online" right up to the fetch that hangs.
 * ⚠️ AND THE OTHER DIRECTION MUST STILL WORK: navigator.onLine === false is a DEFINITE no ([TILL-144]) and
 * must win even when the last few tries happened to succeed (e.g. right before the cable was pulled).
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log(String(l).padEnd(32) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const f = path.join(ROOT, rel);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, r));
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 880 } });
  const p = await ctx.newPage();
  const URL = 'http://127.0.0.1:' + srv.address().port + '/till.html';
  await p.goto(URL);
  await p.waitForFunction(() => typeof window.lineState === 'function' && typeof window.lineUp === 'function', null, { timeout: 30000 });

  console.log('\n── a fresh counter, interface up, nothing tried yet ' + '─'.repeat(15));
  const fresh = await p.evaluate(() => ({
    onLine: navigator.onLine, state: lineState().state, up: lineUp(),
  }));
  say('the interface is up', fresh.onLine === true, 'navigator.onLine is ' + fresh.onLine);
  say('a first reading is a good one', fresh.state === 'good', 'lineState() is ' + fresh.state);
  say('so the page believes it', fresh.up === true, 'lineUp() is ' + fresh.up);

  /* ══ ⚠️⚠️⚠️ THE CENTRAL CASE — interface up, real sends failing ══════════════════════════════════════ */
  console.log('\n── interface up, but the last three real sends failed ' + '─'.repeat(11));
  const patchy = await p.evaluate(() => {
    lineNote(false, 4000); lineNote(false, 4000); lineNote(false, 4000);
    return { onLine: navigator.onLine, state: lineState().state, up: lineUp(),
             hub: /no network/i.test(hubChips()), hubOk: /class="hubchip ok"/.test(hubChips()) };
  });
  say('the interface never dropped', patchy.onLine === true, 'navigator.onLine stayed ' + patchy.onLine);
  say('but the line is judged dead', patchy.state === 'none', 'lineState() is ' + patchy.state);
  say('so the page no longer believes it', patchy.up === false, 'lineUp() is ' + patchy.up);
  say('and the hub chip says so', patchy.hub && !patchy.hubOk, 'hubChips() reads "no network", not "ok"');

  /* ══ recovery — real sends starting to get through again ═══════════════════════════════════════════ */
  console.log('\n── the line recovers ' + '─'.repeat(45));
  const recovered = await p.evaluate(() => {
    for (var i = 0; i < 10; i++) lineNote(true, 150);
    return { onLine: navigator.onLine, state: lineState().state, up: lineUp() };
  });
  say('good sends outweigh the three old failures', recovered.state !== 'none', 'lineState() is ' + recovered.state);
  say('the page believes it again', recovered.up === true, 'lineUp() is ' + recovered.up);

  /* ══ ⚠️ THE OTHER DIRECTION — a definite no still wins over a good recent run ════════════════════════ */
  console.log('\n── the interface itself drops ' + '─'.repeat(37));
  const dead = await p.evaluate(() => { netSet('off'); return { onLine: navigator.onLine, state: lineState().state, up: lineUp() }; });
  say('a real outage overrides good history', dead.onLine === false && dead.state === 'none' && dead.up === false,
      'onLine=' + dead.onLine + ' state=' + dead.state + ' up=' + dead.up);
  await p.evaluate(() => netSet('full'));

  /* ══ ⭐ THE QUEUE DECISION ITSELF — tillGet must not attempt a doomed fetch ══════════════════════════ */
  console.log('\n── a CloudHost read gate believes the same thing ' + '─'.repeat(6));
  const gated = await p.evaluate(async () => {
    CloudHost.key = 'test-key-for-lineup-check';
    LINE_TRIES.length = 0;
    lineNote(false, 4000); lineNote(false, 4000); lineNote(false, 4000);
    var r = await CloudHost.tillGet('/api/till/does-not-matter');
    LINE_TRIES.length = 0;   /* leave the page as we found it */
    delete CloudHost.key;
    return r;
  });
  say('it answers offline without attempting the fetch', gated.ok === false && gated.why === 'offline',
      JSON.stringify(gated));

  await b.close(); srv.close();
  console.log(bad ? '\n' + bad + ' failed' : '\nthe line is judged by what got through, not by the interface');
  process.exit(bad ? 1 : 0);
})();
