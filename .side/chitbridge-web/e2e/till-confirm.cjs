/* till-confirm.cjs — THE CAUTION AT THE MOMENT OF THE ACT ([TILL-172], design-handoff/footer step 1)
 *
 * The CAREFUL strip said "everything is sent and checked first" before the button was pressed, where it could
 * not be measured. The package's sharpest point: at that moment it is a CLAIM; at the moment of the press it
 * could be a NUMBER. So each of the three now opens a sheet carrying the live figures the promise rests on.
 *
 * ⚠️⚠️ AND A FAILING CHECK REORDERS THE WORK RATHER THAN REFUSING IT. Three bills still waiting does not mean
 * "you may not close" — it means "send 3 first, then close", which is what the person wanted anyway. A refusal
 * with no way forward is how people learn to press through warnings.
 *
 * Run: node e2e/till-confirm.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(36) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

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
  const p = await (await b.newContext({ viewport: { width: 900, height: 900 } })).newPage();
  await p.goto(base + '/till.html');
  await p.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });
  await p.evaluate((api) => {
    CloudHost.key = 'k'; CloudHost.api = api; HOST = CloudHost;
    WHO = { id: 'u1', name: 'Bala', kind: 'coassist', since: new Date().toISOString() };
    window.S = { shop: { country: 'IN', name: 'Mayur Bhavan' }, at: new Date().toISOString(), items: [] };
    setMode('sell');
  }, base);

  console.log('\n── the sheet, with nothing waiting ' + '─'.repeat(26));
  const clean = await p.evaluate(async () => {
    STATE = Object.assign({}, STATE || {}, { queued: 0 });
    await sureSheet('close');
    const d = document.getElementById('suredlg');
    return { open: !!(d && d.open), text: document.getElementById('surebody').innerText.replace(/\s+/g, ' ').trim(),
             go: (document.querySelector('[data-testid="till-sure-go"]') || {}).innerText,
             no: (document.querySelector('[data-testid="till-sure-no"]') || {}).innerText,
             rows: document.querySelectorAll('.srw').length };
  });
  say('it asks at the moment of the act', clean.open, 'the sheet opened');
  /* ⭐ the consequence, not the adjective (§3.2) */
  say('it says the consequence', /Billing stops until someone opens it again/.test(clean.text), 'no "CAREFUL"');
  say('and never shouts', !/CAREFUL|careful/.test(clean.text), 'the word has left this screen');
  /* ⭐ the numbers the promise rests on (§3.3) */
  say('it shows the live figures', clean.rows === 3, clean.rows + ' checked rows');
  say('including what is waiting', /Waiting to send none/.test(clean.text), 'counted, not claimed');
  /* ⭐ the button is named with its verb (§3.4) */
  say('the button names the act', /Close the counter/i.test(clean.go), '"' + clean.go + '"');
  say('and the safe way out is plain', /Not now/i.test(clean.no), '"' + clean.no + '"');

  /* ══ ⚠️⚠️ REORDERED, NOT REFUSED ═════════════════════════════════════════════════════════════════════ */
  console.log('\n── with three bills still waiting ' + '─'.repeat(27));
  const stuck = await p.evaluate(async () => {
    sureClose();
    STATE = Object.assign({}, STATE || {}, { queued: 3 });
    await sureSheet('close');
    return { text: document.getElementById('surebody').innerText.replace(/\s+/g, ' ').trim(),
             go: (document.querySelector('[data-testid="till-sure-go"]') || {}).innerText,
             blocked: !!document.querySelector('[data-testid="till-sure-blocked"]'),
             disabled: !!(document.querySelector('[data-testid="till-sure-go"]') || {}).disabled };
  });
  say('it says what is outstanding', stuck.blocked && /3 bills have not reached the shop/.test(stuck.text),
      'named, with the number');
  /* ⚠️⚠️ THE POINT: the destructive path is reordered, never simply blocked */
  say('⚠️⚠️ and the button reorders the work', /Send 3 first, then close/i.test(stuck.go), '"' + stuck.go + '"');
  say('it is never disabled', stuck.disabled === false, 'a dead button teaches people to press through');

  console.log('\n── the other two ' + '─'.repeat(44));
  for (const [kind, want] of [['signout', 'Sign out, Bala?'], ['repair', 'Repair this counter?']]) {
    const r = await p.evaluate(async (k) => {
      sureClose(); await sureSheet(k);
      return { t: (document.querySelector('#surebody h3') || {}).innerText,
               go: (document.querySelector('[data-testid="till-sure-go"]') || {}).innerText };
    }, kind);
    say(kind + ' names the person or the act', r.t === want, '"' + r.t + '" → "' + r.go + '"');
  }

  /* ⭐ and Not now really does nothing */
  const away = await p.evaluate(() => {
    document.querySelector('[data-testid="till-sure-no"]').click();
    return { open: document.getElementById('suredlg').open };
  });
  say('Not now closes and changes nothing', away.open === false, 'the way out works');

  fs.mkdirSync(path.join(__dirname, '..', 'png'), { recursive: true });
  await p.evaluate(async () => { STATE.queued = 0; await sureSheet('close'); });
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(__dirname, '..', 'png', 'ConfirmSheet.png') });

  await b.close(); srv.close();
  console.log(bad ? '\n' + bad + ' failed' : '\nthe caution travels with the action, and carries the numbers');
  process.exit(bad ? 1 : 0);
})();
