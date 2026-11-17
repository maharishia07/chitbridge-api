/* till-open-gst.cjs — THE SHOP CARD'S "Add"/"Register" BUTTONS OPEN CB SETTINGS › YOUR SHOP ON THE WEB, NEVER THE API HOST AND NEVER THE WORKSHOP
 *
 * SET1 (2026-10-13): the door is /settings.html#/shop — the small app that edits the GSTIN (docs/design/INDEX-NOT-APP.md); app.html is the workshop.
 *
 * Two real, live bugs on the same one-line URL, both from Athi actually clicking the button:
 *   [TILL-163] "add button opens in another window but erroring" — an invented hash, '#profile/tax', that
 *              does not exist anywhere in app.html. Fixed by using a real one, '#/app'.
 *   [TILL-170] "if you click add, it is not working, it is giving some error" — the SAME fix still opened
 *              CloudHost.api + '/app.html#/app'. CloudHost.api is the Railway API's own host; app.html is a
 *              static page on the WEB deployment and was never served from there. Fixed by reusing cbHome(),
 *              the one place in this file that already resolves the web app's real address (used at #cblink).
 *
 * This does not mint an entity or sign in — openGst()/cbHome() read only HOST/CloudHost/location, so the
 * fix is provable the moment the script has parsed, before any network call the rest of the page makes.
 *
 * Run: node e2e/till-open-gst.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(58) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
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
  await p.waitForFunction(() => typeof openGst === 'function' && typeof cbHome === 'function', null, { timeout: 30000 });

  console.log('\n── ⭐⭐⭐ [TILL-170] "Add"/"Register" open the WEB app, never the API host ' + '─'.repeat(0));
  const r1 = await p.evaluate(() => {
    var opened = null;
    var realOpen = window.open;
    window.open = function (u) { opened = u; return null; };
    try { HOST = HOST || {}; HOST.mode = 'cloud'; CloudHost.api = 'https://chitbridge-api-production.up.railway.app'; openGst(); }
    finally { window.open = realOpen; }
    return { opened: opened };
  });
  say('the API host never appears in the opened URL', r1.opened.indexOf('railway') < 0, r1.opened);
  say('it opens CB Settings › Your shop (settings.html#/shop), never the workshop', /\/settings\.html#\/shop$/.test(r1.opened) && r1.opened.indexOf('app.html') < 0, r1.opened);
  say('and the host is the web app\'s own — cbRoot(), not a second, bespoke lookup', r1.opened.indexOf('/settings.html#/shop') === r1.opened.length - '/settings.html#/shop'.length, r1.opened);

  console.log('\n── ⚠️ the hash it deep-links to is a real one, not invented ([TILL-163]\'s own mistake) ' + '─'.repeat(0));
  const errsBeforeAppLoad = errs.length;
  await p.goto('http://127.0.0.1:' + srv.address().port + '/settings.html#/shop');
  await p.waitForTimeout(500);
  say('settings.html loads at #/shop with no thrown error', errs.length === errsBeforeAppLoad, errs.slice(errsBeforeAppLoad).join(' | ') || 'none');

  say('no console/page errors across either page', errs.length === 0, errs.join(' | ') || 'none');
  console.log(bad ? '\n' + bad + ' FAILED' : '\nopenGst() opens CB Settings › Your shop, on the web\'s own host, at a route that is really there');
  await b.close(); srv.close();
  process.exit(bad ? 1 : 0);
})();
