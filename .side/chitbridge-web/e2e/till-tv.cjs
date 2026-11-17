/**
 * e2e/till-tv.cjs — 📺 SHOP SCREEN FROM THE COUNTER'S OWN MENU: the address, a one-time code, a share icon,
 * how many screens are paired, and a switch that turns one off (2026-09-27).
 *
 * Athi: "can we give the URL and the code to display as a share icon in the screen menu itself, so no one need
 * to search that" · "can we show how many connection exists already and a switch to revoke".
 * Drives the REAL dialog in till.html; the three API answers are local stand-ins, so this proves the screen,
 * while tests/key-scopes proves the server's rules. Run: node e2e/till-tv.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
            '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(60) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  let screens = [
    { jti: 'aaa111', name: 'shop screen · paired 2026-09-20', last4: 'Q7xZ', paired_at: '2026-09-20T10:00:00Z', seen_at: '2026-09-27T09:12:00Z', alive: true },
    { jti: 'bbb222', name: 'shop screen · paired 2026-09-25', last4: 'k2Pw', paired_at: '2026-09-25T10:00:00Z', seen_at: null, alive: true },
  ];
  const calls = [];
  const srv = http.createServer((q, r) => {
    const url = q.url.split('?')[0];
    if (url.startsWith('/api/')) {
      let body = ''; q.on('data', (c) => { body += c; }); q.on('end', () => {
        calls.push({ m: q.method, url, key: q.headers['x-api-key'] || null, body });
        r.writeHead(200, { 'content-type': 'application/json' });
        if (url === '/api/till/pair') return r.end(JSON.stringify({ code: 'KMT4RX', minutes: 10 }));
        if (url === '/api/till/screens') return r.end(JSON.stringify({ screens, count: screens.length }));
        if (url === '/api/till/screens/revoke') {
          const j = JSON.parse(body || '{}'); screens = screens.filter((s) => s.jti !== j.jti);
          return r.end(JSON.stringify({ ok: true, jti: j.jti }));
        }
        return r.end('{"ok":true}');
      });
      return;
    }
    const f = path.join(ROOT, decodeURIComponent(url).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 880 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(base + '/till.html');
  await p.waitForFunction(() => typeof window.openScreen === 'function', null, { timeout: 30000 });
  await p.evaluate((api) => {
    CloudHost.key = 'demo-key'; CloudHost.api = api; HOST = CloudHost;
    window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR' }, at: new Date().toISOString(), items: [], offers: [] };
    window.sure = async () => true;
    window.__copied = null;
    try { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); } catch (_) {}
    navigator.clipboard.writeText = async (t) => { window.__copied = t; };
  }, base);

  console.log('\n── 📺 Shop screen opens the dialog, and it says how many screens are paired');
  await p.evaluate(() => { openScreen(); });
  await p.waitForSelector('[data-testid="till-tv-row"]', { timeout: 5000 });
  const first = await p.evaluate(() => ({ open: document.getElementById('tvdlg').open,
    count: document.querySelector('[data-testid="till-tv-count"]').textContent.trim(),
    rows: document.querySelectorAll('[data-testid="till-tv-row"]').length,
    sws: document.querySelectorAll('[data-testid="till-tv-sw"].on').length }));
  say('the dialog is open', first.open, String(first.open));
  say('it counts the paired screens', first.count === '📺 2', first.count);
  say('one row per screen, each with its switch ON', first.rows === 2 && first.sws === 2, first.rows + ' rows · ' + first.sws + ' on');

  console.log('\n── 📡 Pair a TV: the address, a code, a share icon');
  await p.click('[data-testid="till-tv-pair"]');
  await p.waitForSelector('[data-testid="till-tv-codebox"]', { timeout: 5000 });
  const got = await p.evaluate(() => ({
    addr: document.querySelector('[data-testid="till-tv-addr"] span').textContent,
    code: document.querySelector('[data-testid="till-tv-codebox"]').textContent }));
  const pairCall = calls.find((c) => c.url === '/api/till/pair');
  say('the code is shown, large', got.code === 'KMT4RX', got.code);
  say('the address is the shop screen page', /\/promo\.html$/.test(got.addr), got.addr);
  say('it asked with THIS counter key', !!pairCall && pairCall.key === 'demo-key' && pairCall.m === 'POST', pairCall ? pairCall.key : 'no call');
  const box = await p.evaluate(() => { const r = document.querySelector('#tvdlg').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  await p.screenshot({ path: path.join(__dirname, 'shots', 'till-tv.png'), clip: box });
  await p.click('[data-testid="till-tv-share"]');
  const copied = await p.evaluate(() => window.__copied);
  say('🔗 share hands over the address AND the code', !!copied && copied.includes('/promo.html') && copied.includes('KMT4RX'), String(copied));

  console.log('\n── the switch turns one screen off');
  await p.click('[data-testid="till-tv-sw"] >> nth=1');
  await p.waitForFunction(() => document.querySelectorAll('[data-testid="till-tv-row"]').length === 1, null, { timeout: 5000 });
  const rev = calls.find((c) => c.url === '/api/till/screens/revoke');
  const after = await p.evaluate(() => document.querySelector('[data-testid="till-tv-count"]').textContent.trim());
  say('it asked ChitBridge to revoke THAT screen', !!rev && JSON.parse(rev.body).jti === 'bbb222', rev ? rev.body : 'no call');
  say('and the count drops to what is left', after === '📺 1', after);

  /* ⭐ Athi: "i should be able to remove and add item as i like and the changes has to be immediate" — the card's
     "Pick for the shop screen" switch was STAGED until Save, so his second pick never left the counter */
  console.log('\n── the product card\'s screen switch saves the moment it is flipped (no Save)');
  await p.evaluate(() => { tvClose();
    S.items = [{ item_id: 'it-1', name: 'Masala Dosa', price: 70, unit: 'plate', category: 'Tiffin' }];
    MODE = 'maintain'; CARD_ID = 'it-1'; pendClear(); paintCard(); });
  await p.waitForSelector('[data-testid="card-screen"]', { state: 'attached', timeout: 5000 });
  const n0 = calls.filter((c) => c.url === '/api/till/flags').length;
  await p.evaluate(() => document.querySelector('[data-testid="card-screen"]').click());
  await p.waitForFunction((n) => true, n0);
  await p.waitForTimeout(500);
  const flagsOn = calls.filter((c) => c.url === '/api/till/flags').slice(n0);
  const onState = await p.evaluate(() => ({ sw: document.querySelector('[data-testid="card-screen"]').classList.contains('on'),
    pending: PEND.screen !== undefined, note: (document.getElementById('lastnote') || {}).textContent || '' }));
  say('flipping it ON writes to ChitBridge at once', flagsOn.length === 1 && JSON.parse(flagsOn[0].body).screen === true, flagsOn.map((c) => c.body).join(' '));
  say('nothing is left waiting for Save', onState.pending === false && onState.sw === true, JSON.stringify({ sw: onState.sw, pending: onState.pending }));
  say('it says so', /on the shop screen now/.test(onState.note), onState.note);
  await p.evaluate(() => document.querySelector('[data-testid="card-screen"]').click());
  await p.waitForTimeout(500);
  const flagsOff = calls.filter((c) => c.url === '/api/till/flags').slice(n0 + 1);
  say('flipping it OFF writes at once too', flagsOff.length === 1 && JSON.parse(flagsOff[0].body).screen === false, flagsOff.map((c) => c.body).join(' '));

  say('console/page errors', !errs.length, errs.length ? errs.join(' | ').slice(0, 200) : 'none');
  await b.close(); srv.close();
  console.log(bad ? '\n' + bad + ' FAILED' : '\nthe shop screen can be paired and switched off from the counter');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
