/* till-settings-perrow.cjs — EVERYTHING SAVES AS YOU CHANGE IT (design-handoff §4, Phase 4.2)
 *
 * "Per-row saving in Settings | Breaks anything that needs a batch or atomic save — check first."
 *
 * ⚠️⚠️ MOST ROWS ALREADY SAVED THIS WAY (voice was built onchange from the start, §3.1). The printer, the
 * counter key and the ChitBridge address were the last three staged until Close, in one saveSettings() that
 * read five fields regardless of which had changed. This proves each now saves on its own — BEFORE Close is
 * ever pressed — and that Close (saveSettings, still the name the button calls) does nothing beyond closing.
 *
 * ⭐⭐⭐ AND THE ONE REAL RISK: the counter key must save on change (blur/Enter), never on every keystroke —
 * a per-keystroke save would call DB.reopen() and throw away the screen (S = null) on a key half typed.
 *
 * Run: node e2e/till-settings-perrow.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(46) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const srv = http.createServer((q, r) => {
    const url = q.url.split('?')[0];
    if (url.startsWith('/api/')) { r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{"ok":true}'); }
    const f = path.join(ROOT, decodeURIComponent(url).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 880 } })).newPage();
  await p.goto(base + '/till.html');
  await p.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });

  await p.evaluate((api) => {
    CloudHost.key = 'old-key-0000'; CloudHost.api = api; HOST = CloudHost;
    ls.set(tillGivenKey(), 'C1');
    window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR' }, at: new Date().toISOString(), items: [] };
    setMode('sell');
    openSettings();
  }, base);

  console.log('\n── ⭐⭐⭐ THE COUNTER KEY — must save on change, never on a keystroke ' + '─'.repeat(1));
  const typing = await p.evaluate(() => {
    var el = document.getElementById('set_key');
    el.value = 'half-typed-so-f';                   /* set programmatically — the way fill() without blur behaves */
    el.dispatchEvent(new Event('input', { bubbles: true }));   /* what every keystroke actually fires */
    return { keyNow: CloudHost.key, sBeforeBlur: window.S !== null };
  });
  say('⚠️ a keystroke alone must not save it', typing.keyNow === 'old-key-0000', 'CloudHost.key is still "' + typing.keyNow + '"');
  say('⚠️⚠️ and must not have thrown the screen away mid-type', typing.sBeforeBlur, 'S is still set');

  console.log('\n── THE CHITBRIDGE ADDRESS — same test ' + '─'.repeat(30));
  const apiSaved = await p.evaluate((api2) => {
    var el = document.getElementById('set_api');
    el.value = api2 + '/v2';
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { apiNow: CloudHost.api, stored: ls.get('cb_till_api', '') };
  }, base);
  say('saves on change, before Close', apiSaved.apiNow.endsWith('/v2'), 'CloudHost.api is "' + apiSaved.apiNow + '"');
  say('to storage too', apiSaved.stored.endsWith('/v2'), 'ls holds "' + apiSaved.stored + '"');

  console.log('\n── THE PRINTER GROUP — three rows, one shared save ' + '─'.repeat(13));
  const printer = await p.evaluate(async () => {
    var calls = [];
    HOST.mode = 'agent';
    HOST.setPrinter = function(args){ calls.push(args); return Promise.resolve({ ok: true }); };
    HOST.printers = function(){ return Promise.resolve({ printers: [{ name: 'Epson TM', thermal: true }], chosen: 'Epson TM', mm: 80, drawer: false }); };
    PRINTERS = null;
    await paintPrinters();
    document.getElementById('set_drawer').checked = true;
    document.getElementById('set_drawer').dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((res) => setTimeout(res, 50));
    return { calls: calls.length, drawer: calls.length ? calls[0].drawer : null, printer: calls.length ? calls[0].printer : null };
  });
  say('flipping the cash drawer alone saves the whole row', printer.calls === 1, printer.calls + ' call(s) to setPrinter');
  say('with the drawer set as changed', printer.drawer === true, 'drawer=' + printer.drawer);
  say('and the printer choice carried along, not dropped', printer.printer === 'Epson TM', 'printer="' + printer.printer + '"');

  console.log('\n── CLOSE DOES NOTHING BUT CLOSE ' + '─'.repeat(35));
  const closed = await p.evaluate(() => {
    var calls = 0;
    var origRefresh = window.refresh, origLoad = window.load;
    window.refresh = function(){ calls++; return Promise.resolve(); };
    window.load = function(){ calls++; return Promise.resolve(); };
    saveSettings();
    var r = { dialogOpen: document.getElementById('setdlg').open, extraCalls: calls };
    window.refresh = origRefresh; window.load = origLoad;
    return r;
  });
  say('the dialog closes', closed.dialogOpen === false, 'setdlg.open is false');
  say('⭐ and reads nothing, calls nothing — every row already saved itself', closed.extraCalls === 0,
      closed.extraCalls + ' extra refresh/load call(s) from Close');


  console.log('\n── ⭐⭐⭐ THE COUNTER KEY, COMMITTED — last, because it now RELOADS the page ' + '─'.repeat(1));
  /* ⚠️ MOVED, NOT DELETED (2026-09-28, G1). This asserted the key saved and the dialog stayed open with no reload.
     A new key is a new shop, and becomeShop() — the one door to a shop — stores it and RELOADS so the start-up
     path opens that shop; a repaint in place carried the bill, the day and the person across (Athi's report).
     So: saved on change (still never on a keystroke, above), and the page goes away, never repainted. */
  /* the printer check above switched the page to the shop-PC host; the key row belongs to a BROWSER counter */
  await p.evaluate(() => { CloudHost.mode = 'cloud'; HOST = CloudHost; openSettings(); });
  await p.waitForSelector('#set_key', { timeout: 10000 });
  const nav = p.waitForEvent('load', { timeout: 20000 }).then(() => true).catch(() => false);
  await p.evaluate(() => {
    var el = document.getElementById('set_key');
    el.value = 'new-shop-key-999';
    el.dispatchEvent(new Event('change', { bubbles: true }));   /* what blur / Enter actually fires */
  });
  const reloaded = await nav;
  const stored = await p.evaluate(() => localStorage.getItem('cb_till_key'));
  say('⭐ change (blur/Enter) does save it', stored === 'new-shop-key-999', 'storage holds "' + stored + '"');
  say('⭐⭐⭐ and the page RELOADS into that shop — never a repaint', reloaded, reloaded ? 'reloaded' : 'no reload');

  await b.close(); srv.close();
  console.log(bad ? '\n' + bad + ' failed' : '\neverything saves as you change it, and closing loses nothing because there is nothing left to lose');
  process.exit(bad ? 1 : 0);
})();
